import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function git(cwd, ...args) { return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
test('Git local: carpetas reales, commits y cambios de herramientas externas', { timeout: 90000 }, async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pe-local-'));
  const data = path.join(temp, 'data');
  const port = 44000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), PE_DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', b => logs += b);
  t.after(async () => { if (child.exitCode === null) { const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed; } await rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', c => reject(new Error(`Server exited ${c}: ${logs}`))); });
  function browser() {
    let cookie = '';
    return async (route, profile = 0, body, query = {}) => {
      const r = await fetch(base + '/api/' + route + '?' + new URLSearchParams({ profile, ...query }), {
        method: body === undefined ? 'GET' : 'POST', headers: { 'X-PromptExplorer': '1', Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify({ profile, ...body }) })
      });
      if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
      return { status: r.status, data: await r.json() };
    };
  }
  const chrome = browser(), firefox = browser();
  const read = async (b, p, name = 'Nota.md') => (await b('file', p, undefined, { path: name })).data;
  const save = async (b, p, file, content) => b('save', p, { path: file.path, revision: file.revision, content });
  const repo = path.join(temp, 'Ana'), other = path.join(temp, 'Luis'), remote = path.join(temp, 'shared.git');
  await mkdir(repo); git(repo, 'init', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Persona real'); git(repo, 'config', 'user.email', 'real@example.invalid'); git(repo, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(repo, 'Nota.md'), '# Nota\n\nColor: violeta\n');
  await writeFile(path.join(repo, 'otro.txt'), 'Original\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Inicio');
  git(temp, 'init', '--bare', '--initial-branch=main', remote); git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-u', 'origin', 'main');
  git(temp, 'clone', remote, other); git(other, 'config', 'user.name', 'Otra persona'); git(other, 'config', 'user.email', 'other@example.invalid'); git(other, 'config', 'commit.gpgsign', 'false');
  await t.test('laboratorio conserva cinco perfiles sin login', async () => {
    const a = await chrome('state'), b = await firefox('state', 1);
    assert.equal(a.status, 200); assert.equal(a.data.profiles.length, 5); assert.equal(a.data.mode, 'demo'); assert.notEqual(a.data.repo, b.data.repo);
    for (const route of ['/', '/app.js', '/vendor/marked.js', '/vendor/purify.js']) assert.equal((await fetch(base + route)).status, 200);
  });
  await t.test('abre repositorios en su lugar y no modifica configuración', async () => {
    const before = await readFile(path.join(repo, '.git', 'config'), 'utf8');
    const a = await chrome('connect', 0, { mode: 'local', directory: repo });
    const b = await firefox('connect', 1, { mode: 'local', directory: other });
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(a.data.repo, await realpath(repo)); assert.equal(a.data.author, 'Persona real');
    assert.equal(await readFile(path.join(repo, '.git', 'config'), 'utf8'), before);
    assert.equal((await chrome('state', 1)).data.mode, 'demo');
    assert.equal((await chrome('state', 0)).data.mode, 'local');
  });
  await t.test('guarda en la carpeta real y crea solo un commit local Markdown', async () => {
    const file = await read(chrome, 0);
    assert.equal((await save(chrome, 0, file, file.content.replace('violeta', 'azul'))).status, 200);
    assert.match(await readFile(path.join(repo, 'Nota.md'), 'utf8'), /azul/);
    assert.match((await read(firefox, 1)).content, /violeta/);
    await writeFile(path.join(repo, 'otro.txt'), 'Cambio externo sin preparar\n');
    const result = await chrome('commit', 0, { message: 'Cambié el color' });
    assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.ahead, 1);
    assert.equal(git(repo, 'log', '-1', '--format=%an'), 'Persona real');
    assert.equal(git(repo, 'show', '--format=', '--name-only', 'HEAD'), 'Nota.md');
    assert.match(git(repo, 'status', '--porcelain'), /otro.txt/);
    assert.notEqual(git(repo, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
  });
  await t.test('push y pull externos se reflejan sin login de la app', async () => {
    git(repo, 'push', 'origin', 'main'); git(other, 'pull', '--ff-only');
    const result = await read(firefox, 1); assert.match(result.content, /azul/);
    assert.equal((await firefox('state', 1)).data.history[0].message, 'Cambié el color');
    assert.equal((await chrome('state', 0)).data.ahead, 0);
  });
  await t.test('no incluye cambios preparados por otra herramienta', async () => {
    git(repo, 'add', 'otro.txt');
    const before = git(repo, 'rev-parse', 'HEAD');
    const result = await chrome('commit', 0, { message: 'No incluir otro.txt' });
    assert.equal(result.status, 400); assert.match(result.data.error, /índice/); assert.equal(git(repo, 'rev-parse', 'HEAD'), before);
    git(repo, 'reset', 'HEAD', '--', 'otro.txt');
  });
  await t.test('detecta conflictos externos y bloquea edición y commits', async () => {
    git(repo, 'branch', 'conflicto');
    await writeFile(path.join(repo, 'Nota.md'), '# Nota\n\nColor: verde\n'); git(repo, 'add', 'Nota.md'); git(repo, 'commit', '-m', 'Verde');
    git(repo, 'checkout', 'conflicto'); await writeFile(path.join(repo, 'Nota.md'), '# Nota\n\nColor: rojo\n'); git(repo, 'add', 'Nota.md'); git(repo, 'commit', '-m', 'Rojo');
    assert.throws(() => git(repo, 'merge', 'main'));
    const state = (await chrome('state', 0)).data; assert.equal(state.merging, true); assert.deepEqual(state.conflicts, ['Nota.md']);
    const f = await read(chrome, 0); assert.equal((await save(chrome, 0, f, '# sobrescribir')).status, 400);
    assert.equal((await chrome('new', 0, { path: 'No.md', content: 'no' })).status, 400);
    assert.equal((await chrome('commit', 0, { message: 'no' })).status, 400);
    git(repo, 'merge', '--abort'); assert.equal((await chrome('state', 0)).data.merging, false); git(repo, 'checkout', 'main');
  });
  await t.test('reconoce bloqueo y worktrees Git', async () => {
    await writeFile(path.join(repo, '.git', 'index.lock'), '');
    assert.equal((await chrome('state', 0)).data.operation, 'index.lock');
    await rm(path.join(repo, '.git', 'index.lock'));
    const worktree = path.join(temp, 'worktree'); git(repo, 'worktree', 'add', '-b', 'worktree-test', worktree);
    const result = await chrome('connect', 2, { mode: 'local', directory: worktree }); assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.branch, 'worktree-test');
  });
  await t.test('protege borradores ante modificaciones externas', async () => {
    const stale = await read(chrome, 0);
    await writeFile(path.join(repo, 'Nota.md'), '# Cambio desde otra herramienta\n');
    assert.equal((await save(chrome, 0, stale, '# Borrador viejo')).status, 409);
    assert.equal((await read(chrome, 0)).content, '# Cambio desde otra herramienta\n');
  });
  await t.test('crear e importar archivos sin sobrescribir', async () => {
    assert.equal((await chrome('new', 0, { path: 'Ideas/Prueba.md', content: '# Prueba' })).status, 200);
    assert.equal((await chrome('new', 0, { path: 'Ideas/Prueba.md', content: 'no' })).status, 400);
    assert.equal((await chrome('import', 0, { files: [{ path: 'Importada.md', content: '# Copia' }] })).status, 200);
    assert.equal(await readFile(path.join(repo, 'Importada.md'), 'utf8'), '# Copia');
    assert.equal((await chrome('commit', 0, { message: 'Nuevos documentos' })).status, 200);
  });
  await t.test('rechaza rutas incorrectas y retira operaciones remotas', async () => {
    assert.equal((await chrome('connect', 0, { mode: 'local', directory: temp })).status, 400);
    assert.equal((await chrome('connect', 0, { mode: 'local', directory: path.join(repo, 'Ideas') })).status, 400);
    for (const file of ['../escape.md', '.git/config.md', '/tmp/escape.md', 'no.txt']) assert.equal((await chrome('new', 0, { path: file, content: 'no' })).status, 400);
    for (const route of ['auth/start', 'pull', 'resolve', 'finish']) assert.equal((await chrome(route, 0, {})).status, 404);
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/quit', { method: 'POST', headers: { 'X-PromptExplorer': '1', 'X-PE-Instance': 'wrong' } })).status, 403);
    assert.equal((await fetch(base + '/api/state')).status, 403);
    assert.equal((await fetch(base + '/api/state', { headers: { 'X-PromptExplorer': '1', Origin: 'https://example.com' } })).status, 403);
    assert.equal((await chrome('commit', 0, { message: '' })).status, 400);
    assert.equal((await chrome('sync', 0, {})).status, 400);
    assert.equal((await chrome('connect', 0, { mode: 'ssh', remote: 'https://github.com/test/repo.git' })).status, 400);
  });
});
