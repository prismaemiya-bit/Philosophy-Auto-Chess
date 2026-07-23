import React from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import "../app/game/combat-ui.css";
import "../app/game/combat-ui-overrides.css";
import "../app/game/drag-safety.css";
import "../app/game/map-art.css";
import "../app/game/readability.css";
import "../app/game/task-ui.css";
import "../app/game/mobile.css";
import { audioAssets } from "../app/game/audio";
import { characterAssets, mapAssets } from "../app/game/assets";
import { DesktopGameExperience } from "../app/game/platform/DesktopGameExperience";
import { MobileGameExperience } from "../app/game/platform/MobileGameExperience";

const base = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const withBase = (path: string) => `${base}${path.replace(/^\/+/, "")}`;

for (const asset of Object.values(characterAssets)) {
  if (asset.portrait) asset.portrait = withBase(asset.portrait);
}
for (const asset of Object.values(audioAssets.effects)) {
  if (asset) asset.source = withBase(asset.source);
}
for (const asset of Object.values(audioAssets.music)) {
  if (asset) asset.source = withBase(asset.source);
}
(mapAssets as { background: string }).background = withBase(mapAssets.background);

const locationUrl = new URL(window.location.href);
const requestedUi = locationUrl.searchParams.get("ui");
const pathMode = locationUrl.pathname.endsWith("/mobile/")
  ? "mobile"
  : locationUrl.pathname.endsWith("/desktop/")
    ? "desktop"
    : undefined;
const automaticMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 1100);
const platform = requestedUi === "mobile" || requestedUi === "desktop"
  ? requestedUi
  : pathMode ?? (automaticMobile ? "mobile" : "desktop");

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLAnchorElement>(".ui-mode-settings a")
    : null;
  if (!target) return;
  const label = target.textContent?.trim();
  const mode = label === "桌面版" ? "desktop" : label === "手机版" ? "mobile" : undefined;
  event.preventDefault();
  window.location.href = mode ? `${base}?ui=${mode}` : base;
});

const root = document.getElementById("root");
if (!root) throw new Error("Static game root is missing.");
createRoot(root).render(
  <React.StrictMode>
    {platform === "mobile" ? <MobileGameExperience /> : <DesktopGameExperience />}
  </React.StrictMode>,
);
