$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "MOS Scene Hunt - 电脑游戏包服务器" -ForegroundColor Cyan
Write-Host "游戏包将保存在当前项目的 data/game-packages 目录。"
Write-Host ""

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "未找到 Node.js/npm。请先安装 Node.js LTS，然后重新运行本脚本。"
}
if (-not (Test-Path "node_modules")) {
  Write-Host "首次运行：正在安装项目依赖……" -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败。" }
}

$tokenFile = Join-Path (Get-Location) ".local-game-store-token"
if (Test-Path $tokenFile) {
  $token = (Get-Content $tokenFile -Raw).Trim()
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $token = ([Convert]::ToHexString($bytes)).ToLowerInvariant()
  Set-Content -Path $tokenFile -Value $token -NoNewline -Encoding ascii
}
if ([string]::IsNullOrWhiteSpace($token)) { throw "访问口令为空，无法安全启动。" }

$env:MOS_LOCAL_GAME_STORE = "1"
$env:MOS_LOCAL_GAME_STORE_TOKEN = $token
$env:HOSTNAME = "0.0.0.0"

New-Item -ItemType Directory -Force -Path "data/game-packages" | Out-Null
Write-Host "访问口令（在创作中心/游戏中心连接时输入）：" -ForegroundColor Green
Write-Host $token -ForegroundColor White
Write-Host ""
Write-Host "正在构建应用；首次构建可能需要几分钟……" -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "构建失败；游戏包目录不会被删除，请修复错误后重试。" }

Write-Host ""
Write-Host "电脑服务即将启动。" -ForegroundColor Green
Write-Host "电脑本机访问：http://localhost:3000"
Write-Host "停止服务：在此窗口按 Ctrl+C。"
Write-Host "请勿将此服务直接暴露到公网；手机 GPS 需要 HTTPS 安全上下文。"
Write-Host ""
npm run start
