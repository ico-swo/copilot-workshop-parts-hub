import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { WhereBuilder, page, parseListQuery, textFilter, type Page } from "../../core/query.ts";

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  requestId: string | null;
}

interface AuditRow {
  id: string;
  occurred_at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  request_id: string | null;
}

function toEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actor: row.actor,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    requestId: row.request_id,
  };
}

export interface AuditInput {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  requestId?: string;
}

/**
 * Append-only record of every state change.
 *
 * There is no update or delete method, by design. Services call record()
 * inside the same transaction as the change it describes.
 */
export class AuditService {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  record(input: AuditInput): void {
    this.#db
      .prepare(
        `INSERT INTO audit_events (id, occurred_at, actor, action, entity_type, entity_id, summary, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        new Date().toISOString(),
        input.actor,
        input.action,
        input.entityType,
        input.entityId,
        input.summary,
        input.requestId ?? null,
      );
  }

  list(params: URLSearchParams): Page<AuditEvent> {
    const query = parseListQuery(params, {
      sortable: { occurredAt: "occurred_at", action: "action", entityType: "entity_type" },
      defaultSort: "occurredAt",
      filters: {
        entityType: textFilter(40),
        entityId: textFilter(64),
        actor: textFilter(120),
        action: textFilter(40),
      },
    });

    const where = new WhereBuilder()
      .addIf(query.filters["entityType"], "entity_type = ?", query.filters["entityType"])
      .addIf(query.filters["entityId"], "entity_id = ?", query.filters["entityId"])
      .addIf(query.filters["actor"], "actor = ?", query.filters["actor"])
      .addIf(query.filters["action"], "action = ?", query.filters["action"]);

    const total = this.#db
      .prepare(`SELECT COUNT(*) AS count FROM audit_events ${where.sql}`)
      .get(...(where.values as never[])) as { count: number };

    const rows = this.#db
      .prepare(
        `SELECT * FROM audit_events ${where.sql}
         ORDER BY ${query.sort} ${query.direction === "asc" ? "ASC" : "DESC"}, rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...([...where.values, query.limit, query.offset] as never[])) as unknown as AuditRow[];

    return page(rows.map(toEvent), total.count, query);
  }

  /**
   * Full history for one entity, newest first.
   *
   * Timestamps have millisecond resolution, so two events written in the same
   * transaction can tie. rowid breaks the tie in insertion order, which keeps
   * the trail deterministic.
   */
  forEntity(entityType: string, entityId: string, limit = 50): AuditEvent[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity_type = ? AND entity_id = ?
          ORDER BY occurred_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(entityType, entityId, limit) as unknown as AuditRow[];
    return rows.map(toEvent);
  }
}
