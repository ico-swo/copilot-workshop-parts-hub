import { Validator } from "../../core/validation.ts";

export const SR_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type StockRequestStatus = (typeof SR_STATUSES)[number];

/**
 * The allowed state transitions, as data. Served to the dashboard at
 * GET /api/stock-requests/transitions so the UI never hard-codes them.
 */
export const ALLOWED_TRANSITIONS: Record<StockRequestStatus, readonly StockRequestStatus[]> = {
  pending: ["approved", "rejected", "cancelled"],
  approved: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: StockRequestStatus, to: StockRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface StockRequest {
  id: string;
  reference: string;
  partId: string;
  part: { id: string; sku: string; name: string } | null;
  quantity: number;
  requestedBy: string;
  jobReference: string | null;
  status: StockRequestStatus;
  note: string | null;
  decidedBy: string | null;
  version: number;
  createdAt: string;
  decidedAt: string | null;
}

export interface CreateStockRequestInput {
  partId: string;
  quantity: number;
  requestedBy: string;
  jobReference: string | null;
  note: string | null;
}

function optionalString(v: Validator, field: string, max: number): string | null {
  if (!v.has(field)) return null;
  const raw = v.raw(field);
  if (raw === null || raw === "") return null;
  return v.string(field, { max, required: false }) ?? null;
}

export function parseCreateStockRequest(input: unknown): CreateStockRequestInput {
  const v = Validator.forBody(input);
  v.rejectUnknown(["partId", "quantity", "requestedBy", "jobReference", "note"]);

  if (v.has("status")) v.reject("status", "cannot be set directly; use the transition endpoints");

  const partId = v.string("partId", { max: 64 });
  const quantity = v.integer("quantity", { min: 1, max: 500 });
  const requestedBy = v.string("requestedBy", { max: 120 });
  const jobReference = optionalString(v, "jobReference", 40);
  const note = optionalString(v, "note", 240);

  v.settle();

  return {
    partId: partId as string,
    quantity: quantity as number,
    requestedBy: requestedBy as string,
    jobReference,
    note,
  };
}

export function parseRejection(input: unknown): string {
  const v = Validator.forBody(input);
  v.rejectUnknown(["reason"]);
  const reason = v.string("reason", { max: 240 });
  v.settle();
  return reason as string;
}

/** Approve and cancel take no body; an empty object is accepted, anything else is refused. */
export function parseEmptyBody(input: unknown): void {
  if (input === undefined || input === null) return;
  const v = Validator.forBody(input);
  v.rejectUnknown([]);
  v.settle();
}
