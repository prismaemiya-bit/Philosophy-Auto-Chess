import type { Metadata } from "next";
import "./globals.css";
import "./game/combat-ui.css";
import "./game/combat-ui-overrides.css";
import "./game/drag-safety.css";
import "./game/map-art.css";

export const metadata: Metadata = {
  title: "往哲荣耀 · Philosophy Auto Chess · V0.1 Demo",
  description: "固定路线防守与自走棋经济的策略游戏原型。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
