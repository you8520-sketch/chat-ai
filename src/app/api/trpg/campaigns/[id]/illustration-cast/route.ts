import { NextResponse } from "next/server";
import { campaignIdFromParams, requireTrpgApi, trpgFail } from "@/lib/trpg/requireApi";
import { loadTrpgIllustrationScene } from "@/lib/trpg/illustrationCast";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const gate = await requireTrpgApi();
  if ("error" in gate) return gate.error;
  try {
    const id = campaignIdFromParams((await ctx.params).id);
    const scene = loadTrpgIllustrationScene(gate.db, {
      campaignId: id,
      viewerUserId: gate.user.id,
    });
    if (!scene) return NextResponse.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      campaignTitle: scene.campaignTitle,
      members: scene.members.map((member) => ({
        participantId: member.participantId,
        name: member.name,
        kind: member.kind,
        imageUrl: member.imageUrl,
        images: member.images,
      })),
    });
  } catch (e) {
    return trpgFail(e);
  }
}
