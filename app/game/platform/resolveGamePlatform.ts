import type { GamePlatform } from "./GamePlatformMarker";

type HeaderReader = {
  get(name: string): string | null;
};

const MOBILE_USER_AGENT =
  /Android|iPhone|iPad|iPod|IEMobile|Mobile Safari|Opera Mini/i;

export function resolveGamePlatform(
  headers: HeaderReader,
  requestedUi?: string,
): GamePlatform {
  if (requestedUi === "desktop" || requestedUi === "mobile") return requestedUi;

  const clientHint = headers.get("sec-ch-ua-mobile");
  if (clientHint === "?1") return "mobile";
  if (clientHint === "?0") return "desktop";

  return MOBILE_USER_AGENT.test(headers.get("user-agent") ?? "")
    ? "mobile"
    : "desktop";
}
