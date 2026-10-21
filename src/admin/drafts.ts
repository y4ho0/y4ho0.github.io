import type { Entry } from "./content";

export interface LocalDraft { key: string; entry: Entry; savedAt: string; selection: [number, number]; scroll: number }
let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("garden-admin-local-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { connection = undefined; reject(new Error("无法打开本地草稿存储，请导出 Markdown 备份。")); };
    request.onblocked = () => { connection = undefined; reject(new Error("草稿数据库被其他标签页阻塞，请关闭其他后台标签页后重试。")); };
  });
}
async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = operation(tx.objectStore("drafts"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error("本地草稿保存失败，存储空间可能不足；请导出 Markdown。"));
  });
}
export async function saveDraft(draft: LocalDraft): Promise<void> {
  // Whitelist document fields. Authentication state never enters this store.
  await transact("readwrite", store => store.put({ key: draft.key, entry: structuredClone(draft.entry), savedAt: draft.savedAt, selection: [...draft.selection], scroll: draft.scroll }));
}
export async function listDrafts(): Promise<LocalDraft[]> {
  return (await transact("readonly", store => store.getAll()) as LocalDraft[]).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function removeDraft(key: string): Promise<void> { await transact("readwrite", store => store.delete(key)); }
export async function clearDrafts(): Promise<void> { await transact("readwrite", store => store.clear()); }
