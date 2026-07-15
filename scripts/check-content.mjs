import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const root = path.resolve("src/content");
const collections = ["courses", "notes", "labs", "projects", "essays"];
const entries = new Map();
const errors = [];

async function markdownFiles(directory, relative = "") {
  const directoryEntries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = await Promise.all(directoryEntries.map((entry) => {
    const target = path.join(relative, entry.name);
    if (entry.isDirectory()) return markdownFiles(directory, target);
    return /\.(md|mdx)$/u.test(entry.name) ? [target] : [];
  }));
  return files.flat();
}

for (const collection of collections) {
  const directory = path.join(root, collection);
  const files = await markdownFiles(directory);
  const ids = new Map();
  for (const file of files) {
    const id = file.replace(/\.(md|mdx)$/u, "").split(path.sep).join("/");
    const source = await readFile(path.join(directory, file), "utf8");
    if (ids.has(id)) errors.push(`${collection}/${id}: duplicate content ID`);
    ids.set(id, matter(source).data);
  }
  entries.set(collection, ids);
}

const urls = new Map();
const locationDefinitions = new Map();
const has = (collection, id) => entries.get(collection)?.has(id);

function routeFor(collection, id, data) {
  if (collection === "courses") return `/courses/${id}/`;
  if (collection === "notes") return data.course ? `/courses/${data.course}/notes/${id}/` : `/garden/${id}/`;
  if (collection === "labs") return data.course ? `/courses/${data.course}/labs/${id}/` : `/labs/${id}/`;
  if (collection === "projects") return `/courses/${data.course}/projects/${id}/`;
  return `/essays/${id}/`;
}

for (const [collection, group] of entries) {
  for (const [id, data] of group) {
    if (id.includes("/")) errors.push(`${collection}/${id}: nested IDs are not supported`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) errors.push(`${collection}/${id}: use a lowercase kebab-case ID`);
    if (collection === "projects" && !data.course) errors.push(`${collection}/${id}: a course reference is required`);
    if (["notes", "labs", "projects"].includes(collection) && data.course && !has("courses", data.course)) {
      errors.push(`${collection}/${id}: missing course ${data.course}`);
    }
    for (const relation of data.related ?? []) {
      if (!collections.includes(relation.collection) || !has(relation.collection, relation.entry)) {
        errors.push(`${collection}/${id}: invalid related reference ${relation.collection}/${relation.entry}`);
      }
    }
    if (collection === "courses" && data.location) {
      errors.push(`${collection}/${id}: courses cannot carry post location metadata`);
    }
    if (data.location) {
      const { region, name, latitude, longitude } = data.location;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(region ?? "")) {
        errors.push(`${collection}/${id}: location.region must be lowercase kebab-case`);
      }
      if (typeof name !== "string" || name.trim().length === 0) {
        errors.push(`${collection}/${id}: location.name is required`);
      }
      if (typeof latitude !== "number" || latitude < -90 || latitude > 90) {
        errors.push(`${collection}/${id}: location.latitude must be between -90 and 90`);
      }
      if (typeof longitude !== "number" || longitude < -180 || longitude > 180) {
        errors.push(`${collection}/${id}: location.longitude must be between -180 and 180`);
      }
      const existing = locationDefinitions.get(region);
      const current = { name, latitude, longitude };
      if (existing && JSON.stringify(existing) !== JSON.stringify(current)) {
        errors.push(`${collection}/${id}: location region ${region} conflicts with another entry`);
      } else if (region) {
        locationDefinitions.set(region, current);
      }
    }
    const url = routeFor(collection, id, data);
    if (urls.has(url)) errors.push(`duplicate URL ${url}: ${urls.get(url)} and ${collection}/${id}`);
    urls.set(url, `${collection}/${id}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Content graph valid: ${[...entries.values()].reduce((sum, group) => sum + group.size, 0)} entries, ${urls.size} canonical URLs.`);
