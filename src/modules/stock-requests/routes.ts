import type { DatabaseSync } from "node:sqlite";
import type { RouteDefinition } from "../../http/router.ts";
import { sendJson, sendVersioned } from "../../http/respond.ts";
import type { AuditService } from "../audit/service.ts";
import { StockRequestService } from "./service.ts";
import {
  ALLOWED_TRANSITIONS,
  parseCreateStockRequest,
  parseEmptyBody,
  parseRejection,
} from "./schema.ts";

export function stockRequestRoutes(db: DatabaseSync, audit: AuditService): RouteDefinition[] {
  const service = new StockRequestService(db, audit);

  return [
    {
      method: "GET",
      path: "/api/stock-requests",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, service.list(ctx.query)),
    },
    {
      // Served so the dashboard never hard-codes the state machine.
      method: "GET",
      path: "/api/stock-requests/transitions",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, ALLOWED_TRANSITIONS),
    },
    {
      method: "GET",
      path: "/api/stock-requests/:id",
      requires: "viewer",
      handler: (ctx) => sendVersioned(ctx.res, 200, service.getById(ctx.params["id"] as string)),
    },
    {
      method: "POST",
      path: "/api/stock-requests",
      requires: "operator",
      handler: async (ctx) => {
        const input = parseCreateStockRequest(await ctx.readJsonBody());
        sendVersioned(ctx.res, 201, service.create(input, ctx.actor, ctx.requestId));
      },
    },
    {
      method: "POST",
      path: "/api/stock-requests/:id/approve",
      requires: "operator",
      handler: async (ctx) => {
        parseEmptyBody(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.approve(ctx.params["id"] as string, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        );
      },
    },
    {
      method: "POST",
      path: "/api/stock-requests/:id/reject",
      requires: "operator",
      handler: async (ctx) => {
        const reason = parseRejection(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.reject(ctx.params["id"] as string, reason, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        );
      },
    },
    {
      method: "POST",
      path: "/api/stock-requests/:id/cancel",
      requires: "operator",
      handler: async (ctx) => {
        parseEmptyBody(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.cancel(ctx.params["id"] as string, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        );
      },
    },
  ];
}
