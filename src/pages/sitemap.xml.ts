import type { APIRoute } from "astro";
import { getAllPublished } from "../lib/content";
import { entryRoute } from "../lib/content-routing";

const staticRoutes = [
  "/",
  "/garden/",
  "/courses/",
  "/labs/",
  "/essays/",
  "/archive/",
  "/search/",
  "/about/",
];

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export const GET: APIRoute = async ({ site }) => {
  const entries = await getAllPublished();
  const urls = [
    ...staticRoutes.map((pathname) => ({ pathname, updatedAt: null as Date | null })),
    ...entries.map((entry) => ({ pathname: entryRoute(entry), updatedAt: entry.data.updatedAt })),
  ];
  const unique = new Map(urls.map((item) => [item.pathname, item]));
  const body = [...unique.values()].map(({ pathname, updatedAt }) => {
    const location = escapeXml(new URL(pathname, site).toString());
    const lastmod = updatedAt ? `<lastmod>${updatedAt.toISOString()}</lastmod>` : "";
    return `<url><loc>${location}</loc>${lastmod}</url>`;
  }).join("");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
};
