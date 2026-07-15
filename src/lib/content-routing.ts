import type { CollectionEntry } from "astro:content";

export type AnyContentEntry =
  | CollectionEntry<"courses">
  | CollectionEntry<"notes">
  | CollectionEntry<"labs">
  | CollectionEntry<"projects">
  | CollectionEntry<"essays">;

export function entryRoute(entry: AnyContentEntry): string {
  switch (entry.collection) {
    case "courses":
      return `/courses/${entry.id}/`;
    case "notes":
      return entry.data.course
        ? `/courses/${entry.data.course.id}/notes/${entry.id}/`
        : `/garden/${entry.id}/`;
    case "labs":
      return entry.data.course
        ? `/courses/${entry.data.course.id}/labs/${entry.id}/`
        : `/labs/${entry.id}/`;
    case "projects":
      return `/courses/${entry.data.course.id}/projects/${entry.id}/`;
    case "essays":
      return `/essays/${entry.id}/`;
  }
}

export function collectionLabel(collection: AnyContentEntry["collection"]): string {
  return {
    courses: "Course",
    notes: "Note",
    labs: "Lab",
    projects: "Project",
    essays: "Essay",
  }[collection];
}
