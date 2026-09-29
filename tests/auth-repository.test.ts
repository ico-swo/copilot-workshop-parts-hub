import test from "node:test";
import assert from "node:assert/strict";
import { seededDatabase } from "./helpers.ts";
import { ApiKeyRepository, hashKey } from "../src/modules/auth/repository.ts";

test("issued keys have distinct salted digests", () => {
  const { db } = seededDatabase();
  const keys = new ApiKeyRepository(db);
  const first = keys.issue("first", "viewer", "first-secret");
  const second = keys.issue("second", "viewer", "second-secret");
  const firstHash = db.prepare("SELECT key_hash FROM api_keys WHERE id = ?").get(first.id) as { key_hash: string };
  const secondHash = db.prepare("SELECT key_hash FROM api_keys WHERE id = ?").get(second.id) as { key_hash: string };

  assert.match(firstHash.key_hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.notEqual(firstHash.key_hash, secondHash.key_hash);
  assert.ok(!firstHash.key_hash.includes("first-secret"));
});

test("duplicate plaintext keys cannot be issued under another role or after revocation", () => {
  const { db } = seededDatabase();
  const keys = new ApiKeyRepository(db);
  const issued = keys.issue("first", "viewer", "same-secret");

  assert.throws(() => keys.issue("second", "admin", "same-secret"), { status: 409, code: "duplicate_api_key" });
  keys.revoke(issued.id);
  assert.throws(() => keys.issue("third", "admin", "same-secret"), { status: 409, code: "duplicate_api_key" });
});

test("pre-existing duplicate plaintext keys fail closed, including a revoked copy", async () => {
  const { db } = seededDatabase();
  const keys = new ApiKeyRepository(db);
  const issued = keys.issue("first", "viewer", "duplicate-secret");
  db.prepare(
    `INSERT INTO api_keys (id, name, key_hash, role, is_active, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run("duplicate", "duplicate", hashKey("duplicate-secret"), "admin", new Date().toISOString());

  assert.equal(await keys.findByPlaintext("duplicate-secret"), undefined);
  assert.equal(keys.findById(issued.id)?.isActive, true);
});

test("only the correct active plaintext key authenticates", async () => {
  const { db } = seededDatabase();
  const keys = new ApiKeyRepository(db);
  const issued = keys.issue("test-key", "viewer", "correct-secret");

  assert.equal((await keys.findByPlaintext("correct-secret"))?.id, issued.id);
  assert.equal(await keys.findByPlaintext("wrong-secret"), undefined);
  keys.revoke(issued.id);
  assert.equal(await keys.findByPlaintext("correct-secret"), undefined);
});

test("legacy unsalted hashes do not authenticate", async () => {
  const { db } = seededDatabase();
  const keys = new ApiKeyRepository(db);
  db.prepare(
    `INSERT INTO api_keys (id, name, key_hash, role, is_active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
  ).run("legacy", "legacy", "a".repeat(64), "viewer", new Date().toISOString());

  assert.equal(await keys.findByPlaintext("legacy"), undefined);
});
