import { config } from "./config.ts";
import { sendJson } from "./http/respond.ts";
import type { RouteDefinition } from "./http/router.ts";
import { CATEGORIES, ADJUSTMENT_REASONS } from "./modules/parts/schema.ts";
import { PO_STATUSES } from "./modules/purchase-orders/schema.ts";

/**
 * A hand-maintained OpenAPI description.
 *
 * It is served from the running process so it can never describe a different
 * version than the one deployed. When you add an endpoint, add it here too —
 * that rule is in .github/copilot-instructions.md.
 */
function document() {
  const listParams = [
    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
    { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
    { name: "sort", in: "query", schema: { type: "string" } },
    { name: "direction", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
  ];

  const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
  const ifMatch = {
    name: "If-Match",
    in: "header",
    description: "Entity tag from a previous read, for optimistic concurrency",
    schema: { type: "string", example: 'W/"3"' },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Astra Parts Hub API",
      version: config.version,
      description:
        "Spare parts catalogue, supplier master data and procurement workflow for Astra Otoparts.",
    },
    servers: [{ url: "/", description: "This instance" }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Parts", description: "Catalogue and stock" },
      { name: "Suppliers", description: "Supplier master data" },
      { name: "Purchase orders", description: "Procurement workflow" },
      { name: "Audit", description: "Append-only change history" },
      { name: "Health", description: "Service liveness" },
      { name: "Session", description: "Caller identity and capabilities" },
    ],
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Report service status",
          description: "Public. Requires no API key.",
          security: [],
          responses: {
            "200": {
              description: "The service is running",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status", "version", "uptimeSeconds"],
                    properties: {
                      status: { type: "string", enum: ["ok"] },
                      version: { type: "string", example: "1.0.0" },
                      uptimeSeconds: { type: "integer", minimum: 0 },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/me": {
        get: {
          tags: ["Session"],
          summary: "Describe the caller and what they may do",
          description: "Used by the dashboard to enable or hide write actions.",
          responses: { "200": { description: "Caller identity and capability flags" } },
        },
      },
      "/api/parts": {
        get: {
          tags: ["Parts"],
          summary: "List parts",
          parameters: [
            ...listParams,
            { name: "category", in: "query", schema: { type: "string", enum: CATEGORIES } },
            { name: "warehouse", in: "query", schema: { type: "string" } },
            { name: "supplierId", in: "query", schema: { type: "string" } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "active", in: "query", schema: { type: "string", enum: ["true", "false"] } },
            { name: "belowReorder", in: "query", schema: { type: "string", enum: ["true"] } },
          ],
          responses: { "200": { description: "A page of parts" } },
        },
        post: {
          tags: ["Parts"],
          summary: "Create a part",
          description: "Requires the operator role.",
          responses: { "201": { description: "Created" }, "409": { description: "Duplicate SKU" } },
        },
      },
      "/api/parts/summary": {
        get: { tags: ["Parts"], summary: "Inventory totals", responses: { "200": { description: "Totals" } } },
      },
      "/api/parts/reorder-list": {
        get: {
          tags: ["Parts"],
          summary: "Parts at or below their reorder level",
          responses: { "200": { description: "Reorder candidates" } },
        },
      },
      "/api/parts/options": {
        get: {
          tags: ["Parts"],
          summary: "Active parts and known warehouses, for form pickers",
          responses: { "200": { description: "Options" } },
        },
      },
      "/api/parts/{id}": {
        get: {
          tags: ["Parts"],
          summary: "Get a part",
          parameters: [idParam],
          responses: { "200": { description: "A part" }, "404": { description: "Not found" } },
        },
        patch: {
          tags: ["Parts"],
          summary: "Update a part",
          description: "Stock cannot be set here; use the adjust-stock endpoint.",
          parameters: [idParam, ifMatch],
          responses: { "200": { description: "Updated" }, "412": { description: "Version conflict" } },
        },
        delete: {
          tags: ["Parts"],
          summary: "Delete a part",
          description: "Requires the admin role. Fails if the part is on an open purchase order.",
          parameters: [idParam],
          responses: { "204": { description: "Deleted" }, "409": { description: "Part in use" } },
        },
      },
      "/api/parts/{id}/adjust-stock": {
        post: {
          tags: ["Parts"],
          summary: "Apply a relative stock movement with a reason",
          description: `Reasons: ${ADJUSTMENT_REASONS.join(", ")}.`,
          parameters: [idParam],
          responses: { "200": { description: "New balance" }, "409": { description: "Insufficient stock" } },
        },
      },
      "/api/suppliers": {
        get: {
          tags: ["Suppliers"],
          summary: "List suppliers",
          parameters: listParams,
          responses: { "200": { description: "A page of suppliers" } },
        },
        post: { tags: ["Suppliers"], summary: "Create a supplier", responses: { "201": { description: "Created" } } },
      },
      "/api/suppliers/options": {
        get: {
          tags: ["Suppliers"],
          summary: "Active suppliers, for form pickers",
          responses: { "200": { description: "Options" } },
        },
      },
      "/api/suppliers/{id}": {
        get: { tags: ["Suppliers"], summary: "Get a supplier", parameters: [idParam], responses: { "200": { description: "A supplier" } } },
        patch: { tags: ["Suppliers"], summary: "Update a supplier", parameters: [idParam, ifMatch], responses: { "200": { description: "Updated" } } },
        delete: {
          tags: ["Suppliers"],
          summary: "Delete a supplier",
          description: "Requires the admin role. Fails if any part or order references it.",
          parameters: [idParam],
          responses: { "204": { description: "Deleted" }, "409": { description: "Supplier in use" } },
        },
      },
      "/api/purchase-orders": {
        get: {
          tags: ["Purchase orders"],
          summary: "List purchase orders",
          parameters: [...listParams, { name: "status", in: "query", schema: { type: "string", enum: PO_STATUSES } }],
          responses: { "200": { description: "A page of orders" } },
        },
        post: { tags: ["Purchase orders"], summary: "Raise a draft order", responses: { "201": { description: "Created" } } },
      },
      "/api/purchase-orders/transitions": {
        get: {
          tags: ["Purchase orders"],
          summary: "The allowed state transitions",
          description: "Served so clients do not hard-code the state machine.",
          responses: { "200": { description: "A map of status to allowed next statuses" } },
        },
      },
      "/api/purchase-orders/{id}": {
        get: { tags: ["Purchase orders"], summary: "Get an order with its lines", parameters: [idParam], responses: { "200": { description: "An order" } } },
        patch: {
          tags: ["Purchase orders"],
          summary: "Edit a draft order",
          parameters: [idParam, ifMatch],
          responses: { "200": { description: "Updated" }, "409": { description: "Not a draft" } },
        },
      },
      "/api/purchase-orders/{id}/submit": {
        post: { tags: ["Purchase orders"], summary: "Submit a draft for approval", parameters: [idParam, ifMatch], responses: { "200": { description: "Submitted" } } },
      },
      "/api/purchase-orders/{id}/approve": {
        post: {
          tags: ["Purchase orders"],
          summary: "Approve a submitted order",
          description: "Requires the admin role. The person who raised the order cannot approve it.",
          parameters: [idParam, ifMatch],
          responses: { "200": { description: "Approved" }, "403": { description: "Segregation of duties" } },
        },
      },
      "/api/purchase-orders/{id}/receive": {
        post: {
          tags: ["Purchase orders"],
          summary: "Record goods receipt and increase stock",
          description: "Transactional. Omit the body to receive every line in full.",
          parameters: [idParam, ifMatch],
          responses: { "200": { description: "Received" }, "409": { description: "Invalid transition" } },
        },
      },
      "/api/purchase-orders/{id}/cancel": {
        post: { tags: ["Purchase orders"], summary: "Cancel an order with a reason", parameters: [idParam, ifMatch], responses: { "200": { description: "Cancelled" } } },
      },
      "/api/audit-events": {
        get: {
          tags: ["Audit"],
          summary: "Read the change history",
          parameters: [
            ...listParams,
            { name: "entityType", in: "query", schema: { type: "string" } },
            { name: "entityId", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "A page of audit events" } },
        },
      },
      "/api/audit-events/{entityType}/{entityId}": {
        get: {
          tags: ["Audit"],
          summary: "History for a single entity",
          responses: { "200": { description: "Events, newest first" } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "An API key issued by the seed script" },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  description: "Field-level problems, keyed by field name",
                },
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}

export function openApiRoutes(): RouteDefinition[] {
  return [
    { method: "GET", path: "/openapi.json", handler: (ctx) => sendJson(ctx.res, 200, document()) },
  ];
}
