# resume-all: read Claude transcripts for the popup (local machine only).
# Input : -In "<session id>:<project folder name>,<session id>:<project folder name>,..."
#         (both are checked against strict patterns below; anything else is reported as not found)
# Output: JSON array [{ s, found, file, cwd, last, mtime, bypass, mode }]
#   cwd    = first "cwd" in the transcript (the folder claude started in)
#   last   = timestamp of the last assistant message (UTC ISO), else null
#   mtime  = transcript last write time (UTC ISO)
#   bypass = the session ever ran in bypassPermissions (only reachable when started with the flag)
#   mode   = last permission mode recorded
# Read-only: never writes anything.
param([string]$In)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$items = @()
foreach ($pair in ($In -split ',')) {
  $kv = $pair -split ':', 2
  if ($kv.Count -eq 2) { $items += [pscustomobject]@{ s = $kv[0]; p = $kv[1] } }
}
$roots = @()
if ($env:CLAUDE_CONFIG_DIR) { $roots += (Join-Path $env:CLAUDE_CONFIG_DIR 'projects') }
$roots += (Join-Path $HOME '.claude\projects')

$idRe = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$projRe = '^[A-Za-z0-9_-]{1,200}$'
$cwdRe = New-Object System.Text.RegularExpressions.Regex('"cwd":"((?:[^"\\]|\\.)*)"')
$tsRe = New-Object System.Text.RegularExpressions.Regex('"timestamp":"([0-9T:.\-]+Z)"', 'RightToLeft')
$modeRe = New-Object System.Text.RegularExpressions.Regex('"permissionMode":"([A-Za-z]+)"')

$out = @()
foreach ($it in $items) {
  $s = [string]$it.s; $p = [string]$it.p
  if ($s -notmatch $idRe -or $p -notmatch $projRe) { $out += [pscustomobject]@{ s = $s; found = $false }; continue }
  $file = $null
  foreach ($r in $roots) {
    $f = Join-Path (Join-Path $r $p) ($s + '.jsonl')
    if (Test-Path -LiteralPath $f) { $file = $f; break }
  }
  if (-not $file) { $out += [pscustomobject]@{ s = $s; found = $false }; continue }

  $cwd = $null; $lastLine = $null; $bypass = $false; $mode = $null
  try {
    $fs = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
    $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
    try {
      while ($null -ne ($line = $sr.ReadLine())) {
        if ($line.StartsWith('{"type":"permission-mode"')) {
          $m = $modeRe.Match($line)
          if ($m.Success) { $mode = $m.Groups[1].Value; if ($mode -eq 'bypassPermissions') { $bypass = $true } }
          continue
        }
        # User turns also carry a top-level permissionMode. Parse the line so text that merely
        # mentions "permissionMode" (tool output) doesn't count; only lines that contain it.
        if ($line.StartsWith('{"parentUuid"') -and $line.Contains('"permissionMode":"')) {
          try {
            $o = ConvertFrom-Json -InputObject $line
            if ($o.type -eq 'user' -and $o.permissionMode) {
              $mode = [string]$o.permissionMode
              if ($mode -eq 'bypassPermissions') { $bypass = $true }
            }
          } catch { }
        }
        if ($null -eq $cwd -and $line.Contains('"cwd":"')) {
          $m = $cwdRe.Match($line)
          if ($m.Success) { $cwd = [regex]::Unescape($m.Groups[1].Value) }
        }
        if ($line.StartsWith('{"parentUuid"') -and $line.Contains('"role":"assistant"')) { $lastLine = $line }
      }
    } finally { $sr.Dispose(); $fs.Dispose() }
  } catch {
    $out += [pscustomobject]@{ s = $s; found = $true; file = $file; error = $_.Exception.Message }
    continue
  }
  $last = $null
  if ($lastLine) { $m = $tsRe.Match($lastLine); if ($m.Success) { $last = $m.Groups[1].Value } }
  $mtime = (Get-Item -LiteralPath $file).LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $out += [pscustomobject]@{ s = $s; found = $true; file = $file; cwd = $cwd; last = $last; mtime = $mtime; bypass = $bypass; mode = $mode }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
