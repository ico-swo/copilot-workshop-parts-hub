import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { AppError, toErrorBody } from "../core/errors.ts";
import { sendJson } from "./respond.ts";
import { ANONYMOUS_VIEWER, type Actor, type Role } from "../modules/auth/types.ts";

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  requestId: string;
  actor: Actor;
  readJsonBody: () => Promise<unknown>;
  /** Version supplied by the caller via the If-Match header, if any. */
  ifMatchVersion: () => number | undefined;
}

export interface RouteDefinition {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  /** Minimum role required. Omit for public routes such as /health. */
  requires?: Role;
  handler: (ctx: RequestContext) => void | Promise<void>;
}

export interface RouterOptions {
  preAuthRateLimit: (req: IncomingMessage) => void;
  authenticate: (req: IncomingMessage) => Promise<Actor>;
  authorize: (actor: Actor, required: Role) => void;
  rateLimit: (actor: Actor) => void;
}

interface CompiledRoute extends RouteDefinition {
  segments: string[];
  dynamicCount: number;
}

function compile(route: RouteDefinition): CompiledRoute {
  const segments = route.path.split("/").filter(Boolean);
  return { ...route, segments, dynamicCount: segments.filter((s) => s.startsWith(":")).length };
}

function match(route: CompiledRoute, segments: string[]): Record<string, string> | undefined {
  if (route.segments.length !== segments.length) return undefined;

  const params: Record<string, string> = {};
  for (let i = 0; i < route.segments.length; i += 1) {
    const expected = route.segments[i] as string;
    const actual = segments[i] as string;
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > config.requestBodyLimitBytes) {
      throw new AppError(413, "payload_too_large", "Request body is too large");
    }
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw AppError.badRequest("Request body is not valid JSON");
  }
}

function parseIfMatch(req: IncomingMessage): number | undefined {
  const header = req.headers["if-match"];
  if (typeof header !== "string") return undefined;

  const parsed = /^(?:W\/)?"(\d+)"$/.exec(header.trim());
  if (!parsed) {
    throw AppError.badRequest('If-Match must be an entity tag such as W/"3"');
  }
  return Number.parseInt(parsed[1] as string, 10);
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

export function createRouter(routes: RouteDefinition[], options: RouterOptions) {
  // Static segments win over parameter segments, so /api/parts/summary is
  // never swallowed by /api/parts/:id.
  const compiled = routes.map(compile).sort((a, b) => a.dynamicCount - b.dynamicCount);

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = performance.now();
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
    res.setHeader("X-Request-Id", requestId);

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const segments = url.pathname.split("/").filter(Boolean);
    const method = (req.method ?? "GET").toUpperCase();
    let status = 500;

    try {
      let pathExists = false;

      for (const route of compiled) {
        const params = match(route, segments);
        if (!params) continue;
        pathExists = true;
        if (route.method !== method) continue;

        // A route without a `requires` declaration is public by design: the
        // dashboard assets, the OpenAPI document and /health. Everything else
        // authenticates before the handler is reached.
        if (route.requires) options.preAuthRateLimit(req);
        const actor = route.requires ? await options.authenticate(req) : ANONYMOUS_VIEWER;
        options.rateLimit(actor);
        if (route.requires) options.authorize(actor, route.requires);

        await route.handler({
          req,
          res,
          params,
          query: url.searchParams,
          requestId,
          actor,
          readJsonBody: () => readJsonBody(req),
          ifMatchVersion: () => parseIfMatch(req),
        });

        status = res.statusCode;
        return;
      }

      if (pathExists) {
        throw new AppError(405, "method_not_allowed", `${method} is not allowed on ${url.pathname}`);
      }
      throw new AppError(404, "not_found", `No route matches ${method} ${url.pathname}`);
    } catch (error) {
      const mapped = toErrorBody(error, requestId);
      status = mapped.status;

      if (!(error instanceof AppError)) {
        log({
          level: "error",
          message: "Unhandled request error",
          requestId,
          path: url.pathname,
          method,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }

      if (!res.headersSent) {
        const headers: Record<string, string> =
          error instanceof AppError && error.code === "rate_limited"
            ? { "Retry-After": error.details?.["retryAfterSeconds"] ?? "60" }
            : {};
        sendJson(res, mapped.status, mapped.body, headers);
      }
    } finally {
      // Never log the body, a credential, or a query string that may hold one.
      log({
        level: status >= 500 ? "error" : "info",
        message: "request",
        requestId,
        method,
        path: url.pathname,
        status,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  };
}
