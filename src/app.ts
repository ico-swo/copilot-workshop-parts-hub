import type { DatabaseSync } from "node:sqlite";
import { createRouter, type RouteDefinition } from "./http/router.ts";
import { staticRoutes } from "./http/static.ts";
import { AuditService } from "./modules/audit/service.ts";
import { auditRoutes } from "./modules/audit/routes.ts";
import { AuthService } from "./modules/auth/service.ts";
import { authRoutes } from "./modules/auth/routes.ts";
import { partsRoutes } from "./modules/parts/routes.ts";
import { supplierRoutes } from "./modules/suppliers/routes.ts";
import { purchaseOrderRoutes } from "./modules/purchase-orders/routes.ts";
import { config } from "./config.ts";
import { sendJson } from "./http/respond.ts";
import { openApiRoutes } from "./openapi.ts";

/**
 * Builds the request handler for a given database.
 *
 * Tests call this with an in-memory database, so no test server ever touches
 * the real data file.
 *
 * Lab 2: register stockRequestRoutes(db, audit) here once the module exists.
 */
export function createApp(db: DatabaseSync) {
  const audit = new AuditService(db);
  const auth = new AuthService(db);

  const routes: RouteDefinition[] = [
    ...partsRoutes(db, audit),
    ...supplierRoutes(db, audit),
    ...purchaseOrderRoutes(db, audit),
    ...auditRoutes(audit),
    ...authRoutes(auth),
    {
      method: "GET",
      path: "/health",
      handler: (ctx) =>
        sendJson(ctx.res, 200, {
          status: "ok",
          version: config.version,
          uptimeSeconds: Math.floor(process.uptime()),
        }),
    },
    ...openApiRoutes(),
    ...staticRoutes(),
  ];

  return createRouter(routes, {
    authenticate: auth.authenticate,
    authorize: auth.authorize,
    rateLimit: auth.rateLimit,
  });
}
