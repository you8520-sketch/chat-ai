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
              length(example_dialog) AS example_dialog_chars
       FROM characters
       WHERE COALESCE(content_kind, 'character') = 'character'
         AND creator_id = ?
         AND nsfw <= ?
         AND (? = '' OR name LIKE ? OR creator_name LIKE ? OR tagline LIKE ?)
       ORDER BY likes DESC, id DESC
       LIMIT 60`,
    )
    .all(user.id, nsfw ? 1 : 0, query, like, like, like) as Array<{
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
    }>;

  return NextResponse.json({
    characters: rows.map((row) => ({
      id: row.id,
      name: row.name,
      tagline: row.tagline,
      creatorName: row.creator_name,
      owned: true,
      nsfw: row.nsfw === 1,
      promptChars: row.system_prompt_chars + row.world_chars + row.example_dialog_chars,
      thumbnail: representativeImage(row.images),
    })),
  });
}
