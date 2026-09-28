import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { seededDatabase, REQUEST_ID } from "./helpers.ts";
import { PurchaseOrderService } from "../src/modules/purchase-orders/service.ts";
import { PartsService } from "../src/modules/parts/service.ts";
import { SuppliersService } from "../src/modules/suppliers/service.ts";
import type { AuditService } from "../src/modules/audit/service.ts";
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  parseCreatePurchaseOrder,
  PO_STATUSES,
} from "../src/modules/purchase-orders/schema.ts";
import { AppError } from "../src/core/errors.ts";
import type { Actor } from "../src/modules/auth/types.ts";

const buyer: Actor = { id: "1", name: "warehouse-operator", role: "operator" };
const approver: Actor = { id: "2", name: "procurement-admin", role: "admin" };

let db: DatabaseSync;
let audit: AuditService;
let orders: PurchaseOrderService;
let parts: PartsService;
let suppliers: SuppliersService;

function supplierId(code: string): string {
  const supplier = suppliers.list(new URLSearchParams({ search: code })).items[0];
  assert.ok(supplier, `expected supplier ${code} in the seed data`);
  return supplier.id;
}

function partBySku(sku: string) {
  const part = parts.list(new URLSearchParams({ search: sku })).items[0];
  assert.ok(part, `expected part ${sku} in the seed data`);
  return part;
}

function draftOrder(lines?: { partId: string; quantity: number; unitPriceIdr: number }[]) {
  const filter = partBySku("AOP-FLT-2002");
  return orders.create(
    parseCreatePurchaseOrder({
      supplierId: supplierId("SUP-DNSO"),
      lines: lines ?? [{ partId: filter.id, quantity: 100, unitPriceIdr: 90000 }],
    }),
    buyer,
    REQUEST_ID,
  );
}

beforeEach(() => {
  const seeded = seededDatabase();
  db = seeded.db;
  audit = seeded.audit;
  orders = new PurchaseOrderService(db, audit);
  parts = new PartsService(db, audit);
  suppliers = new SuppliersService(db, audit);
});

describe("state machine", () => {
  test("every status appears in the transition map", () => {
    assert.deepEqual(Object.keys(ALLOWED_TRANSITIONS).sort(), [...PO_STATUSES].sort());
  });

  test("received and cancelled are terminal", () => {
    assert.deepEqual(ALLOWED_TRANSITIONS.received, []);
    assert.deepEqual(ALLOWED_TRANSITIONS.cancelled, []);
  });

  test("a draft cannot jump straight to received", () => {
    assert.equal(canTransition("draft", "received"), false);
    assert.equal(canTransition("draft", "submitted"), true);
    assert.equal(canTransition("approved", "received"), true);
  });
});

describe("order creation", () => {
  test("assigns a sequential reference and computes the total", () => {
    const order = draftOrder();
    assert.match(order.reference, /^PO-\d{4}-\d{4}$/);
    assert.equal(order.status, "draft");
    assert.equal(order.totalIdr, 100 * 90000);
    assert.equal(order.lines[0]?.receivedQuantity, 0);
  });

  test("denormalises the part SKU onto each line", () => {
    const order = draftOrder();
    assert.equal(order.lines[0]?.partSku, "AOP-FLT-2002");
    assert.ok((order.lines[0]?.partName ?? "").length > 0);
  });

  test("rejects an order with no lines", () => {
    assert.throws(
      () => parseCreatePurchaseOrder({ supplierId: supplierId("SUP-DNSO"), lines: [] }),
      (error: AppError) => error.details?.["lines"] !== undefined,
    );
  });

  test("rejects the same part on two lines", () => {
    const filter = partBySku("AOP-FLT-2002");
    assert.throws(
      () =>
        parseCreatePurchaseOrder({
          supplierId: supplierId("SUP-DNSO"),
          lines: [
            { partId: filter.id, quantity: 10, unitPriceIdr: 1000 },
            { partId: filter.id, quantity: 5, unitPriceIdr: 1000 },
          ],
        }),
      (error: AppError) => (error.details?.["lines"] ?? "").includes("more than once"),
    );
  });

  test("reports the index of each invalid line, so a form can target it", () => {
    const filter = partBySku("AOP-FLT-2002");
    try {
      parseCreatePurchaseOrder({
        supplierId: supplierId("SUP-DNSO"),
        lines: [
          { partId: filter.id, quantity: 10, unitPriceIdr: 1000 },
          { partId: filter.id, quantity: 0, unitPriceIdr: 1000 },
        ],
      });
      assert.fail("expected validation to throw");
    } catch (error) {
      assert.ok((error as AppError).details?.["lines[1].quantity"]);
    }
  });

  test("rejects an unknown part with its line index", () => {
    assert.throws(
      () =>
        orders.create(
          parseCreatePurchaseOrder({
            supplierId: supplierId("SUP-DNSO"),
            lines: [{ partId: "missing", quantity: 1, unitPriceIdr: 1000 }],
          }),
          buyer,
          REQUEST_ID,
        ),
      (error: AppError) => error.details?.["lines[0].partId"] !== undefined,
    );
  });

  test("refuses to raise an order against an inactive supplier", () => {
    const filter = partBySku("AOP-FLT-2002");
    assert.throws(
      () =>
        orders.create(
          parseCreatePurchaseOrder({
            supplierId: supplierId("Legacy"),
            lines: [{ partId: filter.id, quantity: 1, unitPriceIdr: 1000 }],
          }),
          buyer,
          REQUEST_ID,
        ),
      (error: AppError) => error.code === "supplier_inactive",
    );
  });

  test("writes nothing when a line fails, leaving no partial order", () => {
    const before = orders.list(new URLSearchParams({ limit: "1" })).total;
    assert.throws(() =>
      orders.create(
        parseCreatePurchaseOrder({
          supplierId: supplierId("SUP-DNSO"),
          lines: [{ partId: "missing", quantity: 1, unitPriceIdr: 1000 }],
        }),
        buyer,
        REQUEST_ID,
      ),
    );
    assert.equal(orders.list(new URLSearchParams({ limit: "1" })).total, before);
  });
});

describe("approval workflow", () => {
  test("moves draft to submitted to approved, stamping each timestamp", () => {
    const order = draftOrder();
    const submitted = orders.submit(order.id, undefined, buyer, REQUEST_ID);
    assert.equal(submitted.status, "submitted");
    assert.ok(submitted.submittedAt);

    const approved = orders.approve(submitted.id, undefined, approver, REQUEST_ID);
    assert.equal(approved.status, "approved");
    assert.equal(approved.approvedBy, approver.name);
    assert.ok(approved.approvedAt);
  });

  test("refuses approval by the person who raised the order", () => {
    const order = draftOrder();
    orders.submit(order.id, undefined, buyer, REQUEST_ID);

    const sameName: Actor = { id: "9", name: buyer.name, role: "admin" };
    assert.throws(
      () => orders.approve(order.id, undefined, sameName, REQUEST_ID),
      (error: AppError) => error.status === 403 && /segregation of duties/i.test(error.message),
    );
  });

  test("refuses to approve an order that was never submitted", () => {
    const order = draftOrder();
    assert.throws(
      () => orders.approve(order.id, undefined, approver, REQUEST_ID),
      (error: AppError) => error.status === 409 && error.code === "invalid_transition",
    );
  });

  test("refuses to edit an order once it leaves draft", () => {
    const order = draftOrder();
    orders.submit(order.id, undefined, buyer, REQUEST_ID);
    assert.throws(
      () => orders.update(order.id, { notes: "late change" }, undefined, buyer, REQUEST_ID),
      (error: AppError) => error.code === "invalid_transition",
    );
  });

  test("records a cancellation reason alongside the transition", () => {
    const order = draftOrder();
    const cancelled = orders.cancel(order.id, "Supplier withdrew the quotation", undefined, buyer, REQUEST_ID);

    assert.equal(cancelled.status, "cancelled");
    const summaries = audit.forEntity("purchase_order", order.id).map((event) => event.summary);
    assert.ok(summaries.includes("Supplier withdrew the quotation"));
  });

  test("refuses to cancel an order that is already received", () => {
    const order = draftOrder();
    orders.submit(order.id, undefined, buyer, REQUEST_ID);
    orders.approve(order.id, undefined, approver, REQUEST_ID);
    orders.receive(order.id, undefined, undefined, buyer, REQUEST_ID);

    assert.throws(
      () => orders.cancel(order.id, "too late", undefined, buyer, REQUEST_ID),
      (error: AppError) => error.code === "invalid_transition",
    );
  });
});

describe("goods receipt", () => {
  function approvedOrder(quantity = 100) {
    const filter = partBySku("AOP-FLT-2002");
    const order = orders.create(
      parseCreatePurchaseOrder({
        supplierId: supplierId("SUP-DNSO"),
        lines: [{ partId: filter.id, quantity, unitPriceIdr: 90000 }],
      }),
      buyer,
      REQUEST_ID,
    );
    orders.submit(order.id, undefined, buyer, REQUEST_ID);
    orders.approve(order.id, undefined, approver, REQUEST_ID);
    return { order, partId: filter.id, openingStock: filter.stockQuantity };
  }

  test("receiving in full increases stock by the ordered quantity", () => {
    const { order, partId, openingStock } = approvedOrder(100);
    const received = orders.receive(order.id, undefined, undefined, buyer, REQUEST_ID);

    assert.equal(received.status, "received");
    assert.ok(received.receivedAt);
    assert.equal(received.lines[0]?.receivedQuantity, 100);
    assert.equal(parts.getById(partId).stockQuantity, openingStock + 100);
  });

  test("a partial receipt moves only the quantity supplied", () => {
    const { order, partId, openingStock } = approvedOrder(100);
    orders.receive(order.id, [{ partId, receivedQuantity: 40 }], undefined, buyer, REQUEST_ID);

    assert.equal(parts.getById(partId).stockQuantity, openingStock + 40);
  });

  test("refuses to receive more than was ordered", () => {
    const { order, partId, openingStock } = approvedOrder(100);
    assert.throws(
      () => orders.receive(order.id, [{ partId, receivedQuantity: 150 }], undefined, buyer, REQUEST_ID),
      (error: AppError) => (error.details?.["lines[0].receivedQuantity"] ?? "").includes("100"),
    );
    assert.equal(parts.getById(partId).stockQuantity, openingStock, "stock must not move");
  });

  test("refuses a receipt for a part that is not on the order", () => {
    const { order } = approvedOrder();
    const other = partBySku("AOP-BRK-1001");
    assert.throws(
      () => orders.receive(order.id, [{ partId: other.id, receivedQuantity: 1 }], undefined, buyer, REQUEST_ID),
      (error: AppError) => error.details?.["lines[0].partId"] !== undefined,
    );
  });

  test("refuses to receive an order that has not been approved", () => {
    const order = draftOrder();
    assert.throws(
      () => orders.receive(order.id, undefined, undefined, buyer, REQUEST_ID),
      (error: AppError) => error.code === "invalid_transition",
    );
  });

  test("refuses a second receipt, so stock cannot be double counted", () => {
    const { order, partId, openingStock } = approvedOrder(100);
    orders.receive(order.id, undefined, undefined, buyer, REQUEST_ID);

    assert.throws(
      () => orders.receive(order.id, undefined, undefined, buyer, REQUEST_ID),
      (error: AppError) => error.code === "invalid_transition",
    );
    assert.equal(parts.getById(partId).stockQuantity, openingStock + 100);
  });

  test("moves every line of a multi-line order in one transaction", () => {
    const filter = partBySku("AOP-FLT-2002");
    const stabiliser = partBySku("AOP-SUS-3002");

    const order = orders.create(
      parseCreatePurchaseOrder({
        supplierId: supplierId("SUP-DNSO"),
        lines: [
          { partId: filter.id, quantity: 50, unitPriceIdr: 90000 },
          { partId: stabiliser.id, quantity: 25, unitPriceIdr: 170000 },
        ],
      }),
      buyer,
      REQUEST_ID,
    );
    orders.submit(order.id, undefined, buyer, REQUEST_ID);
    orders.approve(order.id, undefined, approver, REQUEST_ID);
    orders.receive(order.id, undefined, undefined, buyer, REQUEST_ID);

    assert.equal(parts.getById(filter.id).stockQuantity, filter.stockQuantity + 50);
    assert.equal(parts.getById(stabiliser.id).stockQuantity, stabiliser.stockQuantity + 25);
  });

  test("leaves a complete audit trail for the whole lifecycle", () => {
    const { order } = approvedOrder();
    orders.receive(order.id, undefined, undefined, buyer, REQUEST_ID);

    const actions = audit.forEntity("purchase_order", order.id).map((event) => event.action);
    assert.deepEqual(actions, [
      "purchase_order.received",
      "purchase_order.approved",
      "purchase_order.submitted",
      "purchase_order.created",
    ]);
  });
});
