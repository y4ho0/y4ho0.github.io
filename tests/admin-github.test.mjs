import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubClient, GitHubError } from '../src/admin/github.ts';

const TOKEN = 'github_pat_TEST_ONLY_NO_NETWORK';
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const COMMIT = 'c'.repeat(40);
const ARTICLE = 'src/content/notes/example.md';
const BASE = 'https://api.github.com';
const REPO = '/repos/y4ho0/y4ho0.github.io';
const repo = (extra = {}) => ({ full_name: 'y4ho0/y4ho0.github.io', permissions: { push: true }, allow_merge_commit: true, ...extra });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const file = (sha = OLD, content = '正文 😀') => ({ path: ARTICLE, type: 'file', sha, size: Buffer.byteLength(content), encoding: 'base64', content: Buffer.from(content).toString('base64') });
const committed = () => ({ content: { sha: NEW }, commit: { sha: COMMIT, html_url: 'javascript:alert(1)' } });

function mock(handler = () => json({})) {
  const calls = [];
  const fetcher = async (url, options) => {
    const call = { path: url.slice(BASE.length), url, ...options };
    calls.push(call);
    assert.ok(url.startsWith(BASE + '/'), 'only fixed GitHub API origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10');
    assert.ok(!url.includes(TOKEN));
    return handler(call);
  };
  return { client: new GitHubClient(fetcher), calls };
}

async function loggedIn(handler, overrides = {}) {
  const context = mock((call) => {
    if (call.path === '/user') return json({ login: 'y4ho0' });
    if (call.path === REPO) return json(repo(overrides));
    return handler(call);
  });
  assert.deepEqual(await context.client.login(TOKEN), { login: 'y4ho0' });
  return context;
}

test('fetch receives the browser global receiver instead of the client instance', async () => {
  let requests = 0;
  const client = new GitHubClient(function (url) {
    assert.equal(this, globalThis, 'native Window.fetch rejects an unrelated receiver');
    requests += 1;
    return Promise.resolve(json(url === `${BASE}/user` ? { login: 'y4ho0' } : repo()));
  });
  await client.login(TOKEN);
  assert.equal(requests, 2);
  assert.equal(client.authenticated, true);
});

test('anonymous reads and writes do not send requests', async () => {
  const { client, calls } = mock();
  for (const action of [() => client.listFiles(), () => client.readFile(ARTICLE), () => client.writeFile(ARTICLE, 'new'), () => client.deleteFile(ARTICLE, OLD)]) {
    await assert.rejects(action, (error) => error.code === 'authentication');
  }
  assert.equal(client.authenticated, false);
  assert.equal(calls.length, 0);
});

test('invalid token fails safely and clears the login session', async () => {
  const { client, calls } = mock(() => json({ message: `sensitive ${TOKEN}` }, 401));
  await assert.rejects(() => client.login(TOKEN), (error) => error instanceof GitHubError && error.status === 401 && !error.message.includes(TOKEN));
  assert.equal(client.authenticated, false);
  assert.equal(calls.length, 1);
  await assert.rejects(() => client.login('bad\nheader'), /令牌格式无效/);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(client)), {});
});

test('read-only account, metadata-only token, and wrong repository fail closed', async () => {
  for (const data of [repo({ permissions: { push: false } }), repo({ allow_merge_commit: undefined }), repo({ full_name: 'somebody/else' }), repo({ archived: true })]) {
    const { client, calls } = mock((call) => json(call.path === '/user' ? { login: 'reader' } : data));
    await assert.rejects(() => client.login(TOKEN), (error) => error.code === 'permission');
    assert.equal(client.authenticated, false);
    assert.equal(calls.some((call) => call.method !== 'GET'), false);
  }
  const { client } = await loggedIn(() => json({}), { allow_merge_commit: false });
  assert.equal(client.authenticated, true, 'disabled merge commits are still a visible permission marker');
});

test('lists every supported collection and raster, including article names requiring validation', async () => {
  const paths = ['src/content/courses/course.md', 'src/content/notes/UPPER name.md', 'src/content/labs/a.mdx', 'src/content/projects/a.md', 'src/content/essays/a.md', 'public/images/example/photo.png'];
  const { client } = await loggedIn(() => json({ truncated: false, tree: [...paths, 'README.md', '.github/workflows/deploy.yml', 'public/images/example/unsafe.svg', 'public/images/example/unsupported.avif'].map((path) => ({ path, sha: OLD, type: 'blob' })) }));
  assert.deepEqual((await client.listFiles()).map((entry) => entry.path).sort(), paths.sort());
});

test('rejects truncated trees instead of silently presenting an incomplete article list', async () => {
  const { client } = await loggedIn(() => json({ truncated: true, tree: [] }));
  await assert.rejects(() => client.listFiles(), (error) => error.code === 'tree');
});

test('reads UTF-8 article contents at main without trusting download URLs', async () => {
  const { client, calls } = await loggedIn(() => json(file()));
  assert.deepEqual(await client.readFile(ARTICLE), { path: ARTICLE, sha: OLD, content: '正文 😀' });
  assert.equal(calls.at(-1).path, `${REPO}/contents/${ARTICLE}?ref=main`);
});

test('new publication checks permissions and absence, encodes UTF-8, and returns a real commit link', async () => {
  const { client, calls } = await loggedIn((call) => call.method === 'PUT' ? json(committed(), 201) : json({}, 404));
  assert.deepEqual(await client.writeFile(ARTICLE, '# 中文 😀'), { sha: NEW, commitSha: COMMIT, url: `https://github.com/y4ho0/y4ho0.github.io/commit/${COMMIT}` });
  assert.deepEqual(calls.slice(2).map((call) => [call.method, call.path]), [
    ['GET', '/user'], ['GET', REPO], ['GET', `${REPO}/contents/${ARTICLE}?ref=main`], ['PUT', `${REPO}/contents/${ARTICLE}`],
  ]);
  const body = JSON.parse(calls.at(-1).body);
  assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), '# 中文 😀');
  assert.equal(body.branch, 'main');
  assert.ok(!('sha' in body));
});

test('updating an existing article rechecks its version and sends GitHub compare-and-swap SHA', async () => {
  const { client, calls } = await loggedIn((call) => call.method === 'PUT' ? json(committed()) : json(file()));
  await client.writeFile(ARTICLE, 'changed', OLD);
  assert.equal(JSON.parse(calls.at(-1).body).sha, OLD);
});

test('concurrent change, unexpected existing path, and deleted original never issue a mutation', async () => {
  for (const [expected, response] of [[OLD, json(file(NEW))], [undefined, json(file())], [OLD, json({}, 404)]]) {
    const { client, calls } = await loggedIn(() => response);
    await assert.rejects(() => client.writeFile(ARTICLE, 'changed', expected), (error) => error.code === 'conflict');
    assert.equal(calls.some((call) => call.method === 'PUT'), false);
  }
});

test('only a 404 permits creation; network and API failure are never reported as success', async () => {
  for (const status of [403, 429, 500]) {
    const { client, calls } = await loggedIn(() => json({ message: TOKEN }, status));
    await assert.rejects(() => client.writeFile(ARTICLE, 'changed'), (error) => error.status === status && !error.message.includes(TOKEN));
    assert.equal(calls.some((call) => call.method === 'PUT'), false);
  }
  const { client } = await loggedIn((call) => call.method === 'PUT' ? json({ message: TOKEN }, 409) : json(file()));
  await assert.rejects(() => client.writeFile(ARTICLE, 'changed', OLD), (error) => error.code === 'conflict');
});

test('permissions are refreshed before every write and revoked access prevents mutation', async () => {
  let checks = 0;
  const { client, calls } = mock((call) => {
    if (call.path === '/user') return json({ login: 'y4ho0' });
    if (call.path === REPO) return json(repo({ permissions: { push: ++checks === 1 } }));
    throw new Error('content endpoint must not be reached');
  });
  await client.login(TOKEN);
  await assert.rejects(() => client.writeFile(ARTICLE, 'new'), (error) => error.code === 'permission');
  assert.equal(calls.some((call) => call.method === 'PUT'), false);
});

test('delete checks the current SHA and returns the deletion commit', async () => {
  const { client, calls } = await loggedIn((call) => call.method === 'DELETE' ? json({ content: null, commit: { sha: COMMIT } }) : json(file()));
  assert.equal((await client.deleteFile(ARTICLE, OLD)).commitSha, COMMIT);
  assert.deepEqual(JSON.parse(calls.at(-1).body), { message: `cms: delete ${ARTICLE}`, branch: 'main', sha: OLD });
  const stale = await loggedIn(() => json(file(NEW)));
  await assert.rejects(() => stale.client.deleteFile(ARTICLE, OLD), (error) => error.code === 'conflict');
  assert.equal(stale.calls.some((call) => call.method === 'DELETE'), false);
});

test('unsafe paths and unsupported media are rejected before any content request', async () => {
  const { client, calls } = await loggedIn(() => json({}));
  const paths = ['.github/workflows/deploy.yml', 'src/content/notes/../../pages/index.md', 'src/content/notes/%2e%2e/a.md', 'src/content/notes/a.md?token=x', 'public/images/a/evil.svg', 'public/images/a/no.html'];
  for (const path of paths) await assert.rejects(() => client.deleteFile(path, OLD), (error) => error.code === 'path');
  await assert.rejects(() => client.writeFile('src/content/notes/UPPER name.md', 'new'), (error) => error.code === 'path');
  await assert.rejects(() => client.uploadFile('public/images/example/photo.png', new TextEncoder().encode('<svg onload=alert(1)>')), (error) => error.code === 'media');
  await assert.rejects(() => client.uploadFile('public/images/example/photo.png', new Uint8Array(5 * 1024 * 1024 + 1)), (error) => error.code === 'size');
  assert.equal(calls.length, 2);
});

test('valid raster upload uses collision protection and the same authenticated commit path', async () => {
  const { client, calls } = await loggedIn((call) => call.method === 'PUT' ? json(committed(), 201) : json({}, 404));
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const result = await client.uploadFile('public/images/example/photo.png', bytes);
  assert.equal(result.commitSha, COMMIT);
  assert.equal(Buffer.from(JSON.parse(calls.at(-1).body).content, 'base64').compare(bytes), 0);
});

test('AVIF files are excluded from every media operation, including spoofed extensions', async () => {
  const { client, calls } = await loggedIn(() => json({}));
  const avif = new Uint8Array([0, 0, 0, 24, ...Buffer.from('ftypavif'), 0, 0, 0, 0, ...Buffer.from('avifmif1')]);
  await assert.rejects(() => client.uploadFile('public/images/example/image.avif', avif), (error) => error.code === 'path');
  await assert.rejects(() => client.uploadFile('public/images/example/image.png', avif), (error) => error.code === 'media');
  await assert.rejects(() => client.deleteFile('public/images/example/image.avif', OLD), (error) => error.code === 'path');
  assert.equal(calls.length, 2, 'no media API request is sent');
});

test('logout aborts in-flight requests and a late response cannot restore credentials', async () => {
  let finish;
  let signal;
  const { client } = mock((_call) => {
    signal = _call.signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  const pending = client.login(TOKEN);
  client.logout();
  assert.equal(signal.aborted, true);
  finish(json({ login: 'y4ho0' }));
  await assert.rejects(() => pending, (error) => error.code === 'session');
  assert.equal(client.authenticated, false);
});

test('writes are serialized and logout cancels queued writes', async () => {
  let release;
  let mutations = 0;
  const { client, calls } = await loggedIn((call) => {
    if (call.method === 'PUT') {
      mutations += 1;
      return new Promise((resolve) => { release = () => resolve(json(committed(), 201)); });
    }
    return json({}, 404);
  });
  const first = client.writeFile(ARTICLE, 'one');
  const second = client.writeFile('src/content/notes/second.md', 'two');
  const outcomes = Promise.allSettled([first, second]);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mutations, 1);
  client.logout();
  release();
  const results = await outcomes;
  assert.ok(results.every((result) => result.status === 'rejected' && result.reason.code === 'session'));
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 1);
});

test('deployment requires a matching successful deploy job; a successful build alone is unknown', async () => {
  for (const [jobs, expected] of [
    [[{ name: 'Build and verify', status: 'completed', conclusion: 'success' }], 'unknown'],
    [[{ name: 'Deploy to GitHub Pages', status: 'completed', conclusion: 'success' }], 'success'],
    [[{ name: 'Deploy to GitHub Pages', status: 'completed', conclusion: 'failure' }], 'failure'],
  ]) {
    const { client, calls } = mock((call) => json(call.path.includes('/jobs?') ? { jobs } : { workflow_runs: [{ id: 12, head_sha: COMMIT, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] }));
    const result = await client.deployment(COMMIT);
    assert.equal(result.state, expected);
    assert.equal(result.url, 'https://github.com/y4ho0/y4ho0.github.io/actions/runs/12');
    assert.ok(calls.every((call) => !('Authorization' in call.headers)), 'deployment uses public endpoints without sending PAT');
  }
});

test('unavailable, pending, and wrong-commit deployment statuses never report success', async () => {
  const missing = mock(() => json({ workflow_runs: [] }));
  assert.equal((await missing.client.deployment(COMMIT)).state, 'pending');
  const wrong = mock(() => json({ workflow_runs: [{ id: 10, head_sha: OLD, event: 'push', head_branch: 'main', conclusion: 'success' }] }));
  assert.equal((await wrong.client.deployment(COMMIT)).state, 'pending');
  const denied = mock(() => json({}, 403));
  assert.equal((await denied.client.deployment(COMMIT)).state, 'unknown');
  const network = await loggedIn(() => { throw new Error(TOKEN); });
  await assert.rejects(() => network.client.listFiles(), (error) => error.code === 'network' && !error.message.includes(TOKEN));
});
