import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => new Response([
  "User-agent: *",
  "Allow: /",
  `Sitemap: ${new URL("/sitemap.xml", site).toString()}`,
  "",
].join("\n"), {
  headers: { "content-type": "text/plain; charset=utf-8" },
});
