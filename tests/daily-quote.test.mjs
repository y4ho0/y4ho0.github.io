import assert from "node:assert/strict";
import test from "node:test";
import { dateInShanghai, resolveDailyQuote } from "../scripts/daily-quote-core.mjs";

const now = new Date("2026-07-16T04:00:00.000Z");
const onlineUrl = "https://example.test/daily-quote.json";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function baseQuote(overrides = {}) {
  return {
    version: 1,
    date: "2026-07-15",
    text: "A previous verified quote.",
    author: "Previous Author",
    source: null,
    language: "en",
    category: "english",
    provider: "Quotable",
    providerUrl: "https://quotable.io/",
    fetchedAt: "2026-07-15T00:00:00.000Z",
    status: "fresh",
    history: [],
    ...overrides,
  };
}

test("uses the Asia/Shanghai calendar date", () => {
  assert.equal(dateInShanghai(new Date("2026-07-14T16:01:00.000Z")), "2026-07-15");
});

test("reuses an online quote generated on the same day", async () => {
  const current = baseQuote({ date: "2026-07-16" });
  let calls = 0;
  const quote = await resolveDailyQuote({ now, onlineUrl, fetchImpl: async () => { calls += 1; return response(current); } });
  assert.deepEqual(quote, current);
  assert.equal(calls, 1);
});

test("reuses local state on a repeated same-day manual build", async () => {
  const current = baseQuote({ date: "2026-07-16" });
  let calls = 0;
  const quote = await resolveDailyQuote({
    now,
    onlineUrl,
    localQuote: current,
    fetchImpl: async () => { calls += 1; return response({}, 404); },
  });
  assert.deepEqual(quote, current);
  assert.equal(calls, 1);
});

test("rejects unsafe same-day stored state", async () => {
  const unsafe = baseQuote({
    date: "2026-07-16",
    text: "<strong>unsafe</strong>",
    providerUrl: "javascript:alert(1)",
  });
  const quote = await resolveDailyQuote({
    now,
    onlineUrl,
    localQuote: unsafe,
    fetchImpl: async () => response({}, 503),
  });
  assert.equal(quote.status, "hidden");
  assert.equal(quote.text, "");
});

test("accepts a provider result and strips HTML", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return response({}, 404);
    return response([{ content: "<em>Clear thought</em> grows slowly.", author: "A. Writer", _id: "verified" }]);
  };
  const quote = await resolveDailyQuote({ now, onlineUrl, fetchImpl });
  assert.equal(quote.status, "fresh");
  assert.equal(quote.text, "Clear thought grows slowly.");
  assert.equal(quote.author, "A. Writer");
});

test("falls back to an older online quote when providers fail", async () => {
  let calls = 0;
  const quote = await resolveDailyQuote({
    now,
    onlineUrl,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(baseQuote()) : response({}, 503);
    },
  });
  assert.equal(quote.status, "fallback");
  assert.equal(quote.date, "2026-07-16");
  assert.equal(quote.staleFromDate, "2026-07-15");
});

test("hides the quote on a first deployment when every provider fails", async () => {
  const quote = await resolveDailyQuote({ now, onlineUrl, fetchImpl: async () => response({}, 503) });
  assert.equal(quote.status, "hidden");
  assert.equal(quote.text, "");
});

test("rejects a recent duplicate and retries", async () => {
  const previous = baseQuote();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return response(previous);
    if (calls === 2) return response([{ content: previous.text, author: previous.author, _id: "duplicate" }]);
    return response([{ q: "A new verified thought.", a: "New Author" }]);
  };
  const quote = await resolveDailyQuote({ now, onlineUrl, fetchImpl });
  assert.equal(quote.status, "fresh");
  assert.equal(quote.text, "A new verified thought.");
});
