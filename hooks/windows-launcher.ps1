# Source for the inline Windows hook command. Rebuild with
# node scripts/build-windows-launchers.js --write.
# EncodedCommand preserves this script across cmd and PowerShell quoting.
# It does not change execution policy or hook trust settings.
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCommand) {
  $fnmCommand = Get-Command fnm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $fnmCommand) { throw 'Foreman requires Node.js on PATH or a configured fnm default.' }
  & $fnmCommand.Source env --shell powershell | Out-String | Invoke-Expression
  $nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
}
$hookScript = "try{require(require('path').join(process.env.PLUGIN_ROOT,'hooks','__FOREMAN_HOOK__')).main()}catch{}"
& $nodeCommand.Source -e $hookScript
exit $LASTEXITCODE
