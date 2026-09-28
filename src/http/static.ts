import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { AppError } from "../core/errors.ts";
import type { RouteDefinition } from "./router.ts";

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serve(fileName: string, res: ServerResponse): void {
  // Resolve inside publicDir only; never trust a path built from a URL.
  const target = normalize(join(publicDir, fileName));
  if (!target.startsWith(publicDir) || !existsSync(target)) {
    throw new AppError(404, "not_found", "Asset not found");
  }

  const body = readFileSync(target);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
    "Content-Length": body.length,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

/** Serves the warehouse dashboard. These routes are public. */
export function staticRoutes(): RouteDefinition[] {
  return [
    { method: "GET", path: "/", handler: (ctx) => serve("index.html", ctx.res) },
    { method: "GET", path: "/app.js", handler: (ctx) => serve("app.js", ctx.res) },
    { method: "GET", path: "/forms.js", handler: (ctx) => serve("forms.js", ctx.res) },
    { method: "GET", path: "/api-client.js", handler: (ctx) => serve("api-client.js", ctx.res) },
    { method: "GET", path: "/styles.css", handler: (ctx) => serve("styles.css", ctx.res) },
  ];
}
