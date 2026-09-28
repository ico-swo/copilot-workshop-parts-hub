import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../../core/errors.ts";
import type { Page } from "../../core/query.ts";
import type { AuditService } from "../audit/service.ts";
import type { Actor } from "../auth/types.ts";
import { SuppliersRepository } from "./repository.ts";
import type { CreateSupplierInput, Supplier, UpdateSupplierInput } from "./schema.ts";

export class SuppliersService {
  readonly #repository: SuppliersRepository;
  readonly #audit: AuditService;

  constructor(db: DatabaseSync, audit: AuditService) {
    this.#repository = new SuppliersRepository(db);
    this.#audit = audit;
  }

  list(params: URLSearchParams): Page<Supplier> {
    return this.#repository.list(params);
  }

  options() {
    return this.#repository.options();
  }

  getById(id: string): Supplier {
    const supplier = this.#repository.findById(id);
    if (!supplier) throw AppError.notFound("Supplier", id);
    return supplier;
  }

  create(input: CreateSupplierInput, actor: Actor, requestId: string): Supplier {
    if (this.#repository.findByCode(input.code)) {
      throw AppError.conflict("duplicate_code", `A supplier with code '${input.code}' already exists`);
    }

    const created = this.#repository.create(input);
    this.#audit.record({
      actor: actor.name,
      action: "supplier.created",
      entityType: "supplier",
      entityId: created.id,
      summary: `Created supplier ${created.code} (${created.name})`,
      requestId,
    });
    return created;
  }

  update(
    id: string,
    input: UpdateSupplierInput,
    expectedVersion: number | undefined,
    actor: Actor,
    requestId: string,
  ): Supplier {
    const current = this.getById(id);
    const version = expectedVersion ?? current.version;

    const updated = this.#repository.update(id, input, version);
    if (!updated) throw AppError.versionConflict("Supplier", version, current.version);

    this.#audit.record({
      actor: actor.name,
      action: "supplier.updated",
      entityType: "supplier",
      entityId: id,
      summary: `Updated fields: ${Object.keys(input).join(", ")}`,
      requestId,
    });
    return updated;
  }

  /**
   * Suppliers referenced by a part or an order cannot be deleted, because the
   * catalogue would lose its provenance. Deactivate them instead.
   */
  delete(id: string, actor: Actor, requestId: string): void {
    const supplier = this.getById(id);
    const parts = this.#repository.countPartsFor(id);
    const orders = this.#repository.countOrdersFor(id);

    if (parts > 0 || orders > 0) {
      throw AppError.conflict(
        "supplier_in_use",
        `Supplier '${supplier.code}' is referenced by ${parts} part(s) and ${orders} order(s). Deactivate it instead of deleting it.`,
      );
    }

    this.#repository.delete(id);
    this.#audit.record({
      actor: actor.name,
      action: "supplier.deleted",
      entityType: "supplier",
      entityId: id,
      summary: `Deleted supplier ${supplier.code}`,
      requestId,
    });
  }
}
