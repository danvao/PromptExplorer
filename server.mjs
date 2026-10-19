import http from 'node:http';
import { sshURL, syncSSH } from './remote.mjs';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.PE_DATA_DIR || path.join(ROOT, '.data'));
const PORT = Number(process.env.PORT || 4317);
const PROFILES = ['Ana', 'Luis', 'Sofía', 'Diego', 'Valeria'];
const sessions = new Map();
let queue = Promise.resolve();
await fs.mkdir(DATA, { recursive: true, mode: 0o700 });

class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}
function cleanError(value) {
  return String(value).replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[credencial oculta]')
    .replace(/https:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[credencial oculta]@').slice(0, 2500);
}
async function run(args, cwd, allowFailure = false, network = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd, shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_EDITOR: 'true', ...(network ? { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=12' } : {}) }
    });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 60000);
    child.stdout.on('data', b => { out += b; });
    child.stderr.on('data', b => { err += b; });
    child.on('error', e => { clearTimeout(timer); reject(new AppError(e.code === 'ENOENT' ? 'Git no está instalado. Instálalo y reinicia la app.' : e.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 || allowFailure) resolve({ out, err, code });
      else {
        let detail = cleanError(err || out || 'La operación Git no pudo completarse.');
        if (network) detail += '\nComprueba la llave SSH, ssh-agent y su autorización SSO. Para la primera conexión, verifica el host desde tu terminal con ssh -T git@HOST. La app no acepta hosts desconocidos automáticamente.';
        reject(new AppError(detail));
      }
    });
  });
}
async function git(args, cwd, network = false) { return (await run(args, cwd, false, network)).out.trim(); }
async function session(req, res) {
  let id = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('pe_session='))?.slice(11);
  if (!/^[a-f0-9]{48}$/.test(id || '')) {
    id = randomBytes(24).toString('hex');
    res.setHeader('Set-Cookie', `pe_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
  }
  if (!sessions.has(id)) {
    const saved = await readJSON(path.join(DATA, 'sessions', id + '.json'), {});
    sessions.set(id, { id, locations: saved.locations || {}, sources: saved.sources || {}, workspaces: saved.workspaces || {} });
  }
  return sessions.get(id);
}
async function persist(s) {
  await writeJSON(path.join(DATA, 'sessions', s.id + '.json'), { locations: s.locations, sources: s.sources, workspaces: s.workspaces });
}
function profile(value) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 4) throw new AppError('Perfil no válido.');
  return n;
}
async function ensureDemo() {
  const remote = path.join(DATA, 'demo.git');
  if (await fs.stat(remote).catch(() => null)) return remote;
  await git(['init', '--bare', '--initial-branch=main', remote], DATA);
  const seed = path.join(DATA, 'seed');
  await fs.mkdir(path.join(seed, 'Prompts'), { recursive: true });
  await git(['init', '--initial-branch=main'], seed);
  await git(['config', 'commit.gpgsign', 'false'], seed);
  await git(['config', 'user.name', 'PromptExplorer'], seed);
  await git(['config', 'user.email', 'demo@promptexplorer.invalid'], seed);
  await fs.writeFile(path.join(seed, 'Bienvenida.md'), '# Un espacio para tus ideas\n\nUn editor ligero. Tus archivos, con historia.\n\n## Empieza aquí\n\nSelecciona **Editar**, cambia este texto y guarda. Después pulsa **Crear versión** para guardar un commit local con un comentario.\n\n### Git local\n\nAbre **Repositorio** y pega la ruta de una copia Git que ya tengas en tu computadora. La app edita esa carpeta directamente.\n\nCada perfil puede abrir una carpeta distinta. Si dos perfiles abren la misma carpeta, comparten archivos.\n\nColor favorito: violeta\n\n> La app crea commits locales. Haz pull, push y resuelve conflictos desde tu herramienta Git habitual.\n');
  await fs.writeFile(path.join(seed, 'Prompts', 'Asistente.md'), '# Asistente de escritura\n\n## Objetivo\n\nAyudar a expresar ideas con claridad.\n\n## Instrucciones\n\n- Usa palabras sencillas.\n- Conserva la intención del autor.\n- Pregunta cuando falte contexto.\n\n```text\nRevisa este texto y propón una versión más clara.\n```\n');
  await git(['add', '.'], seed);
  await git(['commit', '-m', 'Un espacio para explorar'], seed);
  await git(['remote', 'add', 'origin', remote], seed);
  await git(['push', '-u', 'origin', 'main'], seed);
  return remote;
}
async function localWorkspace(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir.trim())) throw new AppError('Pega la ruta absoluta de la carpeta del repositorio.');
  const real = await fs.realpath(dir.trim()).catch(() => { throw new AppError('La carpeta no existe o no se puede abrir.'); });
  if (!(await fs.stat(real)).isDirectory()) throw new AppError('Selecciona una carpeta.');
  const result = await run(['rev-parse', '--show-toplevel'], real, true);
  if (result.code) throw new AppError('Esta carpeta no es un repositorio Git de trabajo. Descárgalo primero con tu herramienta habitual.');
  const top = await fs.realpath(result.out.trim());
  if (top !== real) throw new AppError('Abre la raíz del repositorio: ' + top);
  const branchResult = await run(['symbolic-ref', '--short', 'HEAD'], real, true);
  return { dir: real, branch: branchResult.code ? '(HEAD separado)' : branchResult.out.trim(), external: true };
}
async function workspace(s, p) {
  if (s.locations[p]) {
    const w = await localWorkspace(s.locations[p]);
    const source = s.sources[p];
    if (source?.mode === 'ssh') { w.mode = 'ssh'; w.remote = source.remote; }
    return w;
  }
  const key = `demo:${p}`;
  let w = s.workspaces[key];
  if (w && await fs.stat(path.join(w.dir, '.git')).catch(() => null)) {
    w.branch = await git(['symbolic-ref', '--short', 'HEAD'], w.dir); return w;
  }
  const remote = await ensureDemo();
  const dir = path.join(DATA, 'workspaces', randomBytes(12).toString('hex'));
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await git(['clone', '--', remote, dir], DATA);
  await git(['config', 'user.name', PROFILES[p] + ' (simulado)'], dir);
  await git(['config', 'user.email', `perfil-${p + 1}@promptexplorer.invalid`], dir);
  await git(['config', 'commit.gpgsign', 'false'], dir);
  w = { dir, branch: await git(['symbolic-ref', '--short', 'HEAD'], dir), external: false };
  s.workspaces[key] = w; await persist(s); return w;
}
function relativeMD(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) ||
      value.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || !/\.md$/i.test(value)) {
    throw new AppError('Solo se admiten rutas relativas de archivos .md, sin carpetas ocultas.');
  }
  return value;
}
async function safeFile(dir, value) {
  const name = relativeMD(value);
  let cursor = dir;
  for (const part of name.split('/')) {
    cursor = path.join(cursor, part);
    const st = await fs.lstat(cursor).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (st?.isSymbolicLink()) throw new AppError('No se permiten enlaces simbólicos.');
  }
  return cursor;
}
function revision(content) { return createHash('sha256').update(content).digest('hex'); }
async function files(dir, prefix = '') {
  const result = [];
  for (const e of await fs.readdir(path.join(dir, prefix), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
    const name = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) result.push(...await files(dir, name));
    else if (e.isFile() && /\.md$/i.test(e.name)) result.push(name);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
async function conflicts(w) {
  return (await run(['diff', '--name-only', '--diff-filter=U', '-z'], w.dir)).out.split('\0').filter(Boolean);
}
async function operation(w) {
  for (const name of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'index.lock']) {
    const location = await git(['rev-parse', '--git-path', name], w.dir);
    if (await fs.stat(path.resolve(w.dir, location)).catch(() => null)) return name;
  }
  return '';
}
async function dirty(w) { return !!(await git(['status', '--porcelain'], w.dir)); }
async function aheadBehind(w) {
  const result = await run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], w.dir, true);
  if (result.code) return { ahead: null, behind: null };
  const [ahead, behind] = result.out.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}
async function assertWritable(w) {
  if (await operation(w) || (await conflicts(w)).length) throw new AppError('Git tiene una operación o conflictos pendientes. Termina o cancela esa operación en tu herramienta Git y pulsa Actualizar. La app pausa la edición para no interferir.');
}
async function history(w, file = '') {
  const args = ['log', '-15', '--format=%H%x00%an%x00%aI%x00%s%x00'];
  if (file) args.push('--', relativeMD(file));
  const result = await run(args, w.dir, true);
  if (result.code) return [];
  return result.out.trim().split('\0\n').filter(Boolean).map(line => {
    const [sha, author, date, message] = line.replace(/\0$/, '').split('\0');
    return { sha: sha.trim(), author, date, message };
  });
}
async function state(s, p) {
  const w = await workspace(s, p);
  const op = await operation(w), pendingConflicts = await conflicts(w);
  const name = (await run(['config', 'user.name'], w.dir, true)).out.trim();
  const email = (await run(['config', 'user.email'], w.dir, true)).out.trim();
  return { profiles: PROFILES, profile: p, mode: w.mode || (w.external ? 'local' : 'demo'), repo: w.dir, remote: w.remote || '',
    branch: w.branch, files: await files(w.dir), dirty: await dirty(w), conflicts: pendingConflicts,
    operation: op, merging: !!op || !!pendingConflicts.length, author: name, authorEmail: email,
    ...await aheadBehind(w), history: await history(w) };
}
async function commitMarkdown(w, message) {
  await assertWritable(w);
  if (w.branch === '(HEAD separado)') throw new AppError('Estás en HEAD separado. Selecciona una rama en tu herramienta Git antes de crear una versión.');
  const staged = await git(['diff', '--cached', '--name-only'], w.dir);
  if (staged) throw new AppError('Ya hay cambios preparados en el índice por otra herramienta. Termina ese commit o retíralos del área de preparación antes de crear una versión aquí.');
  const name = (await run(['config', 'user.name'], w.dir, true)).out.trim();
  const email = (await run(['config', 'user.email'], w.dir, true)).out.trim();
  if (!name || !email) throw new AppError('Configura tu nombre y correo Git en tu herramienta habitual antes de crear una versión. La app no cambia tu identidad Git.');
  const entries = (await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], w.dir)).out.split('\0');
  const names = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]; if (!entry) continue;
    const status = entry.slice(0, 2), file = entry.slice(3);
    if (/[RC]/.test(status)) { i++; continue; }
    try { relativeMD(file); } catch { continue; }
    await safeFile(w.dir, file); names.push(file);
  }
  if (!names.length) throw new AppError('No hay cambios Markdown pendientes para crear una versión.');
  // Respect the repository's hooks, signing policy and identity. Do not commit unrelated staged files.
  await git(['add', '-A', '--', ...names], w.dir);
  await git(['commit', '-m', message], w.dir);
}
async function jsonBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 6 * 1024 * 1024) throw new AppError('La solicitud supera 6 MB.', 413);
  }
  try { return JSON.parse(data || '{}'); } catch { throw new AppError('Solicitud no válida.'); }
}
function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function api(req, res, url) {
  const s = await session(req, res);
  const body = req.method === 'POST' ? await jsonBody(req) : {};
  const p = profile(body.profile ?? url.searchParams.get('profile') ?? 0);
  const route = url.pathname;
  if (req.method === 'GET' && route === '/api/state') return send(res, 200, await state(s, p));
  if (req.method === 'POST' && route === '/api/connect') {
    if (body.mode === 'demo') { delete s.locations[p]; delete s.sources[p]; }
    else if (body.mode === 'local') { const w = await localWorkspace(body.directory); s.locations[p] = w.dir; delete s.sources[p]; }
    else if (body.mode === 'ssh') {
      let remote; try { remote = sshURL(body.remote); } catch(e) { throw new AppError(e.message); }
      const key = `ssh:${remote}:${p}`;
      let existing = s.workspaces[key];
      if (!existing || !await fs.stat(path.join(existing.dir, '.git')).catch(() => null)) {
        const dir = path.join(DATA, 'workspaces', randomBytes(12).toString('hex'));
        await fs.mkdir(path.dirname(dir), { recursive: true });
        try { await git(['clone', '--', remote, dir], DATA, true); }
        catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw e; }
        existing = { dir }; s.workspaces[key] = existing;
      }
      await localWorkspace(existing.dir);
      s.locations[p] = existing.dir; s.sources[p] = { mode: 'ssh', remote };
    }
    else throw new AppError('Elige un repositorio local o GitHub por SSH.');
    await persist(s); return send(res, 200, await state(s, p));
  }
  if (!['/api/file', '/api/save', '/api/new', '/api/import', '/api/commit', '/api/sync'].includes(route)) throw new AppError('Ruta no encontrada.', 404);
  const w = await workspace(s, p);
  if (req.method === 'POST' && route === '/api/sync') {
    if (w.mode !== 'ssh') throw new AppError('Este perfil usa Git local. Sincroniza desde tu herramienta habitual o abre GitHub por SSH.', 400);
    try { await syncSSH(w, git, dirty, async w => !!await operation(w) || !!(await conflicts(w)).length); }
    catch (e) { throw new AppError(e.message + '\nSi las ramas divergieron, combina o resuelve los cambios en tu herramienta Git y reintenta. Los commits locales se conservan.'); }
    return send(res, 200, await state(s, p));
  }
  if (req.method === 'GET' && route === '/api/file') {
    const name = relativeMD(url.searchParams.get('path'));
    const file = await safeFile(w.dir, name);
    const st = await fs.stat(file).catch(() => null);
    if (!st?.isFile()) throw new AppError('El archivo no existe.', 404);
    if (st.size > 2 * 1024 * 1024) throw new AppError('El archivo supera 2 MB.');
    const content = await fs.readFile(file, 'utf8');
    return send(res, 200, { path: name, content, revision: revision(content), history: await history(w, name) });
  }
  if (req.method === 'POST' && ['/api/save', '/api/new'].includes(route)) {
    await assertWritable(w);
    const target = await safeFile(w.dir, body.path);
    if (typeof body.content !== 'string' || Buffer.byteLength(body.content) > 2 * 1024 * 1024) throw new AppError('El contenido supera 2 MB o no es texto.');
    if (route === '/api/new' && await fs.stat(target).catch(() => null)) throw new AppError('Ya existe un archivo con ese nombre.');
    if (route === '/api/save') {
      const previous = await fs.readFile(target, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
      if (!body.revision || body.revision !== revision(previous)) throw new AppError('Este archivo cambió en otra ventana del mismo perfil. Tu borrador sigue en el editor: cópialo antes de recargar o cambia de perfil para trabajar por separado.', 409);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body.content, 'utf8');
    return send(res, 200, { ok: true, revision: revision(body.content) });
  }
  if (req.method === 'POST' && route === '/api/import') {
    await assertWritable(w);
    if (!Array.isArray(body.files) || !body.files.length || body.files.length > 200) throw new AppError('Importa de 1 a 200 archivos Markdown.');
    const validated = [];
    for (const file of body.files) {
      const target = await safeFile(w.dir, file.path);
      if (typeof file.content !== 'string' || Buffer.byteLength(file.content) > 2 * 1024 * 1024) throw new AppError('Cada archivo debe ser texto y medir menos de 2 MB.');
      if (await fs.stat(target).catch(() => null)) throw new AppError(`Ya existe ${file.path}. La importación no sobrescribe archivos.`);
      validated.push({ target, content: file.content });
    }
    for (const { target, content } of validated) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8'); }
    return send(res, 200, { imported: validated.length });
  }
  if (req.method === 'POST' && route === '/api/commit') {
    const message = String(body.message || '').trim();
    if (!message || message.length > 500) throw new AppError('Escribe un comentario de entre 1 y 500 caracteres para el commit.');
    await commitMarkdown(w, message);
    return send(res, 200, await state(s, p));
  }
  throw new AppError('Ruta no encontrada.', 404);
}

const assets = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/vendor/marked.js': ['node_modules/marked/lib/marked.umd.js', 'text/javascript; charset=utf-8'],
  '/vendor/purify.js': ['node_modules/dompurify/dist/purify.min.js', 'text/javascript; charset=utf-8']
};
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const hosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
    if (!hosts.includes(req.headers.host)) throw new AppError('Host no permitido.', 403);
    if (req.headers.origin && !hosts.some(h => req.headers.origin === 'http://' + h)) throw new AppError('Origen no permitido.', 403);
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST'].includes(req.method) || req.headers['x-promptexplorer'] !== '1') throw new AppError('Solicitud no permitida.', 403);
      // One queue makes simultaneous windows safe, including operations on the same profile.
      const job = queue.then(() => api(req, res, url));
      queue = job.catch(() => {});
      await job;
    } else {
      if (req.method !== 'GET' || !assets[url.pathname]) throw new AppError('No encontrado.', 404);
      const [file, type] = assets[url.pathname];
      const content = await fs.readFile(path.join(ROOT, file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(content);
    }
  } catch (e) {
    if (res.headersSent) return res.end();
    send(res, e.status || 500, { error: cleanError(e.message || 'No se pudo completar la operación.') });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`PromptExplorer → http://127.0.0.1:${PORT}`));
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está ocupado.` : e.message); process.exit(1); });
