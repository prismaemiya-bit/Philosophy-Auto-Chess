import { headers } from "next/headers";
import { DesktopGameExperience } from "./game/platform/DesktopGameExperience";
import { MobileGameExperience } from "./game/platform/MobileGameExperience";
import { resolveGamePlatform } from "./game/platform/resolveGamePlatform";

type HomeProps = {
  searchParams: Promise<{ ui?: string | string[] }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const requestHeaders = await headers();
  const query = await searchParams;
  const requestedUi = Array.isArray(query.ui) ? query.ui[0] : query.ui;
  const platform = resolveGamePlatform(requestHeaders, requestedUi);

  return platform === "mobile"
    ? <MobileGameExperience />
    : <DesktopGameExperience />;
}
