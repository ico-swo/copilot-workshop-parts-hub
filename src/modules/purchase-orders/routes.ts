import type { DatabaseSync } from "node:sqlite";
import type { RouteDefinition } from "../../http/router.ts";
import { sendJson, sendVersioned } from "../../http/respond.ts";
import type { AuditService } from "../audit/service.ts";
import { PurchaseOrderService } from "./service.ts";
import {
  ALLOWED_TRANSITIONS,
  parseCancellation,
  parseCreatePurchaseOrder,
  parseReceipt,
  parseUpdatePurchaseOrder,
} from "./schema.ts";

export function purchaseOrderRoutes(db: DatabaseSync, audit: AuditService): RouteDefinition[] {
  const service = new PurchaseOrderService(db, audit);

  return [
    {
      method: "GET",
      path: "/api/purchase-orders",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, service.list(ctx.query)),
    },
    {
      // The dashboard reads the state machine rather than hard-coding it, so
      // the buttons it offers can never drift from what the API allows.
      method: "GET",
      path: "/api/purchase-orders/transitions",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, ALLOWED_TRANSITIONS),
    },
    {
      method: "GET",
      path: "/api/purchase-orders/:id",
      requires: "viewer",
      handler: (ctx) => sendVersioned(ctx.res, 200, service.getById(ctx.params["id"] as string)),
    },
    {
      method: "POST",
      path: "/api/purchase-orders",
      requires: "operator",
      handler: async (ctx) => {
        const input = parseCreatePurchaseOrder(await ctx.readJsonBody());
        sendVersioned(ctx.res, 201, service.create(input, ctx.actor, ctx.requestId));
      },
    },
    {
      method: "PATCH",
      path: "/api/purchase-orders/:id",
      requires: "operator",
      handler: async (ctx) => {
        const input = parseUpdatePurchaseOrder(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.update(ctx.params["id"] as string, input, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        );
      },
    },
    {
      method: "POST",
      path: "/api/purchase-orders/:id/submit",
      requires: "operator",
      handler: (ctx) =>
        sendVersioned(
          ctx.res,
          200,
          service.submit(ctx.params["id"] as string, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        ),
    },
    {
      method: "POST",
      path: "/api/purchase-orders/:id/approve",
      requires: "admin",
      handler: (ctx) =>
        sendVersioned(
          ctx.res,
          200,
          service.approve(ctx.params["id"] as string, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        ),
    },
    {
      method: "POST",
      path: "/api/purchase-orders/:id/receive",
      requires: "operator",
      handler: async (ctx) => {
        const receipts = parseReceipt(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.receive(ctx.params["id"] as string, receipts, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        );
      },
    },
    {
      method: "POST",
      path: "/api/purchase-orders/:id/cancel",
      requires: "operator",
      handler: async (ctx) => {
        const reason = parseCancellation(await ctx.readJsonBody());
        sendVersioned(
          ctx.res,
          200,
          service.cancel(ctx.params["id"] as string, reason, ctx.ifMatchVersion(), ctx.actor, ctx.requestId),
        );
      },
    },
  ];
}
