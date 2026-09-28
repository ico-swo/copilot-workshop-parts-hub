import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../../core/errors.ts";
import type { Page } from "../../core/query.ts";
import type { AuditService } from "../audit/service.ts";
import type { Actor } from "../auth/types.ts";
import { PartsRepository } from "../parts/repository.ts";
import { SuppliersRepository } from "../suppliers/repository.ts";
import { PurchaseOrderRepository } from "./repository.ts";
import {
  canTransition,
  type CreatePurchaseOrderInput,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type ReceiveLineInput,
  type UpdatePurchaseOrderInput,
} from "./schema.ts";

/**
 * Procurement workflow.
 *
 * An order moves draft -> submitted -> approved -> received, and can be
 * cancelled from any state before receipt. Receiving is the only operation
 * that increases stock, and it does so transactionally.
 */
export class PurchaseOrderService {
  readonly #repository: PurchaseOrderRepository;
  readonly #parts: PartsRepository;
  readonly #suppliers: SuppliersRepository;
  readonly #audit: AuditService;

  constructor(db: DatabaseSync, audit: AuditService) {
    this.#repository = new PurchaseOrderRepository(db);
    this.#parts = new PartsRepository(db);
    this.#suppliers = new SuppliersRepository(db);
    this.#audit = audit;
  }

  list(params: URLSearchParams): Page<PurchaseOrder> {
    return this.#repository.list(params);
  }

  getById(id: string): PurchaseOrder {
    const order = this.#repository.findById(id);
    if (!order) throw AppError.notFound("Purchase order", id);
    return order;
  }

  create(input: CreatePurchaseOrderInput, actor: Actor, requestId: string): PurchaseOrder {
    const supplier = this.#suppliers.findById(input.supplierId);
    if (!supplier) {
      throw AppError.badRequest("The request body failed validation", {
        supplierId: `no supplier exists with id '${input.supplierId}'`,
      });
    }
    if (!supplier.isActive) {
      throw AppError.conflict(
        "supplier_inactive",
        `Supplier '${supplier.code}' is inactive and cannot receive new orders`,
      );
    }

    // Validate every line before writing anything, so the error names all
    // offending parts rather than failing on the first one.
    const lineErrors: Record<string, string> = {};
    input.lines.forEach((line, index) => {
      const part = this.#parts.findById(line.partId);
      if (!part) {
        lineErrors[`lines[${index}].partId`] = `no part exists with id '${line.partId}'`;
      } else if (!part.isActive) {
        lineErrors[`lines[${index}].partId`] = `part '${part.sku}' is inactive`;
      }
    });
    if (Object.keys(lineErrors).length > 0) {
      throw AppError.badRequest("The request body failed validation", lineErrors);
    }

    const created = this.#repository.create(input, actor.name);
    this.#audit.record({
      actor: actor.name,
      action: "purchase_order.created",
      entityType: "purchase_order",
      entityId: created.id,
      summary: `Created ${created.reference} for ${supplier.code} with ${created.lines.length} line(s), total ${created.totalIdr} IDR`,
      requestId,
    });
    return created;
  }

  update(
    id: string,
    input: UpdatePurchaseOrderInput,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): PurchaseOrder {
    const current = this.getById(id);
    if (current.status !== "draft") {
      throw AppError.invalidTransition("Purchase order", current.status, "edited");
    }

    const version = expectedVersion ?? current.version;
    const updated = this.#repository.update(id, input, version);
    if (!updated) throw AppError.versionConflict("Purchase order", version, current.version);

    this.#audit.record({
      actor: actor.name,
      action: "purchase_order.updated",
      entityType: "purchase_order",
      entityId: id,
      summary: `Updated fields: ${Object.keys(input).join(", ")}`,
      requestId,
    });
    return updated;
  }

  #transition(
    id: string,
    to: PurchaseOrderStatus,
    verb: string,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): PurchaseOrder {
    const current = this.getById(id);

    if (!canTransition(current.status, to)) {
      throw AppError.invalidTransition("Purchase order", current.status, verb);
    }

    const version = expectedVersion ?? current.version;
    const updated = this.#repository.transition(id, to, version, actor.name);
    if (!updated) throw AppError.versionConflict("Purchase order", version, current.version);

    this.#audit.record({
      actor: actor.name,
      action: `purchase_order.${to}`,
      entityType: "purchase_order",
      entityId: id,
      summary: `${current.reference} moved from ${current.status} to ${to}`,
      requestId,
    });
    return updated;
  }

  submit(
    id: string,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): PurchaseOrder {
    return this.#transition(id, "submitted", "submitted", expectedVersion, actor, requestId);
  }

  /** Approval is an admin action: the person who raised it cannot approve it. */
  approve(
    id: string,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): PurchaseOrder {
    const current = this.getById(id);
    if (current.createdBy === actor.name) {
      throw AppError.forbidden(
        `'${actor.name}' raised ${current.reference} and cannot approve it; segregation of duties requires a second person`,
      );
    }
    return this.#transition(id, "approved", "approved", expectedVersion, actor, requestId);
  }

  cancel(
    id: string,
    reason: string,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): PurchaseOrder {
    const cancelled = this.#transition(id, "cancelled", "cancelled", expectedVersion, actor, requestId);
    this.#audit.record({
      actor: actor.name,
      action: "purchase_order.cancellation_reason",
      entityType: "purchase_order",
      entityId: id,
      summary: reason,
      requestId,
    });
    return cancelled;
  }

  /**
   * Records goods receipt and increases stock for every received line.
   *
   * When no payload is supplied, each line is received in full. A supplied
   * payload may under-receive but never over-receive.
   */
  receive(
    id: string,
    receipts: ReceiveLineInput[] | undefined,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): PurchaseOrder {
    const current = this.getById(id);

    if (!canTransition(current.status, "received")) {
      throw AppError.invalidTransition("Purchase order", current.status, "received");
    }

    if (receipts) {
      const errors: Record<string, string> = {};
      receipts.forEach((receipt, index) => {
        const line = current.lines.find((l) => l.partId === receipt.partId);
        if (!line) {
          errors[`lines[${index}].partId`] = `part '${receipt.partId}' is not on ${current.reference}`;
        } else if (receipt.receivedQuantity > line.quantity) {
          errors[`lines[${index}].receivedQuantity`] =
            `must not exceed the ordered quantity of ${line.quantity}`;
        }
      });
      if (Object.keys(errors).length > 0) {
        throw AppError.badRequest("The request body failed validation", errors);
      }
    }

    const resolved = current.lines.map((line) => {
      const supplied = receipts?.find((r) => r.partId === line.partId);
      return { partId: line.partId, receivedQuantity: supplied?.receivedQuantity ?? line.quantity };
    });

    const version = expectedVersion ?? current.version;
    const received = this.#repository.receive(id, resolved, version);
    if (!received) throw AppError.versionConflict("Purchase order", version, current.version);

    const totalUnits = resolved.reduce((sum, r) => sum + r.receivedQuantity, 0);
    this.#audit.record({
      actor: actor.name,
      action: "purchase_order.received",
      entityType: "purchase_order",
      entityId: id,
      summary: `${current.reference} received: ${totalUnits} unit(s) across ${resolved.length} line(s), stock updated`,
      requestId,
    });
    return received;
  }
}
