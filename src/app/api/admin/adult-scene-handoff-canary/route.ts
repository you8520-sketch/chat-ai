import { requireAdminUser } from "@/lib/adminAuth";
import {
  canUseAdultSceneHandoffAdminCanary,
  resolveAdultSceneHandoffCanaryConfig,
} from "@/lib/adultSceneHandoffCanary";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return Response.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const chatId = Number.parseInt(
    new URL(request.url).searchParams.get("chatId") ?? "",
    10
  );
  const config = resolveAdultSceneHandoffCanaryConfig();
  if (
    !Number.isSafeInteger(chatId) ||
    !canUseAdultSceneHandoffAdminCanary({
      config,
      isAdmin: true,
      userId: admin.id,
      chatId,
    })
  ) {
    return Response.json({ error: "허용되지 않은 canary 채팅입니다." }, { status: 403 });
  }

  const rawRows = getDb()
    .prepare(`
      SELECT
        id, chat_id AS chatId, user_message_id AS userMessageId,
        assistant_message_id AS assistantMessageId, canary_stage AS canaryStage,
        detected_scene_mode_before AS detectedSceneModeBefore,
        detected_scene_mode_after AS detectedSceneModeAfter,
        selected_model AS selectedModel, selected_provider AS selectedProvider,
        routing_reason AS routingReason, fallback_attempted AS fallbackAttempted,
        fallback_reason AS fallbackReason, visible_characters AS visibleCharacters,
        finish_reason AS finishReason, assistant_rows_written AS assistantRowsWritten,
        point_charge_count AS pointChargeCount, charged_points AS chargedPoints,
        prompt_leak_detected AS promptLeakDetected,
        duplicate_stream_detected AS duplicateStreamDetected,
        total_latency_ms AS totalLatencyMs, created_at AS createdAt
      FROM adult_scene_handoff_canary_logs
      WHERE user_id=? AND chat_id=?
      ORDER BY id DESC
      LIMIT 20
    `)
    .all(admin.id, chatId) as Array<Record<string, unknown>>;
  const rows = rawRows.reverse().map((row) => ({
    ...row,
    fallbackAttempted: row.fallbackAttempted === 1,
    promptLeakDetected: row.promptLeakDetected === 1,
    duplicateStreamDetected: row.duplicateStreamDetected === 1,
  }));

  return Response.json({ chatId, rows });
}
