import { getCollection, getEntry } from "astro:content";
import type { AnyContentEntry } from "./content-routing";

const isPublished = <T extends AnyContentEntry>(entry: T) => !entry.data.draft;

export async function getPublishedCourses() {
  return (await getCollection("courses")).filter(isPublished);
}

export async function getPublishedNotes() {
  return (await getCollection("notes")).filter(isPublished);
}

export async function getPublishedLabs() {
  return (await getCollection("labs")).filter(isPublished);
}

export async function getPublishedProjects() {
  return (await getCollection("projects")).filter(isPublished);
}

export async function getPublishedEssays() {
  return (await getCollection("essays")).filter(isPublished);
}

export interface PostLocationFrequency {
  region: string;
  name: string;
  latitude: number;
  longitude: number;
  count: number;
}

export async function getPostLocationFrequencies(): Promise<PostLocationFrequency[]> {
  const entries = (await Promise.all([
    getPublishedNotes(),
    getPublishedLabs(),
    getPublishedProjects(),
    getPublishedEssays(),
  ])).flat();
  const locations = new Map<string, PostLocationFrequency>();

  for (const entry of entries) {
    const location = entry.data.location;
    if (!location) continue;
    const existing = locations.get(location.region);
    if (existing) {
      if (
        existing.name !== location.name
        || existing.latitude !== location.latitude
        || existing.longitude !== location.longitude
      ) {
        throw new Error(`Conflicting coordinates for post location region "${location.region}".`);
      }
      existing.count += 1;
    } else {
      locations.set(location.region, { ...location, count: 1 });
    }
  }

  return [...locations.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export async function getAllPublished(): Promise<AnyContentEntry[]> {
  const groups = await Promise.all([
    getPublishedCourses(),
    getPublishedNotes(),
    getPublishedLabs(),
    getPublishedProjects(),
    getPublishedEssays(),
  ]);

  return groups
    .flat() as AnyContentEntry[];
}

export function byUpdatedDate<T extends AnyContentEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => b.data.updatedAt.getTime() - a.data.updatedAt.getTime(),
  );
}

export async function resolveRelated(entry: AnyContentEntry): Promise<AnyContentEntry[]> {
  const resolved: AnyContentEntry[] = [];

  for (const relation of entry.data.related) {
    const related = await getEntry(relation.entry);
    if (!related) {
      throw new Error(
        `Invalid related reference from ${entry.collection}/${entry.id} to ${relation.collection}`,
      );
    }
    if (!related.data.draft) resolved.push(related as AnyContentEntry);
  }

  return resolved;
}
