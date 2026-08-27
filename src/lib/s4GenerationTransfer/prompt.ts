/**
 * S4 output contract — single owner for model-facing transfer instructions.
 */

import type { S4GenerationTransferContext } from "./types";

export function buildS4TransferOutputContractFragment(ctx: S4GenerationTransferContext): string {
  const receiverLines = [...ctx.receivers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ref, r]) => `[${ref}] ${r.displayName}`);

  return [
    "[S4 DIRECT STATEMENT — STRUCTURED TRANSFER]",
    "현재 응답 본문에서 K fact를 R 수신자에게 실제로 직접 말로 전달을 완료한 경우에만,",
    "응답 맨 끝에 아래 형식의 숨김 블록을 추가한다. 전달하지 않았으면 블록을 출력하지 않는다.",
    "",
    "금지 (이 경우 event 0 — 블록 출력 금지):",
    "- 유저가 말하라고 요청만 함 / 말하려는 생각·계획 / 아직 입을 열지 않음",
    "- 제3자가 알아듣기 어려운 상황 / 혼잣말 / 단순 암시 / narration에만 사실 기재",
    "- 수신자에게 실제로 전달되지 않음",
    "",
    "수신자:",
    ...receiverLines,
    "",
    "출력 형식 (visible prose 뒤, 사용자에게 보이지 않음):",
    "<<<S4_KNOWLEDGE_TRANSFER>>>",
    JSON.stringify({
      nonce: ctx.nonce,
      events: [
        {
          factRef: "K1",
          receiverRef: "R1",
          transferType: "DIRECT_STATEMENT",
          completed: true,
          proofText: "<방금 말한 문장의 정확한 부분 문자열>",
        },
      ],
    }),
    "<<<END_S4>>>",
    "",
    "규칙:",
    `- nonce는 정확히 "${ctx.nonce}"`,
    "- factRef/receiverRef는 위 K/R만 사용 (임의 ref 금지)",
    "- transferType은 DIRECT_STATEMENT, completed는 true만",
    "- proofText는 visible prose의 exact substring (secretId/personaId/observerId 출력 금지)",
    "- 실제 전달 1건당 event 1개, 최대 4개",
  ].join("\n");
}
