import "server-only";

import { canAccessAdultContent, type AdultAccessUser } from "@/lib/adultVerification";
import {
  resolveEffectiveAdultRp,
  resolveRoomAdultModeEnabled,
} from "@/lib/chatAdultHandoff";
import { getDb } from "@/lib/db";
import { createAdultOffClassifier } from "@/lib/adultOffOutputClassifier";
import {
  evaluateAdultOffOutput,
  isAdultOffOutputGuardEnabled,
  shouldApplyAdultOffOutputGuard,
  summarizeAdultOffCheck,
  type AdultOffCheckRecord,
  type AdultOffCheckStage,
} from "@/lib/adultOffOutputGuard";

/**
 * 비동기 보조 출력(추천 답장·상태 메타)이 저장되기 전에 쓰는 검사.
 * 방의 성인 RP 여부는 본 턴과 같은 owner(canAccessAdultContent + 방 성인모드)로 본다.
 * 가드가 꺼져 있거나 성인 ON이면 호출하지 않고 전달을 허용한다.
 */
export function adultOffOutputGuardAppliesToChat(chatId: number): boolean {
  if (!isAdultOffOutputGuardEnabled()) return false;
  const db = getDb();
  const chat = db
    .prepare(`SELECT user_id, adult_handoff_enabled FROM chats WHERE id=?`)
    .get(chatId) as { user_id: number; adult_handoff_enabled: number | null } | undefined;
  // 방을 확인하지 못하면 성인 ON으로 단정하지 않는다. 검사 쪽으로 넘긴다.
  if (!chat) return true;
  const user = db
    .prepare(
      `SELECT id, email, is_admin, account_kind, is_adult FROM users WHERE id=?`
    )
    .get(chat.user_id) as AdultAccessUser | undefined;
  const userAdultVerified = canAccessAdultContent(user);
  const roomAdultModeEnabled = resolveRoomAdultModeEnabled({
    persisted: chat.adult_handoff_enabled,
    userAdultVerified,
  });
  return shouldApplyAdultOffOutputGuard({
    enabled: true,
    effectiveAdultRp: resolveEffectiveAdultRp({
      userAdultVerified,
      roomAdultModeEnabled,
    }),
  });
}

/** 저장된 본문을 읽을 때 가드를 적용하는지. 가드 OFF와 성인 ON은 false다. */
export function adultOffReadGuardAppliesForChat(input: {
  user: AdultAccessUser | null | undefined;
  adultHandoffEnabled: unknown;
}): boolean {
  if (!isAdultOffOutputGuardEnabled()) return false;
  const userAdultVerified = canAccessAdultContent(input.user);
  const roomAdultModeEnabled = resolveRoomAdultModeEnabled({
    persisted: input.adultHandoffEnabled,
    userAdultVerified,
  });
  return shouldApplyAdultOffOutputGuard({
    enabled: true,
    effectiveAdultRp: resolveEffectiveAdultRp({
      userAdultVerified,
      roomAdultModeEnabled,
    }),
  });
}

/** 조회가 실패하면 검사 쪽으로 넘긴다. 가드가 꺼져 있으면 조회하지 않는다. */
export function adultOffVisibleSurfaceNeedsReview(chatId: number): boolean {
  try {
    return adultOffOutputGuardAppliesToChat(chatId);
  } catch (error) {
    console.error("[adult-off] visible-surface room lookup failed", (error as Error).message);
    return true;
  }
}

/**
 * 화면에 보일 보조 문자열을 기존 분류기로 검사한다.
 * 빈 텍스트는 호출하지 않는다. 하나라도 제한이거나 검사를 끝내지 못하면 그 결과를 전달하지 않는다.
 * 재시도하지 않는다. 호출 수와 지연은 반환 기록과 원장 행에 남는다.
 */
export async function reviewAdultOffVisibleSurface(input: {
  chatId: number;
  assistantMessageId: number;
  generationSequence: number;
  generationRequestId: string | null;
  stage: AdultOffCheckStage;
  texts: readonly string[];
}): Promise<{ deliver: boolean; record: AdultOffCheckRecord | null }> {
  const visible = input.texts.filter((text) => text.trim());
  if (!visible.length) return { deliver: true, record: null };
  if (!adultOffVisibleSurfaceNeedsReview(input.chatId)) return { deliver: true, record: null };
  const classify = createAdultOffClassifier({
    chatId: input.chatId,
    assistantMessageId: input.assistantMessageId,
    generationSequence: input.generationSequence,
    generationRequestId: input.generationRequestId,
  });
  const startedAt = Date.now();
  const decision = await evaluateAdultOffOutput(visible, classify);
  const record = summarizeAdultOffCheck(input.stage, decision, Date.now() - startedAt);
  console.info("[adult-off] visible surface", {
    chatId: input.chatId,
    messageId: input.assistantMessageId,
    stage: input.stage,
    status: record.status,
    classifierCalls: record.classifierCalls,
    checkMs: record.checkMs,
  });
  return { deliver: decision.status === "approved", record };
}
