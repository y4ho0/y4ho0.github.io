import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");
const errors = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }));
  return files.flat();
}

for (const required of [
  "index.html",
  "404.html",
  "search/index.html",
  "rss.xml",
  "sitemap.xml",
  "robots.txt",
  "pagefind/pagefind.js",
  "data/daily-quote.json",
  "favicon-32.png",
  "apple-touch-icon.png",
  "og.png",
]) {
  try {
    await access(path.join(dist, required));
  } catch {
    errors.push(`missing output: ${required}`);
  }
}

const files = await walk(dist);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
const canonicals = new Map();

function internalTarget(href) {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const pathname = href.split(/[?#]/u)[0];
  if (pathname === "/") return path.join(dist, "index.html");
  if (path.extname(pathname)) return path.join(dist, pathname);
  return path.join(dist, pathname, "index.html");
}

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const relativeFile = path.relative(dist, file);
  const h1Count = (html.match(/<h1(?:\s|>)/gu) ?? []).length;
  if (h1Count !== 1) errors.push(`${relativeFile} has ${h1Count} h1 elements`);
  for (const imageTag of html.match(/<img\b[^>]*>/gu) ?? []) {
    if (!/\salt="[^"]*"/u.test(imageTag)) errors.push(`${relativeFile} has an image without alt text`);
  }
  for (const canvasTag of html.match(/<canvas\b[^>]*>/gu) ?? []) {
    if (!/\saria-hidden="true"/u.test(canvasTag)) errors.push(`${relativeFile} has a non-hidden decorative canvas`);
  }
  const inlineScriptBytes = (html.match(/<script\s+type="module">([\s\S]*?)<\/script>/gu) ?? [])
    .reduce((total, script) => total + Buffer.byteLength(script), 0);
  if (inlineScriptBytes > 30_000) errors.push(`${relativeFile} has ${inlineScriptBytes} bytes of inline module JavaScript`);
  if (relativeFile !== "index.html" && html.includes("home-canvas")) errors.push(`${relativeFile} loads the home canvas`);
  if (relativeFile === "404.html" && !html.includes('name="robots" content="noindex, nofollow"')) errors.push("404.html is indexable");
  const canonicalMatches = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/gu)];
  if (canonicalMatches.length !== 1) {
    errors.push(`${relativeFile} has ${canonicalMatches.length} canonical links`);
  } else {
    const canonical = canonicalMatches[0][1];
    if (!canonical.startsWith("https://y4ho0.github.io/")) errors.push(`non-absolute canonical: ${canonical}`);
    if (canonicals.has(canonical)) errors.push(`duplicate canonical: ${canonical}`);
    canonicals.set(canonical, file);
  }

  const links = [...html.matchAll(/(?:href|src)="([^"]+)"/gu)].map((match) => match[1]);
  for (const link of links) {
    const target = internalTarget(link);
    if (!target) continue;
    try {
      await access(target);
    } catch {
      errors.push(`${relativeFile} links to missing ${link}`);
    }
  }
}

const sitemap = await readFile(path.join(dist, "sitemap.xml"), "utf8");
if (!sitemap.includes("<urlset") || sitemap.includes("sitemapindex")) errors.push("sitemap.xml is not a single URL set");
if (sitemap.includes("/404")) errors.push("sitemap.xml includes the 404 page");

const rss = await readFile(path.join(dist, "rss.xml"), "utf8");
if (!rss.includes("<rss") || !rss.includes("<channel>")) errors.push("rss.xml is invalid");

const quote = JSON.parse(await readFile(path.join(dist, "data/daily-quote.json"), "utf8"));
const quoteFields = ["version", "date", "text", "author", "source", "language", "category", "provider", "providerUrl", "fetchedAt", "status", "history"];
if (quoteFields.some((field) => !(field in quote))) errors.push("daily-quote.json is missing required fields");
if (!/^\d{4}-\d{2}-\d{2}$/u.test(quote.date) || !["fresh", "fallback", "hidden"].includes(quote.status)) errors.push("daily-quote.json has invalid state");
if (quote.status === "hidden" ? quote.text !== "" : !quote.text) errors.push("daily-quote.json text does not match its state");
if (/[<>]/u.test(quote.text) || !Array.isArray(quote.history) || quote.history.length > 30) errors.push("daily-quote.json failed text or history validation");

if (quote.text) {
  if (rss.includes(quote.text)) errors.push("daily quote leaked into RSS");
  const pagefindFiles = files.filter((file) => file.includes(`${path.sep}pagefind${path.sep}`));
  for (const file of pagefindFiles) {
    const contents = await readFile(file);
    if (contents.includes(Buffer.from(quote.text))) errors.push(`daily quote leaked into Pagefind: ${path.relative(dist, file)}`);
  }
}

const robots = await readFile(path.join(dist, "robots.txt"), "utf8");
if (!robots.includes("https://y4ho0.github.io/sitemap.xml")) errors.push("robots.txt has no absolute sitemap URL");

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const [label, foreground, background] of [
  ["light text", "#20231f", "#f4f0e6"],
  ["light muted text", "#696f66", "#f4f0e6"],
  ["light action", "#596853", "#f4f0e6"],
  ["dark text", "#eae6dc", "#111318"],
  ["dark muted text", "#969d98", "#111318"],
  ["dark action", "#91a58a", "#111318"],
]) {
  const ratio = contrast(foreground, background);
  if (ratio < 4.5) errors.push(`${label} contrast is ${ratio.toFixed(2)}:1`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Distribution valid: ${htmlFiles.length} HTML pages, ${canonicals.size} unique canonical URLs.`);
