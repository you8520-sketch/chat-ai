import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

function representativeImage(raw: string): string | null {
  try {
    const images = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(images) && typeof images[0] === "string" ? images[0] : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = new URL(req.url);
  const nsfw = url.searchParams.get("nsfw") === "1";
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 50);
  const like = `%${query.replace(/[%_]/g, "")}%`;
  const rows = getDb()
    .prepare(
      `SELECT id, name, tagline, creator_id, creator_name, images, nsfw,
              length(system_prompt) AS system_prompt_chars,
              length(world) AS world_chars,
              length(example_dialog) AS example_dialog_chars,
              simulation_reuse_allowed, simulation_nsfw_allowed
       FROM characters
       WHERE COALESCE(content_kind, 'character') = 'character'
         AND nsfw <= ?
         AND (
           creator_id = ?
           OR (
             visibility = 'public'
             AND moderation_status = 'approved'
             AND simulation_reuse_allowed = 1
             AND (? = 0 OR simulation_nsfw_allowed = 1)
           )
         )
         AND (? = '' OR name LIKE ? OR creator_name LIKE ? OR tagline LIKE ?)
       ORDER BY CASE WHEN creator_id = ? THEN 0 ELSE 1 END, likes DESC, id DESC
       LIMIT 60`,
    )
    .all(nsfw ? 1 : 0, user.id, nsfw ? 1 : 0, query, like, like, like, user.id) as Array<{
      id: number;
      name: string;
      tagline: string;
      creator_id: number | null;
      creator_name: string;
      images: string;
      nsfw: number;
      system_prompt_chars: number;
      world_chars: number;
      example_dialog_chars: number;
      simulation_reuse_allowed: number;
      simulation_nsfw_allowed: number;
    }>;

  return NextResponse.json({
    characters: rows.map((row) => ({
      id: row.id,
      name: row.name,
      tagline: row.tagline,
      creatorName: row.creator_name,
      owned: row.creator_id === user.id,
      nsfw: row.nsfw === 1,
      promptChars: row.system_prompt_chars + row.world_chars + row.example_dialog_chars,
      thumbnail: representativeImage(row.images),
    })),
  });
}
