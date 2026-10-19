$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$build = Join-Path $root 'build/windows'
$payload = Join-Path $build 'payload'
$dist = Join-Path $root 'dist/windows'
$components = Get-Content (Join-Path $PSScriptRoot 'components.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force $build, $dist | Out-Null
if (Test-Path $payload) { Remove-Item $payload -Recurse -Force }
New-Item -ItemType Directory -Force $payload | Out-Null

function Download-Verified($Component, [string]$Destination) {
    if (!(Test-Path $Destination)) { Invoke-WebRequest -Uri $Component.url -OutFile $Destination }
    $actual = (Get-FileHash $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Component.sha256) { throw "La suma SHA256 no coincide: $Destination" }
}

$nodeZip = Join-Path $build 'node.zip'
$gitZip = Join-Path $build 'git.zip'
Download-Verified $components.node $nodeZip
Download-Verified $components.git $gitZip
$nodeUnpack = Join-Path $build 'node-unpack'
if (Test-Path $nodeUnpack) { Remove-Item $nodeUnpack -Recurse -Force }
Expand-Archive $nodeZip $nodeUnpack
$nodeRoot = (Get-ChildItem $nodeUnpack -Directory | Select-Object -First 1).FullName
$nodeDest = Join-Path $payload 'node'
New-Item -ItemType Directory -Force $nodeDest | Out-Null
foreach ($file in @('node.exe', 'LICENSE', 'README.md', 'CHANGELOG.md')) { Copy-Item (Join-Path $nodeRoot $file) $nodeDest }
Expand-Archive $gitZip (Join-Path $payload 'git')
foreach ($file in @('git/cmd/git.exe', 'git/usr/bin/ssh.exe', 'git/usr/bin/sh.exe')) {
    if (!(Test-Path (Join-Path $payload $file))) { throw "MinGit no incluye $file" }
}

$app = Join-Path $payload 'app'
New-Item -ItemType Directory -Force $app | Out-Null
foreach ($item in @('server.mjs', 'remote.mjs', 'package.json', 'package-lock.json', 'public', 'node_modules')) {
    Copy-Item (Join-Path $root $item) $app -Recurse
}
Copy-Item (Join-Path $PSScriptRoot 'THIRD-PARTY-NOTICES.md') $payload
Copy-Item (Join-Path $PSScriptRoot 'LEEME-Windows.md') $payload
Copy-Item (Join-Path $PSScriptRoot 'components.json') $payload

Add-Type -AssemblyName System.IO.Compression.FileSystem
$payloadZip = Join-Path $PSScriptRoot 'payload.zip'
if (Test-Path $payloadZip) { Remove-Item $payloadZip }
[IO.Compression.ZipFile]::CreateFromDirectory($payload, $payloadZip, [IO.Compression.CompressionLevel]::Optimal, $false)

dotnet publish (Join-Path $PSScriptRoot 'PromptExplorer.csproj') -c Release -r win-x64 --self-contained true -o $dist
if ($LASTEXITCODE -ne 0) { throw 'No se pudo construir PromptExplorer.exe' }
$exe = Join-Path $dist 'PromptExplorer.exe'
if (!(Test-Path $exe)) { throw 'El compilador no generó el ejecutable.' }
Copy-Item (Join-Path $PSScriptRoot 'LEEME-Windows.md') $dist
Copy-Item (Join-Path $PSScriptRoot 'THIRD-PARTY-NOTICES.md') $dist
Copy-Item (Join-Path $PSScriptRoot 'components.json') $dist

# Test the actual EXE with no Node or Git installation in PATH. It starts its
# bundled server, creates a Markdown file and commits with its bundled Git.
$report = Join-Path $dist 'windows-smoke.json'
$process = Start-Process -FilePath $exe -ArgumentList @('--smoke-test', "`"$report`"") -PassThru
if (!$process.WaitForExit(180000)) { $process.Kill($true); throw 'El ejecutable no completó la prueba en 3 minutos.' }
if ($process.ExitCode -ne 0) {
    if (Test-Path $report) { Get-Content $report }
    throw "La prueba del ejecutable falló: $($process.ExitCode)"
}
if (!(Test-Path $report)) { throw 'Falta el resultado de la prueba Windows.' }
$result = Get-Content $report -Raw | ConvertFrom-Json
if (!$result.ok) { throw 'El ejecutable no pasó su prueba.' }

$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  PromptExplorer.exe" | Set-Content (Join-Path $dist 'SHA256SUMS.txt') -Encoding ascii
Write-Host "Ejecutable construido y probado: $exe"
