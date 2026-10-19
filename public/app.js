const $ = id => document.getElementById(id);
let currentProfile = Number(localStorage.getItem('pe-profile') || 0);
if (currentProfile < 0 || currentProfile > 4) currentProfile = 0;
let state = null, currentFile = '', saved = '', fileRevision = '', fileHistory = [], editing = false, saveTimer, toastTimer;
let busy = false, saving = Promise.resolve(), commitAction = 'commit';
const drafts = new Map();
$('profile').value = currentProfile;

async function api(route, body, query = {}) {
  const params = new URLSearchParams({ profile: currentProfile, ...query });
  const response = await fetch('/api/' + route + '?' + params, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-PromptExplorer': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify({ profile: currentProfile, ...body }) })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
}
function notice(message, error = true) {
  $('notice').textContent = message; $('notice').classList.toggle('hidden', !message); $('notice').classList.toggle('error', error);
  document.querySelectorAll('.dialog-notice').forEach(el => el.remove());
  const open = document.querySelector('dialog[open] .dialog-body');
  if (message && open) { const el = document.createElement('div'); el.className = 'notice dialog-notice' + (error ? ' error' : ''); el.setAttribute('role', 'alert'); el.textContent = message; open.prepend(el); }
}
function toast(message) {
  $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
}
async function action(fn, quiet = false) {
  if (busy) return;
  busy = true; document.body.classList.add('busy'); if (!quiet) notice('');
  $('editor').readOnly = true;
  for (const id of ['profile', 'sync', 'pull', 'connect-repo', 'demo', 'new', 'import', 'remote-sync']) $(id).disabled = true;
  try { await fn(); }
  catch (e) { notice(e.message); toast(e.message); }
  finally {
    busy = false; document.body.classList.remove('busy');
    $('editor').readOnly = !!state?.merging;
    for (const id of ['profile', 'sync', 'pull', 'connect-repo', 'demo', 'new', 'import', 'remote-sync']) $(id).disabled = !!state?.merging && ['sync', 'new', 'import', 'remote-sync'].includes(id);
  }
}
function date(value) { return value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''; }
function dirtyEditor() { return currentFile && $('editor').value !== saved; }
function draftKey() { return [state?.mode, state?.repo, state?.branch, currentProfile, currentFile].join(':'); }
function renderMarkdown(content) {
  // Sanitization precedes DOM insertion; no remote images, embeds or executable HTML.
  $('preview').innerHTML = DOMPurify.sanitize(marked.parse(content), {
    FORBID_TAGS: ['img', 'iframe', 'style', 'form', 'input', 'button', 'video', 'audio', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset', 'id', 'name']
  });
  $('preview').querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  $('word-count').textContent = `${words} palabras`;
}
function renderTree() {
  const nav = $('tree'); nav.replaceChildren();
  const search = $('search').value.toLocaleLowerCase();
  let previousFolders = [];
  const names = (state?.files || []).filter(f => f.toLocaleLowerCase().includes(search));
  for (const name of names) {
    const parts = name.split('/'), folders = parts.slice(0, -1);
    for (let i = 0; i < folders.length; i++) {
      if (previousFolders.slice(0, i + 1).join('/') !== folders.slice(0, i + 1).join('/')) {
        const row = document.createElement('div'); row.className = 'folder-row';
        row.textContent = '⌄  ▱  ' + folders[i];
        row.dataset.depth = Math.min(i, 4); nav.append(row);
      }
    }
    previousFolders = folders;
    const button = document.createElement('button'); button.className = 'file-row' + (currentFile === name ? ' active' : '');
    button.dataset.depth = Math.min(folders.length, 4); button.title = name;
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = state.conflicts.includes(name) ? '⚠' : '▤';
    const label = document.createElement('span'); label.textContent = parts.at(-1).replace(/\.md$/i, '');
    button.append(icon, label); button.addEventListener('click', () => action(() => openFile(name)));
    nav.append(button);
  }
  if (!names.length) { const empty = document.createElement('p'); empty.className = 'tree-empty'; empty.textContent = search ? 'Sin coincidencias.' : 'Todavía no hay archivos Markdown.'; nav.append(empty); }
}
function renderHistory() {
  const history = $('history-list'); history.replaceChildren();
  const latest = fileHistory[0];
  $('version-badge').textContent = latest ? 'VERSIÓN ' + latest.sha.slice(0, 7) : 'SIN PUBLICAR';
  $('version-badge').title = latest?.sha || 'Este archivo todavía no tiene un commit.';
  $('version-details').textContent = latest ? `${latest.author} · ${date(latest.date)}` : 'Borrador local · sin commit';
  for (const item of fileHistory) {
    const div = document.createElement('div'); div.className = 'history-item';
    const title = document.createElement('strong'); title.textContent = item.message;
    const meta = document.createElement('p'); meta.textContent = item.author + ' · ' + date(item.date);
    const code = document.createElement('code'); code.textContent = item.sha.slice(0, 7); code.title = item.sha;
    div.append(title, meta, code); history.append(div);
  }
  if (!fileHistory.length) history.textContent = 'La historia empieza con tu primer commit.';
}
function renderState() {
  $('avatar').textContent = state.profiles[currentProfile][0]; $('footer-user').textContent = state.profiles[currentProfile];
  $('vault-name').textContent = state.mode === 'demo' ? 'Laboratorio local' : state.repo.split(/[\\/]/).filter(Boolean).at(-1);
  $('branch-name').textContent = state.branch + (state.mode === 'ssh' ? ' · GitHub SSH' : ' · Git local');
  $('connection-label').textContent = state.mode === 'ssh' ? 'GitHub · SSH del sistema' : 'Sin conexión remota';
  $('remote-sync').classList.toggle('hidden', state.mode !== 'ssh');
  $('remote-status').textContent = state.merging ? 'Operación Git pendiente' : state.dirty ? 'Cambios locales por versionar' : state.ahead ? `${state.ahead} commit(s) locales por enviar*` : 'Carpeta local actualizada';
  $('remote-status').title = 'Estado respecto a la última descarga de tu herramienta Git. Esta app no consulta el servidor remoto.';
  $('sync-count').classList.toggle('hidden', !state.dirty); $('sync-count').textContent = '·';
  $('conflict-banner').classList.toggle('hidden', !state.merging);
  $('conflict-description').textContent = `${state.conflicts.length ? state.conflicts.length + ' archivo(s) en conflicto. ' : ''}${state.operation ? state.operation + '. ' : ''}Termina o cancela la operación en tu herramienta Git y pulsa Actualizar. Edición pausada.`;
  $('local-profile-title').textContent = 'Carpeta de ' + state.profiles[currentProfile];
  $('local-directory').value = state.mode !== 'demo' ? state.repo : '';
  $('workspace-path').textContent = 'Carpeta actual: ' + state.repo;
  $('editor').readOnly = busy || state.merging;
  renderTree();
}
async function refresh(reload = false) {
  state = await api('state'); renderState();
  if (reload && currentFile && state.files.includes(currentFile)) await loadFile(currentFile);
  else if (!currentFile || !state.files.includes(currentFile)) await loadFile(state.files[0] || '');
}
async function loadFile(name) {
  currentFile = name;
  $('empty').classList.toggle('hidden', !!name); $('document').classList.toggle('is-empty', !name);
  $('preview').classList.toggle('hidden', editing || !name); $('editor').classList.toggle('hidden', !editing || !name);
  $('document-meta')?.classList.toggle('hidden', !name);
  if (!name) { $('crumb-file').textContent = 'Sin archivo'; $('word-count').textContent = '0 palabras'; $('editor').value = ''; saved = ''; fileHistory = []; $('preview').replaceChildren(); renderHistory(); renderTree(); return; }
  const data = await api('file', undefined, { path: name });
  saved = data.content; fileRevision = data.revision; $('editor').value = saved; fileHistory = data.history;
  if (drafts.has(draftKey())) $('editor').value = drafts.get(draftKey());
  $('crumb-folder').textContent = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : 'Tu espacio';
  $('crumb-file').textContent = name.split('/').at(-1);
  renderMarkdown($('editor').value); renderHistory(); renderTree(); updateSaveStatus();
}
async function openFile(name) { if (name === currentFile) return; await flush(); await loadFile(name); }
function updateSaveStatus() {
  const isDirty = dirtyEditor(); $('unsaved-dot').classList.toggle('hidden', !isDirty);
  $('save-status').textContent = isDirty ? 'Cambios sin guardar' : '✓ Guardado local';
}
function saveNow() {
  clearTimeout(saveTimer);
  const name = currentFile, p = currentProfile, content = $('editor').value, key = draftKey();
  const promise = saving.then(async () => {
    if (!name || (name === currentFile && p === currentProfile && content === saved)) return;
    const result = await api('save', { path: name, content, profile: p, revision: fileRevision });
    drafts.delete(key);
    if (currentFile === name && currentProfile === p) { saved = content; fileRevision = result.revision; updateSaveStatus(); if (state) { state.dirty = true; renderState(); } }
  });
  saving = promise.catch(() => {});
  return promise;
}
async function flush() { clearTimeout(saveTimer); await saving; if (dirtyEditor()) await saveNow(); }
$('editor').addEventListener('input', () => {
  drafts.set(draftKey(), $('editor').value); updateSaveStatus(); renderMarkdown($('editor').value);
  clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveNow().catch(e => notice(e.message)); }, 750);
});
function setMode(value) {
  editing = value;
  $('read-mode').classList.toggle('active', !editing); $('edit-mode').classList.toggle('active', editing);
  $('preview').classList.toggle('hidden', editing || !currentFile); $('editor').classList.toggle('hidden', !editing || !currentFile);
  if (editing) $('editor').focus(); else renderMarkdown($('editor').value);
}
$('read-mode').onclick = () => setMode(false); $('edit-mode').onclick = () => setMode(true);
$('search').oninput = renderTree;
$('profile').onchange = () => action(async () => {
  const next = Number($('profile').value);
  try { await flush(); currentProfile = next; localStorage.setItem('pe-profile', next); currentFile = ''; await refresh(); toast(`Ahora estás trabajando como ${state.profiles[next]}.`); }
  finally { $('profile').value = currentProfile; }
});
function showConnectionMode() {
  const ssh = $('connection-mode').value === 'ssh';
  $('local-options').classList.toggle('hidden', ssh); $('ssh-options').classList.toggle('hidden', !ssh);
  $('connect-repo').textContent = ssh ? 'Abrir GitHub por SSH' : 'Abrir esta carpeta';
}
function openSettings() {
  if (busy) return;
  action(async () => {
    await flush(); $('connection-mode').value = state.mode === 'ssh' ? 'ssh' : 'local';
    if (state.remote) $('ssh-remote').value = state.remote;
    showConnectionMode(); $('settings-dialog').showModal();
  });
}
$('connection-mode').onchange = showConnectionMode;
$('remote-sync').onclick = () => action(async () => {
  await flush();
  try { state = await api('sync', {}); }
  catch (e) { await refresh(true); throw e; }
  renderState(); await refresh(true); toast('Sincronización con GitHub completada.');
});
$('settings').onclick = openSettings; $('connection').onclick = openSettings;
$('sidebar-toggle').onclick = () => $('sidebar').classList.toggle('visible');
// Sidebar has no mandatory ID for styling; retain a stable control target.
document.querySelector('.sidebar').id = 'sidebar';
$('history-toggle').onclick = () => $('history').classList.toggle('hidden'); $('history-close').onclick = () => $('history').classList.add('hidden');
$('pull').onclick = () => action(async () => { await flush(); await refresh(true); toast('Archivos y estado Git local actualizados.'); });
function openCommit() {
  if (busy) return;
  if (state.merging) { toast('Termina la operación pendiente en tu herramienta Git.'); return; }
  $('commit-title').textContent = 'Crear versión local'; $('commit-message').value = '';
  $('commit-author').textContent = `Autor Git: ${state.author || '(sin configurar)'} <${state.authorEmail || 'sin correo'}> · Rama: ${state.branch}`;
  $('commit-dialog').showModal(); $('commit-message').focus();
}
$('sync').onclick = openCommit;
$('commit-close').onclick = $('commit-cancel').onclick = () => $('commit-dialog').close();
$('commit-form').onsubmit = e => { e.preventDefault(); action(async () => {
  await flush(); const message = $('commit-message').value.trim(); if (!message) throw new Error('Escribe el comentario del commit.');
  $('commit-dialog').close();
  try { state = await api(commitAction, { message }); }
  catch (error) { await refresh(true); throw error; }
  renderState(); await loadFile(state.files.includes(currentFile) ? currentFile : state.files[0] || '');
  if (state.merging) toast('Termina la operación pendiente desde tu herramienta Git.');
  else toast('Versión creada localmente. Puedes hacer push desde tu herramienta Git.');
}); };
$('connect-repo').onclick = () => action(async () => {
  await flush(); const next = await api('connect', $('connection-mode').value === 'ssh' ? { mode: 'ssh', remote: $('ssh-remote').value } : { mode: 'local', directory: $('local-directory').value.trim().replace(/^[\"']|[\"']$/g, '') });
  state = next; currentFile = ''; renderState(); await refresh(); $('settings-dialog').close(); toast(state.mode === 'ssh' ? 'Repositorio conectado por SSH. Tu copia está lista.' : 'Repositorio abierto. Los archivos se editan en esa carpeta.');
});
$('demo').onclick = () => action(async () => {
  await flush(); state = await api('connect', { mode: 'demo' }); currentFile = ''; renderState(); await refresh(); $('settings-dialog').close(); toast('Laboratorio local listo.');
});
function openNew() { if (busy) return; $('new-name').value = ''; $('new-dialog').showModal(); $('new-name').focus(); }
$('new').onclick = $('empty-new').onclick = openNew; $('new-close').onclick = () => $('new-dialog').close();
$('new-form').onsubmit = e => { e.preventDefault(); action(async () => {
  await flush(); let name = $('new-name').value.trim(); if (!/\.md$/i.test(name)) name += '.md';
  await api('new', { path: name, content: '# ' + name.split('/').at(-1).replace(/\.md$/i, '') + '\n\n' });
  $('new-dialog').close(); await refresh(); await loadFile(name); setMode(true); toast('Archivo creado en tu copia local.');
}); };
$('import').onclick = () => { if (!busy) $('folder-input').click(); };
$('folder-input').onchange = () => action(async () => {
  await flush(); const selected = [...$('folder-input').files].filter(f => /\.md$/i.test(f.name));
  if (!selected.length) throw new Error('La carpeta no contiene archivos .md.');
  if (selected.length > 200 || selected.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) throw new Error('Importa hasta 200 archivos y 5 MB en total.');
  const files = await Promise.all(selected.map(async f => ({ path: f.webkitRelativePath || f.name, content: await f.text() })));
  const result = await api('import', { files }); $('folder-input').value = ''; await refresh(); await loadFile(files[0].path);
  toast(`${result.imported} archivo(s) copiados a tu espacio. La carpeta original no se modifica.`);
});
window.addEventListener('beforeunload', e => { if (dirtyEditor()) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); action(async () => { await flush(); toast('Guardado en tu copia local.'); }); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('search').focus(); }
  if (e.key === 'Tab' && e.target === $('editor')) { e.preventDefault(); const start = e.target.selectionStart, end = e.target.selectionEnd; e.target.setRangeText('  ', start, end, 'end'); e.target.dispatchEvent(new Event('input')); }
});
action(async () => { await refresh(); });

function checkExternalChanges() {
  if (busy || dirtyEditor() || document.querySelector('dialog[open]') || document.hidden) return;
  action(async () => {
    state = await api('state'); renderState();
    if (!currentFile || !state.files.includes(currentFile)) await loadFile(state.files[0] || '');
    else {
      const latest = await api('file', undefined, { path: currentFile });
      if (latest.revision !== fileRevision || latest.history[0]?.sha !== fileHistory[0]?.sha) await loadFile(currentFile);
    }
  }, true);
}
window.addEventListener('focus', checkExternalChanges);
setInterval(checkExternalChanges, 10000);
