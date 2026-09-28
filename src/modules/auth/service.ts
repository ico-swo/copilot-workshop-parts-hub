import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../../core/errors.ts";
import { config } from "../../config.ts";
import { ApiKeyRepository } from "./repository.ts";
import { ANONYMOUS_VIEWER, ROLE_RANK, type Actor, type Role } from "./types.ts";

/**
 * Authentication, authorisation and per-actor rate limiting.
 *
 * Auth is enforced in the router, before any handler runs, so a new endpoint
 * cannot accidentally be left unprotected: it declares a required role, or it
 * is explicitly public.
 */
export class AuthService {
  readonly #repository: ApiKeyRepository;
  readonly #buckets = new Map<string, { count: number; windowStart: number }>();

  constructor(db: DatabaseSync) {
    this.#repository = new ApiKeyRepository(db);
  }

  authenticate = (req: IncomingMessage): Actor => {
    const header = req.headers["authorization"];

    if (typeof header !== "string" || header.length === 0) {
      if (config.authDisabled) return ANONYMOUS_VIEWER;
      throw AppError.unauthorized();
    }

    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw AppError.unauthorized("Authorization must use the Bearer scheme");
    }

    const key = this.#repository.findByPlaintext(token);
    if (!key) throw AppError.unauthorized("The API key is not valid or has been revoked");

    this.#repository.touch(key.id);
    return { id: key.id, name: key.name, role: key.role };
  };

  authorize = (actor: Actor, required: Role): void => {
    if (ROLE_RANK[actor.role] < ROLE_RANK[required]) {
      throw AppError.forbidden(
        `This operation requires the '${required}' role; '${actor.name}' has '${actor.role}'`,
      );
    }
  };

  /** Fixed-window limiter, keyed by actor. Sufficient for a single instance. */
  rateLimit = (actor: Actor): void => {
    const now = Date.now();
    const windowMs = 60_000;
    const bucket = this.#buckets.get(actor.id);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      this.#buckets.set(actor.id, { count: 1, windowStart: now });
      return;
    }

    bucket.count += 1;
    if (bucket.count > config.rateLimitPerMinute) {
      const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
      throw AppError.tooManyRequests(Math.max(retryAfter, 1));
    }
  };

  /** Describes the caller to the dashboard, which uses it to show or hide actions. */
  describe(actor: Actor) {
    return {
      id: actor.id,
      name: actor.name,
      role: actor.role,
      anonymous: actor.id === "anonymous",
      can: {
        read: true,
        write: ROLE_RANK[actor.role] >= ROLE_RANK.operator,
        approve: ROLE_RANK[actor.role] >= ROLE_RANK.admin,
        delete: ROLE_RANK[actor.role] >= ROLE_RANK.admin,
        readAudit: ROLE_RANK[actor.role] >= ROLE_RANK.operator,
      },
    };
  }
}
