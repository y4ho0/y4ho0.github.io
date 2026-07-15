import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveDailyQuote } from "./daily-quote-core.mjs";

const outputPath = resolve("public/data/daily-quote.json");

async function readLocalQuote() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    return null;
  }
}

const quote = await resolveDailyQuote({
  localQuote: await readLocalQuote(),
  onlineUrl: process.env.DAILY_QUOTE_ONLINE_URL || undefined,
});

await mkdir(resolve("public/data"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(quote, null, 2)}\n`, "utf8");
console.log(`Daily quote state: ${quote.status} (${quote.date}, ${quote.category}).`);
