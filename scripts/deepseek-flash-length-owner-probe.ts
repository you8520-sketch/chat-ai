/**
 * Probe DeepSeek Flash vs Pro length owner path in assembled prompt (local buildContext).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildContext } from "../src/services/contextBuilder";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "../src/lib/responseLength";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "../src/lib/chatModels";
import {
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  DEEPSEEK_SHORT_USER_TURN_BLOCK,
  DEEPSEEK_BOTTOM_REMINDER,
} from "../src/lib/deepseekPromptStructure";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";

const OUT =
  process.env.OUT_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/00-integrity";

const TURN1_USER =
  "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)";

const GREETING_SNIPPET =
  "가을 햇살이 로비의 통유리창을 길게 가로질렀다";

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

function analyzeUserTurn(userTurn: string) {
  const ownerCount = countOccurrences(userTurn, USER_TAIL_LENGTH_OWNER_SENTENCE);
  const targetLengthCount = (userTurn.match(/TARGET_LENGTH/gi) ?? []).length;
  const minFloorCount = (userTurn.match(/MINIMUM_FLOOR/gi) ?? []).length;
  const numeric3200Count = (userTurn.match(/3,200~4,200/g) ?? []).length;
  const layoutMarker = "지문과 \"…\" 대사 사이 빈 줄";
  const layoutIdx = userTurn.indexOf(layoutMarker);
  const ownerIdx = userTurn.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
  return {
    user_turn_chars: userTurn.length,
    owner_count: ownerCount,
    owner_is_absolute_tail: userTurn.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE.trim()),
    owner_index: ownerIdx,
    layout_index: layoutIdx,
    order_layout_before_owner: layoutIdx >= 0 && ownerIdx >= 0 && layoutIdx < ownerIdx,
    target_length_count: targetLengthCount,
    minimum_floor_count: minFloorCount,
    numeric_3200_4200_count: numeric3200Count,
    has_short_history_extra: userTurn.includes(DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA.slice(0, 20)),
    has_short_user_extra: userTurn.includes(DEEPSEEK_SHORT_USER_TURN_BLOCK.slice(0, 20)),
    has_bottom_reminder: userTurn.includes(DEEPSEEK_BOTTOM_REMINDER.slice(0, 30)),
    trailing_500: userTurn.slice(-500),
  };
}

function buildProbe(modelId: string) {
  const built = buildContext({
    charName: "라이크",
    contentKind: "character",
    chunks: [],
    systemPrompt: "",
    world: "",
    exampleDialog: "",
    characterPersonality: "",
    userNickname: "axis_24858",
    userPersona: "[B] 렌",
    shortTermHistory: [
      { role: "user", content: "[채팅 시작]" },
      { role: "assistant", content: `${GREETING_SNIPPET}… "이름이 뭐였더라?"` },
    ],
    currentUserMessage: TURN1_USER,
    nsfw: false,
    gender: "male",
    modelId,
    provider: "openrouter",
    targetResponseChars: 3500,
    completedTurns: 1,
    userId: 34,
    chatId: 1,
  });

  const lastUser = [...(built.history ?? [])].reverse().find((m) => m.role === "user");
  const userTurn = lastUser?.content ?? "";
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId,
    targetResponseChars: 3500,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: "라이크",
      personaName: "렌",
    },
  });

  return {
    modelId,
    user_turn_analysis: analyzeUserTurn(userTurn),
    wire: {
      max_tokens: wire.requestBody.max_tokens ?? null,
      temperature: wire.requestBody.temperature ?? null,
      top_p: wire.requestBody.top_p ?? null,
      reasoning_effort: wire.requestBody.reasoning_effort ?? null,
    },
    user_turn_redacted: userTurn.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]"),
  };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const flash = buildProbe(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL);
  const pro = buildProbe(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);

  const comparison = {
    generated_at: new Date().toISOString(),
    flash,
    pro,
    comparison_table: {
      flash: {
        user_tail_length_owner: flash.user_turn_analysis.owner_count === 1 ? "USER_TAIL_LENGTH_OWNER_SENTENCE x1" : `count=${flash.user_turn_analysis.owner_count}`,
        target_chars: "3,200~4,200 (via owner sentence)",
        min_chars: "embedded in owner (no MINIMUM_FLOOR token)",
        max_tokens: flash.wire.max_tokens,
        temperature: flash.wire.temperature,
        top_p: flash.wire.top_p,
        provider: "cheaperinference",
        style_block: "common OPENROUTER (not Pro Korean block)",
        short_user_turn: flash.user_turn_analysis.has_short_user_extra,
        short_history_extra: flash.user_turn_analysis.has_short_history_extra,
        bottom_reminder: flash.user_turn_analysis.has_bottom_reminder,
        terminal_recency: flash.user_turn_analysis.order_layout_before_owner,
      },
      pro: {
        user_tail_length_owner: pro.user_turn_analysis.owner_count === 1 ? "USER_TAIL_LENGTH_OWNER_SENTENCE x1 (after bottom reminder prefix)" : `count=${pro.user_turn_analysis.owner_count}`,
        target_chars: "3,200~4,200 + TARGET_LENGTH in bottom reminder",
        min_chars: "MINIMUM_FLOOR in bottom reminder",
        max_tokens: pro.wire.max_tokens,
        temperature: pro.wire.temperature,
        top_p: pro.wire.top_p,
        provider: "cheaperinference",
        style_block: "DEEPSEEK_V4_PRO_KOREAN_STYLE_BLOCK (XML mode)",
        short_user_turn: pro.user_turn_analysis.has_short_user_extra,
        short_history_extra: pro.user_turn_analysis.has_short_history_extra,
        bottom_reminder: pro.user_turn_analysis.has_bottom_reminder,
        terminal_recency: pro.user_turn_analysis.order_layout_before_owner,
      },
    },
    length_diagnosis_hint:
      flash.user_turn_analysis.owner_count === 1 &&
      !flash.user_turn_analysis.has_short_user_extra &&
      !flash.user_turn_analysis.has_short_history_extra
        ? "FLASH_EARLY_STOP_DESPITE_OWNER — owner present but Pro length-only short-input/history extras absent on Flash"
        : flash.user_turn_analysis.owner_count === 0
          ? "FLASH_LENGTH_OWNER_MISSING"
          : "review manually",
  };

  writeFileSync(join(OUT, "FLASH_LENGTH_OWNER_PROBE.json"), JSON.stringify(comparison, null, 2), "utf8");
  writeFileSync(
    join(OUT, "prompt-redacted-flash-user-turn.txt"),
    flash.user_turn_redacted,
    "utf8"
  );
  writeFileSync(
    join(OUT, "prompt-redacted-pro-user-turn.txt"),
    pro.user_turn_redacted,
    "utf8"
  );
  console.log(JSON.stringify(comparison, null, 2));
}

main();
