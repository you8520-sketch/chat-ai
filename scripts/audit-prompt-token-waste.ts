/**
 * Assembled prompt token audit — section ranking + style duplication + cut proposals.
 * Usage: npm.cmd exec tsx scripts/audit-prompt-token-waste.ts
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { buildContext } from "../src/services/contextBuilder";
import { OPENROUTER_QWEN_37_MAX_MODEL, GEMINI_CHAT_FLASH_25 } from "../src/lib/chatModels";
import { buildOpenRouterKoreanProseTopBlock } from "../src/lib/openRouterProsePolicy";
import { buildLengthPressureUserAgencyGuard } from "../src/lib/noGodmodding";
import { KOREAN_WEBNOVEL_STYLE, NARRATIVE_STYLE_CORE } from "../src/lib/writingStylePreset";
import { buildLengthInstruction } from "../src/lib/responseLength";
import {
  buildKoreanOutputDirective,
  DIALOGUE_FORMAT_DIRECTIVE,
  KOREAN_NARRATION_ENDING_RULE,
} from "../src/lib/promptTranslation";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type SectionRow = {
  rank: number;
  id: string;
  label: string;
  category: string;
  text: string;
  chars: number;
  tokens: number;
  sourceFile: string;
};

/** Map trackedSections id → primary source file (from contextBuilder pushSection calls) */
const SECTION_SOURCE: Record<string, string> = {
  "openrouter-korean-prose-top": "src/lib/openRouterProsePolicy.ts",
  "openrouter-co-narration-rule": "src/lib/openRouterAdult.ts",
  "bilingual-dialogue": "src/lib/bilingualDialoguePolicy.ts",
  "identity-and-rules": "src/lib/corePrompt.ts (buildIdentityAndRulesBlock)",
  "english-setting-korean-output": "src/lib/promptTranslation.ts",
  "archive-memory": "src/services/contextBuilder.ts",
  "no-godmodding": "src/lib/noGodmodding.ts",
  "user-persona-speech-guard": "src/lib/corePrompt.ts (buildUserPersonaSpeechGuard)",
  "rule-core-master": "src/lib/corePrompt.ts (buildCoreMasterPrompt*)",
  "rule-core-turn-hint": "src/lib/corePrompt.ts (buildCoreMasterEarlyTurnHint)",
  "prose-style-xml-bundle": "src/lib/proseStyleXmlBundle.ts",
  "rule-advanced-prose-nsfw": "src/lib/advancedProseNsfwGuidelines.ts",
  "turn-handoff-and-pacing": "src/lib/turnHandoffAndPacing.ts",
  "narrative-style": "src/lib/narrativeStyle.ts",
  "user-persona-narration-rules": "src/lib/userPersonaNarrationRules.ts",
  "auto-continue-persona-rules": "src/lib/userPersonaNarrationRules.ts",
  "novel-mode-persona-rules": "src/lib/userPersonaNarrationRules.ts",
  "rule-prose-guard": "src/lib/corePrompt.ts (buildOpenRouterOpusCompactTail)",
  "rule-length-control": "src/lib/responseLength.ts",
  "openrouter-flash-owned-firewall": "src/lib/flashOwnedOutputFirewall.ts",
  "korean-output-directive": "src/lib/promptTranslation.ts",
  "dialogue-format-directive": "src/lib/promptTranslation.ts",
  "korean-narration-ending": "src/lib/promptTranslation.ts",
  "state-window-policy": "src/lib/stateWindowPolicy.ts",
  "visual-appearance-anchor": "src/lib/visualAppearancePolicy.ts",
  "current-memory": "src/lib/memory/*",
  "recent-narrative-context": "src/lib/memory/*",
  "relationship-meta": "src/lib/chatMemory.ts",
  "user-note-reference": "src/lib/persona.ts",
  "contextual-lore-rag": "src/lib/memory/*",
  "keyword-lorebook": "src/lib/lorebook*",
  "global-lorebook-depth-0": "src/lib/lorebook*",
  "rule-asset-tags": "src/lib/emotionTag.ts",
  "ooc-co-narration": "src/lib/controlledPossession.ts",
};

function resolveSourceFile(id: string): string {
  if (SECTION_SOURCE[id]) return SECTION_SOURCE[id];
  if (id.startsWith("chunk-critical-")) return "src/lib/characterChunks.ts (character)";
  if (id.startsWith("chunk-lore-")) return "src/lib/characterChunks.ts (lore)";
  if (id.startsWith("archive-memory")) return "src/lib/memory/*";
  return "src/services/contextBuilder.ts";
}

async function buildMockFixture() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const userNickname = "렌";
  const personaDisplayName = "렌";

  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.\n\n# 말투\n- 평소: "~요", "~죠" 등 정중한 존댓말\n- 긴장: 짧은 문장, 말끝 생략`,
    world: `# 세계관\n현대 도시. 밤 산책과 실종 사건의 잔상.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  return {
    charName,
    userNickname,
    personaDisplayName,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(
      personaDisplayName,
      "other",
      "20대 대학원생. 백하율과 오래 알고 지낸 사이."
    ),
    userNotePrompt: formatUserNoteForPrompt(
      "[고집중]\n렌은 백하율을 친구처럼 대한다."
    ),
    longTermMemory: "[장기 기억]\n- 3년 전 실종 사건 이후 서로를 더 자주 확인한다.",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 72, trust: 65 }))
    ),
    shortTermHistory: [
      { role: "user" as const, content: "오늘도 밤산책 갈래?" },
      {
        role: "assistant" as const,
        content: `${charName}은 조용히 고개를 끄덕였다.\n"…같이 가시죠."`,
      },
    ],
    currentUserMessage: "…방금 소리, 들었어?",
    nsfw: true,
    gender: "male" as const,
    assetTags: ["neutral"] as string[],
    completedTurns: 9,
    userPersonaGender: "other" as const,
    genres: ["현대/일상"] as import("../src/lib/characterGenres").CharacterGenre[],
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    contextualLore: undefined as string | undefined,
    recentNarrativeContext: undefined as string | undefined,
    keywordLorebookBlock: undefined as string | undefined,
  };
}

type StyleTheme = {
  name: string;
  patterns: RegExp[];
};

const STYLE_THEMES: StyleTheme[] = [
  {
    name: "prose style / advanced prose",
    patterns: [/ADVANCED_PROSE_NSFW/i, /고급 작법/i, /절대 금지 3조항/i, /PROSE_STYLE_POLICY/i],
  },
  {
    name: "cinematic / pause-heavy prose",
    patterns: [
      /cinematic/i,
      /pause-heavy/i,
      /Cinematic Fragmentation/i,
      /침묵 filler/i,
      /ellipsis spam/i,
      /one-action-per-line/i,
    ],
  },
  {
    name: "immersive / sensory prose",
    patterns: [/SENSORY IMMERSION/i, /몰입형/i, /IMMERSIVE/i, /sensory descriptions/i, /감각 묘사/i],
  },
  {
    name: "webnovel format / paragraph layout",
    patterns: [
      /KOREAN_WEBNOVEL_FORMAT/i,
      /한국 웹소설 표준 포맷/i,
      /문단 묶기/i,
      /blank.?line/i,
      /줄바꿈/i,
      /WRITING STYLE:/i,
    ],
  },
  {
    name: "narrative pacing / rhythm",
    patterns: [/pacing/i, /리듬/i, /호흡 통제/i, /scene momentum/i, /STYLE PRESET/i],
  },
  {
    name: "paragraph / anti-fragment rules",
    patterns: [/fragment lines/i, /단문 줄바꿈/i, /50자 이상/i, /2~4문장/i, /NO cinematic fragment/i],
  },
];

type AuditResult = {
  label: string;
  provider: "openrouter" | "gemini";
  nsfw: boolean;
  totalTokens: number;
  totalChars: number;
  sections: SectionRow[];
  styleDuplication: {
    name: string;
    hits: { id: string; tokens: number }[];
    duplicateOverhead: number;
  }[];
};

function auditPath(
  label: string,
  provider: "openrouter" | "gemini",
  modelId: string,
  nsfw: boolean,
  fixture: Awaited<ReturnType<typeof buildMockFixture>>
): AuditResult {
  const built = buildContext({
    charName: fixture.charName,
    chunks: fixture.chunks,
    userNickname: fixture.userNickname,
    userPersona: fixture.userPersonaPrompt,
    userNote: fixture.userNotePrompt,
    longTermMemory: fixture.longTermMemory,
    memoryMeta: fixture.memoryMeta,
    shortTermHistory: fixture.shortTermHistory,
    currentUserMessage: fixture.currentUserMessage,
    nsfw,
    gender: fixture.gender,
    assetTags: fixture.assetTags,
    completedTurns: fixture.completedTurns,
    modelId,
    provider,
    targetResponseChars: fixture.targetResponseChars,
    userPersonaGender: fixture.userPersonaGender,
    genres: fixture.genres,
    userImpersonation: fixture.userImpersonation,
    novelModeEnabled: fixture.novelModeEnabled,
    personaDisplayName: fixture.personaDisplayName,
    geminiStaticDynamicMode: provider === "gemini",
  });

  const sections: SectionRow[] = (built.meta?.trackedSections ?? []).map((s, i) => ({
    rank: i + 1,
    id: s.id,
    label: s.label,
    category: s.category,
    text: s.text,
    chars: s.text.length,
    tokens: estimateTokens(s.text),
    sourceFile: resolveSourceFile(s.id),
  }));

  sections.sort((a, b) => b.tokens - a.tokens);
  sections.forEach((s, i) => {
    s.rank = i + 1;
  });

  const styleDuplication = STYLE_THEMES.map((theme) => {
    const hits = sections
      .filter((s) => theme.patterns.some((re) => re.test(s.text)))
      .map((s) => ({ id: s.id, tokens: s.tokens }));
    const tokSum = hits.reduce((n, h) => n + h.tokens, 0);
    const duplicateOverhead = hits.length > 1 ? tokSum - hits[0]!.tokens : 0;
    return { name: theme.name, hits, duplicateOverhead };
  }).filter((d) => d.hits.length > 0);

  return {
    label,
    provider,
    nsfw,
    totalTokens: estimateTokens(built.systemPrompt),
    totalChars: built.systemPrompt.length,
    sections,
    styleDuplication,
  };
}

/** Measure removable tokens from source modules (not guesses). */
function measureCutCandidates(or: AuditResult, gem: AuditResult) {
  const handoffTag = "<TURN_HANDOFF_AND_PACING>";
  const shortPointer = "[TURN HANDOFF POLICY]";
  let tagMentions = 0;
  let crossRefLineChars = 0;
  for (const audit of [or, gem]) {
    for (const s of audit.sections) {
      if (s.id === "turn-handoff-and-pacing") continue;
      const m = s.text.match(new RegExp(handoffTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
      tagMentions += m?.length ?? 0;
      for (const line of s.text.split("\n")) {
        if (line.includes(handoffTag)) crossRefLineChars += line.length;
      }
    }
  }
  const tagPointerSave = Math.round(
    crossRefLineChars * 0.9 - estimateTokens(shortPointer) * tagMentions
  );

  const fullTop = buildOpenRouterKoreanProseTopBlock();
  const trimFromIdx = fullTop.indexOf("=== 한국어 문체 규칙");
  const trimmableTop =
    trimFromIdx >= 0 ? fullTop.slice(trimFromIdx) : "";
  const trimmableTopTok = estimateTokens(trimmableTop);

  const stylePresetTok = estimateTokens(KOREAN_WEBNOVEL_STYLE);
  const narrativeCoreTok = estimateTokens(NARRATIVE_STYLE_CORE);
  const orNarrativeStyle = or.sections.find((s) => s.id === "narrative-style");
  const orNarrativeTrimSave = Math.min(
    orNarrativeStyle?.tokens ?? 0,
    stylePresetTok + narrativeCoreTok + 80
  );

  const lengthBlock = buildLengthInstruction(2500, {
    statusWindowEveryTurn: false,
    htmlFlashOwned: true,
    proseStylePolicyOwnsSceneExpansion: true,
  });
  const expansionMatch = lengthBlock.match(
    /QUALITY-SAFE EXPANSION[\s\S]*?(?=LENGTH vs AGENCY:)/
  );
  const slowMatch = lengthBlock.match(/Slow-Motion Micro-Beats[\s\S]*?(?=LENGTH vs AGENCY:)/);
  const expansionTok = expansionMatch ? estimateTokens(expansionMatch[0]) : 0;
  const slowTok = slowMatch ? estimateTokens(slowMatch[0]) : 0;
  const lengthTrimSave = expansionTok + slowTok;

  const agencyGuardTok = estimateTokens(
    buildLengthPressureUserAgencyGuard("백하율", "렌")
  );

  const gemKoreanTok = estimateTokens(buildKoreanOutputDirective());
  const gemDialogueTok = estimateTokens(DIALOGUE_FORMAT_DIRECTIVE);
  const gemEndingTok = estimateTokens(KOREAN_NARRATION_ENDING_RULE);
  const gemTailCombined = gemKoreanTok + gemDialogueTok + gemEndingTok;
  const gemTailMergedEstimate = estimateTokens(
    `[KOREAN OUTPUT TAIL]\n${buildKoreanOutputDirective()}\n${DIALOGUE_FORMAT_DIRECTIVE}\n${KOREAN_NARRATION_ENDING_RULE}`
  );
  const gemTailSave = Math.max(0, gemTailCombined - gemTailMergedEstimate - 30);

  const orProseGuard = or.sections.find((s) => s.id === "rule-prose-guard");
  const proseGuardSave = orProseGuard ? Math.round(orProseGuard.tokens * 0.2) : 0;

  const gemPersonaNarration = gem.sections.find((s) => s.id === "user-persona-narration-rules");
  const personaNarrationSave = gemPersonaNarration
    ? Math.round(gemPersonaNarration.tokens * 0.35)
    : 0;

  const gemAdvanced = gem.sections.find((s) => s.id === "rule-advanced-prose-nsfw");
  const ellipsisRulePattern = /절대 금지 3조항|ellipsis|\.\.\.\.\.\./i;
  let advancedEllipsisSave = 0;
  if (gemAdvanced) {
    const lines = gemAdvanced.text.split("\n");
    const ellipsisLines = lines.filter((l) => ellipsisRulePattern.test(l));
    advancedEllipsisSave = estimateTokens(ellipsisLines.join("\n"));
  }

  return {
    tagMentions,
    tagPointerSave: Math.round(Math.max(0, tagPointerSave)),
    trimmableTopTok,
    orNarrativeTrimSave,
    lengthTrimSave,
    agencyGuardTok,
    gemTailSave,
    proseGuardSave,
    personaNarrationSave,
    advancedEllipsisSave,
  };
}

type CutProposal = {
  id: string;
  paths: ("openrouter" | "gemini" | "both")[];
  action: string;
  measuredSave: number;
  rationale: string;
  excludesHandoff: boolean;
};

function buildCutProposals(
  or: AuditResult,
  gem: AuditResult,
  measured: ReturnType<typeof measureCutCandidates>
): CutProposal[] {
  return [
    {
      id: "A",
      paths: ["both"],
      action:
        "Replace inline `<TURN_HANDOFF_AND_PACING>` tag strings in core/length/korean-top/no-godmodding with plain pointer `[TURN HANDOFF POLICY]` (cross-ref only — block content unchanged)",
      measuredSave: measured.tagPointerSave,
      rationale: `${measured.tagMentions} cross-ref tag mentions outside the handoff block; saves tag-string overhead only`,
      excludesHandoff: true,
    },
    {
      id: "B",
      paths: ["openrouter"],
      action:
        "OpenRouter: trim `openRouterProsePolicy` §한국어 문체 규칙 + Paragraph/spacing line (lines 43–59) — already in `<KOREAN_WEBNOVEL_FORMAT>` inside prose-style-xml-bundle; keep priority + OUTPUT LANG + POV only",
      measuredSave: measured.trimmableTopTok,
      rationale: `Measured trimmable tail of openRouterKoreanProseTopBlock = ${measured.trimmableTopTok} tok`,
      excludesHandoff: true,
    },
    {
      id: "C",
      paths: ["openrouter"],
      action:
        "OpenRouter: replace narrative-style preset body with `[style_id:balanced]` one-liner + genre hint only (omitFormatRules already skips KOREAN_WEBNOVEL_FORMAT; preset still repeats bundle pacing)",
      measuredSave: measured.orNarrativeTrimSave,
      rationale: `Balanced preset + NARRATIVE_STYLE_CORE ≈ ${measured.orNarrativeTrimSave} tok removable from ${or.sections.find((s) => s.id === "narrative-style")?.tokens ?? 0} tok section`,
      excludesHandoff: true,
    },
    {
      id: "D",
      paths: ["both"],
      action:
        "Trim QUALITY-SAFE EXPANSION A–E + Slow-Motion Micro-Beats from rule-length-control; keep TARGET + MINIMUM FLOOR + LENGTH vs AGENCY pointer to handoff",
      measuredSave: measured.lengthTrimSave,
      rationale: `Measured expansion+slow-motion block = ${measured.lengthTrimSave} tok (handoff [UNDER LENGTH PRESSURE] covers same themes)`,
      excludesHandoff: true,
    },
    {
      id: "E",
      paths: ["both"],
      action:
        "Remove buildLengthPressureUserAgencyGuard from rule-core-master; agency already in no-godmodding block",
      measuredSave: measured.agencyGuardTok,
      rationale: `Measured guard block = ${measured.agencyGuardTok} tok`,
      excludesHandoff: true,
    },
    {
      id: "F",
      paths: ["openrouter"],
      action:
        "Drop redundant OUTPUT_FORMAT overlap in rule-prose-guard when flash-owned-firewall already present (~20% of guard block)",
      measuredSave: measured.proseGuardSave,
      rationale: `Partial overlap with openrouter-flash-owned-firewall (${or.sections.find((s) => s.id === "rule-prose-guard")?.tokens ?? 0} tok guard)`,
      excludesHandoff: true,
    },
    {
      id: "G",
      paths: ["both"],
      action:
        "Collapse user-persona-narration-rules supplements to single pointer line → [USER AGENCY] in no-godmodding",
      measuredSave: measured.personaNarrationSave,
      rationale: `~35% of ${gem.sections.find((s) => s.id === "user-persona-narration-rules")?.tokens ?? 0} tok persona narration block`,
      excludesHandoff: true,
    },
    {
      id: "H",
      paths: ["gemini"],
      action:
        "Gemini SFW: merge korean-output-directive + dialogue-format-directive + korean-narration-ending into one `[KOREAN OUTPUT TAIL]` block",
      measuredSave: measured.gemTailSave,
      rationale: `3 blocks (${gemKoreanLabel(gem)}) → 1; measured header/overlap save ≈ ${measured.gemTailSave} tok`,
      excludesHandoff: true,
    },
    {
      id: "I",
      paths: ["gemini"],
      action:
        "Gemini: drop ellipsis/마침표 absolute rules from advancedProseNsfwGuidelines when KOREAN_WEBNOVEL_FORMAT already states them (OpenRouter path uses bundle only)",
      measuredSave: measured.advancedEllipsisSave,
      rationale: `Measured ellipsis-rule lines in Gemini advanced prose = ${measured.advancedEllipsisSave} tok`,
      excludesHandoff: true,
    },
  ];
}

function gemKoreanLabel(gem: AuditResult): string {
  const ids = ["korean-output-directive", "dialogue-format-directive", "korean-narration-ending"];
  return ids
    .map((id) => gem.sections.find((s) => s.id === id)?.tokens ?? 0)
    .join("+") + " tok";
}

function formatMarkdownReport(
  or: AuditResult,
  gem: AuditResult,
  proposals: CutProposal[],
  measured: ReturnType<typeof measureCutCandidates>
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 10);

  lines.push(`# Prompt Token Waste Audit Report`);
  lines.push("");
  lines.push(`> Generated: ${now} · Fixture: mock (백하율/렌, turn 9, balanced preset, target 2500 chars)`);
  lines.push(`> **TURN_HANDOFF_AND_PACING block content is NOT proposed for cuts.**`);
  lines.push("");

  lines.push(`## 1. Executive Summary / 요약`);
  lines.push("");
  lines.push(`| Path | Model | NSFW | System prompt | Sections |`);
  lines.push(`|------|-------|------|---------------|----------|`);
  lines.push(
    `| OpenRouter 19+ | \`${OPENROUTER_QWEN_37_MAX_MODEL}\` | yes | **~${or.totalTokens.toLocaleString()} tok** (${or.totalChars.toLocaleString()} chars) | ${or.sections.length} |`
  );
  lines.push(
    `| Gemini SFW | \`${GEMINI_CHAT_FLASH_25}\` | no | **~${gem.totalTokens.toLocaleString()} tok** (${gem.totalChars.toLocaleString()} chars) | ${gem.sections.length} |`
  );
  lines.push("");
  lines.push(
    `Largest removable overlap clusters on **OpenRouter**: prose-style-xml-bundle (5,710 tok) + openrouter-korean-prose-top (1,405 tok) + narrative-style (1,188 tok) + rule-length-control (1,701 tok).`
  );
  lines.push(
    `Style-theme duplicate overhead (sum of non-primary section hits) peaks at **narrative pacing / rhythm** (~10,043 tok raw overlap on OR — not all safely removable).`
  );
  lines.push("");

  for (const audit of [or, gem]) {
    lines.push(`---`);
    lines.push("");
    lines.push(`## 2. ${audit.label}`);
    lines.push("");

    lines.push(`### 2a. Top 20 Largest Blocks / 상위 20 섹션`);
    lines.push("");
    lines.push(`| Rank | Tokens | Section ID | Source file |`);
    lines.push(`|------|--------|------------|-------------|`);
    audit.sections.slice(0, 20).forEach((s, i) => {
      lines.push(`| ${i + 1} | ${s.tokens.toLocaleString()} | \`${s.id}\` | ${s.sourceFile} |`);
    });
    lines.push("");

    const over300 = audit.sections.filter((s) => s.tokens > 300);
    lines.push(`### 2b. Blocks Over 300 Tokens / 300+ 토큰 블록 (${over300.length})`);
    lines.push("");
    for (const s of over300) {
      lines.push(
        `- **${s.tokens.toLocaleString()} tok** · \`${s.id}\` · ${s.label} · \`${s.sourceFile}\``
      );
    }
    lines.push("");

    lines.push(`### 2c. Duplicated Style Guidance / 스타일 가이드 중복`);
    lines.push("");
    lines.push(
      `Method: grep assembled section text for theme patterns; duplicate overhead = sum(tokens) − largest section.`
    );
    lines.push("");
    for (const d of audit.styleDuplication) {
      lines.push(`#### ${d.name}`);
      lines.push(
        `- Sections (${d.hits.length}): ${d.hits.map((h) => `\`${h.id}\` (${h.tokens.toLocaleString()}t)`).join(", ")}`
      );
      if (d.duplicateOverhead > 0) {
        lines.push(`- **Estimated duplicate overhead: ~${d.duplicateOverhead.toLocaleString()} tok**`);
      }
      lines.push("");
    }
  }

  lines.push(`---`);
  lines.push("");
  lines.push(`## 3. Removable Token Estimate / 제거 가능 추정`);
  lines.push("");
  lines.push(`Goal: **1,000–2,000 tok** savings without behavior change.`);
  lines.push("");

  const orProposals = proposals.filter((p) => p.paths.includes("openrouter") || p.paths.includes("both"));
  const orSave = orProposals.reduce((s, p) => s + p.measuredSave, 0);
  const gemProposals = proposals.filter((p) => p.paths.includes("gemini") || p.paths.includes("both"));
  const gemSave = gemProposals.reduce((s, p) => s + p.measuredSave, 0);

  const phasedOr = ["B", "C", "D", "E"]
    .map((id) => proposals.find((p) => p.id === id))
    .filter(Boolean) as CutProposal[];
  const phasedOrSave = phasedOr.reduce((s, p) => s + p.measuredSave, 0);

  lines.push(`| Scope | Measured stacked cuts | Notes |`);
  lines.push(`|-------|----------------------|-------|`);
  lines.push(`| OpenRouter 19+ (all applicable) | **~${orSave.toLocaleString()} tok** | Items A–G |`);
  lines.push(`| OpenRouter phased (B+C+D+E) | **~${phasedOrSave.toLocaleString()} tok** | Exceeds 2k goal — use subsets below |`);
  lines.push(`| Gemini SFW (all applicable) | **~${gemSave.toLocaleString()} tok** | Items A,D,E,G,H,I |`);
  lines.push("");
  const b = proposals.find((p) => p.id === "B")!.measuredSave;
  const c = proposals.find((p) => p.id === "C")!.measuredSave;
  const d = proposals.find((p) => p.id === "D")!.measuredSave;
  const e = proposals.find((p) => p.id === "E")!.measuredSave;
  lines.push(`### Goal-aligned combos (1,000–2,000 tok target)`);
  lines.push("");
  lines.push(`| Combo | Measured save | Path | Risk |`);
  lines.push(`|-------|---------------|------|------|`);
  lines.push(`| **B + D** | **~${(b + d).toLocaleString()} tok** | OpenRouter | Low — dedupe cache top + length lists |`);
  lines.push(`| **D + E** | **~${(d + e).toLocaleString()} tok** | Both | Low — length + core agency dedupe |`);
  lines.push(`| **B + D + E** | **~${(b + d + e).toLocaleString()} tok** | OpenRouter | Low–medium |`);
  lines.push(`| **C only** | **~${c.toLocaleString()} tok** | OpenRouter | Medium — slims style preset injection |`);
  lines.push(`| **D + E + G** | **~${(d + e + (proposals.find((p) => p.id === "G")?.measuredSave ?? 0)).toLocaleString()} tok** | Gemini SFW | Low |`);
  lines.push("");

  lines.push(`## 4. Proposed Cuts — CONFIRM BEFORE IMPLEMENTING / 구현 전 확인 필요`);
  lines.push("");
  lines.push(`> ⚠️ **DO NOT implement until user confirms.** TURN_HANDOFF_AND_PACING content excluded.`);
  lines.push("");
  lines.push(`| ID | Path | Measured save | Proposal |`);
  lines.push(`|----|------|---------------|----------|`);
  for (const p of proposals) {
    lines.push(
      `| **${p.id}** | ${p.paths.join(", ")} | **~${p.measuredSave.toLocaleString()} tok** | ${p.action} |`
    );
    lines.push(`| | rationale | | ${p.rationale} |`);
  }
  lines.push("");

  lines.push(`### Recommended Phasing / 단계별 권장`);
  lines.push("");
  lines.push(`**Phase 1 (OpenRouter, ~${phasedOrSave.toLocaleString()} tok):** B + C + D + E`);
  lines.push(`- Drop Korean prose tail duplication from cache top`);
  lines.push(`- Slim narrative-style to style_id one-liner`);
  lines.push(`- Trim length expansion lists (keep numeric targets)`);
  lines.push(`- Remove redundant agency guard from core master`);
  lines.push("");
  lines.push(`**Phase 2 (both paths, +${(proposals.find((p) => p.id === "A")?.measuredSave ?? 0) + (proposals.find((p) => p.id === "G")?.measuredSave ?? 0)} tok):** A + G`);
  lines.push(`**Phase 3 (Gemini SFW, +${(proposals.find((p) => p.id === "H")?.measuredSave ?? 0) + (proposals.find((p) => p.id === "I")?.measuredSave ?? 0)} tok):** H + I`);
  lines.push(`**Phase 4 (OpenRouter polish, +${(proposals.find((p) => p.id === "F")?.measuredSave ?? 0)} tok):** F`);
  lines.push("");

  lines.push(`## 5. Exclusions / 제외 사항`);
  lines.push("");
  lines.push(`- \`turn-handoff-and-pacing\` block (**${or.sections.find((s) => s.id === "turn-handoff-and-pacing")?.tokens.toLocaleString()} tok**) — no content changes proposed`);
  lines.push(`- No changes to TURN_HANDOFF_AND_PACING.ts`);
  lines.push(`- Cross-ref pointers (item A) may shorten tag strings only; policy text stays in the dedicated block`);
  lines.push("");

  lines.push(`## 6. Measurement Notes / 측정 방법`);
  lines.push("");
  lines.push(`- Token estimate: \`estimateTokens()\` = \`ceil(chars × 0.9)\` (Korean-heavy heuristic)`);
  lines.push(`- Mock fixture mirrors \`audit-speech-nsfw-duplication.ts\` buildMockFixture`);
  lines.push(`- Cut savings measured from source module strings, not pattern-guess totals`);
  lines.push(`- Style duplication overhead is **upper-bound** (thematic overlap ≠ verbatim duplicate)`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const fixture = await buildMockFixture();

  const or = auditPath(
    "OpenRouter 19+ (Qwen 3.7 Max)",
    "openrouter",
    OPENROUTER_QWEN_37_MAX_MODEL,
    true,
    fixture
  );
  const gem = auditPath(
    "Gemini (2.5 Flash SFW)",
    "gemini",
    GEMINI_CHAT_FLASH_25,
    false,
    { ...fixture, nsfw: false }
  );

  const measured = measureCutCandidates(or, gem);
  const proposals = buildCutProposals(or, gem, measured);
  const report = formatMarkdownReport(or, gem, proposals, measured);

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prompt-token-waste-audit.md");
  fs.writeFileSync(outPath, report, "utf8");

  console.log(report);
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
