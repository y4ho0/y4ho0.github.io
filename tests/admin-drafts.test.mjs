import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearDrafts, listDrafts, removeDraft, saveDraft } from "../src/admin/drafts.ts";

function fixture(key = "src/content/notes/local-writing.md", savedAt = "2026-10-21T12:00:00.000Z") {
  return {
    key,
    entry: {
      collection: "notes", id: "local-writing", path: "src/content/notes/local-writing.md", sha: "a".repeat(40),
      data: {
        title: "尚未提交的文章", description: "本地摘要", updatedAt: "2026-10-21", draft: true,
        tags: ["数学", "writing"], related: [{ collection: "courses", entry: "algebra" }],
        custom: { nested: [true, 3, null] },
      },
      body: "## 写作位置\n\n未发布的中文 😀\n\n$$x^2$$\n",
    },
    savedAt, selection: [12, 19], scroll: 385,
  };
}

beforeEach(async () => { await clearDrafts(); });

test("IndexedDB recovers exact document, original SHA, selection and scroll as independent snapshots", async () => {
  const draft = fixture();
  const expected = structuredClone(draft);
  await saveDraft(draft);

  // Later typing must not mutate the already saved backup.
  draft.entry.body += "\n尚未保存的新文字";
  draft.entry.data.tags.push("later");
  draft.entry.data.custom.nested[0] = false;
  draft.entry.sha = "b".repeat(40);
  draft.selection[0] = 0;
  draft.scroll = 0;

  const recovered = await listDrafts();
  assert.deepEqual(recovered, [expected]);
  assert.notEqual(recovered[0].entry, draft.entry);
  assert.equal(recovered[0].entry.path, "src/content/notes/local-writing.md");
  assert.equal(recovered[0].entry.sha, "a".repeat(40));

  // A restored draft can itself be edited without changing its persisted copy.
  recovered[0].entry.body = "editing recovered body";
  recovered[0].entry.data.related[0].entry = "different-course";
  recovered[0].selection[1] = 1;
  assert.deepEqual(await listDrafts(), [expected]);
});

test("saving the same draft key replaces its old version and lists latest saves first", async () => {
  const older = fixture("local:older", "2026-10-21T10:00:00.000Z");
  const other = fixture("local:other", "2026-10-21T11:00:00.000Z");
  await saveDraft(older);
  await saveDraft(other);
  assert.deepEqual((await listDrafts()).map((draft) => draft.key), [other.key, older.key]);

  const updated = {
    ...older,
    entry: { ...older.entry, body: "替换后的正文", sha: "c".repeat(40) },
    savedAt: "2026-10-21T12:30:00.000Z", selection: [2, 5], scroll: 640,
  };
  await saveDraft(updated);
  const recovered = await listDrafts();
  assert.equal(recovered.length, 2, "updating an existing key must not duplicate a local draft");
  assert.deepEqual(recovered, [updated, other]);
});

test("remove and clear discard only the requested local drafts and tolerate empty storage", async () => {
  const first = fixture("local:first");
  const second = fixture("local:second");
  await saveDraft(first);
  await saveDraft(second);

  await removeDraft(first.key);
  assert.deepEqual(await listDrafts(), [second]);
  await removeDraft("local:missing");
  assert.deepEqual(await listDrafts(), [second]);

  await clearDrafts();
  assert.deepEqual(await listDrafts(), []);
  await clearDrafts();
  await removeDraft(second.key);
  assert.deepEqual(await listDrafts(), []);
});

test("draft persistence whitelists document fields and excludes accidental authentication properties", async () => {
  const draft = fixture();
  const accidental = {
    ...draft,
    token: "TEST_ONLY_ACCIDENTAL_CREDENTIAL",
    authorization: "Bearer TEST_ONLY_ACCIDENTAL_CREDENTIAL",
    session: { token: "TEST_ONLY_SESSION_CREDENTIAL", login: "test-user" },
    authenticated: true,
  };
  await saveDraft(accidental);
  const [recovered] = await listDrafts();
  assert.deepEqual(recovered, draft);
  assert.deepEqual(Object.keys(recovered).sort(), ["entry", "key", "savedAt", "scroll", "selection"]);
  assert.equal(JSON.stringify(recovered).includes("TEST_ONLY_"), false);
  for (const key of ["token", "authorization", "session", "authenticated"]) {
    assert.equal(Object.hasOwn(recovered, key), false, key);
  }
});
