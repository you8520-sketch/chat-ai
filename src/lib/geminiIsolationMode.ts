/** true | 1 | yes — 채팅 1유저메시지당 Gemini HTTP 1회만 (과금 격리 테스트) */
export function isGeminiIsolationMode(): boolean {
  const raw = process.env.GEMINI_ISOLATION_MODE?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * RP primary-stream thinking 비활성화.
 * GEMINI_DISABLE_THINKING=1|true|yes — 강제 off
 * GEMINI_DISABLE_THINKING=0|false|no — 강제 on
 * unset — GEMINI_ISOLATION_MODE와 동일 (격리 테스트 시 thinking off)
 */
export function isGeminiRpThinkingDisabled(): boolean {
  const raw = process.env.GEMINI_DISABLE_THINKING?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  return isGeminiIsolationMode();
}

let isolationLogged = false;

export function logGeminiIsolationModeOnce(): void {
  if (!isGeminiIsolationMode() || isolationLogged) return;
  isolationLogged = true;
  console.warn("[gemini-isolation] ENABLED — 1 user message = 1 Gemini HTTP request max", {
    disabled: [
      "scheduleMemoryUpdate",
      "mergeRelationshipMetaFromTurn",
      "rollingSummary",
      "lorebookCompact",
      "explicitCache",
      "speechLockRewrite",
      "continuationPass",
    ],
  });
}
