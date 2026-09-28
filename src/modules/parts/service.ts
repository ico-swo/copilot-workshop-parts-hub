import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../../core/errors.ts";
import type { Page } from "../../core/query.ts";
import type { AuditService } from "../audit/service.ts";
import type { Actor } from "../auth/types.ts";
import { SuppliersRepository } from "../suppliers/repository.ts";
import { PartsRepository } from "./repository.ts";
import type {
  CreatePartInput,
  PartWithSupplier,
  StockAdjustmentInput,
  UpdatePartInput,
} from "./schema.ts";

export class PartsService {
  readonly #repository: PartsRepository;
  readonly #suppliers: SuppliersRepository;
  readonly #audit: AuditService;

  constructor(db: DatabaseSync, audit: AuditService) {
    this.#repository = new PartsRepository(db);
    this.#suppliers = new SuppliersRepository(db);
    this.#audit = audit;
  }

  list(params: URLSearchParams): Page<PartWithSupplier> {
    return this.#repository.list(params);
  }

  options() {
    return this.#repository.options();
  }

  warehouses() {
    return this.#repository.warehouses();
  }

  getById(id: string): PartWithSupplier {
    const part = this.#repository.findById(id);
    if (!part) throw AppError.notFound("Part", id);
    return part;
  }

  summary() {
    return this.#repository.summary();
  }

  #assertSupplierUsable(supplierId: string | null | undefined): void {
    if (!supplierId) return;

    const supplier = this.#suppliers.findById(supplierId);
    if (!supplier) {
      throw AppError.badRequest("The request body failed validation", {
        supplierId: `no supplier exists with id '${supplierId}'`,
      });
    }
    if (!supplier.isActive) {
      throw AppError.conflict(
        "supplier_inactive",
        `Supplier '${supplier.code}' is inactive and cannot be assigned to a part`,
      );
    }
  }

  create(input: CreatePartInput, actor: Actor, requestId: string): PartWithSupplier {
    if (this.#repository.findBySku(input.sku)) {
      throw AppError.conflict("duplicate_sku", `A part with SKU '${input.sku}' already exists`);
    }
    this.#assertSupplierUsable(input.supplierId);

    const created = this.#repository.create(input);
    this.#audit.record({
      actor: actor.name,
      action: "part.created",
      entityType: "part",
      entityId: created.id,
      summary: `Created part ${created.sku} with opening stock ${created.stockQuantity}`,
      requestId,
    });
    return created;
  }

  update(
    id: string,
    input: UpdatePartInput,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): PartWithSupplier {
    const current = this.getById(id);
    if ("supplierId" in input) this.#assertSupplierUsable(input.supplierId);

    const version = expectedVersion ?? current.version;
    const updated = this.#repository.update(id, input, version);
    if (!updated) throw AppError.versionConflict("Part", version, current.version);

    this.#audit.record({
      actor: actor.name,
      action: "part.updated",
      entityType: "part",
      entityId: id,
      summary: `Updated fields: ${Object.keys(input).join(", ")}`,
      requestId,
    });
    return updated;
  }

  /**
   * Relative stock movement with an explicit reason.
   *
   * Stock is never set to an absolute value through the API: a delta plus a
   * reason is what makes the audit trail reconstructable.
   */
  adjustStock(
    id: string,
    input: StockAdjustmentInput,
    actor: Actor,
    requestId: string,
  ): PartWithSupplier {
    const current = this.getById(id);

    if (current.stockQuantity + input.delta < 0) {
      throw AppError.conflict(
        "insufficient_stock",
        `Part '${current.sku}' holds ${current.stockQuantity} units; an adjustment of ${input.delta} would make the balance negative`,
      );
    }

    const updated = this.#repository.adjustStock(id, input.delta);
    if (!updated) {
      throw AppError.conflict("adjustment_failed", "The stock adjustment could not be applied");
    }

    this.#audit.record({
      actor: actor.name,
      action: "part.stock_adjusted",
      entityType: "part",
      entityId: id,
      summary: `${input.delta > 0 ? "+" : ""}${input.delta} units (${input.reason}), balance ${current.stockQuantity} to ${updated.stockQuantity}${input.note ? ` — ${input.note}` : ""}`,
      requestId,
    });
    return updated;
  }

  /** Parts at or below their own reorder level, most urgent first. */
  reorderList(): PartWithSupplier[] {
    const params = new URLSearchParams({
      belowReorder: "true",
      active: "true",
      sort: "stockQuantity",
      direction: "asc",
      limit: "100",
    });
    return this.#repository.list(params).items;
  }

  delete(id: string, actor: Actor, requestId: string): void {
    const part = this.getById(id);
    const openLines = this.#repository.countOpenOrderLines(id);

    if (openLines > 0) {
      throw AppError.conflict(
        "part_in_use",
        `Part '${part.sku}' appears on ${openLines} open purchase order line(s) and cannot be deleted`,
      );
    }

    this.#repository.delete(id);
    this.#audit.record({
      actor: actor.name,
      action: "part.deleted",
      entityType: "part",
      entityId: id,
      summary: `Deleted part ${part.sku}`,
      requestId,
    });
  }
}
