#!/usr/bin/env python3
"""Build a self-contained .app using pinned, verified upstream distributions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--arch', choices=['arm64', 'x64'], default='arm64' if platform.machine() == 'arm64' else 'x64')
parser.add_argument('--skip-smoke', action='store_true', help='Cross-compile only. Release workflow always runs a native smoke test.')
parser.add_argument('--skip-ui-smoke', action='store_true', help='Skip native menu/message-loop test when building locally without UI.')
args = parser.parse_args()
ARCH = args.arch
CONFIG = json.loads((ROOT / 'packaging/macos/components.json').read_text())
BUILD = ROOT / 'build' / ('macos-' + ARCH)
DIST = ROOT / 'dist' / ('macos-' + ARCH)
CACHE = Path(os.environ.get('PE_VENDOR_CACHE', str(ROOT / 'build' / 'vendor-cache'))).resolve()
for folder in [BUILD, DIST, CACHE]: folder.mkdir(parents=True, exist_ok=True)

def run(*command, **kwargs):
    subprocess.run([str(s) for s in command], check=True, **kwargs)

def download(component, name):
    target = CACHE / name
    if not target.exists():
        part = target.with_suffix(target.suffix + '.part')
        urllib.request.urlretrieve(component['url'], part)
        part.rename(target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != component['sha256']:
        raise RuntimeError('SHA-256 does not match: ' + name)
    return target

node_archive = download(CONFIG[ARCH]['node'], 'node-' + ARCH + '.tar.gz')
git_archive = download(CONFIG[ARCH]['git'], 'git-' + ARCH + '.tar.gz')
app = BUILD / 'PromptExplorer.app'
if app.exists(): shutil.rmtree(app)
resources = app / 'Contents' / 'Resources'
macos = app / 'Contents' / 'MacOS'
for folder in [resources, macos]: folder.mkdir(parents=True)
shutil.copy2(ROOT / 'packaging/macos/Info.plist', app / 'Contents' / 'Info.plist')
node_unpacked = BUILD / 'node-unpacked'
if node_unpacked.exists(): shutil.rmtree(node_unpacked)
node_unpacked.mkdir()
run('/usr/bin/tar', '-xzf', node_archive, '-C', node_unpacked, '--strip-components', '1')
node = resources / 'node'
(node / 'bin').mkdir(parents=True)
shutil.copy2(node_unpacked / 'bin' / 'node', node / 'bin' / 'node')
for name in ['LICENSE', 'README.md', 'CHANGELOG.md']: shutil.copy2(node_unpacked / name, node / name)
git = resources / 'git'
git.mkdir()
run('/usr/bin/tar', '-xzf', git_archive, '-C', git)
if not (git / 'bin' / 'git').exists(): raise RuntimeError('Git distribution has an unexpected layout')
for link in resources.rglob('*'):
    if link.is_symlink() and not str(link.resolve()).startswith(str(resources.resolve()) + os.sep):
        raise RuntimeError('External symlink in bundle: ' + str(link))
source = resources / 'app'
source.mkdir()
for name in ['server.mjs', 'remote.mjs', 'package.json', 'package-lock.json']:
    shutil.copy2(ROOT / name, source / name)
for name in ['public', 'node_modules']:
    shutil.copytree(ROOT / name, source / name, symlinks=True, ignore=shutil.ignore_patterns('.DS_Store', '.bin'))
for name in ['LEEME-macOS.md', 'THIRD-PARTY-NOTICES.md', 'components.json']:
    shutil.copy2(ROOT / 'packaging/macos' / name, resources / name)
shutil.copytree(ROOT / 'packaging/macos/licenses', resources / 'licenses')
target = ('arm64' if ARCH == 'arm64' else 'x86_64') + '-apple-macos14.0'
run('/usr/bin/swiftc', '-swift-version', '5', '-O', '-target', target, '-module-cache-path', BUILD / 'swift-cache', ROOT / 'packaging/macos/Launcher.swift', '-o', macos / 'PromptExplorer')
run('/usr/bin/codesign', '--force', '--deep', '--sign', '-', app)
run('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
report = DIST / ('macOS-' + ARCH + '-smoke.json')
if not args.skip_smoke:
    environment = {**os.environ, 'PE_BUILD_ARCH': ARCH}
    # The native launcher selects its bundled Node/Git and the smoke test creates
    # a commit using a new, disposable repository without Homebrew/Xcode Git.
    run(macos / 'PromptExplorer', '--smoke-test', report, env=environment, timeout=150)
    result = json.loads(report.read_text())
    if not result.get('ok'): raise RuntimeError(str(result))
    print(json.dumps(result), flush=True)
    if not args.skip_ui_smoke:
        launcher_report = DIST / ('macOS-' + ARCH + '-launcher-smoke.json')
        run(macos / 'PromptExplorer', '--launcher-smoke-test', launcher_report, env=environment, timeout=90)
        launcher_result = json.loads(launcher_report.read_text())
        if not launcher_result.get('ok'): raise RuntimeError(str(launcher_result))
        print(json.dumps(launcher_result), flush=True)
archive = DIST / ('PromptExplorer-macOS-' + ARCH + '.zip')
if archive.exists(): archive.unlink()
run('/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, archive)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(DIST / ('SHA256SUMS-macOS-' + ARCH + '.txt')).write_text(digest + '  ' + archive.name + '\n')
shutil.copy2(ROOT / 'packaging/macos/LEEME-macOS.md', DIST / 'LEEME-macOS.md')
shutil.copy2(ROOT / 'packaging/macos/THIRD-PARTY-NOTICES.md', DIST / 'THIRD-PARTY-NOTICES-macOS.md')
print('Built: ' + str(archive), flush=True)
