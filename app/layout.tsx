import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./leaflet.css";
import { RootProviders } from "@/components/root-providers";

export const metadata: Metadata = {
  title: "MOS Scene Hunt",
  description:
    "在真实世界里移动，解锁情境、线索与任务。一个手机优先的地理情境寻宝游戏引擎。",
  manifest: "/manifest.webmanifest",
  applicationName: "MOS Scene Hunt",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Scene Hunt",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom stays available: a map game should never trap a low-vision player.
  maximumScale: 5,
  userScalable: true,
  themeColor: "#f6f7fb",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
