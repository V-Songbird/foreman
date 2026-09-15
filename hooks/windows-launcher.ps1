# Source for the inline Windows hook command. Rebuild with
# node scripts/build-windows-launchers.js --write.
# EncodedCommand preserves this script across cmd and PowerShell quoting.
# It does not change execution policy or hook trust settings.
# PATH is probed with where.exe rather than Get-Command: a lookup that misses
# makes Windows PowerShell consult its module analysis cache, which can take
# tens of seconds while that cache is cold.
$ErrorActionPreference = 'Stop'
where.exe /q '$PATH:node'
if ($LASTEXITCODE -ne 0) {
  where.exe /q '$PATH:fnm'
  if ($LASTEXITCODE -ne 0) { throw 'Foreman requires Node.js on PATH or a configured fnm default.' }
  fnm env --shell powershell | Out-String | Invoke-Expression
}
$hookScript = "try{require(require('path').join(process.env.PLUGIN_ROOT,'hooks','__FOREMAN_HOOK__')).main()}catch{}"
& node -e $hookScript
exit $LASTEXITCODE
