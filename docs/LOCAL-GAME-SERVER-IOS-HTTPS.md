# MOS Scene Hunt 手机 HTTPS 测试入口（Windows）

本脚本为电脑上运行的 MOS Scene Hunt 建立 Cloudflare 临时 HTTPS 隧道，供 iPhone 在外部/同一网络测试 GPS 安全上下文。它不是正式生产部署方案。

## 使用步骤

1. 先按 [电脑游戏包服务器说明](LOCAL-GAME-SERVER-WINDOWS.md) 启动电脑服务器，确认电脑浏览器能打开 `http://localhost:3000`。
2. 若电脑尚未安装 Cloudflare Tunnel，在 Windows 终端运行：`winget install --id Cloudflare.cloudflared -e`。
3. 双击 `scripts\\start-https-tunnel.bat`。
4. 在隧道窗口找到 Cloudflare 输出的 `https://……trycloudflare.com` 地址。
5. 在 iPhone 的 Safari 打开该 HTTPS 地址，再进入“创作中心”或“游戏中心”。输入电脑服务器访问口令后，测试保存/读取。
6. 测试时保持电脑服务器和隧道两个窗口都运行。关闭任一窗口，手机访问就会中断。

## 安全说明

- 临时 HTTPS URL 会被转发到你的电脑。只在自己控制的测试期间使用，不要把 URL 或访问口令公开发给陌生人。
- 游戏包列表、保存接口都需要服务器访问口令；不要关闭口令校验。
- Quick Tunnel 地址会变化，停止后重启通常会得到新地址。
- 这是一条用于真实 iPhone 测试的临时通道，不是稳定域名、正式托管或长期在线服务。
