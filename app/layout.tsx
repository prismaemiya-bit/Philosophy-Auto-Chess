import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./game/combat-ui.css";
import "./game/combat-ui-overrides.css";
import "./game/drag-safety.css";
import "./game/map-art.css";
import "./game/readability.css";
import "./game/task-ui.css";
import "./game/mobile.css";
import releaseInfo from "../release-info.json";
import { PwaRegistration } from "./game/PwaRegistration";

export const metadata: Metadata = {
  title: `${releaseInfo.productName} · ${releaseInfo.englishName} · ${releaseInfo.displayVersion} · ${releaseInfo.developer}`,
  description: "固定路线防守与自走棋经济的策略游戏原型。",
  applicationName: "往哲荣耀",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" }],
    shortcut: "/favicon.svg",
    apple: [{ url: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "往哲荣耀",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#071014",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><PwaRegistration />{children}</body></html>;
}
