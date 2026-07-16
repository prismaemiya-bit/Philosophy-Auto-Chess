param([string]$ReleaseRoot = (Join-Path $PSScriptRoot "..\release"))

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseRoot = [IO.Path]::GetFullPath($ReleaseRoot)
$name = "sages-glory-v0.1-demo-windows-portable"
$target = Join-Path $releaseRoot $name
$packageZip = Join-Path $releaseRoot "$name.zip"
$sourceZip = Join-Path $releaseRoot "sages-glory-v0.1-demo-source.zip"

foreach ($path in @($target, $packageZip, $sourceZip)) {
  if (Test-Path -LiteralPath $path) { throw "Demo artifact already exists and will not be overwritten: $path" }
}
if (-not (Test-Path -LiteralPath (Join-Path $root "dist\server\index.js"))) {
  throw "Production build missing. Run npm.cmd test first."
}

$runtimeCandidates = @(
  (Join-Path $root "release\runtime\node.exe"),
  (Join-Path $root ".runtime\node.exe")
)
$runtime = $runtimeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $runtime) { throw "Portable node.exe was not found in release\runtime or .runtime." }

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path $target, (Join-Path $target "runtime") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root "dist") -Destination (Join-Path $target "dist") -Recurse
Copy-Item -LiteralPath $runtime -Destination (Join-Path $target "runtime\node.exe")
Copy-Item -LiteralPath (Join-Path $root "scripts\portable-server.mjs") -Destination (Join-Path $target "portable-server.mjs")
Copy-Item -LiteralPath (Join-Path $root "scripts\portable-start.cmd") -Destination (Join-Path $target "start-game.cmd")
Copy-Item -LiteralPath (Join-Path $root "scripts\portable-start.cmd") -Destination (Join-Path $target "启动往哲荣耀.cmd")
Copy-Item -LiteralPath (Join-Path $root "QUICKSTART.txt") -Destination $target
Copy-Item -LiteralPath (Join-Path $root "RELEASE_NOTES_v0.1-demo.md") -Destination $target

$forbidden = Get-ChildItem -LiteralPath $target -Recurse -Force | Where-Object {
  $_.FullName -match "(User Data|Local Storage|IndexedDB|idea-garrison-v01-save|sages-glory-save|\.log$|\.pid$)"
}
if ($forbidden) { throw "Release contains local state or log files: $($forbidden.FullName -join ', ')" }

$manifest = Get-ChildItem -LiteralPath $target -Recurse -File | Sort-Object FullName | ForEach-Object {
  $relativePath = $_.FullName.Substring($target.Length).TrimStart("\").Replace("\", "/")
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relativePath"
}
Set-Content -LiteralPath (Join-Path $target "SHA256SUMS.txt") -Value $manifest -Encoding utf8
& tar.exe -a -cf $packageZip -C $target .
if ($LASTEXITCODE -ne 0) { throw "Unable to create portable ZIP." }

$staging = Join-Path ([IO.Path]::GetTempPath()) "sages-glory-v0.1-demo-source"
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null
$sourceItems = @(
  "app", "public", "scripts", "tests", "worker", "build", ".openai",
  "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "next.config.ts",
  "eslint.config.mjs", "postcss.config.mjs", "README.md", "QUICKSTART.txt",
  "DESIGN_V02.md", "MECHANICS_AUDIT.md", "WORKLOG_V02.md", "MAP_ART_SPEC.md",
  "RELEASE_NOTES_v0.1-demo.md"
)
foreach ($item in $sourceItems) {
  $source = Join-Path $root $item
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $staging -Recurse }
}
& tar.exe -a -cf $sourceZip -C $staging .
if ($LASTEXITCODE -ne 0) { throw "Unable to create source snapshot ZIP." }
Remove-Item -LiteralPath $staging -Recurse -Force

$artifactHashes = @($packageZip, $sourceZip) | ForEach-Object {
  "{0}  {1}" -f (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant(), (Split-Path $_ -Leaf)
}
Set-Content -LiteralPath (Join-Path $releaseRoot "v0.1-demo-SHA256SUMS.txt") -Value $artifactHashes -Encoding utf8

Write-Host "Portable Demo: $target"
Write-Host "Package ZIP: $packageZip"
Write-Host "Source snapshot: $sourceZip"
