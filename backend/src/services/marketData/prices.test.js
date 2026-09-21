// Permanent regression tests for computeSnapshotFromCloses's support/
// resistance calculation - see its comment in prices.js for the real bug:
// the window used to include today's own close, which mathematically
// forces resistance (or support) to equal the current price on any day
// that's a new 14-day high (or low) - common in a trend, since that's
// what "Bullish"/"Bearish" usually looks like. Real published Analysis
// output from this: "the current price is at the resistance level of
// $X... a break above this resistance could signal further bullish
// momentum" - circular, since $X was defined BY today's price.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSnapshotFromCloses, getJson } from "./prices.js";

test("computeSnapshotFromCloses does not collapse resistance to the current price on a new 14-day high (real bug)", () => {
  // Strictly ascending closes - today (the last one) is the highest value
  // in the whole series, so it was also the max of its own 14-day window
  // under the old bug.
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i); // ...157, 158, 159
  const snapshot = computeSnapshotFromCloses("BTC/USD", closes, "crypto");
  assert.equal(snapshot.price, 159);
  assert.notEqual(snapshot.resistance, snapshot.price, "resistance collapsed to the current price - the regression is back");
  assert.equal(snapshot.resistance, 158, "resistance should be the highest close in the 14 days BEFORE today, not including today");
  assert.ok(snapshot.resistance < snapshot.price, "a genuine new high should read as price breaking above resistance, not sitting on it");
});

test("computeSnapshotFromCloses does not collapse support to the current price on a new 14-day low (symmetric case)", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 200 - i); // ...143, 142, 141
  const snapshot = computeSnapshotFromCloses("BTC/USD", closes, "crypto");
  assert.equal(snapshot.price, 141);
  assert.notEqual(snapshot.support, snapshot.price, "support collapsed to the current price - the regression is back");
  assert.equal(snapshot.support, 142, "support should be the lowest close in the 14 days BEFORE today, not including today");
  assert.ok(snapshot.support > snapshot.price, "a genuine new low should read as price breaking below support, not sitting on it");
});

test("computeSnapshotFromCloses computes a normal support < price < resistance range when today isn't an extreme", () => {
  const priorWindow = [90, 95, 100, 105, 110, 108, 106, 104, 102, 100, 98, 96, 94, 92];
  const closes = [...priorWindow, 100]; // today sits comfortably inside the prior range
  const snapshot = computeSnapshotFromCloses("BTC/USD", closes, "crypto");
  assert.equal(snapshot.price, 100);
  assert.equal(snapshot.support, 90);
  assert.equal(snapshot.resistance, 110);
  assert.ok(snapshot.support < snapshot.price && snapshot.price < snapshot.resistance);
});

// Regression tests for getJson's COINGECKO_API_KEY header logic - added
// after this project repeatedly hit real HTTP 429s on CoinGecko's keyless
// public endpoint during live verification batches. Stubs global.fetch
// (no other test in this project does this, but getJson has no DI seam
// and there's no real key to test against) so this runs with no network
// call and no real key, purely verifying which header gets attached to
// which URL.
test("getJson attaches the CoinGecko Demo API key header when COINGECKO_API_KEY is set and the URL is a CoinGecko one", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.COINGECKO_API_KEY;
  let capturedHeaders;
  try {
    process.env.COINGECKO_API_KEY = "test-demo-key-123";
    global.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      return { ok: true, json: async () => ({}) };
    };
    await getJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin");
    assert.equal(capturedHeaders["x-cg-demo-api-key"], "test-demo-key-123");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.COINGECKO_API_KEY;
    else process.env.COINGECKO_API_KEY = originalKey;
  }
});

test("getJson sends no CoinGecko key header when COINGECKO_API_KEY is unset (today's default, keyless behavior)", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.COINGECKO_API_KEY;
  let capturedHeaders;
  try {
    delete process.env.COINGECKO_API_KEY;
    global.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      return { ok: true, json: async () => ({}) };
    };
    await getJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin");
    assert.equal(capturedHeaders["x-cg-demo-api-key"], undefined);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.COINGECKO_API_KEY;
    else process.env.COINGECKO_API_KEY = originalKey;
  }
});

test("getJson does not attach the CoinGecko key header to a non-CoinGecko URL (e.g. Alpha Vantage)", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.COINGECKO_API_KEY;
  let capturedHeaders;
  try {
    process.env.COINGECKO_API_KEY = "test-demo-key-123";
    global.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      return { ok: true, json: async () => ({}) };
    };
    await getJson("https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&apikey=abc");
    assert.equal(capturedHeaders["x-cg-demo-api-key"], undefined);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.COINGECKO_API_KEY;
    else process.env.COINGECKO_API_KEY = originalKey;
  }
});
