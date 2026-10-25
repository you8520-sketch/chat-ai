/**
 * Phase G8 — Gemini compact living-scene contract (experiment-only).
 *
 * Production default: OFF. Not imported by chat routes / contextBuilder.
 * Harness may REPLACE the creative-owner family for Gemini 3.1 Pro Arm B.
 *
 * DeepSeek / Opus / Terra: untouched (BYTE_IDENTICAL production path).
 * CANON / PERSONA / MEMORY / LTM / hygiene / POV / speech metadata: preserved.
 * LENGTH OWNER: BYTE_IDENTICAL.
 */

import { COLLABORATIVE_INTERACTIVE_OWNER_BLOCK } from "@/lib/noGodmodding";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import {
  WEBNOVEL_OUTPUT_FORMAT_BLOCK,
  buildWebnovelOutputLayoutRecencyBlock,
} from "@/lib/webnovelOutputFormat";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { CURRENT_USER_INPUT_HEADER } from "@/lib/currentUserInputLabel";
import { isGemini31ProModel } from "@/lib/chatModels";

export type GeminiLivingSceneArm = "A" | "B";

/**
 * Compact coherent creative contract — one SoT for agency + living scene +
 * narration/dialogue form. No stacked DO NOT / NEVER quota lists.
 */
export const GEMINI_LIVING_SCENE_CONTRACT = `[GEMINI RP — LIVING SCENE]
AI는 [A]와 AI 담당 NPC·환경·세계의 움직임을 연기한다. [B]는 사용자 페르소나이며 장면의 공동 주연이다.

현재 입력과 최근 기록은 이미 성립한 현재 상태다. 그 상태가 만든 반응과 결과에서 자연스럽게 이어간다. 정본과 기억은 현재 인물의 판단·행동·관계·환경 변화에 활용한다.

[B]의 새로운 직접 대사와 중요한 선택·동의·거절, 관계·목표·정체성을 바꾸는 결정은 사용자에게 남긴다. 현재 입력과 정본에 맞는 짧고 되돌릴 수 있는 표정·시선·비자발적 반응, 이미 시작한 행동의 마무리, 사소한 이동·접촉·물건 수취·일상 행동은 장면의 자연스러운 연속성을 위해 공동서술할 수 있다.

[A]와 NPC·환경은 사용자의 다음 입력을 기다리며 정지하지 않는다. 현재 인과에 맞게 스스로 행동하고 반응한다. 필요하면 주변 인물, 환경 변화, 새로운 정보, 가까운 공간의 이동이나 짧은 시간의 진행이 현재 장면에서 자연스럽게 발생할 수 있다. 중대한 사용자 선택이 필요한 지점에서는 결과를 대신 결정하지 않고 반응할 여지를 남긴다.

장면의 중심은 현재 인물의 체험이다. 감각·생각·판단·행동·환경·관계·결과 중 그 순간에 의미 있는 것들을 자연스럽게 연결하여 각 문단이 다음 상태를 만든다. 정본은 설명 자료처럼 나열하기보다 인물이 무엇을 알아차리고 판단하고 행동하는지의 원인으로 살아난다. 대사는 필요할 때 캐릭터답게 쓰고, 존재감은 행동·내면·시선·침묵·환경 반응으로도 이어진다.

자연스러운 한국 웹소설 지문은 -다/-했다체다. 지문은 의미 단락으로 연결하고, 실제 발화는 화자별 독립 문단에 둔다. 본문에는 RP 메타나 내부 상태 형식을 드러내지 않는다.`;

/** Data-boundary wrapper only — agency SoT lives in LIVING SCENE CONTRACT. */
export const G8_CURRENT_USER_WRAPPER_V2 = `[CURRENT USER INPUT — COMPLETED CUE]
The following is the user's latest completed cue for this turn. Treat it as already-occurred starting state for the next beat of the scene.`;

export const G8_TERMINAL_LAYOUT_LINE =
  `레이아웃: 지문과 "…" 대사 사이 빈 줄(\\n\\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.`;

const OUTPUT_LAYOUT_BLOCK = buildWebnovelOutputLayoutRecencyBlock();

/** Production creative bundle that Arm B consolidates into the living-scene contract. */
export function g8CreativeBlocksToReplace(): string[] {
  return [
    COLLABORATIVE_INTERACTIVE_OWNER_BLOCK,
    WEBNOVEL_OUTPUT_FORMAT_BLOCK,
    PROSE_STYLE_SECTION,
    OUTPUT_LAYOUT_BLOCK,
  ];
}

export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.round(chars / 2));
}

export function countNegativeClauses(text: string): {
  surface_hits: number;
  semantic_prohibition_clauses: number;
  samples: string[];
} {
  const surfaceRe =
    /하지\s*않는다|금지|절대|never|do\s*not|don't|must\s*not|forbidden|말\s*것|쓰지\s*않는다|드러내지\s*않는다/gi;
  const surface = text.match(surfaceRe) ?? [];
  // Approximate semantic clauses: sentence-like units containing a prohibition marker.
  const sentences = text.split(/(?<=[.。!！?？\n])/);
  const semantic = sentences.filter((s) =>
    /하지\s*않는다|금지|절대|never|do\s*not|don't|must\s*not|forbidden|말\s*것|쓰지\s*않는다/i.test(
      s
    )
  );
  return {
    surface_hits: surface.length,
    semantic_prohibition_clauses: semantic.length,
    samples: semantic.slice(0, 12).map((s) => s.trim().slice(0, 120)),
  };
}

function extractCurrentUserBody(lastUser: string): string {
  let body = lastUser.trim();
  // Strip known wrappers
  if (body.startsWith(CURRENT_USER_INPUT_HEADER)) {
    const lines = body.split("\n");
    // Find first content line after wrapper prose — labeled user parts start with [유저
    const idx = lines.findIndex((l) => /^\[유저/.test(l) || /^\[USER/i.test(l));
    if (idx >= 0) {
      body = lines.slice(idx).join("\n");
    } else {
      // fallback: drop first 5 wrapper lines of legacy template
      body = lines.slice(5).join("\n");
    }
  }
  if (body.startsWith("[CURRENT USER INPUT — COMPLETED CUE]")) {
    const lines = body.split("\n");
    const idx = lines.findIndex((l) => /^\[유저/.test(l) || /^\[USER/i.test(l));
    body = idx >= 0 ? lines.slice(idx).join("\n") : lines.slice(2).join("\n");
  }
  // Strip terminal layout + length owner for re-append
  body = body
    .split(G8_TERMINAL_LAYOUT_LINE)
    .join("")
    .split(USER_TAIL_LENGTH_OWNER_SENTENCE)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body;
}

export function applyG8LivingSceneArmToMessages(input: {
  messages: Array<{ role: string; content: string }>;
  modelId: string;
  arm: GeminiLivingSceneArm;
}): {
  messages: Array<{ role: string; content: string }>;
  applied: boolean;
  removedBlocks: string[];
  insertedContract: boolean;
  wrapperRewritten: boolean;
  lengthOwnerPreserved: boolean;
  systemText: string;
} {
  if (input.arm !== "B" || !isGemini31ProModel(input.modelId)) {
    const systemText =
      input.messages.find((m) => m.role === "system")?.content ?? "";
    return {
      messages: input.messages,
      applied: false,
      removedBlocks: [],
      insertedContract: false,
      wrapperRewritten: false,
      lengthOwnerPreserved: systemText.includes(USER_TAIL_LENGTH_OWNER_SENTENCE)
        ? false
        : true,
      systemText,
    };
  }

  const removedBlocks: string[] = [];
  let systemText =
    input.messages.find((m) => m.role === "system")?.content ?? "";

  for (const block of g8CreativeBlocksToReplace()) {
    if (systemText.includes(block)) {
      systemText = systemText.split(block).join("");
      removedBlocks.push(block.slice(0, 48));
    }
  }
  systemText = systemText.replace(/\n{3,}/g, "\n\n").trim();

  let insertedContract = false;
  if (!systemText.includes("[GEMINI RP — LIVING SCENE]")) {
    // Place after OUTPUT LANG / knowledge preface when present; else prepend.
    if (systemText.includes("[OUTPUT LANG]")) {
      systemText = systemText.replace(
        /(\[OUTPUT LANG\][^\n]*(?:\n(?!\[)[^\n]*)*)/,
        `$1\n\n${GEMINI_LIVING_SCENE_CONTRACT}`
      );
    } else {
      systemText = `${GEMINI_LIVING_SCENE_CONTRACT}\n\n${systemText}`;
    }
    insertedContract = true;
  }

  // Rewrite last user turn: V2 wrapper + body + length owner (no terminal layout).
  let wrapperRewritten = false;
  let lengthOwnerPreserved = false;
  const messages = input.messages.map((m, i) => {
    if (m.role !== "system") return m;
    return { ...m, content: systemText };
  });

  // Find last user message index
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx >= 0) {
    const prev = messages[lastUserIdx]!.content;
    const hadLength = prev.includes(USER_TAIL_LENGTH_OWNER_SENTENCE);
    const body = extractCurrentUserBody(prev);
    const next = [
      G8_CURRENT_USER_WRAPPER_V2,
      "",
      body,
      "",
      USER_TAIL_LENGTH_OWNER_SENTENCE,
    ].join("\n");
    messages[lastUserIdx] = { role: "user", content: next };
    wrapperRewritten = true;
    lengthOwnerPreserved = hadLength && next.includes(USER_TAIL_LENGTH_OWNER_SENTENCE);
  }

  return {
    messages,
    applied: removedBlocks.length > 0 && insertedContract && wrapperRewritten,
    removedBlocks,
    insertedContract,
    wrapperRewritten,
    lengthOwnerPreserved,
    systemText,
  };
}

/** Scene-capacity channel taxonomy for offline audit (evaluator/docs only). */
export const G8_SCENE_CHANNELS = [
  "AI character action",
  "AI character perception",
  "AI character inner judgment",
  "relevant memory/association",
  "relationship movement",
  "environment reaction",
  "NPC autonomous action",
  "new immediate information",
  "local world event",
  "short spatial progression",
  "short temporal progression",
  "minor user co-narration",
] as const;

export type G8SceneChannelStatus =
  | "EXPLICITLY_ALLOWED"
  | "IMPLICIT"
  | "CONSTRAINED"
  | "ABSENT";

export const G8_PRODUCTION_SCENE_CHANNEL_MAP: Record<
  (typeof G8_SCENE_CHANNELS)[number],
  G8SceneChannelStatus
> = {
  "AI character action": "EXPLICITLY_ALLOWED",
  "AI character perception": "IMPLICIT",
  "AI character inner judgment": "IMPLICIT",
  "relevant memory/association": "IMPLICIT",
  "relationship movement": "IMPLICIT",
  "environment reaction": "IMPLICIT",
  "NPC autonomous action": "CONSTRAINED",
  "new immediate information": "CONSTRAINED",
  "local world event": "CONSTRAINED",
  "short spatial progression": "CONSTRAINED",
  "short temporal progression": "CONSTRAINED",
  "minor user co-narration": "EXPLICITLY_ALLOWED",
};

export const G8_CANDIDATE_SCENE_CHANNEL_MAP: Record<
  (typeof G8_SCENE_CHANNELS)[number],
  G8SceneChannelStatus
> = {
  "AI character action": "EXPLICITLY_ALLOWED",
  "AI character perception": "EXPLICITLY_ALLOWED",
  "AI character inner judgment": "EXPLICITLY_ALLOWED",
  "relevant memory/association": "EXPLICITLY_ALLOWED",
  "relationship movement": "EXPLICITLY_ALLOWED",
  "environment reaction": "EXPLICITLY_ALLOWED",
  "NPC autonomous action": "EXPLICITLY_ALLOWED",
  "new immediate information": "EXPLICITLY_ALLOWED",
  "local world event": "EXPLICITLY_ALLOWED",
  "short spatial progression": "EXPLICITLY_ALLOWED",
  "short temporal progression": "EXPLICITLY_ALLOWED",
  "minor user co-narration": "EXPLICITLY_ALLOWED",
};
