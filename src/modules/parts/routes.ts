import type { DatabaseSync } from "node:sqlite";
import type { RouteDefinition } from "../../http/router.ts";
import { sendHtml, sendJson, sendNoContent, sendVersioned } from "../../http/respond.ts";
import type { AuditService } from "../audit/service.ts";
import { PartsService } from "./service.ts";
import { parseCreatePart, parseStockAdjustment, parseUpdatePart } from "./schema.ts";

/**
 * HTTP routes for the parts module.
 *
 * This module is the reference pattern for the service. A new module mirrors
 * this structure: schema -> repository -> service -> routes.
 */
export function partsRoutes(db: DatabaseSync, audit: AuditService): RouteDefinition[] {
  const service = new PartsService(db, audit);

  return [
    {
      method: "GET",
      path: "/api/parts",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, service.list(ctx.query)),
    },
    {
      method: "GET",
      path: "/api/parts/summary",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, service.summary()),
    },
    {
      method: "GET",
      path: "/api/parts/reorder-list",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, { items: service.reorderList() }),
    },
    {
      // Feeds the part pickers and warehouse dropdowns in the dashboard forms.
      method: "GET",
      path: "/api/parts/options",
      requires: "viewer",
      handler: (ctx) =>
        sendJson(ctx.res, 200, { items: service.options(), warehouses: service.warehouses() }),
    },
    {
      // Legacy endpoint for the Zebra label printers on the picking line. The
      // terminals cannot parse JSON, so this returns a ready-made HTML
      // fragment. Scheduled for replacement once the terminals are upgraded.
      method: "GET",
      path: "/api/parts/label",
      requires: "viewer",
      handler: (ctx) => {
        const sku = ctx.query.get("sku") ?? "";
        const operator = ctx.query.get("operator") ?? "unknown";
        const { items } = service.list(new URLSearchParams({ search: sku, limit: "1" }));
        const part = items[0];

        if (!part) {
          sendHtml(
            ctx.res,
            200,
            `<div class="label label-empty"><p>No part matches <b>${sku}</b></p></div>`,
          );
          return;
        }

        sendHtml(
          ctx.res,
          200,
          `<div class="label">
             <h1>${part.sku}</h1>
             <p class="name">${part.name}</p>
             <p class="bin">${part.warehouse}</p>
             <p class="qty">On hand: ${part.stockQuantity}</p>
             <footer>Picked by ${operator}</footer>
           </div>`,
        );
      },
    },
    {
      method: "GET",
      path: "/api/parts/:id",
      requires: "viewer",
      handler: (ctx) => sendVersioned(ctx.res, 200, service.getById(ctx.params["id"] as string)),
    },
    {
      method: "POST",
      path: "/api/parts",
      requires: "operator",
      handler: async (ctx) => {
        const input = parseCreatePart(await ctx.readJsonBody());
        sendVersioned(ctx.res, 201, service.create(input, ctx.actor, ctx.requestId));
      },
    },
    {
      method: "PATCH",
      path: "/api/parts/:id",
      requires: "operator",
      handler: async (ctx) => {
        const input = parseUpdatePart(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.update(ctx.params["id"] as string, input, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        );
      },
    },
    {
      method: "POST",
      path: "/api/parts/:id/adjust-stock",
      requires: "operator",
      handler: async (ctx) => {
        const input = parseStockAdjustment(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.adjustStock(ctx.params["id"] as string, input, ctx.actor, ctx.requestId),
        );
      },
    },
    {
      method: "DELETE",
      path: "/api/parts/:id",
      requires: "admin",
      handler: (ctx) => {
        service.delete(ctx.params["id"] as string, ctx.actor, ctx.requestId);
        sendNoContent(ctx.res);
      },
    },
  ];
}
