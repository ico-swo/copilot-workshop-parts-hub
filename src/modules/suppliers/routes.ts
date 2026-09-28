import type { DatabaseSync } from "node:sqlite";
import type { RouteDefinition } from "../../http/router.ts";
import { sendJson, sendNoContent, sendVersioned } from "../../http/respond.ts";
import type { AuditService } from "../audit/service.ts";
import { SuppliersService } from "./service.ts";
import { parseCreateSupplier, parseUpdateSupplier } from "./schema.ts";

export function supplierRoutes(db: DatabaseSync, audit: AuditService): RouteDefinition[] {
  const service = new SuppliersService(db, audit);

  return [
    {
      method: "GET",
      path: "/api/suppliers",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, service.list(ctx.query)),
    },
    {
      // Feeds the supplier dropdowns in the dashboard forms.
      method: "GET",
      path: "/api/suppliers/options",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, { items: service.options() }),
    },
    {
      method: "GET",
      path: "/api/suppliers/:id",
      requires: "viewer",
      handler: (ctx) => sendVersioned(ctx.res, 200, service.getById(ctx.params["id"] as string)),
    },
    {
      method: "POST",
      path: "/api/suppliers",
      requires: "operator",
      handler: async (ctx) => {
        const input = parseCreateSupplier(await ctx.readJsonBody());
        sendVersioned(ctx.res, 201, service.create(input, ctx.actor, ctx.requestId));
      },
    },
    {
      method: "PATCH",
      path: "/api/suppliers/:id",
      requires: "operator",
      handler: async (ctx) => {
        const input = parseUpdateSupplier(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.update(ctx.params["id"] as string, input, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        );
      },
    },
    {
      method: "DELETE",
      path: "/api/suppliers/:id",
      requires: "admin",
      handler: (ctx) => {
        service.delete(ctx.params["id"] as string, ctx.actor, ctx.requestId);
        sendNoContent(ctx.res);
      },
    },
  ];
}
