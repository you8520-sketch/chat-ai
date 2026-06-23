import type { StatusMeta } from "./types";
import { hasVisibleStatusMeta } from "./types";
import { parseMarkdownPipeTable } from "@/lib/chatRichContent";
import { tableMarkdownHasContent } from "./formatSpec";

/** 상태창 markdown — tableMarkdown 또는 레거시 섹션 */
export function renderStatusMetaMarkdown(meta: StatusMeta, _formatSpec?: string | null): string {
  if (meta.tableMarkdown?.trim()) {
    return meta.tableMarkdown.trim();
  }
  return renderLegacyStatusMetaMarkdown(meta);
}

function line(label: string, value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return `${label}: ${v}`;
}

function renderLegacyStatusMetaMarkdown(meta: StatusMeta): string {
  const lines: string[] = ["━━━━━━━━━━━━━━", "📍 현재 상황"];
  for (const l of [
    line("시간", meta.datetime),
    line("장소", meta.location),
    line("관계", meta.relationship),
    line("상황", meta.sceneSummary),
  ]) {
    if (l) lines.push(l);
  }

  if (meta.npcEmotion?.trim()) {
    lines.push("", "💭 NPC 감정", meta.npcEmotion.trim());
  }
  if (meta.npcIntent?.trim() || meta.nextObjective?.trim()) {
    lines.push("", "🎯 NPC 목표");
    for (const item of [meta.npcIntent, meta.nextObjective].filter(Boolean)) {
      const t = item!.trim();
      if (t) lines.push(`• ${t.replace(/^•\s*/, "")}`);
    }
  }
  if (meta.hiddenThought?.trim()) {
    lines.push("", "🫀 속마음", `"${meta.hiddenThought.trim().replace(/^["']|["']$/g, "")}"`);
  }
  lines.push("━━━━━━━━━━━━━━");
  return lines.join("\n");
}

export function statusMetaDisplayMarkdown(
  meta: StatusMeta,
  _formatSpec?: string | null
): string | null {
  const md = renderStatusMetaMarkdown(meta);
  if (meta.tableMarkdown?.trim()) {
    if (tableMarkdownHasContent(md)) return md;
    // plain-text 줄글 템플릿(— placeholder)도 표시
    if (!parseMarkdownPipeTable(md)) return md.trim() ? md : null;
    return null;
  }
  return md.trim() ? md : null;
}

/** UI·폴링 — 표시할 내용이 있는지 */
export function statusMetaHasDisplayContent(
  meta: StatusMeta | null | undefined,
  formatSpec?: string | null
): boolean {
  if (!meta || !hasVisibleStatusMeta(meta)) return false;
  if (meta.tableMarkdown?.trim()) {
    return Boolean(statusMetaDisplayMarkdown(meta, formatSpec)?.trim());
  }
  return Boolean(
    meta.datetime?.trim() ||
      meta.location?.trim() ||
      meta.relationship?.trim() ||
      meta.npcEmotion?.trim() ||
      meta.npcIntent?.trim() ||
      meta.nextObjective?.trim() ||
      meta.hiddenThought?.trim() ||
      meta.sceneSummary?.trim()
  );
}
