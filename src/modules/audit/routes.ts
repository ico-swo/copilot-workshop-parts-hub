import type { RouteDefinition } from "../../http/router.ts";
import { sendJson } from "../../http/respond.ts";
import type { AuditService } from "./service.ts";

export function auditRoutes(audit: AuditService): RouteDefinition[] {
  return [
    {
      method: "GET",
      path: "/api/audit-events",
      requires: "operator",
      handler: (ctx) => sendJson(ctx.res, 200, audit.list(ctx.query)),
    },
    {
      // Powers the "History" section of the detail drawer in the dashboard.
      method: "GET",
      path: "/api/audit-events/:entityType/:entityId",
      requires: "operator",
      handler: (ctx) =>
        sendJson(ctx.res, 200, {
          items: audit.forEntity(ctx.params["entityType"] as string, ctx.params["entityId"] as string, 25),
        }),
    },
  ];
}
