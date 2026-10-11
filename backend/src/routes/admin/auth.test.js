// Regression test for the admin-login rate limiter (see auth.js's
// loginLimiter) - pre-launch security review found POST /api/admin/login
// had zero abuse protection, unlike the poll-vote/reaction routes which
// already had perIpPerResourceLimiter. Runs the REAL router (not a copy of
// the limiter in isolation) on a real Express app listening on a real
// ephemeral loopback port, and makes real HTTP requests against it - the
// closest a test in this project gets to actually "hitting /login" without
// standing up the whole server.js.
//
// trust proxy is enabled only on this TEST app so X-Forwarded-For can
// simulate two distinct client IPs over a single real loopback connection
// (every real request in this test physically arrives from 127.0.0.1) -
// see rateLimit.js's own comment on why server.js does NOT do this in
// production without a real trusted proxy in front of it.
//
// A bogus, nonexistent email is used throughout - the route returns 401
// after a single fast, real SELECT (no bcrypt.compare, since rows.length
// is 0), so this exercises the real route without needing bcrypt work or
// touching admin_users' actual data.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import adminAuthRoutes from "./auth.js";

async function startTestServer() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use("/api/admin", adminAuthRoutes);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

function loginRequest(port, ip) {
  return fetch(`http://127.0.0.1:${port}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email: "rate-limit-test@example.com", password: "wrong-password" }),
  });
}

test("POST /api/admin/login rejects the 11th attempt from the same IP within the window, and leaves a different IP unaffected", async () => {
  const { server, port } = await startTestServer();
  try {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const res = await loginRequest(port, "203.0.113.5");
      statuses.push(res.status);
    }
    assert.deepEqual(
      statuses.slice(0, 10),
      Array(10).fill(401),
      "the first 10 attempts (bogus credentials, but under the limit) should fail normally with 401, not be rate-limited"
    );
    assert.equal(statuses[10], 429, "the 11th attempt from the same IP within the window should be rejected with 429");

    const blockedBody = await (await loginRequest(port, "203.0.113.5")).json();
    assert.match(blockedBody.error, /too many login attempts/i);

    const otherIpRes = await loginRequest(port, "198.51.100.9");
    assert.equal(otherIpRes.status, 401, "a different IP should be completely unaffected by the first IP's limit, not blocked");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
