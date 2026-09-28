import { AppError } from "./errors.ts";

/**
 * Query-string parsing for list endpoints.
 *
 * The sort field is resolved against an explicit allow-list and is the only
 * place in the codebase where a value from a request becomes part of a SQL
 * string. Anything not on the list is rejected, never interpolated.
 */

export interface ListQuery {
  limit: number;
  offset: number;
  sort: string;
  direction: "asc" | "desc";
  filters: Record<string, string>;
}

export interface ListQuerySpec {
  /** Maps an API sort key to its database column. */
  sortable: Record<string, string>;
  defaultSort: string;
  /** Maps an API filter key to a validator that returns the value to bind. */
  filters?: Record<string, (raw: string) => string>;
  maxLimit?: number;
}

export function parseListQuery(params: URLSearchParams, spec: ListQuerySpec): ListQuery {
  const errors: Record<string, string> = {};
  const maxLimit = spec.maxLimit ?? 100;

  const limit = Number.parseInt(params.get("limit") ?? "25", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    errors["limit"] = `must be an integer between 1 and ${maxLimit}`;
  }

  const offset = Number.parseInt(params.get("offset") ?? "0", 10);
  if (!Number.isInteger(offset) || offset < 0) {
    errors["offset"] = "must be an integer greater than or equal to 0";
  }

  const sortKey = params.get("sort") ?? spec.defaultSort;
  if (!(sortKey in spec.sortable)) {
    errors["sort"] = `must be one of: ${Object.keys(spec.sortable).join(", ")}`;
  }

  const directionRaw = (params.get("direction") ?? "asc").toLowerCase();
  if (directionRaw !== "asc" && directionRaw !== "desc") {
    errors["direction"] = "must be asc or desc";
  }

  const filters: Record<string, string> = {};
  for (const [key, validate] of Object.entries(spec.filters ?? {})) {
    const raw = params.get(key);
    if (raw === null || raw.length === 0) continue;
    try {
      filters[key] = validate(raw);
    } catch (error) {
      errors[key] = error instanceof Error ? error.message : "is invalid";
    }
  }

  if (Object.keys(errors).length > 0) {
    throw AppError.badRequest("The query string failed validation", errors);
  }

  return {
    limit,
    offset,
    // Resolved through the allow-list, so this is a known column name.
    sort: spec.sortable[sortKey] as string,
    direction: directionRaw as "asc" | "desc",
    filters,
  };
}

/** Builds a WHERE clause from named conditions, keeping values bound. */
export class WhereBuilder {
  readonly #clauses: string[] = [];
  readonly #values: unknown[] = [];

  add(clause: string, ...values: unknown[]): this {
    this.#clauses.push(clause);
    this.#values.push(...values);
    return this;
  }

  addIf(condition: unknown, clause: string, ...values: unknown[]): this {
    if (condition !== undefined && condition !== null && condition !== "") {
      this.add(clause, ...values);
    }
    return this;
  }

  get sql(): string {
    return this.#clauses.length > 0 ? `WHERE ${this.#clauses.join(" AND ")}` : "";
  }

  get values(): unknown[] {
    return [...this.#values];
  }
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function page<T>(items: T[], total: number, query: ListQuery): Page<T> {
  return { items, total, limit: query.limit, offset: query.offset };
}

/** Enforces an allow-list for a filter value, for use in a ListQuerySpec. */
export function enumFilter<T extends string>(allowed: readonly T[]): (raw: string) => string {
  return (raw) => {
    if (!allowed.includes(raw as T)) {
      throw new Error(`must be one of: ${allowed.join(", ")}`);
    }
    return raw;
  };
}

export function textFilter(maxLength = 120): (raw: string) => string {
  return (raw) => {
    if (raw.length > maxLength) throw new Error(`must be at most ${maxLength} characters`);
    return raw;
  };
}
