import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { createHmac, randomBytes } from "node:crypto";
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
  readonly #preAuthBuckets = new Map<string, { count: number; windowStart: number }>();
  readonly #preAuthFingerprintKey = randomBytes(32);
  #pendingAuthentications = 0;

  constructor(db: DatabaseSync) {
    this.#repository = new ApiKeyRepository(db);
  }

  preAuthRateLimit = (req: IncomingMessage): void => {
    const header = req.headers["authorization"];
    const value = typeof header === "string" ? header : "";
    const [scheme, token] = value.split(" ");
    const fingerprint = createHmac("sha256", this.#preAuthFingerprintKey)
      .update(scheme === "Bearer" && token ? token : value)
      .digest("hex");
    const now = Date.now();
    const windowMs = 60_000;
    const bucket = this.#preAuthBuckets.get(fingerprint);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      this.#preAuthBuckets.delete(fingerprint);
      // Bound memory even if callers continuously rotate invalid credentials.
      if (this.#preAuthBuckets.size >= 1024) {
        const oldest = this.#preAuthBuckets.keys().next().value;
        if (oldest) this.#preAuthBuckets.delete(oldest);
      }
      this.#preAuthBuckets.set(fingerprint, { count: 1, windowStart: now });
      return;
    }
    bucket.count += 1;
    if (bucket.count > config.rateLimitPerMinute) {
      throw AppError.tooManyRequests(Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    }
  };

  authenticate = async (req: IncomingMessage): Promise<Actor> => {
    const header = req.headers["authorization"];

    if (typeof header !== "string" || header.length === 0) {
      if (config.authDisabled) return ANONYMOUS_VIEWER;
      throw AppError.unauthorized();
    }

    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw AppError.unauthorized("Authorization must use the Bearer scheme");
    }

    // Bound queued scrypt work as well as limiting attempts per remote address.
    if (this.#pendingAuthentications >= 4) throw AppError.tooManyRequests(1);
    this.#pendingAuthentications += 1;
    let key;
    try {
      key = await this.#repository.findByPlaintext(token);
    } finally {
      this.#pendingAuthentications -= 1;
    }
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
