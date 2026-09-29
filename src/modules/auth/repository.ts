import type { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { AppError } from "../../core/errors.ts";
import type { Role } from "./types.ts";

export interface ApiKeyRecord {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  role: Role;
  is_active: number;
  created_at: string;
  last_used_at: string | null;
}

/** Keys are stored as a salted scrypt digest; the plaintext is shown once at issue time. */
export function hashKey(plaintext: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(plaintext, salt, 64).toString("hex")}`;
}

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function parseHash(value: string): { salt: Buffer; digest: Buffer } | undefined {
  const parts = /^([0-9a-f]{32}):([0-9a-f]{128})$/.exec(value);
  // Legacy unsalted SHA-256 digests cannot be verified securely; reissue those keys.
  if (!parts) return undefined;
  return { salt: Buffer.from(parts[1] as string, "hex"), digest: Buffer.from(parts[2] as string, "hex") };
}

export class ApiKeyRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  issue(name: string, role: Role, plaintext: string): ApiKeyRecord {
    const rows = this.#db.prepare("SELECT key_hash FROM api_keys").all() as { key_hash: string }[];
    for (const row of rows) {
      const stored = parseHash(row.key_hash);
      if (stored && timingSafeEqual(stored.digest, scryptSync(plaintext, stored.salt, stored.digest.length))) {
        throw AppError.conflict("duplicate_api_key", "This API key has already been issued");
      }
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.#db
      .prepare(
        `INSERT INTO api_keys (id, name, key_hash, role, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .run(id, name, hashKey(plaintext), role, now);
    return this.findById(id) as ApiKeyRecord;
  }

  findById(id: string): ApiKeyRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  /**
   * Looks up an active key by its salted digest.
   *
   * Compared with timingSafeEqual rather than by SQL equality, so a lookup
   * does not leak timing information about the key.
   */
  async findByPlaintext(plaintext: string): Promise<ApiKeyRecord | undefined> {
    const rows = this.#db
      .prepare("SELECT * FROM api_keys")
      .all() as unknown as ApiKeyRow[];
    let match: ApiKeyRow | undefined;

    for (const row of rows) {
      const stored = parseHash(row.key_hash);
      if (!stored) continue;
      const candidate = await new Promise<Buffer>((resolve, reject) => {
        scrypt(plaintext, stored.salt, stored.digest.length, (error, derived) =>
          error ? reject(error) : resolve(derived),
        );
      });
      if (timingSafeEqual(stored.digest, candidate)) {
        // Reject pre-existing duplicate keys, including revoked copies, rather than
        // letting row order determine identity or undo a revocation.
        if (match) return undefined;
        match = row;
      }
    }
    return match?.is_active === 1 ? toRecord(match) : undefined;
  }

  touch(id: string): void {
    this.#db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  list(): ApiKeyRecord[] {
    const rows = this.#db
      .prepare("SELECT * FROM api_keys ORDER BY created_at ASC")
      .all() as unknown as ApiKeyRow[];
    return rows.map(toRecord);
  }

  revoke(id: string): boolean {
    return this.#db.prepare("UPDATE api_keys SET is_active = 0 WHERE id = ?").run(id).changes > 0;
  }
}
