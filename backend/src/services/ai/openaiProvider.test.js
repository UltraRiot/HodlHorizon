import { test } from "node:test";
import assert from "node:assert/strict";
import { openaiGenerateGlossary } from "./openaiProvider.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

const CLEAN_GLOSSARY_BODY = {
  choices: [{ message: { content: JSON.stringify({ short_definition: "A test definition.", body: "Paragraph one.\n\nParagraph two.", seo_title: "Test Title Under Sixty Chars", seo_description: "A test SEO description that is long enough to satisfy the length guidance for this field." }) } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

async function withStubbedFetch(fetchImpl, run) {
  const originalFetch = global.fetch;
  try {
    global.fetch = fetchImpl;
    return await run();
  } finally {
    global.fetch = originalFetch;
  }
}

test("callOpenAi throws a clear error on a model refusal instead of silently returning an empty result", async () => {
  await withStubbedFetch(
    async () => jsonResponse(200, { choices: [{ message: { refusal: "This request violates the content policy.", content: null } }], usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 } }),
    async () => {
      await assert.rejects(
        () => openaiGenerateGlossary("Some Term"),
        /OpenAI refused this request: This request violates the content policy\./
      );
    }
  );
});

test("callOpenAi does not throw on a clean response with no refusal (sanity check for the refusal test above)", async () => {
  await withStubbedFetch(
    async () => jsonResponse(200, CLEAN_GLOSSARY_BODY),
    async () => {
      const entry = await openaiGenerateGlossary("Some Term");
      assert.equal(entry.short_definition, "A test definition.");
    }
  );
});

test("callOpenAi retries once on a 429 and succeeds on the second attempt", async () => {
  let callCount = 0;
  await withStubbedFetch(
    async () => {
      callCount += 1;
      if (callCount === 1) return jsonResponse(429, { error: { message: "Rate limit exceeded" } });
      return jsonResponse(200, CLEAN_GLOSSARY_BODY);
    },
    async () => {
      const entry = await openaiGenerateGlossary("Some Term");
      assert.equal(entry.short_definition, "A test definition.");
      assert.equal(callCount, 2, "expected exactly one retry (two total fetch calls)");
    }
  );
});

test("callOpenAi retries on a 503 the same way as a 429", async () => {
  let callCount = 0;
  await withStubbedFetch(
    async () => {
      callCount += 1;
      if (callCount === 1) return jsonResponse(503, { error: { message: "Service unavailable" } });
      return jsonResponse(200, CLEAN_GLOSSARY_BODY);
    },
    async () => {
      const entry = await openaiGenerateGlossary("Some Term");
      assert.equal(entry.short_definition, "A test definition.");
      assert.equal(callCount, 2);
    }
  );
});

test("callOpenAi does NOT retry a non-retryable 400 - fails immediately on the first attempt", async () => {
  let callCount = 0;
  await withStubbedFetch(
    async () => {
      callCount += 1;
      return jsonResponse(400, { error: { message: "Invalid request" } });
    },
    async () => {
      await assert.rejects(() => openaiGenerateGlossary("Some Term"), /OpenAI request failed \(400\)/);
      assert.equal(callCount, 1, "a 400 is not in RETRYABLE_STATUS - it should never be retried");
    }
  );
});

test("callOpenAi gives up after exhausting its retries on a persistent 500, throwing the final failure", async () => {
  let callCount = 0;
  await withStubbedFetch(
    async () => {
      callCount += 1;
      return jsonResponse(500, { error: { message: "Internal server error" } });
    },
    async () => {
      await assert.rejects(() => openaiGenerateGlossary("Some Term"), /OpenAI request failed \(500\)/);
      assert.equal(callCount, 3, "expected the initial attempt plus both backoff retries, then give up");
    }
  );
});
