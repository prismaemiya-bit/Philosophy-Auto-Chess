import GameClient from "../GameClient";
import { GamePlatformMarker } from "./GamePlatformMarker";

export function DesktopGameExperience() {
  return <>
    <GamePlatformMarker platform="desktop" />
    <GameClient />
  </>;
}
