import type { BilingualDialoguePolicy } from "@/lib/bilingualDialoguePolicy";
import { isBilingualDialogueActive } from "@/lib/bilingualDialoguePolicy";
import type { CharacterGender } from "@/lib/characterGender";
import type { ResolvedStatusWindow } from "@/lib/statusWindow";
import { buildLengthInstruction } from "@/lib/responseLength";

export type LengthRuleContext = {
  targetInput?: number | null;
};

function normalizeLengthRuleContext(
  ctx?: LengthRuleContext | number | null
): { targetInput?: number | null } {
  if (typeof ctx === "number" || ctx == null) {
    return { targetInput: ctx ?? undefined };
  }
  return {
    targetInput: ctx.targetInput,
  };
}

const GENDER_EN: Record<CharacterGender, string> = {
  male: "male",
  female: "female",
  other: "other",
};

export type CoreMasterPromptInput = {
  charName: string;
  userName: string;
  charGender: CharacterGender;
  userGender: CharacterGender;
  nsfwEnabled: boolean;
  impersonationOn: boolean;
  /** 소설 모드 UI 토글 — 전면 co-narration */
  novelModeEnabled?: boolean;
  completedTurns: number;
  hasMindReading: boolean;
  allowsBeard: boolean;
  allowsBodyHair: boolean;
  party?: boolean;
  /** dialogue-format-directive tail 사용 시 core §8 축약 */
  tailFormatActive?: boolean;
  /** status-window 또는 ban 블록이 tail에 있으면 §6 예외 문구 제거 */
  statusWindowTailActive?: boolean;
  /** 일반 자동진행 턴 — length guard가 확장 BOUNDARY와 일치 */
  autoContinueTurn?: boolean;
};

function roleBoundaryLine(i: CoreMasterPromptInput): string {
  if (i.novelModeEnabled) {
    return `1. [ROLE] Novel mode ON. Co-narrate per [NO GODMODDING — NOVEL MODE] + [NOVEL MODE — USER PERSONA NARRATION RULES].`;
  }
  return `1. [ROLE] Lead as [A]. Obey [NO GODMODDING] and <TURN_HANDOFF_AND_PACING>.`;
}

function genderBlock(i: CoreMasterPromptInput): string {
  const lines = [
    `[GENDER LOCK] [A]=${GENDER_EN[i.charGender]}, [B]=${GENDER_EN[i.userGender]}. Fixed — honorifics/body/voice match gender.`,
  ];
  const sameSex =
    (i.charGender === "male" && i.userGender === "male") ||
    (i.charGender === "female" && i.userGender === "female");
  if (sameSex) {
    lines.push(`[SAME-SEX] NO het-marriage/pregnancy tropes (MPreg etc. only if lore says so).`);
  }
  lines.push(`[SPOUSE TERMS] husband/wife/dear ONLY if relationship established in lore.`);
  const hairBans: string[] = [];
  if (!i.allowsBeard || i.charGender === "female") hairBans.push("beard");
  if (!i.allowsBodyHair) hairBans.push("body hair");
  if (hairBans.length > 0) {
    lines.push(`[NO INVENT] Do NOT describe ${hairBans.join("/")} unless in setting.`);
  }
  return lines.join("\n");
}

function userInputNotationBlock(i: CoreMasterPromptInput): string {
  const parenRule = i.hasMindReading
    ? `( ) [ ] = NOT dialogue — auto observable action OR inner thought (mind-read ONLY per lore)`
    : `( ) [ ] = NOT dialogue — auto observable action OR inner thought (char CANNOT know thought)`;
  return `[USER INPUT] * * = user stage narration (지문, NOT dialogue) · ${parenRule} · narrative -다/-했다 = observable action · speech-style = dialogue · "…" = dialogue.`;
}

function nsfwBlock(i: CoreMasterPromptInput): string {
  if (i.nsfwEnabled) {
    return `[19+ NSFW] Adult verified — see [ADVANCED PROSE & NSFW GUIDELINES] § intimacy.`;
  }
  return `[SAFE] NO sexual/explicit content.`;
}

function buildFormatRhythmSection(i: CoreMasterPromptInput): string {
  const rhythm =
    'Obey [OUTPUT LANG] and [KOREAN_WEBNOVEL_STYLE]. Out-loud speech in "…" only. NO cinematic fragment lines.';
  if (i.tailFormatActive) {
    return `8. [FORMAT & RHYTHM] 3rd person Korean RP. Obey dialogue/format directives at prompt tail and [WRITING STYLE: 한국 웹소설 표준 포맷 및 호흡 통제]. ${rhythm}`;
  }
  return `8. [FORMAT & RHYTHM] 3rd person. ${rhythm}`;
}

/** Early-turn relationship pacing — restricts escalation speed, not narrative depth */
function buildEarlyTurnEscalationClause(completedTurns: number): string {
  return `[EARLY t=${completedTurns}] Relationship stays at early stage — no sudden intimacy, obsession, worship, or spouse-level closeness. This restricts EMOTIONAL ESCALATION SPEED only. [A] may still have rich internal monologue, environmental reaction, and scene depth — early stage means cautious PACING, not thin content.`;
}

/** Layer 1 — compact core master rules (English, token-optimized) */
export function buildCoreMasterPrompt(i: CoreMasterPromptInput): string {
  const early = i.completedTurns < 15;
  const escalation = early ? ` ${buildEarlyTurnEscalationClause(i.completedTurns)}` : "";

  const parts: string[] = [
    `[CORE RP] [A]=AI character · [B]=user character.`,
  ];

  parts.push(
    roleBoundaryLine(i),

    `2. [INTEGRITY] Keep personality/tone/world/authority every turn. Romance/sex scales with relationship + prior turns ONLY. NO instant submission/worship/fate/obsession/personality break.${escalation}`,

    `3. [SPEECH] [A] dialogue: see [USER PERSONA SPEECH] above.`,

    `4. [CONTINUITY] Continue location/emotion/context. NO copy prior turn/user input. NEW action/sense/dialogue only.`,

    `5. [PROSE] obey 해설형 서술 금지 (see [ADVANCED PROSE & NSFW GUIDELINES]).`,

    `6. [NO META] Output story ONLY. NO system tags/dev notes/checklist ("role immersion", "adult mode confirm", "character·relationship"). NO out-of-scene author/narrator introducing or planning the story — start in-scene.`,

    `7. [NO UI STATS] NO D-Day/affection numbers in prose.`,

    buildFormatRhythmSection(i),
    genderBlock(i),
    userInputNotationBlock(i),
    nsfwBlock(i),
  );

  if (i.party) {
    parts.push(`[PARTY] Multi-user room. Prefix "nickname:" identifies speaker.`);
  }

  return parts.join("\n\n");
}

export function buildCoreMasterEarlyTurnHint(completedTurns: number): string | null {
  if (completedTurns >= 15) return null;
  return buildEarlyTurnEscalationClause(completedTurns);
}

/** OpenRouter cache — exclude per-turn early hint from static block */
export function buildCoreMasterPromptForCache(i: CoreMasterPromptInput): string {
  return buildCoreMasterPrompt({ ...i, completedTurns: 99 });
}

export function buildCompactStatusWindowBlock(_resolved: ResolvedStatusWindow): string | null {
  return null;
}

export function buildCompactLengthRule(ctx?: LengthRuleContext | number | null): string {
  const { targetInput } = normalizeLengthRuleContext(ctx);
  return buildLengthInstruction(targetInput);
}

/** @deprecated style/length 분리 — style은 writingStylePreset, length는 buildLengthTargetPrompt */
export function buildOpenRouterLengthStructureRule(ctx?: LengthRuleContext | number | null): string {
  void ctx;
  return "";
}

export function buildOpenRouterOutputFormatBlock(bilingual?: BilingualDialoguePolicy): string {
  if (bilingual && isBilingualDialogueActive(bilingual)) {
    return `<OUTPUT_FORMAT>
Language: Narration 100% Korean web-novel prose (-다 style).
Dialogue: ${bilingual.primaryDisplay} in double quotes + Korean gloss in ( ) on every speech line (creator bilingual setting).
Exception: If the user explicitly requests HTML/UI via an [OOC] command, you MAY generate it using ONLY inline HTML (<div>, <span>). NEVER use <!DOCTYPE> or <html>.
</OUTPUT_FORMAT>`;
  }
  return `<OUTPUT_FORMAT>
Language: 100% Korean Web-novel prose.
Exception: If the user explicitly requests HTML/UI via an [OOC] command, you MAY generate it using ONLY inline HTML (<div>, <span>). NEVER use <!DOCTYPE> or <html>.
</OUTPUT_FORMAT>`;
}

/** @deprecated buildOpenRouterOutputFormatBlock() */
export const OPENROUTER_OUTPUT_FORMAT_BLOCK = buildOpenRouterOutputFormatBlock();

/** OpenRouter — 분량 중복 없음, prose 라벨 가드만 */
export function buildOpenRouterOpusCompactTail(bilingual?: BilingualDialoguePolicy): string {
  const proseLine =
    bilingual && isBilingualDialogueActive(bilingual)
      ? `[PROSE] In-scene Korean narration per <PROSE_STYLE_POLICY>; bilingual "…" (한국어) dialogue per creator setting.`
      : `[PROSE] In-scene Korean prose per <PROSE_STYLE_POLICY>.`;

  return `${buildOpenRouterOutputFormatBlock(bilingual)}

${proseLine}`;
}

/** @deprecated buildOpenRouterOpusCompactTail */
export function buildClaudeOpusNarrativeForcingTail(): string {
  return buildOpenRouterOpusCompactTail();
}

export const IDENTITY_PREAMBLE =
  "The following defines the USER's roleplay persona (the human player character — NOT the AI character you play). Obey [USER_PERSONA] for how the user character speaks and behaves when referenced.";

function buildIdentityPreamble(impersonationOn: boolean, _userName: string, novelMode = false): string {
  if (novelMode) {
    return `The following defines the USER's roleplay persona for novel mode co-narration. [USER_PERSONA] describes [B] — mirror per [NO GODMODDING — NOVEL MODE] and [NOVEL MODE — USER PERSONA NARRATION RULES].`;
  }
  if (impersonationOn) return IDENTITY_PREAMBLE;
  return `The following defines the USER's roleplay persona (NOT the AI character). [USER_PERSONA] describes [B] — involuntary physiological cues OK; voluntary dialogue/action/emotion forbidden per [NO GODMODDING].`;
}

export function buildIdentityAndRulesBlock(
  persona: string | null | undefined,
  mandatoryRules: string | null | undefined,
  opts?: { impersonationOn?: boolean; novelModeEnabled?: boolean; userName?: string }
): string | null {
  const personaText = persona?.trim() ?? "";
  const rulesText = mandatoryRules?.trim() ?? "";
  if (!personaText && !rulesText) return null;

  const parts: string[] = [
    buildIdentityPreamble(
      !!opts?.impersonationOn,
      opts?.userName ?? "",
      !!opts?.novelModeEnabled
    ),
  ];
  if (personaText) parts.push(`[USER_PERSONA]\n${personaText}`);
  if (rulesText) parts.push(`[MANDATORY_RULES]\n${rulesText}`);
  return `[IDENTITY_AND_RULES]\n\n${parts.join("\n\n")}`;
}

/** 유저 페르소나 말투 vs AI 캐릭터 Speech Lock 분리 (Flash 혼동 방지) */
export function buildUserPersonaSpeechGuard(
  _charName: string,
  _userName: string,
  _impersonationOn: boolean,
  _novelMode = false
): string {
  return `[USER PERSONA SPEECH — CRITICAL]
[B] = player's persona · [A] = AI character you play.
User-agency (dialogue/action/thought): see [NO GODMODDING].
When quoting or echoing the user's typed lines, preserve their endings exactly — NEVER upgrade 반말 → ~습니다/~요.
[A] dialogue register is separate from [B] — see [SPEECH PROFILE] when present.`;
}
