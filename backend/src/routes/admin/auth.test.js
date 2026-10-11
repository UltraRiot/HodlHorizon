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
