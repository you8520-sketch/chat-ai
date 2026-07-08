import { isDeepSeekV4ProModel, isQwenModel } from "@/lib/chatModels";

const CONTAMINATION_LINE_PATTERNS: RegExp[] = [
  /SPEECH\s*(?:METADATA|LOCK|RULE|CONSISTENCY|ENFORCEMENT)/i,
  /GENERATION\s+METADATA/i,
  /NEVER\s+NARRATE/i,
  /register_by_context|default_register|style_notes|dialogue_examples/i,
  /speech_(?:style|tone|formality|profile|traits|examples|forbidden)/i,
  /말투\s*(?:고정|잠금|규칙|메타|설정)|상황별\s*말투|대사\s*예시/i,
  /(?:^|\b)[a-z][a-z0-9]+(?:_[a-z0-9]+){1,}(?:\b|$)/,
  /_TOUCH_|TOUCH_/i,
  /D-?DAY|디데이.*스포일러|spoiler/i,
  /hidden\s*(?:status|trigger|rule)|private\s*(?:status|trigger|rule)/i,
  /status\s*(?:value|threshold|condition)|trigger\s*(?:schema|evaluator|condition)/i,
  /fire_once|event_effect|source_turn|extracted_facts/i,
  /EPISODIC MEMORY|RETRIEVED FACTS|LONG_TERM_MEMORY|LOREBOOK/i,
  /이번 턴 장면 지시|권장 강도|전개 방향|정체 감지|유저 조종|비공개 장면|scene\s*engine/i,
  /recentStagnation|recommendedIntensity|progressionTypes|nextBeatHint|userControl/i,
  /auto_progression|no_user_control|limited_reactions|persona_based_dialogue_allowed/i,
  /snake_case/i,
];

const INTERNAL_BLOCK_PATTERNS: RegExp[] = [
  /<<<STATUS_VALUES>>>[\s\S]*?(?:<<<END_STATUS>>>|$)/gi,
  /\[EPISODIC MEMORY - RETRIEVED FACTS\][\s\S]*?(?=\n\n|\n\[|$)/gi,
  /\[SPEECH METADATA[^\]]*\][\s\S]*?(?=\n\n|\n\[|$)/gi,
  /\[PRIVATE SCENE ENGINE RULE\][\s\S]*?(?=\n\n|\n\[|$)/gi,
];

export const FALSE_SHARED_MEMORY_PHRASES = [
  "전에 말했잖아",
  "네가 말했잖아",
  "그때 네가",
  "우리 예전에",
  "네가 약속했잖아",
  "전에 네가 알려줬잖아",
];

function lineLooksContaminated(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return CONTAMINATION_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function normalizeBlankLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function findPossibleFalseSharedMemoryPhrases(text: string): string[] {
  return FALSE_SHARED_MEMORY_PHRASES.filter((phrase) => text.includes(phrase));
}

export function logPossibleFalseSharedMemory(text: string): string[] {
  const phrases = findPossibleFalseSharedMemoryPhrases(text);
  if (phrases.length > 0 && process.env.NODE_ENV !== "production") {
    console.warn("[FalseMemoryGuard] possible unsupported shared memory phrase detected", {
      phrases,
    });
  }
  return phrases;
}

export function sanitizeRuntimePromptSource(text: string | null | undefined): string {
  let out = (text ?? "").trim();
  if (!out) return "";

  for (const pattern of INTERNAL_BLOCK_PATTERNS) {
    out = out.replace(pattern, "");
  }

  return normalizeBlankLines(
    out
      .split("\n")
      .filter((line) => !lineLooksContaminated(line))
      .join("\n")
  );
}

export function stripRuntimePromptContaminationFromVisibleOutput(text: string): string {
  logPossibleFalseSharedMemory(text);
  let out = text;
  for (const pattern of INTERNAL_BLOCK_PATTERNS) {
    out = out.replace(pattern, "");
  }

  return normalizeBlankLines(
    out
      .split("\n")
      .filter((line) => !lineLooksContaminated(line))
      .join("\n")
  );
}

export function buildRuntimePromptContaminationGuardBlock(modelId?: string): string {
  const id = modelId ?? "";
  const needsReinforcement =
    isQwenModel(id) || isDeepSeekV4ProModel(id) || id.toLowerCase().includes("deepseek");
  const modelReinforcement = needsReinforcement
    ? [
        "",
        "Qwen/DeepSeek 보강: 내부 규칙, snake_case, 상태/기억/트리거 형식은 절대 본문이 아니다.",
      ].join("\n")
    : "";

  return `[RUNTIME PROMPT CONTAMINATION GUARD - PRIVATE]
비공개 통제문과 시스템 블록을 본문에 언급하지 마라.
- 말투/레지스터 규칙은 자연스러운 대사 문체로만 반영하고, 말투 규칙명이나 speech_style 같은 내부명을 말하지 않는다.
- 상태창 키, 숨은 트리거, D-DAY 결과, 미래 스포일러, _TOUCH_, fire_once, event_effect를 본문에 노출하지 않는다.
- 장기기억/에피소드기억/로어북은 조용히 참고하고, 헤더, source_turn, extracted_facts, category/subject/attribute/value, runtime_events를 출력하지 않는다.
- snake_case, JSON, 프롬프트 섹션명, 구현 메타데이터 없이 자연스러운 한국어 RP 본문만 쓴다.${modelReinforcement}`;
}
