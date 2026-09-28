import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  WhereBuilder,
  enumFilter,
  page,
  parseListQuery,
  textFilter,
  type Page,
} from "../../core/query.ts";
import type { CreateSupplierInput, Supplier, UpdateSupplierInput } from "./schema.ts";

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  contact_email: string;
  phone: string | null;
  country: string;
  lead_time_days: number;
  is_active: number;
  version: number;
  created_at: string;
  updated_at: string;
}

function toSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contactEmail: row.contact_email,
    phone: row.phone,
    country: row.country,
    leadTimeDays: row.lead_time_days,
    isActive: row.is_active === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SuppliersRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  list(params: URLSearchParams): Page<Supplier> {
    const query = parseListQuery(params, {
      sortable: {
        code: "code",
        name: "name",
        country: "country",
        leadTimeDays: "lead_time_days",
        createdAt: "created_at",
      },
      defaultSort: "code",
      filters: {
        country: textFilter(60),
        search: textFilter(60),
        active: enumFilter(["true", "false"] as const),
      },
    });

    const search = query.filters["search"];
    const where = new WhereBuilder()
      .addIf(query.filters["country"], "country = ?", query.filters["country"])
      .addIf(search, "(name LIKE ? OR code LIKE ?)", `%${search}%`, `%${search}%`)
      .addIf(query.filters["active"], "is_active = ?", query.filters["active"] === "true" ? 1 : 0);

    const total = this.#db
      .prepare(`SELECT COUNT(*) AS count FROM suppliers ${where.sql}`)
      .get(...(where.values as never[])) as { count: number };

    const rows = this.#db
      .prepare(
        `SELECT * FROM suppliers ${where.sql}
         ORDER BY ${query.sort} ${query.direction === "asc" ? "ASC" : "DESC"}
         LIMIT ? OFFSET ?`,
      )
      .all(...([...where.values, query.limit, query.offset] as never[])) as unknown as SupplierRow[];

    return page(rows.map(toSupplier), total.count, query);
  }

  /** Every active supplier, for the dropdowns in the dashboard forms. */
  options(): { id: string; code: string; name: string; leadTimeDays: number }[] {
    const rows = this.#db
      .prepare("SELECT * FROM suppliers WHERE is_active = 1 ORDER BY code ASC")
      .all() as unknown as SupplierRow[];
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      leadTimeDays: row.lead_time_days,
    }));
  }

  findById(id: string): Supplier | undefined {
    const row = this.#db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id) as SupplierRow | undefined;
    return row ? toSupplier(row) : undefined;
  }

  findByCode(code: string): Supplier | undefined {
    const row = this.#db.prepare("SELECT * FROM suppliers WHERE code = ?").get(code) as SupplierRow | undefined;
    return row ? toSupplier(row) : undefined;
  }

  create(input: CreateSupplierInput): Supplier {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.#db
      .prepare(
        `INSERT INTO suppliers
           (id, code, name, contact_email, phone, country, lead_time_days, is_active, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        input.code,
        input.name,
        input.contactEmail,
        input.phone,
        input.country,
        input.leadTimeDays,
        input.isActive ? 1 : 0,
        now,
        now,
      );

    return this.findById(id) as Supplier;
  }

  /**
   * Applies an update only if the stored version still matches, so a write
   * based on stale data is rejected rather than silently overwriting.
   * Returns undefined when the guard did not match.
   */
  update(id: string, input: UpdateSupplierInput, expectedVersion: number): Supplier | undefined {
    const current = this.findById(id);
    if (!current) return undefined;

    const merged = { ...current, ...input };
    const result = this.#db
      .prepare(
        `UPDATE suppliers
            SET name = ?, contact_email = ?, phone = ?, country = ?,
                lead_time_days = ?, is_active = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        merged.name,
        merged.contactEmail,
        merged.phone,
        merged.country,
        merged.leadTimeDays,
        merged.isActive ? 1 : 0,
        new Date().toISOString(),
        id,
        expectedVersion,
      );

    return result.changes > 0 ? this.findById(id) : undefined;
  }

  delete(id: string): boolean {
    return this.#db.prepare("DELETE FROM suppliers WHERE id = ?").run(id).changes > 0;
  }

  countPartsFor(supplierId: string): number {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS count FROM parts WHERE supplier_id = ?")
      .get(supplierId) as { count: number };
    return row.count;
  }

  countOrdersFor(supplierId: string): number {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS count FROM purchase_orders WHERE supplier_id = ?")
      .get(supplierId) as { count: number };
    return row.count;
  }
}
