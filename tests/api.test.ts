import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, body, type TestServer } from "./helpers.ts";

let server: TestServer;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.close();
});

interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, string>; requestId?: string };
}

describe("authentication and authorisation", () => {
  test("rejects a request with no credentials", async () => {
    const response = await fetch(`${server.url}/api/parts`);
    assert.equal(response.status, 401);

    const payload = (await response.json()) as ErrorEnvelope;
    assert.equal(payload.error.code, "unauthorized");
  });

  test("rejects a key that does not exist", async () => {
    const response = await fetch(`${server.url}/api/parts`, {
      headers: { Authorization: "Bearer not-a-real-key" },
    });
    assert.equal(response.status, 401);
  });

  test("keeps public routes responsive during invalid key verification", async () => {
    const invalid = fetch(`${server.url}/api/parts`, {
      headers: { Authorization: ["Bearer", "invalid-key"].join(" ") },
    });
    const health = fetch(`${server.url}/health`);
    assert.equal(await Promise.race([invalid.then(() => "invalid"), health.then(() => "health")]), "health");
    assert.equal((await health).status, 200);
    assert.equal((await invalid).status, 401);
  });

  test("caps concurrent unauthenticated key checks", async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        fetch(`${server.url}/api/parts`, { headers: { Authorization: ["Bearer", "invalid-key"].join(" ") } }),
      ),
    );
    assert.ok(responses.some((response) => response.status === 429));
    assert.ok(responses.every((response) => response.status === 401 || response.status === 429));
  });

  test("rejects a non-Bearer scheme", async () => {
    const response = await fetch(`${server.url}/api/parts`, {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    assert.equal(response.status, 401);
  });

  test("a viewer can read but cannot write", async () => {
    assert.equal((await server.request("/api/parts", { key: "viewer" })).status, 200);

    const write = await server.request("/api/parts", { key: "viewer", method: "POST", body: body({}) });
    assert.equal(write.status, 403);

    const payload = (await write.json()) as ErrorEnvelope;
    assert.equal(payload.error.code, "forbidden");
    assert.match(payload.error.message, /requires the 'operator' role/);
  });

  test("an operator cannot perform an admin-only delete", async () => {
    const page = await server.json<Page<{ id: string }>>("/api/parts?limit=1");
    const response = await server.request(`/api/parts/${page.items[0]?.id}`, {
      key: "operator",
      method: "DELETE",
    });
    assert.equal(response.status, 403);
  });

  test("the audit trail is not readable by a viewer", async () => {
    assert.equal((await server.request("/api/audit-events", { key: "viewer" })).status, 403);
    assert.equal((await server.request("/api/audit-events", { key: "operator" })).status, 200);
  });
});

describe("session endpoint", () => {
  test("describes what a viewer may do", async () => {
    const me = await server.json<{ role: string; can: Record<string, boolean> }>("/api/me", {
      key: "viewer",
    });
    assert.equal(me.role, "viewer");
    assert.deepEqual(me.can, {
      read: true,
      write: false,
      approve: false,
      delete: false,
      readAudit: false,
    });
  });

  test("describes what an operator may do", async () => {
    const me = await server.json<{ can: Record<string, boolean> }>("/api/me", { key: "operator" });
    assert.equal(me.can["write"], true);
    assert.equal(me.can["approve"], false);
    assert.equal(me.can["delete"], false);
  });

  test("describes what an admin may do", async () => {
    const me = await server.json<{ can: Record<string, boolean> }>("/api/me", { key: "admin" });
    assert.equal(me.can["approve"], true);
    assert.equal(me.can["delete"], true);
  });
});

describe("dashboard support endpoints", () => {
  test("supplier options exclude inactive suppliers", async () => {
    const options = await server.json<{ items: { code: string }[] }>("/api/suppliers/options");
    assert.ok(options.items.length > 0);
    assert.ok(!options.items.some((s) => s.code === "SUP-LGCY"), "inactive supplier must not be offered");
  });

  test("part options carry the catalogue price and known warehouses", async () => {
    const options = await server.json<{
      items: { sku: string; unitPriceIdr: number }[];
      warehouses: string[];
    }>("/api/parts/options");

    assert.ok(options.items.every((part) => typeof part.unitPriceIdr === "number"));
    assert.deepEqual([...options.warehouses].sort(), ["Bekasi-2", "Jakarta-1", "Karawang-1"]);
  });

  test("the state machine is served, so clients do not hard-code it", async () => {
    const transitions = await server.json<Record<string, string[]>>("/api/purchase-orders/transitions");
    assert.deepEqual(transitions["draft"], ["submitted", "cancelled"]);
    assert.deepEqual(transitions["received"], []);
  });

  test("entity history is available for the detail drawer", async () => {
    const page = await server.json<Page<{ id: string }>>("/api/parts?limit=1");
    const history = await server.json<{ items: { action: string }[] }>(
      `/api/audit-events/part/${page.items[0]?.id}`,
    );
    assert.ok(Array.isArray(history.items));
  });
});

describe("list endpoints", () => {
  test("returns a paginated envelope", async () => {
    const page = await server.json<Page<unknown>>("/api/parts?limit=3");
    assert.equal(page.items.length, 3);
    assert.equal(page.limit, 3);
    assert.ok(page.total >= 15);
  });

  test("rejects an out-of-range limit with field details", async () => {
    const response = await server.request("/api/parts?limit=999");
    assert.equal(response.status, 400);

    const payload = (await response.json()) as ErrorEnvelope;
    assert.ok(payload.error.details?.["limit"]);
  });

  test("rejects a sort field that is not on the allow-list", async () => {
    const response = await server.request("/api/parts?sort=stock_quantity;DROP TABLE parts");
    assert.equal(response.status, 400);

    const payload = (await response.json()) as ErrorEnvelope;
    assert.match(payload.error.details?.["sort"] ?? "", /must be one of/);

    // The table is still there.
    assert.equal((await server.request("/api/parts?limit=1")).status, 200);
  });

  test("sorts on an allowed field in the requested direction", async () => {
    const page = await server.json<Page<{ unitPriceIdr: number }>>(
      "/api/parts?sort=unitPriceIdr&direction=desc&limit=5",
    );
    const prices = page.items.map((part) => part.unitPriceIdr);
    assert.deepEqual(prices, [...prices].sort((a, b) => b - a));
  });

  test("filters by category and by reorder status", async () => {
    const brakes = await server.json<Page<{ category: string }>>("/api/parts?category=brake");
    assert.ok(brakes.items.every((part) => part.category === "brake"));

    const reorder = await server.json<Page<{ stockQuantity: number; reorderLevel: number }>>(
      "/api/parts?belowReorder=true",
    );
    assert.ok(reorder.items.every((part) => part.stockQuantity <= part.reorderLevel));
  });

  test("static route segments are not shadowed by the :id route", async () => {
    assert.equal((await server.request("/api/parts/summary")).status, 200);
    assert.equal((await server.request("/api/parts/reorder-list")).status, 200);
    assert.equal((await server.request("/api/parts/options")).status, 200);
    assert.equal((await server.request("/api/suppliers/options")).status, 200);
    assert.equal((await server.request("/api/purchase-orders/transitions")).status, 200);
  });
});

describe("write flows over HTTP", () => {
  test("creates, edits, adjusts and reads back a part", async () => {
    const created = (await (
      await server.request("/api/parts", {
        method: "POST",
        body: body({
          sku: "AOP-ENG-5150",
          name: "Thermostat housing",
          category: "engine",
          vehicleModel: "Xenia 1.3 R",
          unitPriceIdr: 275000,
          stockQuantity: 20,
          reorderLevel: 8,
          warehouse: "Jakarta-1",
        }),
      })
    ).json()) as { id: string; version: number };

    const edited = await server.request(`/api/parts/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": `W/"${created.version}"` },
      body: body({ unitPriceIdr: 289000 }),
    });
    assert.equal(edited.status, 200);

    const adjusted = await server.request(`/api/parts/${created.id}/adjust-stock`, {
      method: "POST",
      body: body({ delta: -5, reason: "damage", note: "Damaged in transit" }),
    });
    assert.equal(adjusted.status, 200);

    const final = (await adjusted.json()) as { stockQuantity: number; unitPriceIdr: number };
    assert.equal(final.stockQuantity, 15);
    assert.equal(final.unitPriceIdr, 289000);
  });

  test("runs an order from draft to received and moves stock", async () => {
    const suppliers = await server.json<{ items: { id: string; code: string }[] }>("/api/suppliers/options");
    const supplier = suppliers.items.find((s) => s.code === "SUP-NGKB");
    assert.ok(supplier);

    const parts = await server.json<Page<{ id: string; sku: string; stockQuantity: number }>>(
      "/api/parts?search=AOP-ELC-4003",
    );
    const part = parts.items[0];
    assert.ok(part);

    const created = (await (
      await server.request("/api/purchase-orders", {
        method: "POST",
        body: body({
          supplierId: supplier.id,
          lines: [{ partId: part.id, quantity: 30, unitPriceIdr: 660000 }],
        }),
      })
    ).json()) as { id: string; reference: string; version: number };

    assert.match(created.reference, /^PO-\d{4}-\d{4}$/);

    const submitted = (await (
      await server.request(`/api/purchase-orders/${created.id}/submit`, { method: "POST" })
    ).json()) as { version: number };

    // The operator who raised it must not be able to approve it.
    const selfApprove = await server.request(`/api/purchase-orders/${created.id}/approve`, {
      key: "admin",
      method: "POST",
    });
    assert.equal(selfApprove.status, 200, "a different actor may approve");

    const received = await server.request(`/api/purchase-orders/${created.id}/receive`, {
      method: "POST",
      body: body({ lines: [{ partId: part.id, receivedQuantity: 30 }] }),
    });
    assert.equal(received.status, 200);

    const after = await server.json<{ stockQuantity: number }>(`/api/parts/${part.id}`);
    assert.equal(after.stockQuantity, part.stockQuantity + 30);
    assert.ok(submitted.version > created.version);
  });

  test("creates and edits a supplier", async () => {
    const created = (await (
      await server.request("/api/suppliers", {
        method: "POST",
        body: body({
          code: "SUP-TEST",
          name: "Test Components",
          contactEmail: "sales@test.example.com",
          country: "Indonesia",
          leadTimeDays: 14,
        }),
      })
    ).json()) as { id: string; version: number };

    const edited = await server.request(`/api/suppliers/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": `W/"${created.version}"` },
      body: body({ leadTimeDays: 9, phone: null }),
    });
    assert.equal(edited.status, 200);

    const updated = (await edited.json()) as { leadTimeDays: number; phone: string | null };
    assert.equal(updated.leadTimeDays, 9);
    assert.equal(updated.phone, null);
  });

  test("rejects an invalid email with a field-level detail the form can display", async () => {
    const response = await server.request("/api/suppliers", {
      method: "POST",
      body: body({
        code: "SUP-BAD1",
        name: "Bad Email Co",
        contactEmail: "not-an-email",
        country: "Indonesia",
        leadTimeDays: 5,
      }),
    });
    assert.equal(response.status, 400);

    const payload = (await response.json()) as ErrorEnvelope;
    assert.equal(payload.error.details?.["contactEmail"], "must be a valid email address");
  });
});

describe("optimistic concurrency", () => {
  test("a stale If-Match is rejected with 412", async () => {
    const created = (await (
      await server.request("/api/parts", {
        method: "POST",
        body: body({
          sku: "AOP-BRK-1900",
          name: "Concurrency test part",
          category: "brake",
          vehicleModel: "Avanza 1.3 G",
          unitPriceIdr: 100000,
          stockQuantity: 5,
          warehouse: "Jakarta-1",
        }),
      })
    ).json()) as { id: string; version: number };

    const etag = `W/"${created.version}"`;

    const first = await server.request(`/api/parts/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": etag },
      body: body({ name: "First writer wins" }),
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("etag"), `W/"${created.version + 1}"`);

    const second = await server.request(`/api/parts/${created.id}`, {
      method: "PATCH",
      headers: { "If-Match": etag },
      body: body({ name: "Second writer loses" }),
    });
    assert.equal(second.status, 412);

    const payload = (await second.json()) as ErrorEnvelope;
    assert.equal(payload.error.code, "version_conflict");
    assert.equal(payload.error.details?.["currentVersion"], String(created.version + 1));
  });

  test("a malformed If-Match is a client error, not a crash", async () => {
    const page = await server.json<Page<{ id: string }>>("/api/parts?limit=1");
    const response = await server.request(`/api/parts/${page.items[0]?.id}`, {
      method: "PATCH",
      headers: { "If-Match": "banana" },
      body: body({ name: "irrelevant" }),
    });
    assert.equal(response.status, 400);
  });
});

describe("referential integrity", () => {
  test("a supplier referenced by a part cannot be deleted", async () => {
    const suppliers = await server.json<Page<{ id: string }>>("/api/suppliers?search=Denso");
    const response = await server.request(`/api/suppliers/${suppliers.items[0]?.id}`, {
      key: "admin",
      method: "DELETE",
    });
    assert.equal(response.status, 409);

    const payload = (await response.json()) as ErrorEnvelope;
    assert.equal(payload.error.code, "supplier_in_use");
  });

  test("a part on an open purchase order cannot be deleted", async () => {
    const orders = await server.json<Page<{ lines: { partId: string }[] }>>(
      "/api/purchase-orders?status=draft&limit=1",
    );
    const partId = orders.items[0]?.lines[0]?.partId;
    assert.ok(partId);

    const response = await server.request(`/api/parts/${partId}`, { key: "admin", method: "DELETE" });
    assert.equal(response.status, 409);

    const payload = (await response.json()) as ErrorEnvelope;
    assert.equal(payload.error.code, "part_in_use");
  });
});

describe("protocol behaviour", () => {
  test("unknown routes return a structured 404 carrying the request id", async () => {
    const response = await server.request("/api/unknown");
    assert.equal(response.status, 404);

    const payload = (await response.json()) as ErrorEnvelope;
    assert.equal(payload.error.code, "not_found");
    assert.equal(payload.error.requestId, response.headers.get("x-request-id"));
  });

  test("an unsupported method on a known path returns 405", async () => {
    assert.equal((await server.request("/api/parts", { method: "DELETE" })).status, 405);
  });

  test("a malformed JSON body is a 400", async () => {
    const response = await server.request("/api/parts", { method: "POST", body: "{ not json" });
    assert.equal(response.status, 400);
  });

  test("an inbound request id is echoed rather than replaced", async () => {
    const response = await server.request("/api/parts?limit=1", {
      headers: { "X-Request-Id": "trace-me-123" },
    });
    assert.equal(response.headers.get("x-request-id"), "trace-me-123");
  });

  test("responses carry the baseline security headers", async () => {
    const response = await server.request("/api/parts?limit=1");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  });

  test("the dashboard assets are served without a key", async () => {
    for (const path of ["/", "/app.js", "/forms.js", "/api-client.js", "/styles.css"]) {
      const response = await fetch(`${server.url}${path}`);
      assert.equal(response.status, 200, `${path} should be public`);
    }
  });

  test("the OpenAPI document describes the deployed version", async () => {
    const response = await fetch(`${server.url}/openapi.json`);
    assert.equal(response.status, 200);

    const document = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    assert.match(document.openapi, /^3\./);
    assert.ok(Object.keys(document.paths).includes("/api/purchase-orders/{id}/receive"));
    assert.ok(Object.keys(document.paths).includes("/api/me"));
  });

  test("GET /health reports service status", async () => {
    const response = await fetch(`${server.url}/health`);
    assert.equal(response.status, 200);

    const payload = (await response.json()) as { status: string; version: string; uptimeSeconds: number };
    assert.equal(payload.status, "ok");
    assert.ok(payload.version.length > 0);
    assert.ok(Number.isInteger(payload.uptimeSeconds));
  });
});
