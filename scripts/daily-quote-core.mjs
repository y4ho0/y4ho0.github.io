const ONLINE_QUOTE_URL = "https://y4ho0.github.io/data/daily-quote.json";
const MAX_HISTORY = 30;
const MAX_LENGTH = 220;

const providers = {
  english: [fetchQuotable, fetchDummyJson, fetchZenQuotes],
  chinese: [fetchHitokotoChinese],
  "math-cs": [fetchProgrammingQuote, fetchQuotableTechnical],
  "fiction-games": [fetchHitokotoFiction],
};

export function dateInShanghai(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function selectCategory(date) {
  let hash = 2166136261;
  for (const character of date) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const bucket = (hash >>> 0) % 100;
  if (bucket < 60) return "english";
  if (bucket < 85) return "chinese";
  if (bucket < 95) return "math-cs";
  return "fiction-games";
}

function decodeEntities(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function plainText(value) {
  if (typeof value !== "string") return "";
  return decodeEntities(value)
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizedKey(text, author) {
  return `${text}::${author ?? ""}`.toLocaleLowerCase("en-US").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function isSafeText(text) {
  if (text.length === 0 || [...text].length > MAX_LENGTH) return false;
  if (/<|>|javascript:|https?:\/\//iu.test(text)) return false;
  const disallowed = [/(?:kill|hurt)\s+(?:yourself|myself)/iu, /\b(?:porn|xxx)\b/iu];
  return disallowed.every((pattern) => !pattern.test(text));
}

function normalizeCandidate(candidate, category) {
  const text = plainText(candidate?.text);
  const author = plainText(candidate?.author) || null;
  const source = plainText(candidate?.source) || null;
  const provider = plainText(candidate?.provider) || null;
  const providerUrl = typeof candidate?.providerUrl === "string" && /^https:\/\/[^\s]+$/u.test(candidate.providerUrl) && candidate.providerUrl.length <= 500
    ? candidate.providerUrl
    : null;
  if (
    !isSafeText(text)
    || (!author && !source)
    || (author && [...author].length > 100)
    || (source && [...source].length > 140)
    || !provider
    || [...provider].length > 80
    || !providerUrl
  ) return null;
  return {
    text,
    author,
    source,
    language: candidate.language === "zh" ? "zh" : "en",
    category,
    provider,
    providerUrl,
  };
}

function isPlainLimited(value, maximum, nullable = true) {
  if (value === null && nullable) return true;
  return typeof value === "string" && value === plainText(value) && [...value].length <= maximum;
}

function isStoredHistoryItem(item) {
  return item
    && /^\d{4}-\d{2}-\d{2}$/u.test(item.date)
    && typeof item.text === "string"
    && item.text === plainText(item.text)
    && isSafeText(item.text)
    && isPlainLimited(item.author, 100)
    && isPlainLimited(item.source, 140)
    && Boolean(item.author || item.source)
    && ["en", "zh"].includes(item.language)
    && ["english", "chinese", "math-cs", "fiction-games"].includes(item.category)
    && isPlainLimited(item.provider, 80, false)
    && typeof item.providerUrl === "string"
    && /^https:\/\/[^\s]+$/u.test(item.providerUrl)
    && item.providerUrl.length <= 500
    && (item.fetchedAt === null || typeof item.fetchedAt === "string");
}

function isStoredQuote(value) {
  if (
    !value
    || value.version !== 1
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value.date)
    || typeof value.text !== "string"
    || !["en", "zh"].includes(value.language)
    || !["english", "chinese", "math-cs", "fiction-games"].includes(value.category)
    || !["fresh", "fallback", "hidden"].includes(value.status)
    || !Array.isArray(value.history)
    || value.history.length > MAX_HISTORY
  ) return false;

  if (value.status === "hidden") {
    if (value.text !== "" || value.author !== null || value.source !== null || value.provider !== null || value.providerUrl !== null) return false;
  } else if (
    value.text !== plainText(value.text)
    || !isSafeText(value.text)
    || !isPlainLimited(value.author, 100)
    || !isPlainLimited(value.source, 140)
    || !value.author && !value.source
    || !isPlainLimited(value.provider, 80, false)
    || typeof value.providerUrl !== "string"
    || !/^https:\/\/[^\s]+$/u.test(value.providerUrl)
    || value.providerUrl.length > 500
  ) return false;

  const currentKey = value.text ? normalizedKey(value.text, value.author) : null;
  const seen = new Set();
  for (const item of value.history) {
    if (!isStoredHistoryItem(item)) return false;
    const key = normalizedKey(item.text, item.author);
    if (key === currentKey || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function historyItem(quote) {
  return {
    date: quote.date,
    text: quote.text,
    author: quote.author ?? null,
    source: quote.source ?? null,
    language: quote.language,
    category: quote.category,
    provider: quote.provider ?? null,
    providerUrl: quote.providerUrl ?? null,
    fetchedAt: quote.fetchedAt ?? null,
  };
}

function recentHistory(previous, candidate) {
  if (!previous) return [];
  const items = previous.text ? [historyItem(previous), ...previous.history] : previous.history;
  const candidateKey = candidate ? normalizedKey(candidate.text, candidate.author) : null;
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.text) return false;
    const key = normalizedKey(item.text, item.author);
    if (key === candidateKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_HISTORY);
}

async function fetchJson(fetchImpl, url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "y4ho0-garden-build/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function cacheBustedStateUrl(url, now) {
  try {
    const stateUrl = new URL(url);
    stateUrl.searchParams.set("quote-state-check", String(now.getTime()));
    return stateUrl.toString();
  } catch {
    return url;
  }
}

async function fetchQuotable(fetchImpl) {
  const data = await fetchJson(fetchImpl, "https://api.quotable.io/quotes/random?limit=1&maxLength=220&tags=philosophy|literature|science");
  const quote = Array.isArray(data) ? data[0] : data?.results?.[0] ?? data;
  return {
    text: quote?.content,
    author: quote?.author,
    source: null,
    language: "en",
    provider: "Quotable",
    providerUrl: quote?._id ? `https://quotable.io/quotes/${quote._id}` : "https://quotable.io/",
  };
}

async function fetchQuotableTechnical(fetchImpl) {
  const quote = await fetchQuotable(fetchImpl);
  return { ...quote, providerUrl: quote.providerUrl };
}

async function fetchZenQuotes(fetchImpl) {
  const data = await fetchJson(fetchImpl, "https://zenquotes.io/api/random");
  const quote = Array.isArray(data) ? data[0] : data;
  return {
    text: quote?.q,
    author: quote?.a,
    source: null,
    language: "en",
    provider: "ZenQuotes",
    providerUrl: "https://zenquotes.io/",
  };
}

async function fetchDummyJson(fetchImpl) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const quote = await fetchJson(fetchImpl, "https://dummyjson.com/quotes/random");
    const text = plainText(quote?.quote);
    const author = plainText(quote?.author);
    if (!isSafeText(text) || !author) continue;
    return {
      text,
      author,
      source: null,
      language: "en",
      provider: "DummyJSON Quotes",
      providerUrl: "https://dummyjson.com/docs/quotes",
    };
  }
  throw new Error("DummyJSON did not return a usable quote.");
}

async function fetchHitokoto(fetchImpl, query) {
  const data = await fetchJson(fetchImpl, `https://international.v1.hitokoto.cn/?${query}&max_length=220&encode=json`);
  return {
    text: data?.hitokoto,
    author: data?.from_who,
    source: data?.from,
    language: "zh",
    provider: "Hitokoto",
    providerUrl: data?.uuid ? `https://hitokoto.cn/?uuid=${encodeURIComponent(data.uuid)}` : "https://hitokoto.cn/",
  };
}

function fetchHitokotoChinese(fetchImpl) {
  return fetchHitokoto(fetchImpl, "c=d&c=i&c=k");
}

function fetchHitokotoFiction(fetchImpl) {
  return fetchHitokoto(fetchImpl, "c=a&c=b&c=c&c=h");
}

async function fetchProgrammingQuote(fetchImpl) {
  const data = await fetchJson(fetchImpl, "https://programming-quotesapi.vercel.app/api/random");
  return {
    text: data?.quote ?? data?.en,
    author: data?.author,
    source: data?.source ?? "Programming Quotes API",
    language: "en",
    provider: "Programming Quotes API",
    providerUrl: "https://github.com/mudroljub/programming-quotes-api",
  };
}

export async function resolveDailyQuote({
  now = new Date(),
  fetchImpl = globalThis.fetch,
  localQuote = null,
  onlineUrl = ONLINE_QUOTE_URL,
  maxAttempts = 3,
  onProviderError = null,
} = {}) {
  const today = dateInShanghai(now);
  let onlineQuote = null;
  try {
    onlineQuote = await fetchJson(fetchImpl, cacheBustedStateUrl(onlineUrl, now));
  } catch {
    onlineQuote = null;
  }

  const storedOnlineQuote = isStoredQuote(onlineQuote) ? onlineQuote : null;
  const storedLocalQuote = isStoredQuote(localQuote) ? localQuote : null;

  // A hidden state means no quote was actually generated. Retry it later on
  // the same day, while successful fresh/fallback states remain stable.
  if (storedOnlineQuote?.date === today && storedOnlineQuote.status !== "hidden") return storedOnlineQuote;
  if (storedLocalQuote?.date === today && storedLocalQuote.status !== "hidden") return storedLocalQuote;

  const previous = storedOnlineQuote?.text
    ? storedOnlineQuote
    : storedLocalQuote?.text
      ? storedLocalQuote
      : storedOnlineQuote ?? storedLocalQuote;
  const category = selectCategory(today);
  const categoryProviders = providers[category];
  const recent = new Set(
    previous
      ? [previous, ...previous.history]
        .filter((item) => item?.text)
        .map((item) => normalizedKey(item.text, item.author))
      : [],
  );

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const provider = categoryProviders[attempt % categoryProviders.length];
    try {
      const candidate = normalizeCandidate(await provider(fetchImpl), category);
      if (!candidate || recent.has(normalizedKey(candidate.text, candidate.author))) continue;
      return {
        version: 1,
        date: today,
        ...candidate,
        fetchedAt: now.toISOString(),
        status: "fresh",
        history: recentHistory(previous, candidate),
      };
    } catch (error) {
      onProviderError?.({
        provider: provider.name || "anonymous-provider",
        error,
      });
      // A provider failure is expected to fall through to the next adapter.
    }
  }

  if (previous?.text) {
    const { staleFromDate: _staleFromDate, ...stored } = previous;
    return {
      ...stored,
      date: today,
      status: "fallback",
      staleFromDate: previous.staleFromDate ?? previous.date,
      history: recentHistory(previous, previous),
    };
  }

  return {
    version: 1,
    date: today,
    text: "",
    author: null,
    source: null,
    language: category === "chinese" || category === "fiction-games" ? "zh" : "en",
    category,
    provider: null,
    providerUrl: null,
    fetchedAt: null,
    status: "hidden",
    history: [],
  };
}
