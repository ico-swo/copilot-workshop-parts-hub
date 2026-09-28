import type { RouteDefinition } from "../../http/router.ts";
import { sendJson } from "../../http/respond.ts";
import type { AuthService } from "./service.ts";

export function authRoutes(auth: AuthService): RouteDefinition[] {
  return [
    {
      // The dashboard calls this on load and whenever the key changes, so it
      // can enable or hide write actions instead of guessing.
      method: "GET",
      path: "/api/me",
      requires: "viewer",
      handler: (ctx) => sendJson(ctx.res, 200, auth.describe(ctx.actor)),
    },
  ];
}
