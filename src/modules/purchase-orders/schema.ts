import { Validator } from "../../core/validation.ts";
import { AppError } from "../../core/errors.ts";

export const PO_STATUSES = ["draft", "submitted", "approved", "received", "cancelled"] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

/**
 * The allowed state transitions.
 *
 * Keeping this as data rather than a chain of if-statements means the rule is
 * testable on its own, is the single place to change when the process changes,
 * and can be served to the dashboard so it knows which buttons to show.
 */
export const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "cancelled"],
  approved: ["received", "cancelled"],
  received: [],
  cancelled: [],
};

export function canTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface PurchaseOrderLine {
  id: string;
  partId: string;
  partSku: string;
  partName: string;
  quantity: number;
  unitPriceIdr: number;
  receivedQuantity: number;
  lineTotalIdr: number;
}

export interface PurchaseOrder {
  id: string;
  reference: string;
  supplierId: string;
  supplier: { id: string; code: string; name: string } | null;
  status: PurchaseOrderStatus;
  expectedAt: string | null;
  notes: string | null;
  createdBy: string;
  approvedBy: string | null;
  lines: PurchaseOrderLine[];
  totalIdr: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
}

export interface CreateLineInput {
  partId: string;
  quantity: number;
  unitPriceIdr: number;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  expectedAt: string | null;
  notes: string | null;
  lines: CreateLineInput[];
}

export interface ReceiveLineInput {
  partId: string;
  receivedQuantity: number;
}

function parseLine(item: unknown): CreateLineInput {
  const v = Validator.forBody(item);
  v.rejectUnknown(["partId", "quantity", "unitPriceIdr"]);

  const partId = v.string("partId", { max: 64 });
  const quantity = v.integer("quantity", { min: 1, max: 10_000 });
  const unitPriceIdr = v.integer("unitPriceIdr", { min: 0, max: 5_000_000_000 });

  v.settle();

  return {
    partId: partId as string,
    quantity: quantity as number,
    unitPriceIdr: unitPriceIdr as number,
  };
}

export function parseCreatePurchaseOrder(input: unknown): CreatePurchaseOrderInput {
  const v = Validator.forBody(input);
  v.rejectUnknown(["supplierId", "expectedAt", "notes", "lines"]);

  const supplierId = v.string("supplierId", { max: 64 });
  const expectedAt =
    v.has("expectedAt") && v.raw("expectedAt") !== null && v.raw("expectedAt") !== ""
      ? v.isoDate("expectedAt", { required: false })
      : null;
  const notes =
    v.has("notes") && v.raw("notes") !== null && v.raw("notes") !== ""
      ? v.string("notes", { max: 500, required: false })
      : null;
  const lines = v.array("lines", parseLine, { min: 1, max: 50 });

  v.settle();

  const parsedLines = lines as CreateLineInput[];
  const seen = new Set<string>();
  for (const line of parsedLines) {
    if (seen.has(line.partId)) {
      throw AppError.badRequest("The request body failed validation", {
        lines: `part '${line.partId}' appears more than once; combine the quantities into a single line`,
      });
    }
    seen.add(line.partId);
  }

  return {
    supplierId: supplierId as string,
    expectedAt: expectedAt ?? null,
    notes: notes ?? null,
    lines: parsedLines,
  };
}

export interface UpdatePurchaseOrderInput {
  expectedAt?: string | null;
  notes?: string | null;
}

export function parseUpdatePurchaseOrder(input: unknown): UpdatePurchaseOrderInput {
  const v = Validator.forBody(input);
  v.rejectUnknown(["expectedAt", "notes"]);

  if (v.has("status")) v.reject("status", "cannot be set directly; use the transition endpoints");
  if (v.has("lines")) v.reject("lines", "cannot be changed; cancel the order and raise a new one");

  const update: UpdatePurchaseOrderInput = {};
  if (v.has("expectedAt")) {
    const raw = v.raw("expectedAt");
    update.expectedAt = raw === null || raw === "" ? null : (v.isoDate("expectedAt") ?? null);
  }
  if (v.has("notes")) {
    const raw = v.raw("notes");
    update.notes = raw === null || raw === "" ? null : (v.string("notes", { max: 500 }) ?? null);
  }

  v.settle();

  if (Object.keys(update).length === 0) {
    throw AppError.badRequest("The request body failed validation", {
      body: "must contain at least one field to update",
    });
  }
  return update;
}

/**
 * The receipt payload is optional. When omitted, every line is received in
 * full; when supplied, it must reference lines that exist on the order.
 */
export function parseReceipt(input: unknown): ReceiveLineInput[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0) {
    return undefined;
  }

  const v = Validator.forBody(input);
  v.rejectUnknown(["lines"]);

  const lines = v.array(
    "lines",
    (item) => {
      const lv = Validator.forBody(item);
      lv.rejectUnknown(["partId", "receivedQuantity"]);
      const partId = lv.string("partId", { max: 64 });
      const receivedQuantity = lv.integer("receivedQuantity", { min: 0, max: 10_000 });
      lv.settle();
      return { partId: partId as string, receivedQuantity: receivedQuantity as number };
    },
    { min: 1, max: 50 },
  );

  v.settle();
  return lines as ReceiveLineInput[];
}

export function parseCancellation(input: unknown): string {
  const v = Validator.forBody(input);
  v.rejectUnknown(["reason"]);
  const reason = v.string("reason", { max: 240 });
  v.settle();
  return reason as string;
}
