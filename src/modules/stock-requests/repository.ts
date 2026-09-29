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
  SR_STATUSES,
  type CreateStockRequestInput,
  type StockRequest,
  type StockRequestStatus,
} from "./schema.ts";

interface StockRequestRow {
  id: string;
  reference: string;
  part_id: string;
  quantity: number;
  requested_by: string;
  job_reference: string | null;
  status: StockRequestStatus;
  note: string | null;
  decided_by: string | null;
  version: number;
  created_at: string;
  decided_at: string | null;
  part_sku: string | null;
  part_name: string | null;
}

function toStockRequest(row: StockRequestRow): StockRequest {
  return {
    id: row.id,
    reference: row.reference,
    partId: row.part_id,
    part: row.part_sku
      ? { id: row.part_id, sku: row.part_sku, name: row.part_name as string }
      : null,
    quantity: row.quantity,
    requestedBy: row.requested_by,
    jobReference: row.job_reference,
    status: row.status,
    note: row.note,
    decidedBy: row.decided_by,
    version: row.version,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

const JOIN_SELECT = `
  SELECT r.*, p.sku AS part_sku, p.name AS part_name
    FROM stock_requests r
    LEFT JOIN parts p ON p.id = r.part_id`;

export class StockRequestRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Reference numbers are sequential per calendar year: SR-2026-0007. */
  #nextReference(): string {
    const year = new Date().getUTCFullYear();
    const row = this.#db
      .prepare("SELECT COUNT(*) AS count FROM stock_requests WHERE reference LIKE ?")
      .get(`SR-${year}-%`) as { count: number };
    return `SR-${year}-${String(row.count + 1).padStart(4, "0")}`;
  }

  list(params: URLSearchParams): Page<StockRequest> {
    const query = parseListQuery(params, {
      sortable: {
        reference: "r.reference",
        createdAt: "r.created_at",
        quantity: "r.quantity",
        status: "r.status",
      },
      defaultSort: "createdAt",
      filters: {
        status: enumFilter(SR_STATUSES),
        partId: textFilter(64),
        requestedBy: textFilter(120),
      },
    });

    const where = new WhereBuilder()
      .addIf(query.filters["status"], "r.status = ?", query.filters["status"])
      .addIf(query.filters["partId"], "r.part_id = ?", query.filters["partId"])
      .addIf(query.filters["requestedBy"], "r.requested_by = ?", query.filters["requestedBy"]);

    const total = this.#db
      .prepare(`SELECT COUNT(*) AS count FROM stock_requests r ${where.sql}`)
      .get(...(where.values as never[])) as { count: number };

    const rows = this.#db
      .prepare(
        `${JOIN_SELECT} ${where.sql}
         ORDER BY ${query.sort} ${query.direction === "asc" ? "ASC" : "DESC"}
         LIMIT ? OFFSET ?`,
      )
      .all(...([...where.values, query.limit, query.offset] as never[])) as unknown as StockRequestRow[];

    return page(rows.map(toStockRequest), total.count, query);
  }

  findById(id: string): StockRequest | undefined {
    const row = this.#db.prepare(`${JOIN_SELECT} WHERE r.id = ?`).get(id) as
      | StockRequestRow
      | undefined;
    return row ? toStockRequest(row) : undefined;
  }

  create(input: CreateStockRequestInput): StockRequest {
    const id = randomUUID();
    const now = new Date().toISOString();
    const reference = this.#nextReference();

    this.#db
      .prepare(
        `INSERT INTO stock_requests
           (id, reference, part_id, quantity, requested_by, job_reference, status, note, version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?)`,
      )
      .run(id, reference, input.partId, input.quantity, input.requestedBy, input.jobReference, input.note, now);

    return this.findById(id) as StockRequest;
  }

  /**
   * Moves a request out of pending. Guarded by version so a concurrent
   * decision changes no rows and the caller can return 412.
   */
  decide(
    id: string,
    to: StockRequestStatus,
    expectedVersion: number,
    decidedBy: string,
  ): StockRequest | undefined {
    const result = this.#db
      .prepare(
        `UPDATE stock_requests
            SET status = ?, decided_by = ?, decided_at = ?, version = version + 1
          WHERE id = ? AND version = ?`,
      )
      .run(to, decidedBy, new Date().toISOString(), id, expectedVersion);

    return result.changes > 0 ? this.findById(id) : undefined;
  }
}
