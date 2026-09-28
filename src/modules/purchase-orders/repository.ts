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
  PO_STATUSES,
  type CreatePurchaseOrderInput,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
  type UpdatePurchaseOrderInput,
} from "./schema.ts";

interface OrderRow {
  id: string;
  reference: string;
  supplier_id: string;
  status: PurchaseOrderStatus;
  expected_at: string | null;
  notes: string | null;
  created_by: string;
  approved_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
}

interface LineRow {
  id: string;
  purchase_order_id: string;
  part_id: string;
  quantity: number;
  unit_price_idr: number;
  received_quantity: number;
  part_sku: string;
  part_name: string;
}

function toLine(row: LineRow): PurchaseOrderLine {
  return {
    id: row.id,
    partId: row.part_id,
    partSku: row.part_sku,
    partName: row.part_name,
    quantity: row.quantity,
    unitPriceIdr: row.unit_price_idr,
    receivedQuantity: row.received_quantity,
    lineTotalIdr: row.quantity * row.unit_price_idr,
  };
}

function toOrder(row: OrderRow, lines: PurchaseOrderLine[]): PurchaseOrder {
  return {
    id: row.id,
    reference: row.reference,
    supplierId: row.supplier_id,
    supplier: row.supplier_code
      ? { id: row.supplier_id, code: row.supplier_code, name: row.supplier_name as string }
      : null,
    status: row.status,
    expectedAt: row.expected_at,
    notes: row.notes,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    lines,
    totalIdr: lines.reduce((sum, line) => sum + line.lineTotalIdr, 0),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    receivedAt: row.received_at,
    cancelledAt: row.cancelled_at,
  };
}

const ORDER_SELECT = `
  SELECT o.*, s.code AS supplier_code, s.name AS supplier_name
    FROM purchase_orders o
    LEFT JOIN suppliers s ON s.id = o.supplier_id`;

const LINE_SELECT = `
  SELECT l.*, p.sku AS part_sku, p.name AS part_name
    FROM purchase_order_lines l
    JOIN parts p ON p.id = l.part_id
   WHERE l.purchase_order_id = ?
   ORDER BY p.sku ASC`;

export class PurchaseOrderRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  #linesFor(orderId: string): PurchaseOrderLine[] {
    const rows = this.#db.prepare(LINE_SELECT).all(orderId) as unknown as LineRow[];
    return rows.map(toLine);
  }

  /** Reference numbers are sequential per calendar year: PO-2026-0007. */
  #nextReference(): string {
    const year = new Date().getUTCFullYear();
    const row = this.#db
      .prepare("SELECT COUNT(*) AS count FROM purchase_orders WHERE reference LIKE ?")
      .get(`PO-${year}-%`) as { count: number };
    return `PO-${year}-${String(row.count + 1).padStart(4, "0")}`;
  }

  list(params: URLSearchParams): Page<PurchaseOrder> {
    const query = parseListQuery(params, {
      sortable: {
        reference: "o.reference",
        status: "o.status",
        createdAt: "o.created_at",
        expectedAt: "o.expected_at",
      },
      defaultSort: "createdAt",
      filters: {
        status: enumFilter(PO_STATUSES),
        supplierId: textFilter(64),
        createdBy: textFilter(120),
      },
    });

    const where = new WhereBuilder()
      .addIf(query.filters["status"], "o.status = ?", query.filters["status"])
      .addIf(query.filters["supplierId"], "o.supplier_id = ?", query.filters["supplierId"])
      .addIf(query.filters["createdBy"], "o.created_by = ?", query.filters["createdBy"]);

    const total = this.#db
      .prepare(`SELECT COUNT(*) AS count FROM purchase_orders o ${where.sql}`)
      .get(...(where.values as never[])) as { count: number };

    const rows = this.#db
      .prepare(
        `${ORDER_SELECT} ${where.sql}
         ORDER BY ${query.sort} ${query.direction === "asc" ? "ASC" : "DESC"}
         LIMIT ? OFFSET ?`,
      )
      .all(...([...where.values, query.limit, query.offset] as never[])) as unknown as OrderRow[];

    return page(
      rows.map((row) => toOrder(row, this.#linesFor(row.id))),
      total.count,
      query,
    );
  }

  findById(id: string): PurchaseOrder | undefined {
    const row = this.#db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id) as OrderRow | undefined;
    return row ? toOrder(row, this.#linesFor(row.id)) : undefined;
  }

  findByReference(reference: string): PurchaseOrder | undefined {
    const row = this.#db.prepare(`${ORDER_SELECT} WHERE o.reference = ?`).get(reference) as
      | OrderRow
      | undefined;
    return row ? toOrder(row, this.#linesFor(row.id)) : undefined;
  }

  /**
   * Creates the header and all lines in one transaction, so a failure on any
   * line leaves no partial order behind.
   */
  create(input: CreatePurchaseOrderInput, createdBy: string): PurchaseOrder {
    const id = randomUUID();
    const now = new Date().toISOString();
    const reference = this.#nextReference();

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          `INSERT INTO purchase_orders
             (id, reference, supplier_id, status, expected_at, notes, created_by, version, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, 1, ?, ?)`,
        )
        .run(id, reference, input.supplierId, input.expectedAt, input.notes, createdBy, now, now);

      const insertLine = this.#db.prepare(
        `INSERT INTO purchase_order_lines
           (id, purchase_order_id, part_id, quantity, unit_price_idr, received_quantity)
         VALUES (?, ?, ?, ?, ?, 0)`,
      );

      for (const line of input.lines) {
        insertLine.run(randomUUID(), id, line.partId, line.quantity, line.unitPriceIdr);
      }

      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }

    return this.findById(id) as PurchaseOrder;
  }

  update(
    id: string,
    input: UpdatePurchaseOrderInput,
    expectedVersion: number,
  ): PurchaseOrder | undefined {
    const current = this.findById(id);
    if (!current) return undefined;

    const merged = { ...current, ...input };
    const result = this.#db
      .prepare(
        `UPDATE purchase_orders
            SET expected_at = ?, notes = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?`,
      )
      .run(merged.expectedAt, merged.notes, new Date().toISOString(), id, expectedVersion);

    return result.changes > 0 ? this.findById(id) : undefined;
  }

  /** Moves the order to a new status and stamps the matching timestamp column. */
  transition(
    id: string,
    to: PurchaseOrderStatus,
    expectedVersion: number,
    actorName: string,
  ): PurchaseOrder | undefined {
    const now = new Date().toISOString();
    const stampColumn: Partial<Record<PurchaseOrderStatus, string>> = {
      submitted: "submitted_at",
      approved: "approved_at",
      received: "received_at",
      cancelled: "cancelled_at",
    };

    // `column` comes from the map above, never from a request value.
    const column = stampColumn[to];
    const approvedBy = to === "approved" ? ", approved_by = ?" : "";
    const values: unknown[] = [to, now];
    if (to === "approved") values.push(actorName);
    values.push(now, id, expectedVersion);

    const result = this.#db
      .prepare(
        `UPDATE purchase_orders
            SET status = ?, ${column} = ?${approvedBy}, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?`,
      )
      .run(...(values as never[]));

    return result.changes > 0 ? this.findById(id) : undefined;
  }

  /**
   * Records the receipt and increments part stock in a single transaction.
   *
   * Either every line is received and every stock balance moves, or nothing
   * changes. This is the rule that makes the inventory trustworthy.
   */
  receive(
    id: string,
    receipts: { partId: string; receivedQuantity: number }[],
    expectedVersion: number,
  ): PurchaseOrder | undefined {
    const now = new Date().toISOString();

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const header = this.#db
        .prepare(
          `UPDATE purchase_orders
              SET status = 'received', received_at = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND version = ?`,
        )
        .run(now, now, id, expectedVersion);

      if (header.changes === 0) {
        this.#db.exec("ROLLBACK");
        return undefined;
      }

      const updateLine = this.#db.prepare(
        `UPDATE purchase_order_lines
            SET received_quantity = ?
          WHERE purchase_order_id = ? AND part_id = ?`,
      );
      const updateStock = this.#db.prepare(
        `UPDATE parts
            SET stock_quantity = stock_quantity + ?, version = version + 1, updated_at = ?
          WHERE id = ?`,
      );

      for (const receipt of receipts) {
        updateLine.run(receipt.receivedQuantity, id, receipt.partId);
        if (receipt.receivedQuantity > 0) {
          updateStock.run(receipt.receivedQuantity, now, receipt.partId);
        }
      }

      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }

    return this.findById(id);
  }
}
