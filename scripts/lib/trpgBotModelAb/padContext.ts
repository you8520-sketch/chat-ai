import type { TrpgBotActionContext } from "@/lib/trpg/botActions";

/** Rough chars/token for mixed Korean TRPG prompts (~1.8 chars/token). */
export const EST_CHARS_PER_INPUT_TOKEN = 1.8;

export function estimateInputTokens(text: string): number {
  return Math.round(Array.from(text).length / EST_CHARS_PER_INPUT_TOKEN);
}

function padBlock(title: string, seed: string, targetChars: number): string {
  const lines: string[] = [];
  let i = 0;
  while (lines.join("\n").length < targetChars) {
    lines.push(`- [R${i + 1}] ${seed} (${title})`);
    i += 1;
  }
  return lines.join("\n");
}

/** Pad long-term memory until user block approaches target input tokens. */
export function padContextToTargetTokens(
  ctx: TrpgBotActionContext,
  userChars: number,
  targetTokens: number
): TrpgBotActionContext {
  const targetChars = Math.floor(targetTokens * EST_CHARS_PER_INPUT_TOKEN);
  const deficit = targetChars - userChars;
  if (deficit <= 400) return ctx;
  const existing = ctx.longTermMemories?.trim() ?? "";
  const pad = padBlock(
    "과거 회상",
    "캠페인 도중 쌓인 사소한 단서·관계·장소 기억. GM 확정 사실이 아니라 이 캐릭터가 알고 있는 범위.",
    Math.min(deficit, 9000)
  );
  return {
    ...ctx,
    longTermMemories: existing ? `${existing}\n\n${pad}` : pad,
  };
}
