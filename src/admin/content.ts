import { parseDocument, stringify } from "yaml";

export const COLLECTIONS = ["courses", "notes", "labs", "projects", "essays"] as const;
export type Collection = typeof COLLECTIONS[number];

export interface Entry {
  collection: Collection;
  id: string;
  path: string;
  sha: string;
  data: Record<string, any>;
  body: string;
}

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const contentPathPattern = /^src\/content\/(courses|notes|labs|projects|essays)\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(md|mdx)$/u;
const statuses = ["seedling", "growing", "evergreen"];
const fieldOrder = ["title", "description", "publishedAt", "updatedAt", "tags", "status", "draft", "course", "feed", "related", "location"];
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertSafeData(value: unknown, label = "frontmatter", depth = 0, seen = new Set<unknown>()) {
  if (depth > 30) throw new Error(`${label}: YAML 嵌套过深。`);
  if (typeof value === "string" && controlCharacters.test(value)) throw new Error(`${label}: 不允许控制字符。`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${label}: 数值必须有限。`);
  if (value === null || typeof value !== "object") {
    if (value !== null && !["string", "number", "boolean", "undefined"].includes(typeof value)) {
      throw new Error(`${label}: 不支持该 YAML 值类型。`);
    }
    return;
  }
  if (seen.has(value)) throw new Error(`${label}: 不支持循环 YAML 引用。`);
  if (!Array.isArray(value) && !isObject(value)) throw new Error(`${label}: 必须使用普通 YAML 数据。`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (unsafeKeys.has(key) || controlCharacters.test(key)) throw new Error(`${label}: 不安全的字段名 ${key}。`);
    assertSafeData(child, `${label}.${key}`, depth + 1, seen);
  }
  seen.delete(value);
}

/** Parse data only. YAML tags, duplicate keys, prototype keys and cycles fail visibly. */
export function parseEntry(path: string, sha: string, source: string): Entry {
  const pathMatch = contentPathPattern.exec(path);
  if (!pathMatch) throw new Error(`${path}: 内容路径必须直接位于集合目录，并使用小写 kebab-case 文件名。`);
  const frontmatter = /^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/u.exec(source);
  if (!frontmatter) throw new Error(`${path}: 缺少完整的 YAML frontmatter。`);
  try {
    const document = parseDocument(frontmatter[1], { schema: "core", uniqueKeys: true, merge: false });
    if (document.errors.length || document.warnings.length) {
      throw new Error([...document.errors, ...document.warnings].map((issue) => issue.message).join(" "));
    }
    const data: unknown = document.toJS({ maxAliasCount: 25 });
    if (!isObject(data)) throw new Error("frontmatter 必须是 YAML 对象。");
    assertSafeData(data);
    return {
      collection: pathMatch[1] as Collection,
      id: pathMatch[2],
      path,
      sha,
      data,
      body: source.slice(frontmatter[0].length),
    };
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function newEntry(collection: Collection): Entry {
  if (!COLLECTIONS.includes(collection)) throw new Error("未知内容集合。");
  return {
    collection, id: "", path: "", sha: "", body: "",
    data: {
      title: "", description: "", updatedAt: new Date().toISOString().slice(0, 10),
      tags: [], status: "seedling", draft: true, related: [],
      ...(collection === "notes" ? { feed: false } : {}),
      ...(collection === "projects" ? { course: "" } : {}),
    },
  };
}

/** Preserve unknown metadata; canonical field ordering makes later commits readable. */
export function serializeEntry(entry: Entry): string {
  if (!isObject(entry.data)) throw new Error("frontmatter 必须是 YAML 对象。");
  assertSafeData(entry.data);
  const ordered: Record<string, unknown> = {};
  const keys = [...fieldOrder.filter((key) => Object.hasOwn(entry.data, key)),
    ...Object.keys(entry.data).filter((key) => !fieldOrder.includes(key)).sort()];
  for (const key of keys) if (entry.data[key] !== undefined) ordered[key] = entry.data[key];
  const frontmatter = stringify(ordered, { schema: "core", lineWidth: 0, aliasDuplicateObjects: false });
  return `---\n${frontmatter}---\n${entry.body}`;
}

function validDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/u.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hour, minute, second, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59)) return false;
  if (zone && zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function validateFields(entry: Entry): string[] {
  const errors: string[] = [];
  const label = `${entry.collection}/${entry.id || "（新文章）"}`;
  const fail = (message: string) => errors.push(`${label}: ${message}`);
  if (!COLLECTIONS.includes(entry.collection)) fail("未知内容集合。");
  if (!idPattern.test(entry.id)) fail("文件 ID 只能使用小写字母、数字和单个连字符，不能包含子目录。");
  if (entry.path) {
    const match = contentPathPattern.exec(entry.path);
    if (!match || match[1] !== entry.collection || match[2] !== entry.id) fail("文件路径与集合或 ID 不一致。");
  } else if (entry.sha) fail("已有文章必须保留原文件路径。");
  if (typeof entry.body !== "string") fail("Markdown 正文必须是字符串。");
  if (!isObject(entry.data)) { fail("frontmatter 必须是对象。"); return errors; }
  try { assertSafeData(entry.data); } catch (error) { fail(error instanceof Error ? error.message : String(error)); return errors; }
  const data = entry.data;
  for (const field of ["title", "description"]) {
    if (typeof data[field] !== "string" || !data[field].trim()) fail(`${field} 必须是非空文字。`);
  }
  if (!validDate(data.updatedAt)) fail("updatedAt 必须是真实的 ISO 日期（YYYY-MM-DD 或含时区的时间）。");
  if (data.publishedAt !== undefined && !validDate(data.publishedAt)) fail("publishedAt 必须是真实的 ISO 日期。");
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((tag: unknown) => typeof tag !== "string" || !tag.trim()))) fail("tags 必须是非空文字组成的数组。");
  if (data.status !== undefined && !statuses.includes(data.status)) fail("status 只能是 seedling、growing 或 evergreen。");
  if (data.draft !== undefined && typeof data.draft !== "boolean") fail("draft 必须是布尔值。");
  if (entry.collection === "notes" && data.feed !== undefined && typeof data.feed !== "boolean") fail("feed 必须是布尔值。");
  if (entry.collection === "projects" && (typeof data.course !== "string" || !idPattern.test(data.course))) fail("Project 必须关联一个 Course。");
  if (["notes", "labs"].includes(entry.collection) && data.course !== undefined && (typeof data.course !== "string" || !idPattern.test(data.course))) fail("course 必须是有效的 Course ID；不关联时请省略该字段。");
  if (data.related !== undefined) {
    if (!Array.isArray(data.related)) fail("related 必须是关联对象数组。");
    else for (const relation of data.related) {
      if (!isObject(relation) || !COLLECTIONS.includes(relation.collection) || typeof relation.entry !== "string" || !idPattern.test(relation.entry)) fail("related 中每一项必须包含有效的 collection 和 entry ID。");
    }
  }
  if (data.location !== undefined) {
    if (entry.collection === "courses") fail("Course 不能包含 location。");
    else if (!isObject(data.location)) fail("location 必须是对象。");
    else {
      const location = data.location;
      if (typeof location.region !== "string" || !idPattern.test(location.region)) fail("location.region 必须是小写 kebab-case。");
      if (typeof location.name !== "string" || !location.name.trim()) fail("location.name 不能为空。");
      if (typeof location.latitude !== "number" || !Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) fail("location.latitude 必须介于 -90 和 90。");
      if (typeof location.longitude !== "number" || !Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) fail("location.longitude 必须介于 -180 和 180。");
    }
  }
  return errors;
}

/** Validate the replacement together with the current repository graph, including drafts. */
export function validateEntry(entry: Entry, entries: Entry[]): string[] {
  const graph = [...entries.filter((existing) => existing !== entry && !(entry.sha && existing.path === entry.path)), entry];
  const errors = graph.flatMap(validateFields);
  const ids = new Map<string, Entry>();
  const locations = new Map<string, { value: string; source: string }>();
  for (const item of graph) {
    const key = `${item.collection}/${item.id}`;
    if (ids.has(key)) errors.push(`${key}: 内容 ID 已存在；.md 与 .mdx 也不能共用 ID。`);
    ids.set(key, item);
  }
  for (const item of graph) {
    if (!isObject(item.data)) continue;
    const key = `${item.collection}/${item.id}`;
    if (["notes", "labs", "projects"].includes(item.collection) && typeof item.data.course === "string" && item.data.course) {
      const course = ids.get(`courses/${item.data.course}`);
      if (!course) errors.push(`${key}: Course ${item.data.course} 不存在。`);
      else if (item.data.draft !== true && course.data.draft === true) errors.push(`${key}: 公开文章关联的 Course ${item.data.course} 仍是草稿，请先发布 Course。`);
    }
    if (Array.isArray(item.data.related)) for (const relation of item.data.related) {
      if (isObject(relation) && typeof relation.collection === "string" && typeof relation.entry === "string" && !ids.has(`${relation.collection}/${relation.entry}`)) errors.push(`${key}: 关联内容 ${relation.collection}/${relation.entry} 不存在。`);
    }
    if (isObject(item.data.location) && typeof item.data.location.region === "string") {
      const { region, name, latitude, longitude } = item.data.location;
      const value = JSON.stringify([name, latitude, longitude]);
      const previous = locations.get(region);
      if (previous && previous.value !== value) errors.push(`${key}: 地点 ${region} 的名称或坐标与 ${previous.source} 不一致（包括仓库草稿）。`);
      else locations.set(region, { value, source: key });
    }
  }
  return [...new Set(errors)];
}

export function blockersForDelete(entry: Entry, entries: Entry[]): string[] {
  const blockers: string[] = [];
  for (const item of entries) {
    if (item.path === entry.path) continue;
    const label = `${item.collection}/${item.id}`;
    if (entry.collection === "courses" && ["notes", "labs", "projects"].includes(item.collection) && item.data.course === entry.id) blockers.push(`${label} 的 course 引用了此 Course。`);
    if (Array.isArray(item.data.related) && item.data.related.some((relation: unknown) => isObject(relation) && relation.collection === entry.collection && relation.entry === entry.id)) blockers.push(`${label} 的 related 引用了此文章。`);
  }
  return blockers;
}

export function entryRoute(entry: Entry): string {
  const course = entry.data.course;
  switch (entry.collection) {
    case "courses": return `/courses/${entry.id}/`;
    case "notes": return course ? `/courses/${course}/notes/${entry.id}/` : `/garden/${entry.id}/`;
    case "labs": return course ? `/courses/${course}/labs/${entry.id}/` : `/labs/${entry.id}/`;
    case "projects": return `/courses/${course}/projects/${entry.id}/`;
    case "essays": return `/essays/${entry.id}/`;
  }
}
