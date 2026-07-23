import releaseInfo from "../../../release-info.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      status: "ok",
      service: "philosophy-auto-chess",
      productName: releaseInfo.productName,
      version: releaseInfo.versionId,
      commit:
        process.env.CF_PAGES_COMMIT_SHA
        ?? process.env.GIT_COMMIT_SHA
        ?? null,
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
