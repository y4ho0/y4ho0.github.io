import { newEntry, parseEntry, serializeEntry, validateEntry, blockersForDelete, entryRoute, type Collection, type Entry } from "./content";
import { GitHubClient, GitHubError, type CommitResult } from "./github";
import { saveDraft, listDrafts, removeDraft, clearDrafts, type LocalDraft } from "./drafts";
import { bindImageInput, validateImage } from "./media";
import { bindEditorTools } from "./editor-tools";
import { bindKnowledgeTools } from "./knowledge-tools";

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = el<HTMLFormElement>("metadata");
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const input = (name: string) => field(name) as HTMLInputElement;
const editor = el<HTMLTextAreaElement>("markdown");
const client = new GitHubClient();
let active = newEntry("notes");
let draftKey = crypto.randomUUID() as string;
let entries: Entry[] = [];
let media: string[] = [];
let dirty = false;
let revision = 0;
let busy = false;
let saveTimer = 0;
let previewTimer = 0;
let previewVersion = 0;
let sessionVersion = 0;
let lastCommit = "";
let pendingImage: File | undefined;
let pendingImageUrl = "";
let position: { start: number; end: number; direction: "forward" | "backward" | "none"; scroll: number } | undefined;

function notice(message: string, error = false) { el("notice").textContent = message; el("notice").dataset.error = String(error); }
function message(error: unknown): string { return error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
function dateValue(value: unknown): string { return typeof value === "string" ? value.slice(0, 10) : ""; }
function jsonValue(value: unknown, fallback: string): string { return value === undefined ? fallback : typeof value === "string" ? value : JSON.stringify(value, null, 2); }
function parseJson(value: string): unknown { try { return JSON.parse(value); } catch { return value; } }

async function confirmAction(title: string, text: string): Promise<boolean> {
  const dialog = el<HTMLDialogElement>("confirm-dialog");
  el("confirm-title").textContent = title;
  el("confirm-text").textContent = text;
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }));
}

function updateControls() {
  const logged = client.authenticated;
  el("login-form").hidden = logged;
  el("logout").hidden = !logged;
  for (const id of ["refresh", "publish"]) (el(id) as HTMLButtonElement).disabled = busy || !logged;
  el<HTMLButtonElement>("upload").disabled = busy || !logged || !pendingImage;
  el<HTMLButtonElement>("delete-entry").disabled = busy || !logged || !active.sha;
  el<HTMLButtonElement>("insert-media").disabled = busy || !logged || !el<HTMLSelectElement>("media-select").value;
  field("collection").disabled = busy || Boolean(active.sha);
  field("id").disabled = busy || Boolean(active.sha);
  field("course").disabled = busy || Boolean(active.sha);
  el("course-field").hidden = !["notes", "labs", "projects"].includes(active.collection);
  el("feed-field").hidden = active.collection !== "notes";
  el("location-field").hidden = active.collection === "courses";
  el("editor-heading").textContent = active.sha ? "编辑文章" : "新建文章";
  el("entry-path").textContent = active.path || `新文件 → src/content/${active.collection}/${active.id || "文章ID"}.md`;
  el("save-state").textContent = dirty ? "有改动 · 等待本地保存" : "本地草稿";
  el("metadata-summary").textContent = `${active.collection} · ${active.data.status ?? "seedling"} · ${active.data.draft ? "仓库未发布" : "设为公开"}`;
}

async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("button,input,select,textarea"));
  const disabled = controls.map(control => control.disabled);
  controls.forEach(control => { if (control.id !== "logout" && !control.closest("dialog")) control.disabled = true; });
  try { await action(); } catch (error) {
    notice(message(error), true);
    if (error instanceof GitHubError && error.code === "conflict") notice(`${message(error)}\n本地草稿保留原内容。请先导出备份，再从文章库打开最新版本，手动合并后提交。`, true);
  } finally {
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    busy = false;
    updateControls();
  }
}

function syncFromForm() {
  active.collection = field("collection").value as Collection;
  active.id = field("id").value.trim();
  for (const name of ["title", "description", "status"]) active.data[name] = field(name).value;
  // Retain full existing timestamps until the date is explicitly changed.
  for (const name of ["publishedAt", "updatedAt"]) {
    const value = field(name).value;
    if (value !== dateValue(active.data[name])) {
      if (value) active.data[name] = value;
      else delete active.data[name];
    }
  }
  active.data.tags = field("tags").value.split(/[,，]/u).map(tag => tag.trim()).filter(Boolean);
  active.data.draft = input("draft").checked;
  if (active.collection === "notes") active.data.feed = input("feed").checked;
  if (["notes", "labs", "projects"].includes(active.collection)) {
    if (field("course").value) active.data.course = field("course").value;
    else delete active.data.course;
  }
  active.data.related = parseJson(field("related").value || "[]");
  if (active.collection !== "courses" && field("location").value.trim()) active.data.location = parseJson(field("location").value);
  else delete active.data.location;
  active.body = editor.value;
}

function courseOptions() {
  const select = field("course") as HTMLSelectElement;
  const value = active.data.course || "";
  select.replaceChildren(new Option("无课程", ""));
  for (const course of entries.filter(item => item.collection === "courses")) select.add(new Option(`${course.data.title} (${course.id})${course.data.draft ? " · 草稿" : ""}`, course.id));
  if (value && !Array.from(select.options).some(option => option.value === value)) select.add(new Option(`${value} · 待验证`, value));
  select.value = value;
}

function renderActive(selection?: [number, number], scroll = 0) {
  for (const name of ["title", "description", "status"]) field(name).value = active.data[name] ?? (name === "status" ? "seedling" : "");
  field("collection").value = active.collection;
  field("id").value = active.id;
  field("tags").value = (active.data.tags ?? []).join(", ");
  for (const name of ["publishedAt", "updatedAt"]) field(name).value = dateValue(active.data[name]);
  input("draft").checked = active.data.draft === true;
  input("feed").checked = active.data.feed === true;
  field("related").value = jsonValue(active.data.related, "[]");
  field("location").value = jsonValue(active.data.location, "");
  courseOptions();
  editor.value = active.body;
  editor.setSelectionRange(selection?.[0] ?? 0, selection?.[1] ?? 0);
  editor.scrollTop = scroll;
  position = undefined;
  dirty = false;
  updateControls();
  schedulePreview();
}

async function renderDrafts() {
  const list = el("draft-list");
  const drafts = await listDrafts();
  list.replaceChildren();
  if (!drafts.length) { const text = document.createElement("li"); text.textContent = "暂无本地草稿"; list.append(text); }
  for (const draft of drafts) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.textContent = draft.entry.data.title || "未命名草稿";
    const detail = document.createElement("small"); detail.textContent = `${draft.entry.collection} · ${new Date(draft.savedAt).toLocaleString("zh-CN")}`; open.append(detail);
    open.onclick = () => void run(async () => {
      await persistIfDirty();
      const latest = (await listDrafts()).find(item => item.key === draft.key);
      if (!latest) throw new Error("这份本地草稿已被移除，请刷新草稿列表。");
      active = structuredClone(latest.entry); draftKey = latest.key;
      renderActive(latest.selection, latest.scroll); notice("已恢复本地草稿。仓库版本将在提交时重新校验。");
    });
    const remove = document.createElement("button"); remove.className = "draft-remove"; remove.textContent = "移除此草稿";
    remove.onclick = () => void run(async () => {
      if (!await confirmAction("移除本地草稿", "只删除此浏览器的这份草稿。此操作无法撤销。")) return;
      if (draftKey === draft.key) window.clearTimeout(saveTimer);
      await removeDraft(draft.key);
      if (draftKey === draft.key) { active = newEntry(active.collection); draftKey = crypto.randomUUID(); renderActive(); }
      await renderDrafts();
    });
    li.append(open, remove); list.append(li);
  }
}

async function persist() {
  window.clearTimeout(saveTimer);
  syncFromForm();
  const savedRevision = revision;
  const savedKey = draftKey;
  const snapshot: LocalDraft = { key: savedKey, entry: structuredClone(active), savedAt: new Date().toISOString(), selection: [editor.selectionStart, editor.selectionEnd], scroll: editor.scrollTop };
  await saveDraft(snapshot);
  if (savedKey === draftKey && savedRevision === revision) {
    dirty = false;
    updateControls();
    el("save-state").textContent = "已保存到本地";
  }
  await renderDrafts();
}
async function persistIfDirty() { if (dirty) await persist(); }

function renderEntries() {
  const query = el<HTMLInputElement>("search").value.trim().toLocaleLowerCase();
  const collection = el<HTMLSelectElement>("collection-filter").value;
  const list = el("entry-list"); list.replaceChildren();
  for (const entry of entries.filter(item => (!collection || item.collection === collection) && String(item.data.title).toLocaleLowerCase().includes(query))) {
    const li = document.createElement("li"); const button = document.createElement("button");
    button.textContent = String(entry.data.title || entry.id);
    const detail = document.createElement("small"); detail.textContent = `${entry.collection} · ${entry.data.draft === true ? "仓库未发布 · 源码公开" : "已设为公开 · 部署另行确认"} · ${dateValue(entry.data.publishedAt) || "无发布日期"}`; button.append(detail);
    button.onclick = () => void run(async () => {
      await persistIfDirty();
      const file = await client.readFile(entry.path);
      active = parseEntry(file.path, file.sha, file.content);
      draftKey = crypto.randomUUID(); renderActive();
      notice(entry.path.endsWith(".mdx") ? "当前仓库未启用 MDX 集成；只支持 Markdown 语法预览。保留原扩展名。" : "已读取最新文件。原文件路径与课程保持锁定。");
    });
    li.append(button); list.append(li);
  }
  el("repo-count").textContent = `仓库共 ${entries.length} 篇文章`;
}

async function loadRepository() {
  const epoch = sessionVersion;
  const files = await client.listFiles();
  const articles = files.filter(file => file.path.startsWith("src/content/"));
  const loaded: Entry[] = [];
  // Bounded requests keep large collections from exhausting API/browser connections.
  for (let offset = 0; offset < articles.length; offset += 6) {
    loaded.push(...await Promise.all(articles.slice(offset, offset + 6).map(async file => {
      const current = await client.readFile(file.path);
      return parseEntry(current.path, current.sha, current.content);
    })));
  }
  if (epoch !== sessionVersion || !client.authenticated) throw new Error("会话已结束，请重新连接。");
  entries = loaded.sort((a, b) => String(b.data.updatedAt).localeCompare(String(a.data.updatedAt)));
  media = files.filter(file => file.path.startsWith("public/images/")).map(file => file.path);
  renderEntries(); courseOptions();
  const select = el<HTMLSelectElement>("media-select"); select.replaceChildren(new Option("选择图片", ""));
  for (const path of media) select.add(new Option(path.replace("public/", ""), path));
}

async function showCommit(result: CommitResult, label: string) {
  lastCommit = result.commitSha;
  el("result").hidden = false;
  el("result-text").textContent = `${label}：GitHub 提交成功。`;
  el<HTMLAnchorElement>("commit-link").href = result.url;
  el("deploy-status").textContent = "等待 GitHub Actions 构建与部署；提交成功不等于网站已更新。";
}

function rememberPosition() { position = { start: editor.selectionStart, end: editor.selectionEnd, direction: editor.selectionDirection, scroll: editor.scrollTop }; }
function restorePosition(focus = false) {
  if (!position) return;
  if (focus) editor.focus({ preventScroll: true });
  editor.setSelectionRange(position.start, position.end, position.direction);
  editor.scrollTop = position.scroll;
}
const narrow = matchMedia("(max-width: 1100px)");
const compactLibrary = matchMedia("(max-width: 760px)");
const applyLibrary = () => { el<HTMLDetailsElement>("library-panel").open = !compactLibrary.matches; };
compactLibrary.addEventListener("change", applyLibrary);
applyLibrary();
let preference: "split" | "tabs" | null = null;
try { const value = localStorage.getItem("garden-admin-layout"); if (value === "split" || value === "tabs") preference = value; } catch { /* Storage may be disabled. */ }
let selectedTab: "edit" | "preview" = "edit";
let fullPreview = false;
let previewControlToken = "";
let lastRenderedSource: string | undefined;
let measuredFullHeight = 768;
let appliedFromPreview: number | null = null;
let editorScrollPending = false;
const splitActive = () => el("writing-area").dataset.layout === "split";
const editorProgress = () => {
  const length = Math.max(0, editor.scrollHeight - editor.clientHeight);
  return length === 0 ? 0 : Math.max(0, Math.min(1, editor.scrollTop / length));
};
const sendEditorProgress = () => {
  if (!splitActive() || !previewControlToken) return;
  el<HTMLIFrameElement>("preview").contentWindow?.postMessage({
    type: "garden:scroll-set", token: previewControlToken, progress: editorProgress(),
  }, "*"); // opaque-origin iframe; targetOrigin cannot be an ordinary site origin
};

editor.addEventListener("scroll", () => {
  if (!splitActive() || !previewControlToken) return;
  const progress = editorProgress();
  // Ignore the position set by the preview, while still allowing the next
  // user-initiated wheel, arrow-key or scrollbar drag to flow back.
  if (appliedFromPreview !== null && Math.abs(progress - appliedFromPreview) < .012) {
    appliedFromPreview = null;
    return;
  }
  appliedFromPreview = null;
  if (editorScrollPending) return;
  editorScrollPending = true;
  requestAnimationFrame(() => {
    editorScrollPending = false;
    sendEditorProgress();
  });
}, { passive: true });

const previewFrame = el<HTMLIFrameElement>("preview");
const sendPreviewMode = () => {
  if (!previewControlToken) return;
  previewFrame.contentWindow?.postMessage({
    type: "garden:preview-mode",
    token: previewControlToken,
    mode: fullPreview ? "full" : "split",
  }, "*");
};
previewFrame.addEventListener("load", () => {
  // A new HTML render resets its scroll range, but tab switches now preserve
  // the same iframe and only update its trusted mode channel.
  sendPreviewMode();
  if (splitActive()) sendEditorProgress();
});

// The preview has an opaque origin and may send only measured height or
// scroll fraction. Verify its window, origin and per-render capability.
window.addEventListener("message", (event: MessageEvent) => {
  const frame = el<HTMLIFrameElement>("preview");
  if (event.source !== frame.contentWindow || event.origin !== "null") return;
  const data: unknown = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const report = data as Record<string, unknown>;
  if (!previewControlToken || report.token !== previewControlToken) return;

  if (report.type === "garden:preview-height" && fullPreview) {
    if (typeof report.height !== "number" || !Number.isFinite(report.height)
      || report.height < 0) return;
    measuredFullHeight = Math.max(640, Math.min(200000, Math.ceil(report.height)));
    frame.style.height = String(measuredFullHeight) + "px";
  } else if (report.type === "garden:scroll-position" && splitActive() && !fullPreview) {
    if (typeof report.progress !== "number" || !Number.isFinite(report.progress)
      || report.progress < 0 || report.progress > 1) return;
    appliedFromPreview = report.progress;
    editor.scrollTop = report.progress * Math.max(0, editor.scrollHeight - editor.clientHeight);
  }
});

function applyLayout(focus = false) {
  const layout = narrow.matches ? "tabs" : preference ?? "split";
  el("writing-area").dataset.layout = layout;
  el("writing-area").dataset.tab = selectedTab;
  el("editor-tabs").hidden = layout === "split";
  el("layout-split").setAttribute("aria-pressed", String(layout === "split"));
  el("layout-tabs").setAttribute("aria-pressed", String(layout === "tabs"));
  el("tab-edit").setAttribute("aria-selected", String(selectedTab === "edit"));
  el("tab-preview").setAttribute("aria-selected", String(selectedTab === "preview"));
  if (layout === "split" || selectedTab === "edit") restorePosition(focus);
  const shouldExpand = layout === "tabs" && selectedTab === "preview";
  if (fullPreview !== shouldExpand) {
    fullPreview = shouldExpand;
    const frame = el<HTMLIFrameElement>("preview");
    // Reuse the existing sanitized document. Rebuilding srcdoc on every tab
    // switch reparses CSS/fonts/long articles and blocks visible controls.
    frame.style.height = shouldExpand ? String(measuredFullHeight) + "px" : "";
    sendPreviewMode();
    if (!shouldExpand) sendEditorProgress();
  }
}
for (const layout of ["split", "tabs"] as const) el(`layout-${layout}`).onclick = () => {
  if (el("writing-area").dataset.layout === "split" || selectedTab === "edit") rememberPosition();
  preference = layout;
  try { localStorage.setItem("garden-admin-layout", layout); } catch { /* Preference is optional. */ }
  applyLayout(true);
  if (layout === "split" && narrow.matches) notice("窗口较窄，当前使用切换布局。窗口变宽后将恢复左右对照。");
};
for (const tab of ["edit", "preview"] as const) el(`tab-${tab}`).onclick = () => {
  if (tab === "preview" && selectedTab === "edit") rememberPosition();
  selectedTab = tab; applyLayout(tab === "edit");
};
narrow.addEventListener("change", () => { if (el("writing-area").dataset.layout === "split" || selectedTab === "edit") rememberPosition(); applyLayout(); });
let ratio = 50;
function setRatio(value: number) { ratio = Math.max(25, Math.min(75, value)); el("writing-area").style.setProperty("--split", `${ratio}%`); el("splitter").setAttribute("aria-valuenow", String(Math.round(ratio))); }
el("splitter").onpointerdown = event => {
  const handle = el("splitter"); handle.setPointerCapture(event.pointerId);
  const move = (pointer: PointerEvent) => { const bounds = el("writing-area").getBoundingClientRect(); setRatio((pointer.clientX - bounds.left) / bounds.width * 100); };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", () => handle.removeEventListener("pointermove", move), { once: true });
  handle.addEventListener("pointercancel", () => handle.removeEventListener("pointermove", move), { once: true });
};
el("splitter").onkeydown = event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setRatio(ratio + (event.key === "ArrowLeft" ? -2 : 2)); } };

function schedulePreview() {
  window.clearTimeout(previewTimer);
  const version = ++previewVersion;
  const source = editor.value;
  // The first preview is kept alive in every layout. A switch of layout, tab
  // or theme must never re-render an unchanged Markdown document.
  if (previewControlToken && source === lastRenderedSource) return;
  previewTimer = window.setTimeout(() => {
    if (version !== previewVersion) return;
    const frame = el<HTMLIFrameElement>("preview");
    const token = crypto.randomUUID();
    const mode = fullPreview ? "full" : "split";
    frame.setAttribute("sandbox", "allow-scripts");
    void import("./preview")
      .then(({ previewDocument }) => previewDocument(source, token, mode))
      .then(html => {
        if (version !== previewVersion) return;
        previewControlToken = token;
        lastRenderedSource = source;
        frame.srcdoc = html;
      })
      .catch(() => {
        if (version === previewVersion) notice("预览渲染失败；正文仍保留，请保存草稿。", true);
      });
  }, 120);
}
function changed() {
  revision++; dirty = true; syncFromForm(); updateControls();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { void persist().catch(error => notice(message(error), true)); }, 900);
}
editor.addEventListener("input", () => { changed(); schedulePreview(); });
form.addEventListener("input", changed);
form.addEventListener("submit", event => event.preventDefault());
field("collection").addEventListener("change", () => {
  // New documents may change collection; discard only fields that do not apply.
  if (active.collection !== "notes") delete active.data.feed;
  if (!["notes", "labs", "projects"].includes(active.collection)) delete active.data.course;
  if (active.collection === "courses") delete active.data.location;
  updateControls();
});
el("search").addEventListener("input", renderEntries);
el("collection-filter").addEventListener("change", renderEntries);
el("media-select").addEventListener("change", updateControls);
el("new-entry").onclick = () => void run(async () => { await persistIfDirty(); const collection = el<HTMLSelectElement>("collection-filter").value; active = newEntry((collection || "notes") as Collection); draftKey = crypto.randomUUID(); renderActive(); notice("新文章只在本地保存。取消勾选 GitHub 未发布文章后，提交才会进入公开网站构建。"); });
el("save-draft").onclick = () => void run(async () => { await persist(); notice("草稿已保存到此浏览器的 IndexedDB，没有提交 GitHub。"); });
el("clear-drafts").onclick = () => void run(async () => {
  if (!await confirmAction("清空全部本地草稿", "将永久删除此浏览器中所有本地草稿，并清空当前编辑内容。请先导出需要保留的内容。GitHub 文件不受影响。")) return;
  window.clearTimeout(saveTimer); await clearDrafts(); active = newEntry(active.collection); draftKey = crypto.randomUUID(); renderActive(); await renderDrafts(); notice("本地草稿已清空。");
});
el("refresh").onclick = () => void run(async () => { await loadRepository(); notice("已刷新文章与媒体列表；编辑中的正文保持原样，提交时会检查版本。"); });
el("login-form").addEventListener("submit", event => {
  event.preventDefault();
  const token = el<HTMLInputElement>("token").value.trim(); el<HTMLInputElement>("token").value = "";
  void run(async () => { const user = await client.login(token); el("identity").textContent = `GitHub · ${user.login} · y4ho0/y4ho0.github.io`; await loadRepository(); notice("已验证账号及目标仓库 Contents 写权限。可以提交文章与图片。"); });
});
el("logout").onclick = () => {
  sessionVersion++; client.logout(); el<HTMLInputElement>("token").value = ""; entries = []; media = [];
  renderEntries(); el("repo-count").textContent = "仓库尚未加载"; el("identity").textContent = "本地写作 · 尚未连接 GitHub";
  el<HTMLSelectElement>("media-select").replaceChildren(new Option("选择图片", ""));
  clearMedia(); el("result").hidden = true; lastCommit = "";
  updateControls(); notice("已清除内存凭据并中止未完成的请求。本地文章草稿仍保留，可另行清空。已被 GitHub 接收的提交无法通过退出撤回。");
};
el("publish").onclick = () => void run(async () => {
  await persist();
  const candidate = structuredClone(active);
  if (!candidate.data.draft && !candidate.data.publishedAt) candidate.data.publishedAt = new Date().toISOString().slice(0, 10);
  if (!candidate.path) candidate.path = `src/content/${candidate.collection}/${candidate.id}.md`;
  await loadRepository();
  const errors = validateEntry(candidate, entries);
  if (errors.length) { el<HTMLDetailsElement>("metadata-panel").open = true; throw new Error(`内容校验失败：\n${errors.join("\n")}`); }
  const publicText = candidate.data.draft ? "将以 draft: true 提交。网站不生成文章页，但 Markdown 源码在公开 GitHub 仓库中任何人都能读取。" : `将公开发布到 ${entryRoute(candidate)}。`;
  if (!await confirmAction("提交文章到 GitHub", `${publicText}\n\n文件：${candidate.path}\n提交后等待 Actions 构建部署。`)) return;
  const result = await client.writeFile(candidate.path, serializeEntry(candidate), candidate.sha || undefined);
  await showCommit(result, candidate.data.draft ? "仓库未发布文章" : "文章");
  candidate.sha = result.sha; active = candidate; renderActive(); await persist();
  notice("GitHub 提交成功，尚未确认部署。可在下方检查部署或查看提交。后续修改会使用新版本标识。");
  await loadRepository();
});
el("delete-entry").onclick = () => void run(async () => {
  await persist(); const candidate = structuredClone(active); await loadRepository();
  const blockers = blockersForDelete(candidate, entries);
  if (blockers.length) throw new Error(`不能删除仍被引用的文章：\n${blockers.join("\n")}`);
  if (!await confirmAction("删除 GitHub 文章", `将提交删除 ${candidate.path}。\n网站将在部署后移除文章；Git 历史仍可恢复。本地草稿会保留。`)) return;
  const result = await client.deleteFile(candidate.path, candidate.sha);
  await showCommit(result, "删除文章");
  active = newEntry(candidate.collection); draftKey = crypto.randomUUID(); renderActive(); await loadRepository(); notice("删除提交成功，本地备份草稿仍保留。网站移除时间取决于部署。");
});
el("check-deploy").onclick = () => void run(async () => {
  if (!lastCommit) return;
  const status = await client.deployment(lastCommit);
  const labels = { success: "该提交的 Pages 部署任务已成功。", pending: "Actions 尚未完成部署。", failure: "构建或部署失败，请查看 Actions。", unknown: "无法确认该提交的部署状态，请查看 Actions。" };
  const link = document.createElement("a"); link.href = status.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = `${labels[status.state]} 查看 Actions ↗`; el("deploy-status").replaceChildren(link);
});
el("export").onclick = () => {
  try {
    syncFromForm();
    const url = URL.createObjectURL(new Blob([serializeEntry(active)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${active.id || "local-draft"}.md`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice("已导出 Markdown。导出不代表内容已通过发布校验。");
  } catch (error) { notice(message(error), true); }
};
function insertImage(path: string) {
  const image = path.replace(/^public/u, "");
  const reference = `![图片说明](${image})`;
  if (position && el("writing-area").dataset.tab === "preview") restorePosition();
  editor.setRangeText(reference, editor.selectionStart, editor.selectionEnd, "end");
  rememberPosition(); changed(); schedulePreview(); selectedTab = "edit"; applyLayout(); editor.focus({ preventScroll: true });
  notice(`已插入 ${reference}。请填写图片说明；图片提交后须等待部署才能通过本站路径访问。`);
}
el("insert-media").onclick = () => { const path = el<HTMLSelectElement>("media-select").value; if (path) insertImage(path); };
function clearMedia() {
  pendingImage = undefined;
  if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl);
  pendingImageUrl = "";
  el<HTMLInputElement>("media-file").value = "";
  el<HTMLImageElement>("media-thumbnail").removeAttribute("src");
  el("media-thumbnail").hidden = true; el("clear-media").hidden = true;
  el("media-pending").textContent = "尚未选择图片";
  updateControls();
}
function stageImage(file: File) {
  if (busy) { notice("当前操作尚未完成，请稍后添加图片。", true); return; }
  clearMedia(); validateImage(file);
  pendingImage = file; pendingImageUrl = URL.createObjectURL(file);
  el<HTMLImageElement>("media-thumbnail").src = pendingImageUrl;
  el("media-thumbnail").hidden = false; el("clear-media").hidden = false;
  el("media-pending").textContent = `${file.name || "粘贴图片"} · ${(file.size / 1024).toFixed(1)} KiB · 等待确认上传`;
  el<HTMLDetailsElement>("media-panel").open = true;
  updateControls();
  notice(client.authenticated ? "图片已暂存，点击“上传并插入”确认公开上传；每次处理一张。" : "图片已暂存在此页面。连接 GitHub 并填写文章 ID 后可确认上传；目前没有发送图片。");
}
el("media-file").addEventListener("change", () => {
  const file = el<HTMLInputElement>("media-file").files?.[0];
  if (file) try { stageImage(file); } catch (error) { notice(message(error), true); }
});
el("clear-media").onclick = clearMedia;
bindImageInput({
  dropTargets: [el("writing-area"), el("media-dropzone")],
  pasteTarget: document.querySelector<HTMLElement>(".editor-panel")!,
  onFile: stageImage,
  onError: error => { clearMedia(); notice(message(error), true); },
});
for (const target of [el("writing-area"), el("media-dropzone")]) {
  target.addEventListener("dragenter", event => { if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) target.dataset.dragging = "true"; });
  target.addEventListener("dragleave", event => { if (!target.contains(event.relatedTarget as Node | null)) delete target.dataset.dragging; });
  target.addEventListener("drop", () => { delete target.dataset.dragging; });
}
el("upload").onclick = () => void run(async () => {
  syncFromForm(); const file = pendingImage;
  if (!file) throw new Error("请先选择图片。");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(active.id)) { el<HTMLDetailsElement>("metadata-panel").open = true; throw new Error("请先填写有效的文章 ID，用于图片目录。"); }
  validateImage(file);
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[file.type];
  const path = `public/images/${active.id}/${crypto.randomUUID()}.${extension}`;
  if (!await confirmAction("公开上传图片", `图片将立即提交到公开仓库：\n${path}\n本地草稿中的图片也会公开。确认上传？`)) return;
  const result = await client.uploadFile(path, new Uint8Array(await file.arrayBuffer()));
  await showCommit(result, "图片"); insertImage(path); await persist(); clearMedia(); await loadRepository();
});
window.addEventListener("beforeunload", event => { if (dirty) event.preventDefault(); });
window.addEventListener("pagehide", () => { client.logout(); el<HTMLInputElement>("token").value = ""; });
window.addEventListener("pageshow", event => { if (event.persisted) { sessionVersion++; updateControls(); el("identity").textContent = "本地写作 · 尚未连接 GitHub"; } });
renderActive(); applyLayout();
bindEditorTools({
  editor,
  prepare: () => {
    if (busy) return false;
    if (el("writing-area").dataset.layout === "tabs" && selectedTab === "preview") {
      restorePosition(); selectedTab = "edit"; applyLayout();
    }
    return true;
  },
  afterEdit: rememberPosition,
});
bindKnowledgeTools({
  editor,
  prepare: () => {
    if (busy) return false;
    if (el("writing-area").dataset.layout === "tabs" && selectedTab === "preview") {
      restorePosition(); selectedTab = "edit"; applyLayout();
    }
    return true;
  },
  afterEdit: rememberPosition,
});
void renderDrafts().catch(error => notice(message(error), true));
