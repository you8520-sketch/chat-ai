/**
 * S4 output contract — single owner, compact token footprint.
 */

import type { S4GenerationTransferContext } from "./types";

export function buildS4TransferOutputContractFragment(ctx: S4GenerationTransferContext): string {
  const receiverLines = [...ctx.receivers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ref, r]) => `[${ref}] ${r.displayName}`);

  return [
    "[S4 DIRECT STATEMENT]",
    "본문에서 K fact를 R에게 실제로 직접 말로 전달 완료한 경우에만, 응답 맨 끝에 숨김 블록을 추가한다.",
    "의도·계획·혼잣말·암시·narration-only·미전달이면 블록 0.",
    "수신자:",
    ...receiverLines,
    "형식:",
    "<<<S4_KNOWLEDGE_TRANSFER>>>",
    JSON.stringify({
      nonce: ctx.nonce,
      events: [
        {
          factRef: "K1",
          receiverRef: "R1",
          transferType: "DIRECT_STATEMENT",
          completed: true,
          proofText: "<visible prose exact substring>",
        },
      ],
    }),
    "<<<END_S4>>>",
    `nonce="${ctx.nonce}"; K/R는 위 목록만; completed=true; proofText=visible exact substring; max 4 events; secretId/observerId 출력 금지.`,
  ].join("\n");
}
