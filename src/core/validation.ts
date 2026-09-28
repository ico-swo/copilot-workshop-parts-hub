import { AppError } from "./errors.ts";

/**
 * A small, dependency-free validation kit.
 *
 * Collect every problem into a field-error map, then throw once, so the caller
 * sees all invalid fields in a single response instead of one per round trip.
 * The dashboard relies on this: it maps `error.details` straight onto its form
 * inputs.
 */

export type FieldErrors = Record<string, string>;

const MAX_TEXT = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class Validator {
  readonly #source: Record<string, unknown>;
  readonly #errors: FieldErrors = {};

  private constructor(source: Record<string, unknown>) {
    this.#source = source;
  }

  static forBody(input: unknown): Validator {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw AppError.badRequest("Request body must be a JSON object");
    }
    return new Validator(input as Record<string, unknown>);
  }

  has(field: string): boolean {
    return field in this.#source;
  }

  raw(field: string): unknown {
    return this.#source[field];
  }

  reject(field: string, reason: string): void {
    this.#errors[field] = reason;
  }

  string(field: string, opts: { max?: number; required?: boolean } = {}): string | undefined {
    const value = this.#source[field];
    if (value === undefined || value === null) {
      if (opts.required !== false) this.#errors[field] = "is required";
      return undefined;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      this.#errors[field] = "must be a non-empty string";
      return undefined;
    }
    const max = opts.max ?? MAX_TEXT;
    if (value.length > max) {
      this.#errors[field] = `must be at most ${max} characters`;
      return undefined;
    }
    return value.trim();
  }

  pattern(field: string, regex: RegExp, hint: string): string | undefined {
    const value = this.string(field);
    if (value === undefined) return undefined;
    if (!regex.test(value)) {
      this.#errors[field] = `must match the pattern ${hint}`;
      return undefined;
    }
    return value;
  }

  email(field: string): string | undefined {
    const value = this.string(field);
    if (value === undefined) return undefined;
    if (!EMAIL_PATTERN.test(value)) {
      this.#errors[field] = "must be a valid email address";
      return undefined;
    }
    return value;
  }

  integer(
    field: string,
    opts: { min?: number; max?: number; required?: boolean } = {},
  ): number | undefined {
    const value = this.#source[field];
    if (value === undefined || value === null) {
      if (opts.required !== false) this.#errors[field] = "is required";
      return undefined;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      this.#errors[field] = "must be an integer";
      return undefined;
    }
    const min = opts.min ?? 0;
    if (value < min) {
      this.#errors[field] = `must be greater than or equal to ${min}`;
      return undefined;
    }
    if (opts.max !== undefined && value > opts.max) {
      this.#errors[field] = `must be less than or equal to ${opts.max}`;
      return undefined;
    }
    return value;
  }

  boolean(field: string, opts: { required?: boolean } = {}): boolean | undefined {
    const value = this.#source[field];
    if (value === undefined || value === null) {
      if (opts.required !== false) this.#errors[field] = "is required";
      return undefined;
    }
    if (typeof value !== "boolean") {
      this.#errors[field] = "must be true or false";
      return undefined;
    }
    return value;
  }

  oneOf<T extends string>(
    field: string,
    allowed: readonly T[],
    opts: { required?: boolean } = {},
  ): T | undefined {
    const value = this.#source[field];
    if (value === undefined || value === null) {
      if (opts.required !== false) this.#errors[field] = "is required";
      return undefined;
    }
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      this.#errors[field] = `must be one of: ${allowed.join(", ")}`;
      return undefined;
    }
    return value as T;
  }

  isoDate(field: string, opts: { required?: boolean } = {}): string | undefined {
    const value = this.#source[field];
    if (value === undefined || value === null) {
      if (opts.required !== false) this.#errors[field] = "is required";
      return undefined;
    }
    if (
      typeof value !== "string" ||
      !ISO_DATE_PATTERN.test(value) ||
      Number.isNaN(Date.parse(value))
    ) {
      this.#errors[field] = "must be a date in YYYY-MM-DD format";
      return undefined;
    }
    return value;
  }

  array<T>(
    field: string,
    parseItem: (item: unknown, index: number) => T,
    opts: { min?: number; max?: number } = {},
  ): T[] | undefined {
    const value = this.#source[field];
    if (!Array.isArray(value)) {
      this.#errors[field] = "must be an array";
      return undefined;
    }
    const min = opts.min ?? 1;
    const max = opts.max ?? 100;
    if (value.length < min) {
      this.#errors[field] = `must contain at least ${min} item(s)`;
      return undefined;
    }
    if (value.length > max) {
      this.#errors[field] = `must contain at most ${max} item(s)`;
      return undefined;
    }

    const parsed: T[] = [];
    value.forEach((item, index) => {
      try {
        parsed.push(parseItem(item, index));
      } catch (error) {
        if (error instanceof AppError && error.details) {
          for (const [key, reason] of Object.entries(error.details)) {
            this.#errors[`${field}[${index}].${key}`] = reason;
          }
        } else {
          this.#errors[`${field}[${index}]`] = "is invalid";
        }
      }
    });

    return parsed;
  }

  /** Rejects any field the caller sent that the endpoint does not accept. */
  rejectUnknown(allowed: readonly string[]): void {
    for (const key of Object.keys(this.#source)) {
      if (!allowed.includes(key)) {
        this.#errors[key] = "is not an accepted field";
      }
    }
  }

  get errors(): FieldErrors {
    return this.#errors;
  }

  settle(message = "The request body failed validation"): void {
    if (Object.keys(this.#errors).length > 0) {
      throw AppError.badRequest(message, this.#errors);
    }
  }
}

/** Guards a PATCH payload that parsed cleanly but changed nothing. */
export function requireNonEmptyUpdate(update: object): void {
  if (Object.keys(update).length === 0) {
    throw AppError.badRequest("The request body failed validation", {
      body: "must contain at least one field to update",
    });
  }
}
