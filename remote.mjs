// Keep SSH URLs as structured data; never interpolate them into a shell command.
export function sshURL(value) {
  const match = /^git@([A-Za-z0-9][A-Za-z0-9.-]*):([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(String(value || '').trim());
  if (!match || match[1].includes('..') || match[1].endsWith('.') || ['.', '..'].includes(match[2]) || ['.', '..'].includes(match[3])) {
    throw new Error('Usa la URL SSH de GitHub: git@github.com:organizacion/repositorio.git. También admite un dominio Enterprise o un alias de tu configuración SSH.');
  }
  return `git@${match[1]}:${match[2]}/${match[3]}.git`;
}

export async function syncSSH(w, git, isDirty, isPending) {
  if (await isPending(w)) throw new Error('Resuelve o cancela la operación pendiente en tu herramienta Git antes de sincronizar.');
  if (await isDirty(w)) throw new Error('Hay cambios locales sin commit. Crea una versión antes de sincronizar.');
  if (w.branch === '(HEAD separado)') throw new Error('Selecciona una rama antes de sincronizar.');
  const origin = sshURL(await git(['remote', 'get-url', 'origin'], w.dir));
  // Revalidate the destination every time; a tool may have changed origin since opening.
  if (origin !== w.remote) throw new Error('El remoto cambió desde que abriste este repositorio. Ábrelo de nuevo para confirmar el destino.');
  const pushTargets = (await git(['remote', 'get-url', '--push', '--all', 'origin'], w.dir)).trim().split(/\r?\n/);
  if (pushTargets.length !== 1) throw new Error('Origin tiene varios destinos de push. Revisa su configuración antes de sincronizar.');
  const pushURL = sshURL(pushTargets[0]);
  if (pushURL !== origin) throw new Error('El destino de push es distinto al repositorio abierto. Revisa origin en tu herramienta Git antes de sincronizar.');
  await git(['fetch', '--prune', 'origin'], w.dir, true);
  // No implicit merge commits, rebases or conflict markers in the editor.
  // Divergence stays intact and is resolved explicitly in the user's Git tool.
  const remoteRef = `refs/remotes/origin/${w.branch}`;
  const available = await git(['for-each-ref', '--format=%(refname)', remoteRef], w.dir);
  if (available.trim()) await git(['merge', '--ff-only', remoteRef], w.dir);
  await git(['push', '--set-upstream', 'origin', `HEAD:refs/heads/${w.branch}`], w.dir, true);
}
