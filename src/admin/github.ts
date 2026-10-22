const API = 'https://api.github.com';
const REPOSITORY = 'y4ho0/y4ho0.github.io';
const REPO = `/repos/${REPOSITORY}`;
const BRANCH = 'main';
const CONTENT_PREFIX = /^src\/content\/(courses|notes|labs|projects|essays)\/.+\.(md|mdx)$/;
const NEW_ARTICLE = /^src\/content\/(courses|notes|labs|projects|essays)\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const MEDIA_PATH = /^public\/images\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|gif|webp)$/i;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const MAX_ARTICLE_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type RepositoryFile = { path: string; sha: string };
export type CommitResult = { sha: string; commitSha: string; url: string };
export type DeploymentResult = { state: 'pending' | 'success' | 'failure' | 'unknown'; url: string };
type Session = { epoch: number; signal: AbortSignal };
type Json = Record<string, unknown>;

/** Intentionally never includes GitHub response text, request bodies, or credentials. */
export class GitHubError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, message: string, status = 0): never {
  throw new GitHubError(code, message, status);
}

function record(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function validPath(path: string, allowMedia = true): void {
  if (typeof path !== 'string' || path.length > 512 || /[\\%?#\u0000-\u001f\u007f]/.test(path)
      || path.split('/').some((part) => !part || part === '.' || part === '..')
      || !(CONTENT_PREFIX.test(path) || (allowMedia && MEDIA_PATH.test(path)))) {
    fail('path', '文件路径不在允许的文章或图片目录内。');
  }
}

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function decodeContent(value: unknown): string {
  const data = record(value);
  if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string'
      || typeof data.size !== 'number' || data.size > MAX_ARTICLE_BYTES) {
    fail('content', '无法读取该文件；文章必须是 1 MiB 以内的 UTF-8 文本。');
  }
  try {
    const binary = atob(data.content.replace(/\s/g, ''));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return fail('content', '文章内容不是有效的 UTF-8 文本。');
  }
}

function imageMatches(path: string, bytes: Uint8Array): boolean {
  const first = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'png') return first(137, 80, 78, 71, 13, 10, 26, 10);
  if (extension === 'jpg' || extension === 'jpeg') return first(255, 216, 255);
  if (extension === 'gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (extension === 'webp') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  return false;
}

/** Fixed-repository browser client. PAT and identity live only in this instance's memory. */
export class GitHubClient {
  #token = '';
  #verified = false;
  #epoch = 0;
  #controller = new AbortController();
  #writes: Promise<unknown> = Promise.resolve();
  #fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch) {
    // Native browser fetch requires its Window receiver; calling a stored class
    // member directly would otherwise bind `this` to this GitHubClient instance.
    this.#fetcher = fetcher.bind(globalThis);
  }

  get authenticated(): boolean { return this.#verified && Boolean(this.#token); }

  logout(): void {
    this.#token = '';
    this.#verified = false;
    this.#epoch += 1;
    this.#controller.abort();
    this.#controller = new AbortController();
  }

  async login(token: string): Promise<{ login: string }> {
    this.logout();
    const candidate = token.trim();
    if (!/^[a-zA-Z0-9_]{10,255}$/.test(candidate)) fail('authentication', '令牌格式无效。');
    this.#token = candidate;
    const session = this.#session(false);
    try {
      const identity = await this.#verify(session);
      this.#assertSession(session);
      this.#verified = true;
      return identity;
    } catch (error) {
      if (session.epoch === this.#epoch) this.logout();
      throw error;
    }
  }

  async listFiles(): Promise<RepositoryFile[]> {
    const session = this.#session();
    const data = record(await this.#request(`${REPO}/git/trees/${BRANCH}?recursive=1`, session));
    if (data.truncated !== false || !Array.isArray(data.tree)) {
      fail('tree', 'GitHub 文件列表不完整，已停止加载以避免遗漏或误操作。');
    }
    return data.tree.flatMap((entry: unknown) => {
      const file = record(entry);
      // Include unusual article filenames so the content editor can surface their validation errors.
      if (file.type !== 'blob' || typeof file.path !== 'string' || typeof file.sha !== 'string'
          || !SHA.test(file.sha) || !(CONTENT_PREFIX.test(file.path) || MEDIA_PATH.test(file.path))) return [];
      return [{ path: file.path, sha: file.sha }];
    }).sort((left, right) => left.path.localeCompare(right.path));
  }

  async readFile(path: string): Promise<{ path: string; sha: string; content: string }> {
    validPath(path, false);
    const data = await this.#read(path, this.#session());
    return { path, sha: data.sha, content: decodeContent(data.data) };
  }

  async writeFile(path: string, content: string, sha?: string): Promise<CommitResult> {
    validPath(path, false);
    if (typeof content !== 'string') fail('content', '文章内容必须是文本。');
    if (!sha && !NEW_ARTICLE.test(path)) fail('path', '新文章路径必须使用集合目录下的小写英文短横线 slug.md。');
    const bytes = new TextEncoder().encode(content);
    if (bytes.length > MAX_ARTICLE_BYTES) fail('size', '文章超过 1 MiB 限制。');
    return this.#write(path, bytes, sha);
  }

  async uploadFile(path: string, bytes: Uint8Array): Promise<CommitResult> {
    validPath(path);
    if (!MEDIA_PATH.test(path)) fail('path', '图片必须位于 public/images/文章标识/文件名 目录。');
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      fail('size', '图片必须大于 0 字节且不超过 5 MiB。');
    }
    if (!imageMatches(path, bytes)) fail('media', '图片内容与扩展名不匹配；仅接受 PNG、JPEG、GIF 和 WebP。');
    return this.#write(path, bytes.slice());
  }

  async deleteFile(path: string, sha: string): Promise<CommitResult> {
    validPath(path);
    if (!SHA.test(sha)) fail('conflict', '缺少有效文件版本，请重新打开文件。');
    const session = this.#session();
    return this.#serial(session, async () => {
      await this.#verify(session);
      const current = await this.#read(path, session);
      if (current.sha !== sha) fail('conflict', '文件已在其他位置更新。请重新加载并比较后再删除。');
      const result = await this.#request(`${REPO}/contents/${encodedPath(path)}`, session, 'DELETE', {
        message: `cms: delete ${path}`, branch: BRANCH, sha,
      });
      return this.#commit(result, sha);
    });
  }

  /** Uses public Actions endpoints; an unavailable deployment result never implies success. */
  async deployment(commitSha: string): Promise<DeploymentResult> {
    if (!SHA.test(commitSha)) return { state: 'unknown', url: `https://github.com/${REPOSITORY}/actions` };
    const fallback = `https://github.com/${REPOSITORY}/actions?query=${encodeURIComponent(commitSha)}`;
    const session = { epoch: this.#epoch, signal: this.#controller.signal };
    try {
      const data = record(await this.#request(
        `${REPO}/actions/workflows/deploy.yml/runs?head_sha=${encodeURIComponent(commitSha)}&event=push&per_page=100`,
        session, 'GET', undefined, false,
      ));
      if (!Array.isArray(data.workflow_runs)) return { state: 'unknown', url: fallback };
      const runs = data.workflow_runs.map(record).filter((run) => run.head_sha === commitSha && run.head_branch === BRANCH && run.event === 'push');
      const run = runs[0];
      if (!run || typeof run.id !== 'number' || !Number.isSafeInteger(run.id)) return { state: 'pending', url: fallback };
      const url = `https://github.com/${REPOSITORY}/actions/runs/${run.id}`;
      const jobsData = record(await this.#request(`${REPO}/actions/runs/${run.id}/jobs?per_page=100`, session, 'GET', undefined, false));
      const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs.map(record) : [];
      const deploy = jobs.find((job) => job.name === 'Deploy to GitHub Pages');
      if (deploy?.status === 'completed' && deploy.conclusion === 'success') return { state: 'success', url };
      if (run.status === 'completed' && run.conclusion !== 'success') return { state: 'failure', url };
      if (deploy?.status === 'completed') return { state: 'failure', url };
      return { state: run.status === 'completed' ? 'unknown' : 'pending', url };
    } catch {
      return { state: 'unknown', url: fallback };
    }
  }

  #session(requireVerified = true): Session {
    if (!this.#token || (requireVerified && !this.#verified)) fail('authentication', '请先使用具有目标仓库写权限的 GitHub 令牌登录。');
    return { epoch: this.#epoch, signal: this.#controller.signal };
  }

  #assertSession(session: Session, requireToken = true): void {
    if (session.epoch !== this.#epoch || session.signal.aborted || (requireToken && !this.#token)) {
      fail('session', '会话已退出或被替换，操作已取消。');
    }
  }

  async #verify(session: Session): Promise<{ login: string }> {
    const user = record(await this.#request('/user', session));
    if (typeof user.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(user.login)) fail('authentication', 'GitHub 未返回有效的登录身份。');
    const repo = record(await this.#request(REPO, session));
    // GitHub documents merge settings as visible only with Contents read + write.
    // A boolean false is a valid setting. This is an additional fail-closed check;
    // GitHub still authoritatively enforces token scope and branch rules on writes.
    // https://docs.github.com/en/rest/repos/repos#get-a-repository
    if (repo.full_name !== REPOSITORY || record(repo.permissions).push !== true
        || typeof repo.allow_merge_commit !== 'boolean' || repo.archived === true || repo.disabled === true) {
      fail('permission', '无法确认此令牌拥有目标仓库的 Contents 读写权限。请限定目标仓库并授予 Contents: Read and write。', 403);
    }
    return { login: user.login };
  }

  async #read(path: string, session: Session): Promise<{ sha: string; data: Json }> {
    const data = record(await this.#request(`${REPO}/contents/${encodedPath(path)}?ref=${BRANCH}`, session));
    if (data.type !== 'file' || data.path !== path || typeof data.sha !== 'string' || !SHA.test(data.sha)) {
      fail('content', 'GitHub 返回了无效文件版本，请重新加载。');
    }
    return { sha: data.sha, data };
  }

  async #write(path: string, bytes: Uint8Array, sha?: string): Promise<CommitResult> {
    if (sha !== undefined && !SHA.test(sha)) fail('conflict', '缺少有效文件版本，请重新打开文章。');
    const session = this.#session();
    return this.#serial(session, async () => {
      await this.#verify(session);
      try {
        const current = await this.#read(path, session);
        if (!sha || current.sha !== sha) fail('conflict', '文件已存在或已在其他位置更新。请重新加载并比较，当前内容未被覆盖。');
      } catch (error) {
        if (!(error instanceof GitHubError) || error.status !== 404) throw error;
        if (sha) fail('conflict', '原文件已被删除或移动，请重新加载，当前内容未被提交。');
      }
      const body: Json = { message: `cms: ${sha ? 'update' : 'create'} ${path}`, content: base64(bytes), branch: BRANCH };
      if (sha) body.sha = sha;
      const result = await this.#request(`${REPO}/contents/${encodedPath(path)}`, session, 'PUT', body);
      return this.#commit(result);
    });
  }

  async #serial<T>(session: Session, action: () => Promise<T>): Promise<T> {
    const next = this.#writes.catch(() => undefined).then(() => {
      this.#assertSession(session);
      return action();
    });
    this.#writes = next;
    return next;
  }

  #commit(value: unknown, deletedSha?: string): CommitResult {
    const data = record(value);
    const sha = deletedSha ?? record(data.content).sha;
    const commitSha = record(data.commit).sha;
    if (typeof sha !== 'string' || !SHA.test(sha) || typeof commitSha !== 'string' || !SHA.test(commitSha)) {
      return fail('result', 'GitHub 响应缺少有效提交记录。请检查仓库历史以确认操作结果，避免直接重试。');
    }
    return { sha, commitSha, url: `https://github.com/${REPOSITORY}/commit/${commitSha}` };
  }

  async #request(path: string, session: Session, method = 'GET', body?: Json, authenticated = true): Promise<unknown> {
    this.#assertSession(session, authenticated);
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
    if (authenticated) headers.Authorization = `Bearer ${this.#token}`;
    if (body) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.#fetcher(`${API}${path}`, {
        method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: session.signal,
        cache: 'no-store', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
    } catch {
      this.#assertSession(session, authenticated);
      return fail('network', '无法连接 GitHub。请检查网络后重试；如提交请求已发出，请先检查仓库历史。');
    }
    this.#assertSession(session, authenticated);
    if (!response.ok) {
      const status = response.status;
      if (status === 401) {
        if (authenticated) this.logout();
        return fail('authentication', 'GitHub 令牌无效或已过期，请重新登录。', status);
      }
      if (status === 403) return fail('permission', 'GitHub 拒绝访问：请检查令牌权限、分支规则或 API 请求额度。', status);
      if (status === 404) return fail('not-found', 'GitHub 文件或资源不存在，或令牌无权访问。', status);
      if (status === 409 || status === 422) return fail('conflict', 'GitHub 未接受修改：文件版本冲突或分支规则不允许。请重新加载并检查仓库。', status);
      return fail('api', `GitHub 请求失败（HTTP ${status}）。请稍后重试；提交前请先检查仓库历史。`, status);
    }
    try {
      const data: unknown = await response.json();
      this.#assertSession(session, authenticated);
      return data;
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      return fail('response', 'GitHub 返回了无法识别的响应。请检查仓库历史以确认操作结果。');
    }
  }
}
