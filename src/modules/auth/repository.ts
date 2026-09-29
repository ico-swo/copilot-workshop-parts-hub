import type { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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

export class ApiKeyRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  issue(name: string, role: Role, plaintext: string): ApiKeyRecord {
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
  findByPlaintext(plaintext: string): ApiKeyRecord | undefined {
    const rows = this.#db
      .prepare("SELECT * FROM api_keys WHERE is_active = 1")
      .all() as unknown as ApiKeyRow[];

    for (const row of rows) {
      const [saltHex, hashHex] = row.key_hash.split(":");
      // Legacy unsalted SHA-256 digests cannot be verified securely; reissue those keys.
      if (!saltHex || !hashHex || !/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{128}$/.test(hashHex)) continue;
      const stored = Buffer.from(hashHex, "hex");
      const candidate = scryptSync(plaintext, Buffer.from(saltHex, "hex"), stored.length);
      if (timingSafeEqual(stored, candidate)) {
        return toRecord(row);
      }
    }
    return undefined;
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
