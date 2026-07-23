"use client";

import { useEffect } from "react";

export type GamePlatform = "desktop" | "mobile";

export function GamePlatformMarker({ platform }: { platform: GamePlatform }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.gameUi = platform;

    return () => {
      if (root.dataset.gameUi === platform) delete root.dataset.gameUi;
    };
  }, [platform]);

  return null;
}
