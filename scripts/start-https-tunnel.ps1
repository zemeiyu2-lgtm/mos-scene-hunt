$ErrorActionPreference = "Stop"
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "未找到 cloudflared。可在 Windows 终端执行以下命令安装：" -ForegroundColor Yellow
  Write-Host "winget install --id Cloudflare.cloudflared -e"
  Write-Host ""
  Write-Host "安装后重新打开终端，再双击 scripts\\start-https-tunnel.bat。"
  exit 1
}
Write-Host "正在为本机 MOS Scene Hunt 建立临时 HTTPS 入口……" -ForegroundColor Cyan
Write-Host "确保电脑游戏服务器已在 http://localhost:3000 运行。"
Write-Host "出现 https://*.trycloudflare.com 地址后，用该 HTTPS 地址在 iPhone Safari 打开。"
Write-Host "临时地址只用于测试；停止此窗口会关闭隧道。不要公开分享给不可信的人。"
Write-Host ""
cloudflared tunnel --url http://localhost:3000
