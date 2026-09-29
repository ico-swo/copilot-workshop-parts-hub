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
