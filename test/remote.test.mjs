import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { sshURL, syncSSH } from '../remote.mjs';

function git(cwd, args) { return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
test('URLs SSH: normalización y rechazo de opciones o comandos', () => {
  assert.equal(sshURL('git@github.com:danvao/PromptExplorer'), 'git@github.com:danvao/PromptExplorer.git');
  assert.equal(sshURL('git@github-trabajo:equipo/docs.git'), 'git@github-trabajo:equipo/docs.git');
  assert.equal(sshURL('git@empresa.ghe.com:equipo/docs.git'), 'git@empresa.ghe.com:equipo/docs.git');
  for (const input of ['https://github.com/a/b.git', '/tmp/repo', 'git@-option:a/b.git', 'git@github.com:a/../b', 'git@github.com:a/b;echo x', 'git@github.com:a/b\n--upload-pack=bad']) assert.throws(() => sshURL(input));
});
test('Sync: precondiciones y destino de publicación', async () => {
  const w = { dir: '/unused', branch: 'main', remote: 'git@github.com:a/b.git' };
  let calls = 0;
  await assert.rejects(syncSSH(w, () => { calls++; }, async () => true, async () => false), /sin commit/);
  assert.equal(calls, 0);
  await assert.rejects(syncSSH(w, () => { calls++; }, async () => false, async () => true), /pendiente/);
  assert.equal(calls, 0);
  await assert.rejects(syncSSH(w, async () => 'git@github.com:a/otro.git', async () => false, async () => false), /remoto cambió/);
  const changedPush = async args => args.includes('--push') ? 'git@github.com:otro/destino.git' : w.remote;
  await assert.rejects(syncSSH(w, changedPush, async () => false, async () => false), /destino de push/);
});
test('Sync real de Git con transporte local: push, avance y divergencia sin pérdida', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pe-sync-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const local = path.join(temp, 'local'), peer = path.join(temp, 'peer'), remote = path.join(temp, 'remote.git');
  await mkdir(local); git(local, ['init', '--initial-branch=main']);
  function identity(dir) { git(dir, ['config', 'user.name', 'Prueba']); git(dir, ['config', 'user.email', 'test@example.invalid']); }
  identity(local); await writeFile(path.join(local, 'Nota.md'), 'Inicio\n'); git(local, ['add', '.']); git(local, ['commit', '-m', 'Inicio']);
  git(temp, ['init', '--bare', '--initial-branch=main', remote]); git(local, ['remote', 'add', 'origin', remote]); git(local, ['push', '-u', 'origin', 'main']);
  git(temp, ['clone', remote, peer]); identity(peer);
  const w = { dir: local, branch: 'main', remote: 'git@github.com:test/notes.git' };
  // Exercise real Git synchronization without contacting GitHub or using credentials.
  const transport = async (args, dir) => args[0] === 'remote' ? w.remote : git(dir, args);
  const dirty = async w => !!git(w.dir, ['status', '--porcelain']);
  const pending = async () => false;
  await writeFile(path.join(local, 'Nota.md'), 'Propuesta local\n'); git(local, ['add', '.']); git(local, ['commit', '-m', 'Local']);
  await syncSSH(w, transport, dirty, pending);
  assert.equal(git(local, ['rev-parse', 'HEAD']), git(remote, ['rev-parse', 'main']));
  git(peer, ['pull', '--ff-only']); await writeFile(path.join(peer, 'Otra.md'), '# Remota'); git(peer, ['add', '.']); git(peer, ['commit', '-m', 'Remota']); git(peer, ['push']);
  await syncSSH(w, transport, dirty, pending);
  assert.equal(git(local, ['log', '-1', '--format=%s']), 'Remota');
  await writeFile(path.join(local, 'Nota.md'), 'Azul\n'); git(local, ['add', '.']); git(local, ['commit', '-m', 'Azul']);
  await writeFile(path.join(peer, 'Nota.md'), 'Verde\n'); git(peer, ['add', '.']); git(peer, ['commit', '-m', 'Verde']); git(peer, ['push']);
  const before = git(local, ['rev-parse', 'HEAD']);
  await assert.rejects(syncSSH(w, transport, dirty, pending));
  assert.equal(git(local, ['rev-parse', 'HEAD']), before);
  assert.equal(git(local, ['status', '--porcelain']), '');
  assert.equal(await stat(path.join(local, '.git', 'MERGE_HEAD')).catch(() => null), null);
  assert.equal(git(remote, ['log', '-1', '--format=%s']), 'Verde');
});
