import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { seededDatabase, REQUEST_ID } from "./helpers.ts";
import { StockRequestService } from "../src/modules/stock-requests/service.ts";
import { parseCreateStockRequest } from "../src/modules/stock-requests/schema.ts";
import { PartsService } from "../src/modules/parts/service.ts";
import { AppError } from "../src/core/errors.ts";
import type { Actor } from "../src/modules/auth/types.ts";

const technician: Actor = { id: "1", name: "workshop-technician", role: "operator" };
const operator: Actor = { id: "2", name: "warehouse-operator", role: "operator" };

let requests: StockRequestService;
let parts: PartsService;

/** An active seeded part with enough stock to draw from. */
function stockedPart() {
  const part = parts
    .list(new URLSearchParams({ active: "true", sort: "stockQuantity", direction: "desc" }))
    .items[0];
  assert.ok(part, "expected an active part in the seed data");
  assert.ok(part.stockQuantity >= 10, "expected the part to hold at least 10 units");
  return part;
}

function balanceOf(partId: string): number {
  return parts.getById(partId).stockQuantity;
}

function raise(partId: string, quantity: number, requestedBy = technician.name) {
  return requests.create(
    parseCreateStockRequest({ partId, quantity, requestedBy, jobReference: "", note: "" }),
    technician,
    REQUEST_ID,
  );
}

function isAppError(status: number, code: string) {
  return (error: unknown) =>
    error instanceof AppError && error.status === status && error.code === code;
}

beforeEach(() => {
  const { db, audit } = seededDatabase();
  requests = new StockRequestService(db, audit);
  parts = new PartsService(db, audit);
});

describe("stock request creation", () => {
  test("creates a pending request with an SR-YYYY-NNNN reference", () => {
    const part = stockedPart();
    const created = raise(part.id, 2);

    assert.match(created.reference, /^SR-\d{4}-\d{4}$/);
    assert.equal(created.status, "pending");
    assert.equal(created.version, 1);
    assert.equal(created.jobReference, null);
    assert.equal(balanceOf(part.id), part.stockQuantity, "creation must not move stock");
  });

  test("refuses a request for an inactive part with 400 naming partId", () => {
    const part = stockedPart();
    parts.update(part.id, { isActive: false }, undefined, operator, REQUEST_ID);

    assert.throws(
      () => raise(part.id, 1),
      (error: unknown) =>
        isAppError(400, "bad_request")(error) &&
        Object.keys((error as AppError).details ?? {}).includes("partId"),
    );
  });

  test("refuses a quantity above available stock with 409 insufficient_stock", () => {
    const part = stockedPart();
    const quantity = Math.min(part.stockQuantity + 1, 500);
    assert.ok(quantity > part.stockQuantity, "fixture part must hold fewer than 500 units");

    assert.throws(() => raise(part.id, quantity), isAppError(409, "insufficient_stock"));
    assert.equal(balanceOf(part.id), part.stockQuantity);
  });
});

describe("stock request approval", () => {
  test("approves a request and decrements the part's balance", () => {
    const part = stockedPart();
    const created = raise(part.id, 3);

    const approved = requests.approve(created.id, created.version, operator, REQUEST_ID);

    assert.equal(approved.status, "approved");
    assert.equal(approved.decidedBy, operator.name);
    assert.equal(approved.version, created.version + 1);
    assert.equal(balanceOf(part.id), part.stockQuantity - 3);
  });

  test("refuses approval when stock moved after creation and leaves the balance unchanged", () => {
    const part = stockedPart();
    const created = raise(part.id, 5);

    // Someone draws stock down between creation and approval, leaving 4.
    parts.adjustStock(
      part.id,
      { delta: -(part.stockQuantity - 4), reason: "damage", note: null },
      operator,
      REQUEST_ID,
    );
    assert.equal(balanceOf(part.id), 4);

    assert.throws(
      () => requests.approve(created.id, created.version, operator, REQUEST_ID),
      isAppError(409, "insufficient_stock"),
    );
    assert.equal(balanceOf(part.id), 4, "a failed approval must not move stock");
    assert.equal(requests.getById(created.id).status, "pending");
  });

  test("refuses a second approval with 409 already_resolved", () => {
    const part = stockedPart();
    const created = raise(part.id, 2);
    const approved = requests.approve(created.id, created.version, operator, REQUEST_ID);
    const afterFirst = balanceOf(part.id);

    assert.throws(
      () => requests.approve(created.id, approved.version, operator, REQUEST_ID),
      isAppError(409, "already_resolved"),
    );
    assert.equal(balanceOf(part.id), afterFirst, "stock must only be drawn once");
  });
});

describe("stock request cancellation", () => {
  test("refuses cancellation by someone other than the requester with 403", () => {
    const part = stockedPart();
    const created = raise(part.id, 1);

    assert.throws(
      () => requests.cancel(created.id, created.version, operator, REQUEST_ID),
      isAppError(403, "forbidden"),
    );
    assert.equal(requests.getById(created.id).status, "pending");
  });
});
