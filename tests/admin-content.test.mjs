import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTIONS, blockersForDelete, entryRoute, newEntry, parseEntry, serializeEntry, validateEntry,
} from "../src/admin/content.ts";

function fixture(collection = "essays", id = "first-post", data = {}, body = "\n## Body\n\n本文。\n") {
  return {
    ...newEntry(collection), id, path: `src/content/${collection}/${id}.md`, sha: `sha-${collection}-${id}`,
    data: { title: "中文标题", description: "摘要", updatedAt: "2026-10-21", draft: false, ...data }, body,
  };
}

test("safe YAML round-trip preserves unknown metadata, Unicode and exact Markdown body", () => {
  const original = fixture("notes", "unicode-post", {
    publishedAt: "2026-01-02T12:30:15.123+08:00", tags: ["数学", "a: b"], feed: true,
    custom: { nested: [1, true, null, "---"], text: "多行\n文字" },
    related: [{ collection: "essays", entry: "linked-post", unknown: "preserved" }],
  }, "\n## 中文\n\n$$x^2$$\n\n```js\nconst x = '<script>';\n```\n");
  const source = serializeEntry(original);
  const parsed = parseEntry(original.path, original.sha, source);
  assert.deepEqual(parsed, original);
  assert.equal(serializeEntry(parsed), source);
  assert.ok(source.indexOf("title:") < source.indexOf("custom:"));
});

test("MDX files and CRLF frontmatter preserve path, SHA and unmodified body", () => {
  const body = "\r\n<Component />\r\n";
  const parsed = parseEntry("src/content/essays/an-mdx-file.mdx", "abc123", `---\r\ntitle: Test\r\ndescription: Text\r\nupdatedAt: 2026-10-21\r\n---\r\n${body}`);
  assert.equal(parsed.body, body);
  assert.equal(parsed.path, "src/content/essays/an-mdx-file.mdx");
  assert.equal(parsed.sha, "abc123");
});

test("new entries are local drafts with collection-specific defaults", () => {
  for (const collection of COLLECTIONS) {
    const entry = newEntry(collection);
    assert.equal(entry.data.draft, true);
    assert.equal(entry.path, "");
    assert.equal(entry.sha, "");
    assert.deepEqual(entry.data.tags, []);
    assert.deepEqual(entry.data.related, []);
    assert.equal(entry.data.status, "seedling");
    assert.equal(entry.data.publishedAt, undefined);
    assert.equal(entry.data.feed, collection === "notes" ? false : undefined);
    assert.equal(entry.data.course, collection === "projects" ? "" : undefined);
  }
});

test("YAML fails closed for invalid roots, duplicate fields, custom tags and prototype keys", () => {
  const unsafe = [
    "- title: Test", "null", "title: First\ntitle: Second", "title: !!js/function 'function () {}'",
    "__proto__: { polluted: yes }", "custom: { constructor: bad }", "custom: { prototype: bad }",
    "custom: &cycle { again: *cycle }", "title: .inf", "title: \"\\u0000\"",
  ];
  for (const yaml of unsafe) {
    assert.throws(() => parseEntry("src/content/essays/test.md", "a", `---\n${yaml}\n---\nbody`), undefined, yaml);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => parseEntry("src/content/essays/test.md", "a", "title: No frontmatter"), /frontmatter/u);
});

test("paths and IDs cannot escape collection directories or add nested routes", () => {
  for (const path of ["src/content/essays/nested/post.md", "src/content/essays/../post.md", "public/a.md", "src/content/essays/My-Post.md", "src/content/essays/my_post.md"]) {
    assert.throws(() => parseEntry(path, "x", "---\ntitle: a\n---\n"));
  }
  const entry = fixture();
  entry.id = "../secret";
  assert.match(validateEntry(entry, []).join("\n"), /ID/u);
  entry.id = "first-post";
  entry.path = "src/content/notes/first-post.md";
  assert.match(validateEntry(entry, []).join("\n"), /路径/u);
});

test("all supported collection models validate without inventing category metadata", () => {
  const course = fixture("courses", "math");
  const entries = COLLECTIONS.map((collection) => fixture(collection, `post-${collection}`, collection === "projects" ? { course: "math" } : {}));
  for (const entry of entries) assert.deepEqual(validateEntry(entry, [course]), [], entry.collection);
  const note = fixture("notes", "note", { course: "math", feed: true });
  assert.deepEqual(validateEntry(note, [course]), []);
  assert.match(validateEntry(fixture("courses", "geo", { location: { region: "tokyo", name: "Tokyo", latitude: 35, longitude: 139 } }), []).join("\n"), /不能包含 location/u);
});

test("required fields, scalar types, statuses and actual calendar dates are validated", () => {
  for (const data of [
    { title: " " }, { description: 42 }, { updatedAt: "2026-02-30" }, { updatedAt: "2026-13-01" },
    { updatedAt: "2026-10-21T25:00:00Z" }, { updatedAt: "2026-10-21T12:00:00" },
    { publishedAt: "2025-02-29" }, { publishedAt: null }, { tags: ["valid", ""] },
    { tags: "tag" }, { status: "published" }, { draft: "false" }, { related: {} },
    { related: [{ collection: "other", entry: "post" }] },
  ]) assert.ok(validateEntry(fixture("essays", "test", data), []).length, JSON.stringify(data));
  for (const date of ["2024-02-29", "2026-10-21", "2026-10-21T12:30Z", "2026-10-21T12:30:59.001-07:00"]) {
    assert.deepEqual(validateEntry(fixture("essays", "test", { updatedAt: date }), []), [], date);
  }
  assert.ok(validateEntry(fixture("notes", "test", { feed: "true" }), []).length);
  assert.ok(validateEntry(fixture("labs", "test", { course: "" }), []).length);
  assert.ok(validateEntry(fixture("projects", "test"), []).length);
});

test("references include repository drafts; publishing requires a published Course", () => {
  const draftCourse = fixture("courses", "math", { draft: true });
  const child = fixture("projects", "exercise", { course: "math", draft: true });
  assert.deepEqual(validateEntry(child, [draftCourse]), []);
  child.data.draft = false;
  assert.match(validateEntry(child, [draftCourse]).join("\n"), /仍是草稿/u);
  assert.match(validateEntry(child, []).join("\n"), /不存在/u);
  const target = fixture("notes", "source", { draft: true });
  const related = fixture("essays", "article", { related: [{ collection: "notes", entry: "source" }] });
  assert.deepEqual(validateEntry(related, [target]), []);
  assert.match(validateEntry(related, []).join("\n"), /关联内容.*不存在/u);
});

test("turning an existing Course into a draft checks public dependents in the whole graph", () => {
  const course = fixture("courses", "math");
  const child = fixture("notes", "a-note", { course: "math" });
  const edited = { ...course, data: { ...course.data, draft: true } };
  assert.match(validateEntry(edited, [course, child]).join("\n"), /公开文章/u);
});

test("updates replace the old version; fresh ID collisions and md/mdx collisions fail", () => {
  const original = fixture();
  const edited = { ...original, data: { ...original.data, title: "Edited" } };
  assert.deepEqual(validateEntry(edited, [original]), []);
  const duplicate = { ...original, sha: "" };
  assert.match(validateEntry(duplicate, [original]).join("\n"), /ID 已存在/u);
  const mdxDuplicate = { ...original, path: original.path.replace(/\.md$/u, ".mdx") };
  assert.match(validateEntry(mdxDuplicate, [original]).join("\n"), /ID 已存在/u);
});

test("location ranges and cross-entry consistency also apply to draft entries", () => {
  const location = { region: "hangzhou", name: "Hangzhou", latitude: 30.2741, longitude: 120.1551 };
  const first = fixture("notes", "one", { location, draft: true });
  assert.deepEqual(validateEntry(fixture("essays", "two", { location }), [first]), []);
  assert.match(validateEntry(fixture("essays", "two", { location: { ...location, name: "Different" } }), [first]).join("\n"), /不一致/u);
  for (const change of [{ region: "New_York" }, { name: "" }, { latitude: 91 }, { longitude: -181 }, { latitude: "30" }]) {
    assert.ok(validateEntry(fixture("labs", "two", { location: { ...location, ...change } }), []).length);
  }
});

test("deletion blockers find Course and related references, including drafts", () => {
  const course = fixture("courses", "math");
  const child = fixture("projects", "exercise", { course: "math", draft: true });
  const referring = fixture("essays", "about-math", { related: [{ collection: "courses", entry: "math" }] });
  const blockers = blockersForDelete(course, [course, child, referring]);
  assert.equal(blockers.length, 2);
  assert.match(blockers.join("\n"), /projects\/exercise/u);
  assert.match(blockers.join("\n"), /essays\/about-math/u);
  assert.deepEqual(blockersForDelete(child, [course, child, referring]), []);
});

test("route generation exactly matches existing blog routes", () => {
  assert.equal(entryRoute(fixture("courses", "math")), "/courses/math/");
  assert.equal(entryRoute(fixture("notes", "note")), "/garden/note/");
  assert.equal(entryRoute(fixture("notes", "note", { course: "math" })), "/courses/math/notes/note/");
  assert.equal(entryRoute(fixture("labs", "lab")), "/labs/lab/");
  assert.equal(entryRoute(fixture("labs", "lab", { course: "math" })), "/courses/math/labs/lab/");
  assert.equal(entryRoute(fixture("projects", "project", { course: "math" })), "/courses/math/projects/project/");
  assert.equal(entryRoute(fixture("essays", "essay")), "/essays/essay/");
});
