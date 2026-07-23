import releaseInfo from "../../../release-info.json";
import { AUDIO_SETTINGS_VERSION } from "../../game/audio";
import { SAVE_VERSION } from "../../game/engine";
import { PROFILE_VERSION } from "../../game/profile";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  return Response.json(
    {
      schemaVersion: 1,
      product: {
        name: releaseInfo.productName,
        englishName: releaseInfo.englishName,
        developer: releaseInfo.developer,
      },
      release: {
        version: releaseInfo.version,
        versionId: releaseInfo.versionId,
        displayVersion: releaseInfo.displayVersion,
        releaseNotes: releaseInfo.releaseNotes,
      },
      play: {
        automatic: `${origin}/`,
        desktop: `${origin}/desktop`,
        mobile: `${origin}/mobile`,
      },
      compatibility: {
        saveVersion: SAVE_VERSION,
        profileVersion: PROFILE_VERSION,
        audioSettingsVersion: AUDIO_SETTINGS_VERSION,
      },
      source: "https://github.com/prismaemiya-bit/Philosophy-Auto-Chess",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
