import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getPublishedEssays, getPublishedLabs, getPublishedNotes, getPublishedProjects } from "../lib/content";
import { entryRoute } from "../lib/content-routing";
import { SITE_DESCRIPTION, SITE_NAME } from "../lib/seo";

export const GET: APIRoute = async (context) => {
  const [essays, labs, projects, notes] = await Promise.all([
    getPublishedEssays(),
    getPublishedLabs(),
    getPublishedProjects(),
    getPublishedNotes(),
  ]);
  const entries = [...essays, ...labs, ...projects, ...notes.filter((entry) => entry.data.feed)]
    .sort((a, b) => b.data.updatedAt.getTime() - a.data.updatedAt.getTime());

  return rss({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    site: context.site!,
    items: entries.map((entry) => ({
      title: entry.data.title,
      description: entry.data.description,
      pubDate: entry.data.publishedAt ?? entry.data.updatedAt,
      link: entryRoute(entry),
      categories: entry.data.tags,
    })),
    customData: "<language>en</language>",
  });
};
