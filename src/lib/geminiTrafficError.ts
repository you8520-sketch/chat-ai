/** 503/429 — UI 시스템 메시지 (DB·assistant 저장 금지) */
export const GEMINI_TRAFFIC_OVERLOAD_MESSAGE =
  "[시스템: 현재 구글 AI 서버에 트래픽이 몰려 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.]";

export class GeminiTrafficOverloadError extends Error {
  readonly userMessage = GEMINI_TRAFFIC_OVERLOAD_MESSAGE;

  constructor(message = GEMINI_TRAFFIC_OVERLOAD_MESSAGE) {
    super(message);
    this.name = "GeminiTrafficOverloadError";
  }
}

export function isGeminiTrafficOverloadError(e: unknown): e is GeminiTrafficOverloadError {
  return e instanceof GeminiTrafficOverloadError;
}

export function isGeminiTrafficOverloadHttp(status: number, errText = ""): boolean {
  if (status === 503 || status === 429) return true;
  return /503|429|UNAVAILABLE|high demand|RESOURCE_EXHAUSTED|Too Many Requests/i.test(errText);
}

export function throwIfGeminiTrafficOverload(errText: string, status: number): void {
  if (isGeminiTrafficOverloadHttp(status, errText)) {
    throw new GeminiTrafficOverloadError();
  }
}

/** 트래픽 안내 문구 — DB·히스토리 오염 방지용 식별 */
export function isTrafficOverloadSystemMessage(text: string): boolean {
  const t = text.trim();
  return t === GEMINI_TRAFFIC_OVERLOAD_MESSAGE || /현재 구글 AI 서버에 트래픽이 몰려/.test(t);
}

/**
 * 503/429 시 연결을 끊지 않고 텍스트 청크 + done으로 스트림 정상 종료.
 * skipPersistence — DB 저장·과금 스킵 (프론트가 ephemeral system UI로 표시).
 */
export function sendTrafficOverloadGracefulStream(send: (obj: object) => void): void {
  send({ type: "reset" });
  send({ type: "append", text: GEMINI_TRAFFIC_OVERLOAD_MESSAGE, forceAppend: true });
  send({
    type: "done",
    trafficOverload: true,
    skipPersistence: true,
    finalContent: GEMINI_TRAFFIC_OVERLOAD_MESSAGE,
  });
}
