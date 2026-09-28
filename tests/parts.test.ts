import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { seededDatabase, ACTOR, REQUEST_ID } from "./helpers.ts";
import { PartsService } from "../src/modules/parts/service.ts";
import { SuppliersService } from "../src/modules/suppliers/service.ts";
import { AuditService } from "../src/modules/audit/service.ts";
import {
  parseCreatePart,
  parseStockAdjustment,
  parseUpdatePart,
} from "../src/modules/parts/schema.ts";
import { AppError } from "../src/core/errors.ts";

const newPart = {
  sku: "AOP-ENG-5099",
  name: "Water pump, replacement",
  category: "engine",
  vehicleModel: "Innova 2.0 G",
  unitPriceIdr: 890000,
  stockQuantity: 12,
  warehouse: "Jakarta-1",
};

let db: DatabaseSync;
let audit: AuditService;
let parts: PartsService;
let suppliers: SuppliersService;

beforeEach(() => {
  const seeded = seededDatabase();
  db = seeded.db;
  audit = seeded.audit;
  parts = new PartsService(db, audit);
  suppliers = new SuppliersService(db, audit);
});

describe("part validation", () => {
  test("accepts a well-formed part and applies the reorder-level default", () => {
    const parsed = parseCreatePart(newPart);
    assert.equal(parsed.reorderLevel, 10);
    assert.equal(parsed.isActive, true);
    assert.equal(parsed.supplierId, null);
  });

  test("rejects a SKU that does not match the catalogue pattern", () => {
    assert.throws(
      () => parseCreatePart({ ...newPart, sku: "BRK-1" }),
      (error: AppError) => error.status === 400 && error.details?.["sku"] !== undefined,
    );
  });

  test("reports every invalid field in a single response", () => {
    try {
      parseCreatePart({ ...newPart, sku: "nope", category: "tyres", unitPriceIdr: -5 });
      assert.fail("expected validation to throw");
    } catch (error) {
      assert.deepEqual(Object.keys((error as AppError).details ?? {}).sort(), [
        "category",
        "sku",
        "unitPriceIdr",
      ]);
    }
  });

  test("rejects a field the endpoint does not accept", () => {
    assert.throws(
      () => parseCreatePart({ ...newPart, isAdmin: true }),
      (error: AppError) => error.details?.["isAdmin"] === "is not an accepted field",
    );
  });

  test("treats an empty supplier selection as no supplier", () => {
    // The dashboard's select sends "" when the user picks the blank option.
    assert.equal(parseCreatePart({ ...newPart, supplierId: "" }).supplierId, null);
    assert.equal(parseUpdatePart({ supplierId: "" }).supplierId, null);
  });

  test("refuses to change an immutable SKU", () => {
    assert.throws(
      () => parseUpdatePart({ sku: "AOP-BRK-9999" }),
      (error: AppError) => error.details?.["sku"] !== undefined,
    );
  });

  test("refuses to set stock directly, pointing at the adjustment endpoint", () => {
    assert.throws(
      () => parseUpdatePart({ stockQuantity: 500 }),
      (error: AppError) => (error.details?.["stockQuantity"] ?? "").includes("adjust-stock"),
    );
  });

  test("refuses an update that changes nothing", () => {
    assert.throws(() => parseUpdatePart({}), (error: AppError) => error.status === 400);
  });

  test("rejects a zero stock adjustment", () => {
    assert.throws(
      () => parseStockAdjustment({ delta: 0, reason: "stock_take" }),
      (error: AppError) => error.details?.["delta"] === "must not be zero",
    );
  });

  test("requires a recognised adjustment reason", () => {
    assert.throws(
      () => parseStockAdjustment({ delta: 5, reason: "because" }),
      (error: AppError) => error.details?.["reason"] !== undefined,
    );
  });

  test("accepts an empty note from the adjustment form as null", () => {
    assert.equal(parseStockAdjustment({ delta: 5, reason: "return", note: "" }).note, null);
  });
});

describe("parts service", () => {
  test("creates a part and records an audit event", () => {
    const created = parts.create(parseCreatePart(newPart), ACTOR, REQUEST_ID);
    assert.equal(created.sku, newPart.sku);
    assert.equal(created.version, 1);

    const events = audit.forEntity("part", created.id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.action, "part.created");
    assert.equal(events[0]?.actor, ACTOR.name);
  });

  test("rejects a duplicate SKU with a typed conflict", () => {
    parts.create(parseCreatePart(newPart), ACTOR, REQUEST_ID);
    assert.throws(
      () => parts.create(parseCreatePart(newPart), ACTOR, REQUEST_ID),
      (error: AppError) => error.status === 409 && error.code === "duplicate_sku",
    );
  });

  test("rejects a part that references an unknown supplier", () => {
    assert.throws(
      () => parts.create(parseCreatePart({ ...newPart, supplierId: "missing" }), ACTOR, REQUEST_ID),
      (error: AppError) => error.status === 400 && error.details?.["supplierId"] !== undefined,
    );
  });

  test("rejects a part assigned to an inactive supplier", () => {
    const legacy = suppliers.list(new URLSearchParams({ search: "Legacy" })).items[0];
    assert.ok(legacy);
    assert.throws(
      () => parts.create(parseCreatePart({ ...newPart, supplierId: legacy.id }), ACTOR, REQUEST_ID),
      (error: AppError) => error.code === "supplier_inactive",
    );
  });

  test("joins the supplier into the part representation", () => {
    const page = parts.list(new URLSearchParams({ search: "AOP-FLT-2001" }));
    assert.equal(page.items[0]?.supplier?.code, "SUP-DNSO");
    assert.equal(typeof page.items[0]?.supplier?.leadTimeDays, "number");
  });

  test("filters to parts at or below their own reorder level, most urgent first", () => {
    const reorder = parts.reorderList();
    assert.ok(reorder.length > 0);
    assert.ok(reorder.every((part) => part.stockQuantity <= part.reorderLevel));

    const quantities = reorder.map((part) => part.stockQuantity);
    assert.deepEqual(quantities, [...quantities].sort((a, b) => a - b));
  });

  test("increments the version on every update and leaves stock alone", () => {
    const created = parts.create(parseCreatePart(newPart), ACTOR, REQUEST_ID);
    const updated = parts.update(
      created.id,
      parseUpdatePart({ name: "Water pump, OEM" }),
      undefined,
      ACTOR,
      REQUEST_ID,
    );

    assert.equal(updated.version, created.version + 1);
    assert.equal(updated.name, "Water pump, OEM");
    assert.equal(updated.stockQuantity, created.stockQuantity);
  });

  test("rejects an update based on a stale version", () => {
    const created = parts.create(parseCreatePart(newPart), ACTOR, REQUEST_ID);
    parts.update(created.id, parseUpdatePart({ name: "First writer" }), created.version, ACTOR, REQUEST_ID);

    assert.throws(
      () =>
        parts.update(created.id, parseUpdatePart({ name: "Second writer" }), created.version, ACTOR, REQUEST_ID),
      (error: AppError) => error.status === 412 && error.code === "version_conflict",
    );
  });

  test("applies a positive stock adjustment and audits the balance change", () => {
    const created = parts.create(parseCreatePart(newPart), ACTOR, REQUEST_ID);
    const adjusted = parts.adjustStock(
      created.id,
      parseStockAdjustment({ delta: 8, reason: "return", note: "Customer return" }),
      ACTOR,
      REQUEST_ID,
    );

    assert.equal(adjusted.stockQuantity, 20);
    const events = audit.forEntity("part", created.id);
    assert.equal(events[0]?.action, "part.stock_adjusted");
    assert.match(events[0]?.summary ?? "", /\+8 units \(return\)/);
    assert.match(events[0]?.summary ?? "", /Customer return/);
  });

  test("refuses an adjustment that would make the balance negative", () => {
    const created = parts.create(parseCreatePart(newPart), ACTOR, REQUEST_ID);
    assert.throws(
      () =>
        parts.adjustStock(created.id, parseStockAdjustment({ delta: -99, reason: "damage" }), ACTOR, REQUEST_ID),
      (error: AppError) => error.status === 409 && error.code === "insufficient_stock",
    );

    assert.equal(parts.getById(created.id).stockQuantity, 12, "the balance must be unchanged");
  });

  test("computes inventory totals in a single query", () => {
    const summary = parts.summary();
    assert.equal(summary.totalParts, 15);
    assert.equal(summary.warehouses, 3);
    assert.ok(summary.stockValueIdr > 0);
    assert.ok(summary.belowReorder > 0);
  });

  test("exposes active parts and warehouses for the dashboard pickers", () => {
    const options = parts.options();
    assert.ok(options.length > 0);
    assert.ok(options.every((option) => option.sku.startsWith("AOP-")));
    assert.deepEqual(parts.warehouses().sort(), ["Bekasi-2", "Jakarta-1", "Karawang-1"]);
  });

  test("returns 404 for an unknown id", () => {
    assert.throws(() => parts.getById("missing"), (error: AppError) => error.status === 404);
  });
});
