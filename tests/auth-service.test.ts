import test from "node:test";
import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { config } from "../src/config.ts";
import { AuthService } from "../src/modules/auth/service.ts";
import { seededDatabase } from "./helpers.ts";

test("limits unauthenticated attempts before key verification", () => {
  const { db } = seededDatabase();
  const auth = new AuthService(db);
  const req = new IncomingMessage(new Socket());
  for (let attempt = 0; attempt < config.rateLimitPerMinute; attempt += 1) {
    auth.preAuthRateLimit(req);
  }

  assert.throws(() => auth.preAuthRateLimit(req), { status: 429, code: "rate_limited" });
  req.destroy();
});

test("different credentials on the same connection have independent pre-auth quotas", () => {
  const { db } = seededDatabase();
  const auth = new AuthService(db);
  const socket = new Socket();
  const first = new IncomingMessage(socket);
  const second = new IncomingMessage(socket);
  first.headers.authorization = ["Bearer", "invalid-one"].join(" ");
  second.headers.authorization = ["Bearer", "valid-other"].join(" ");

  for (let attempt = 0; attempt < config.rateLimitPerMinute; attempt += 1) {
    auth.preAuthRateLimit(first);
  }
  assert.throws(() => auth.preAuthRateLimit(first), { status: 429, code: "rate_limited" });
  assert.doesNotThrow(() => auth.preAuthRateLimit(second));
  first.headers.authorization += " ";
  assert.throws(() => auth.preAuthRateLimit(first), { status: 429, code: "rate_limited" });
  first.destroy();
  second.destroy();
});
