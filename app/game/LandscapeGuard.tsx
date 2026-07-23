"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "philosophy-auto-chess-landscape-hint-dismissed";

export async function requestMobileLandscape() {
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const mobileSizedScreen = Math.min(window.screen.width, window.screen.height) <= 1024;
  if (!coarsePointer || !mobileSizedScreen) return false;

  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  if (!standalone && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // iOS Safari and some embedded browsers do not expose page fullscreen.
    }
  }

  const orientation = window.screen.orientation as ScreenOrientation & {
    lock?: (mode: "landscape") => Promise<void>;
  };
  if (typeof orientation?.lock === "function") {
    try {
      await orientation.lock("landscape");
      return true;
    } catch {
      // Browser orientation locks commonly require fullscreen or installed PWA.
    }
  }

  return window.matchMedia("(orientation: landscape)").matches;
}

export function LandscapeGuard() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const retryLandscape = () => {
    void requestMobileLandscape().finally(dismiss);
  };

  return <aside className={`landscape-hint ${dismissed ? "dismissed" : ""}`} role="status" aria-label="建议横屏游玩">
    <div aria-hidden="true"><span>◇</span><i>↻</i></div>
    <p><b>建议横屏游玩</b><small>横置手机可完整查看三路战场；竖屏仍可继续。</small></p>
    <button type="button" onClick={retryLandscape}>横屏游玩</button>
  </aside>;
}
