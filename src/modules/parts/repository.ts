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
import {
  CATEGORIES,
  type CreatePartInput,
  type Part,
  type PartWithSupplier,
  type UpdatePartInput,
} from "./schema.ts";

interface PartRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  vehicle_model: string;
  unit_price_idr: number;
  stock_quantity: number;
  reorder_level: number;
  warehouse: string;
  supplier_id: string | null;
  is_active: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface PartWithSupplierRow extends PartRow {
  supplier_code: string | null;
  supplier_name: string | null;
  supplier_lead_time: number | null;
}

function toPart(row: PartRow): Part {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    vehicleModel: row.vehicle_model,
    unitPriceIdr: row.unit_price_idr,
    stockQuantity: row.stock_quantity,
    reorderLevel: row.reorder_level,
    warehouse: row.warehouse,
    supplierId: row.supplier_id,
    isActive: row.is_active === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPartWithSupplier(row: PartWithSupplierRow): PartWithSupplier {
  const part = toPart(row);
  return {
    ...part,
    supplier:
      row.supplier_id && row.supplier_code
        ? {
            id: row.supplier_id,
            code: row.supplier_code,
            name: row.supplier_name as string,
            leadTimeDays: row.supplier_lead_time as number,
          }
        : null,
    belowReorderLevel: part.stockQuantity <= part.reorderLevel,
  };
}

const JOIN_SELECT = `
  SELECT p.*,
         s.code           AS supplier_code,
         s.name           AS supplier_name,
         s.lead_time_days AS supplier_lead_time
    FROM parts p
    LEFT JOIN suppliers s ON s.id = p.supplier_id`;

export class PartsRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  list(params: URLSearchParams): Page<PartWithSupplier> {
    const query = parseListQuery(params, {
      sortable: {
        sku: "p.sku",
        name: "p.name",
        category: "p.category",
        unitPriceIdr: "p.unit_price_idr",
        stockQuantity: "p.stock_quantity",
        createdAt: "p.created_at",
      },
      defaultSort: "sku",
      filters: {
        category: enumFilter(CATEGORIES),
        warehouse: textFilter(40),
        supplierId: textFilter(64),
        search: textFilter(60),
        active: enumFilter(["true", "false"] as const),
        belowReorder: enumFilter(["true"] as const),
      },
    });

    const search = query.filters["search"];
    const where = new WhereBuilder()
      .addIf(query.filters["category"], "p.category = ?", query.filters["category"])
      .addIf(query.filters["warehouse"], "p.warehouse = ?", query.filters["warehouse"])
      .addIf(query.filters["supplierId"], "p.supplier_id = ?", query.filters["supplierId"])
      .addIf(search, "(p.name LIKE ? OR p.sku LIKE ?)", `%${search}%`, `%${search}%`)
      .addIf(query.filters["active"], "p.is_active = ?", query.filters["active"] === "true" ? 1 : 0)
      .addIf(query.filters["belowReorder"], "p.stock_quantity <= p.reorder_level");

    const total = this.#db
      .prepare(`SELECT COUNT(*) AS count FROM parts p ${where.sql}`)
      .get(...(where.values as never[])) as { count: number };

    const rows = this.#db
      .prepare(
        `${JOIN_SELECT} ${where.sql}
         ORDER BY ${query.sort} ${query.direction === "asc" ? "ASC" : "DESC"}
         LIMIT ? OFFSET ?`,
      )
      .all(...([...where.values, query.limit, query.offset] as never[])) as unknown as PartWithSupplierRow[];

    return page(rows.map(toPartWithSupplier), total.count, query);
  }

  /** Active parts, for the line-item pickers in the dashboard forms. */
  options(): { id: string; sku: string; name: string; unitPriceIdr: number; stockQuantity: number }[] {
    const rows = this.#db
      .prepare("SELECT * FROM parts WHERE is_active = 1 ORDER BY sku ASC")
      .all() as unknown as PartRow[];
    return rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      unitPriceIdr: row.unit_price_idr,
      stockQuantity: row.stock_quantity,
    }));
  }

  findById(id: string): PartWithSupplier | undefined {
    const row = this.#db.prepare(`${JOIN_SELECT} WHERE p.id = ?`).get(id) as
      | PartWithSupplierRow
      | undefined;
    return row ? toPartWithSupplier(row) : undefined;
  }

  findBySku(sku: string): Part | undefined {
    const row = this.#db.prepare("SELECT * FROM parts WHERE sku = ?").get(sku) as PartRow | undefined;
    return row ? toPart(row) : undefined;
  }

  create(input: CreatePartInput): PartWithSupplier {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.#db
      .prepare(
        `INSERT INTO parts
           (id, sku, name, category, vehicle_model, unit_price_idr, stock_quantity,
            reorder_level, warehouse, supplier_id, is_active, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        input.sku,
        input.name,
        input.category,
        input.vehicleModel,
        input.unitPriceIdr,
        input.stockQuantity,
        input.reorderLevel,
        input.warehouse,
        input.supplierId,
        input.isActive ? 1 : 0,
        now,
        now,
      );

    return this.findById(id) as PartWithSupplier;
  }

  update(id: string, input: UpdatePartInput, expectedVersion: number): PartWithSupplier | undefined {
    const current = this.findById(id);
    if (!current) return undefined;

    const merged = { ...current, ...input };
    const result = this.#db
      .prepare(
        `UPDATE parts
            SET name = ?, category = ?, vehicle_model = ?, unit_price_idr = ?,
                reorder_level = ?, warehouse = ?, supplier_id = ?, is_active = ?,
                version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        merged.name,
        merged.category,
        merged.vehicleModel,
        merged.unitPriceIdr,
        merged.reorderLevel,
        merged.warehouse,
        merged.supplierId,
        merged.isActive ? 1 : 0,
        new Date().toISOString(),
        id,
        expectedVersion,
      );

    return result.changes > 0 ? this.findById(id) : undefined;
  }

  /**
   * Applies a relative change to stock.
   *
   * The guard in the WHERE clause means an over-draw changes no rows rather
   * than producing a negative balance; callers still check availability first
   * so they can return a meaningful error.
   */
  adjustStock(id: string, delta: number): PartWithSupplier | undefined {
    const result = this.#db
      .prepare(
        `UPDATE parts
            SET stock_quantity = stock_quantity + ?, version = version + 1, updated_at = ?
          WHERE id = ? AND stock_quantity + ? >= 0`,
      )
      .run(delta, new Date().toISOString(), id, delta);

    return result.changes > 0 ? this.findById(id) : undefined;
  }

  delete(id: string): boolean {
    return this.#db.prepare("DELETE FROM parts WHERE id = ?").run(id).changes > 0;
  }

  countOpenOrderLines(partId: string): number {
    const row = this.#db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM purchase_order_lines l
           JOIN purchase_orders o ON o.id = l.purchase_order_id
          WHERE l.part_id = ? AND o.status IN ('draft', 'submitted', 'approved')`,
      )
      .get(partId) as { count: number };
    return row.count;
  }

  /** Inventory totals for the dashboard, computed in SQL rather than in JS. */
  summary(): {
    totalParts: number;
    activeParts: number;
    belowReorder: number;
    stockValueIdr: number;
    warehouses: number;
  } {
    const row = this.#db
      .prepare(
        `SELECT COUNT(*)                                          AS total_parts,
                COALESCE(SUM(is_active), 0)                       AS active_parts,
                COALESCE(SUM(stock_quantity <= reorder_level), 0) AS below_reorder,
                COALESCE(SUM(unit_price_idr * stock_quantity), 0) AS stock_value,
                COUNT(DISTINCT warehouse)                         AS warehouses
           FROM parts`,
      )
      .get() as {
      total_parts: number;
      active_parts: number;
      below_reorder: number;
      stock_value: number;
      warehouses: number;
    };

    return {
      totalParts: row.total_parts,
      activeParts: row.active_parts,
      belowReorder: row.below_reorder,
      stockValueIdr: row.stock_value,
      warehouses: row.warehouses,
    };
  }

  /** Distinct warehouse names, for the filter and form dropdowns. */
  warehouses(): string[] {
    const rows = this.#db
      .prepare("SELECT DISTINCT warehouse FROM parts ORDER BY warehouse ASC")
      .all() as unknown as { warehouse: string }[];
    return rows.map((row) => row.warehouse);
  }
}
