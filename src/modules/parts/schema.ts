import { Validator, requireNonEmptyUpdate } from "../../core/validation.ts";

export interface Part {
  id: string;
  sku: string;
  name: string;
  category: string;
  vehicleModel: string;
  unitPriceIdr: number;
  stockQuantity: number;
  reorderLevel: number;
  warehouse: string;
  supplierId: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A part joined with its supplier, returned by the list and detail endpoints. */
export interface PartWithSupplier extends Part {
  supplier: { id: string; code: string; name: string; leadTimeDays: number } | null;
  belowReorderLevel: boolean;
}

export type CreatePartInput = Omit<Part, "id" | "version" | "createdAt" | "updatedAt">;
export type UpdatePartInput = Partial<Omit<CreatePartInput, "sku" | "stockQuantity">>;

export const CATEGORIES = ["brake", "filter", "suspension", "electrical", "engine", "body"] as const;
export type Category = (typeof CATEGORIES)[number];

export const ADJUSTMENT_REASONS = ["stock_take", "damage", "return", "correction"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface StockAdjustmentInput {
  delta: number;
  reason: AdjustmentReason;
  note: string | null;
}

const SKU_PATTERN = /^AOP-[A-Z]{3}-\d{4}$/;

const CREATE_FIELDS = [
  "sku",
  "name",
  "category",
  "vehicleModel",
  "unitPriceIdr",
  "stockQuantity",
  "reorderLevel",
  "warehouse",
  "supplierId",
  "isActive",
] as const;

const UPDATE_FIELDS = [
  "name",
  "category",
  "vehicleModel",
  "unitPriceIdr",
  "reorderLevel",
  "warehouse",
  "supplierId",
  "isActive",
] as const;

export function parseCreatePart(input: unknown): CreatePartInput {
  const v = Validator.forBody(input);
  v.rejectUnknown(CREATE_FIELDS);

  const sku = v.pattern("sku", SKU_PATTERN, "AOP-XXX-0000");
  const name = v.string("name");
  const category = v.oneOf("category", CATEGORIES);
  const vehicleModel = v.string("vehicleModel");
  const warehouse = v.string("warehouse", { max: 40 });
  const unitPriceIdr = v.integer("unitPriceIdr", { min: 0, max: 5_000_000_000 });
  const stockQuantity = v.integer("stockQuantity", { min: 0, max: 1_000_000 });
  const reorderLevel = v.has("reorderLevel")
    ? v.integer("reorderLevel", { min: 0, max: 100_000, required: false })
    : 10;
  const supplierId =
    v.has("supplierId") && v.raw("supplierId") !== null && v.raw("supplierId") !== ""
      ? v.string("supplierId", { max: 64, required: false })
      : null;
  const isActive = v.has("isActive") ? v.boolean("isActive", { required: false }) : true;

  v.settle();

  return {
    sku: sku as string,
    name: name as string,
    category: category as string,
    vehicleModel: vehicleModel as string,
    unitPriceIdr: unitPriceIdr as number,
    stockQuantity: stockQuantity as number,
    reorderLevel: reorderLevel ?? 10,
    warehouse: warehouse as string,
    supplierId: supplierId ?? null,
    isActive: isActive ?? true,
  };
}

export function parseUpdatePart(input: unknown): UpdatePartInput {
  const v = Validator.forBody(input);
  v.rejectUnknown(UPDATE_FIELDS);

  if (v.has("sku")) v.reject("sku", "cannot be changed after a part is created");
  if (v.has("stockQuantity")) {
    v.reject("stockQuantity", "cannot be set directly; use POST /api/parts/:id/adjust-stock");
  }

  const update: UpdatePartInput = {};
  if (v.has("name")) {
    const value = v.string("name");
    if (value !== undefined) update.name = value;
  }
  if (v.has("category")) {
    const value = v.oneOf("category", CATEGORIES);
    if (value !== undefined) update.category = value;
  }
  if (v.has("vehicleModel")) {
    const value = v.string("vehicleModel");
    if (value !== undefined) update.vehicleModel = value;
  }
  if (v.has("warehouse")) {
    const value = v.string("warehouse", { max: 40 });
    if (value !== undefined) update.warehouse = value;
  }
  if (v.has("unitPriceIdr")) {
    const value = v.integer("unitPriceIdr", { min: 0, max: 5_000_000_000 });
    if (value !== undefined) update.unitPriceIdr = value;
  }
  if (v.has("reorderLevel")) {
    const value = v.integer("reorderLevel", { min: 0, max: 100_000 });
    if (value !== undefined) update.reorderLevel = value;
  }
  if (v.has("supplierId")) {
    const raw = v.raw("supplierId");
    update.supplierId = raw === null || raw === "" ? null : (v.string("supplierId", { max: 64 }) ?? null);
  }
  if (v.has("isActive")) {
    const value = v.boolean("isActive");
    if (value !== undefined) update.isActive = value;
  }

  v.settle();
  requireNonEmptyUpdate(update);
  return update;
}

export function parseStockAdjustment(input: unknown): StockAdjustmentInput {
  const v = Validator.forBody(input);
  v.rejectUnknown(["delta", "reason", "note"]);

  const raw = v.raw("delta");
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    v.reject("delta", "must be an integer");
  } else if (raw === 0) {
    v.reject("delta", "must not be zero");
  } else if (Math.abs(raw) > 100_000) {
    v.reject("delta", "must be between -100000 and 100000");
  }

  const reason = v.oneOf("reason", ADJUSTMENT_REASONS);
  const note = v.has("note") && v.raw("note") !== null && v.raw("note") !== ""
    ? v.string("note", { max: 240, required: false })
    : undefined;

  v.settle();

  return { delta: raw as number, reason: reason as AdjustmentReason, note: note ?? null };
}
