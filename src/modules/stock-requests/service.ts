import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../../core/errors.ts";
import type { Page } from "../../core/query.ts";
import type { AuditService } from "../audit/service.ts";
import type { Actor } from "../auth/types.ts";
import { PartsRepository } from "../parts/repository.ts";
import { StockRequestRepository } from "./repository.ts";
import {
  canTransition,
  type CreateStockRequestInput,
  type StockRequest,
  type StockRequestStatus,
} from "./schema.ts";

/**
 * Stock requests: a technician draws parts from a warehouse for a job.
 *
 * pending -> approved | rejected | cancelled. Approval is the only transition
 * that moves stock, and it does so inside a single transaction together with
 * the status change.
 */
export class StockRequestService {
  readonly #db: DatabaseSync;
  readonly #repository: StockRequestRepository;
  readonly #parts: PartsRepository;
  readonly #audit: AuditService;

  constructor(db: DatabaseSync, audit: AuditService) {
    this.#db = db;
    this.#repository = new StockRequestRepository(db);
    this.#parts = new PartsRepository(db);
    this.#audit = audit;
  }

  list(params: URLSearchParams): Page<StockRequest> {
    return this.#repository.list(params);
  }

  getById(id: string): StockRequest {
    const request = this.#repository.findById(id);
    if (!request) throw AppError.notFound("Stock request", id);
    return request;
  }

  create(input: CreateStockRequestInput, actor: Actor, requestId: string): StockRequest {
    const part = this.#parts.findById(input.partId);
    if (!part) {
      throw AppError.badRequest("The request body failed validation", {
        partId: `no part exists with id '${input.partId}'`,
      });
    }
    if (!part.isActive) {
      throw AppError.badRequest("The request body failed validation", {
        partId: `part '${part.sku}' is inactive`,
      });
    }
    if (input.quantity > part.stockQuantity) {
      throw AppError.conflict(
        "insufficient_stock",
        `Requested ${input.quantity} of '${part.sku}' but only ${part.stockQuantity} in stock`,
      );
    }

    const created = this.#repository.create(input);
    this.#audit.record({
      actor: actor.name,
      action: "stock_request.created",
      entityType: "stock_request",
      entityId: created.id,
      summary: `Created ${created.reference}: ${created.quantity} x ${part.sku} for ${created.requestedBy}`,
      requestId,
    });
    return created;
  }

  #assertCanMove(current: StockRequest, to: StockRequestStatus): void {
    if (!canTransition(current.status, to)) {
      throw AppError.conflict(
        "already_resolved",
        `${current.reference} is already ${current.status} and cannot be ${to}`,
      );
    }
  }

  /**
   * Re-checks availability, decrements stock and records the decision in one
   * BEGIN IMMEDIATE transaction: either all of it happens or none of it does.
   */
  approve(
    id: string,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): StockRequest {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getById(id);
      this.#assertCanMove(current, "approved");

      const version = expectedVersion ?? current.version;
      if (version !== current.version) {
        throw AppError.versionConflict("Stock request", version, current.version);
      }

      // Stock may have moved since the request was raised.
      const part = this.#parts.findById(current.partId);
      if (!part || part.stockQuantity < current.quantity) {
        throw AppError.conflict(
          "insufficient_stock",
          `${current.reference} needs ${current.quantity} but only ${part?.stockQuantity ?? 0} in stock`,
        );
      }

      const adjusted = this.#parts.adjustStock(current.partId, -current.quantity);
      if (!adjusted) {
        throw AppError.conflict("insufficient_stock", `${current.reference} could not draw stock`);
      }

      const approved = this.#repository.decide(id, "approved", version, actor.name);
      if (!approved) throw AppError.versionConflict("Stock request", version, current.version);

      this.#audit.record({
        actor: actor.name,
        action: "stock_request.approved",
        entityType: "stock_request",
        entityId: id,
        summary: `${current.reference} approved: ${current.quantity} x ${part.sku} drawn, balance now ${adjusted.stockQuantity}`,
        requestId,
      });

      this.#db.exec("COMMIT");
      return approved;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  reject(
    id: string,
    reason: string,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): StockRequest {
    const current = this.getById(id);
    this.#assertCanMove(current, "rejected");

    const version = expectedVersion ?? current.version;
    const rejected = this.#repository.decide(id, "rejected", version, actor.name);
    if (!rejected) throw AppError.versionConflict("Stock request", version, current.version);

    this.#audit.record({
      actor: actor.name,
      action: "stock_request.rejected",
      entityType: "stock_request",
      entityId: id,
      summary: `${current.reference} rejected: ${reason}`,
      requestId,
    });
    return rejected;
  }

  /** Only the named requester may cancel their own pending request. */
  cancel(
    id: string,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): StockRequest {
    const current = this.getById(id);
    if (current.requestedBy !== actor.name) {
      throw AppError.forbidden(
        `Only '${current.requestedBy}' may cancel ${current.reference}`,
      );
    }
    this.#assertCanMove(current, "cancelled");

    const version = expectedVersion ?? current.version;
    const cancelled = this.#repository.decide(id, "cancelled", version, actor.name);
    if (!cancelled) throw AppError.versionConflict("Stock request", version, current.version);

    this.#audit.record({
      actor: actor.name,
      action: "stock_request.cancelled",
      entityType: "stock_request",
      entityId: id,
      summary: `${current.reference} cancelled by requester`,
      requestId,
    });
    return cancelled;
  }
}
