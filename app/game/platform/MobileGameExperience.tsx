import GameClient from "../GameClient";
import { GamePlatformMarker } from "./GamePlatformMarker";

export function MobileGameExperience() {
  return <>
    <GamePlatformMarker platform="mobile" />
    <GameClient />
  </>;
}
