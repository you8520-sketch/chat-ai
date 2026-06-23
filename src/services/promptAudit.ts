import { estimateTokens } from "@/lib/ai";
import type { ChatMsg } from "@/lib/ai";
import type { CharacterChunk } from "@/types";
import {
  DEEPSEEK_BOTTOM_REMINDER,
  DEEPSEEK_XML_TAGS,
  formatDeepSeekChatHistoryBlock,
} from "@/lib/deepseekPromptStructure";

export type PromptSectionCategory =
  | "systemRules"
  | "characterSetting"
  | "worldLore"
  | "memory"
  | "persona"
  | "userNote"
  | "dialogueExamples"
  | "recentConversation";

export type TrackedPromptSection = {
  id: string;
  label: string;
  category: PromptSectionCategory;
  text: string;
};

export type PromptDuplicateHit = {
  label: string;
  sectionIds: string[];
  estimatedWastedTokens: number;
  snippet: string;
};

export type PromptAuditBreakdown = {
  systemRules: number;
  characterSetting: number;
  worldLore: number;
  memory: number;
  persona: number;
  userNote: number;
  dialogueExamples: number;
  recentConversation: number;
};

export type PromptAuditResult = {
  breakdown: PromptAuditBreakdown;
  systemPromptTokens: number;
  historyTokens: number;
  currentUserTurnTokens: number;
  totalAssembledTokens: number;
  totalChars: number;
  sectionCount: number;
  duplicates: PromptDuplicateHit[];
  inefficiencies: string[];
  sections: { id: string; label: string; category: PromptSectionCategory; tokens: number }[];
  deepSeekStructure?: {
    taggedSections: { PERSONA: boolean; WORLD_LORE: boolean; LONG_TERM_MEMORY: boolean };
    chatHistoryTagged: boolean;
    bottomReminderBeforeCurrentTurn: boolean;
  };
};

const DUPLICATE_SIGNATURES: { label: string; patterns: RegExp[]; minLen?: number }[] = [
  {
    label: "ANTI_ECHO_SYSTEM_RULE (반복·에코 금지)",
    patterns: [/반복·에코 출력 절대 금지/i, /NEVER echo or repeat/i, /복붙 금지.*직전 턴/i],
  },
  {
    label: "Gender rules (성별·호칭 규칙)",
    patterns: [/성별.*최종 확인/i, /GENDER.*ENFORCEMENT/i, /캐릭터 성별/i, /유저 페르소나 성별/i],
  },
  {
    label: "Speech Lock (말투 잠금)",
    patterns: [/Speech Lock/i, /말투 잠금/i, /금지\s*말투/i, /SPEECH.*ENFORCEMENT/i],
  },
  {
    label: "Response length (출력 분량)",
    patterns: [
      /\[LENGTH CONTROL(?: & SCENE EXPANSION)?\]/i,
      /\[LENGTH MODE:/i,
      /\[TARGET LENGTH\]/i,
      /\[CRITICAL COMPLETION RULE\]/i,
    ],
  },
  {
    label: "Relationship pacing (관계 속도)",
    patterns: [/관계·감정 발전 속도/i, /SLOW BURN/i, /초반 대화.*관계 제한/i, /LORE RELATIONSHIP/i],
  },
  {
    label: "Status window (상태창)",
    patterns: [/STATUS WINDOW/i, /상태창/i, /GRACEFUL CLOSING/i],
  },
  {
    label: "Narrative style layer (서술 스타일)",
    patterns: [/SENSORY IMMERSION/i, /NARRATIVE STYLE/i, /감각 몰입/i, /ANTI.?MELODRAMA/i],
  },
  {
    label: "User impersonation (유저 사칭·조종)",
    patterns: [/유저\s*조종|Controlled Possession|user impersonation|3인칭 소설/i],
  },
  {
    label: "Korean language enforcement (한국어 강제)",
    patterns: [/CRITICAL LANGUAGE REQUIREMENT/i, /100%.*한국어/i, /KOREAN NOVEL FORMAT/i],
  },
];

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function findLongSharedSubstrings(a: string, b: string, minLen = 80): string[] {
  const hits: string[] = [];
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return hits;

  for (let len = Math.min(200, na.length, nb.length); len >= minLen; len -= 10) {
    for (let i = 0; i <= na.length - len; i++) {
      const sub = na.slice(i, i + len);
      if (nb.includes(sub)) {
        hits.push(sub.slice(0, 120));
        return hits;
      }
    }
  }
  return hits;
}

export function isDialogueExampleChunk(chunk: CharacterChunk): boolean {
  if (chunk.category !== "speech") return false;
  return (
    /\[예시\s*대화\]/i.test(chunk.content) ||
    /(?:^|\n)\s*(?:유저|User)\s*:/im.test(chunk.content) ||
    /(?:^|\n)\s*(?:캐릭터|Character)\s*:/im.test(chunk.content)
  );
}

export function chunkPromptCategory(chunk: CharacterChunk): "characterSetting" | "worldLore" | "dialogueExamples" {
  if (chunk.category === "world") return "worldLore";
  if (isDialogueExampleChunk(chunk)) return "dialogueExamples";
  return "characterSetting";
}

function sumCategory(sections: TrackedPromptSection[], category: PromptSectionCategory): number {
  return sections
    .filter((s) => s.category === category)
    .reduce((n, s) => n + estimateTokens(s.text), 0);
}

function detectSignatureDuplicates(sections: TrackedPromptSection[]): PromptDuplicateHit[] {
  const hits: PromptDuplicateHit[] = [];

  for (const sig of DUPLICATE_SIGNATURES) {
    const matched = sections.filter((s) => sig.patterns.some((re) => re.test(s.text)));
    if (matched.length < 2) continue;

    const tokens = matched.reduce((n, s) => n + estimateTokens(s.text), 0);
    const wasted = Math.max(0, tokens - estimateTokens(matched[0]?.text ?? ""));
    hits.push({
      label: sig.label,
      sectionIds: matched.map((m) => m.id),
      estimatedWastedTokens: wasted,
      snippet: matched[0]?.text.slice(0, 100).replace(/\s+/g, " ") + "…",
    });
  }

  return hits.sort((a, b) => b.estimatedWastedTokens - a.estimatedWastedTokens);
}

function detectContentDuplicates(sections: TrackedPromptSection[]): PromptDuplicateHit[] {
  const hits: PromptDuplicateHit[] = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const shared = findLongSharedSubstrings(sections[i].text, sections[j].text);
      if (shared.length === 0) continue;
      const wasted = Math.min(estimateTokens(sections[i].text), estimateTokens(sections[j].text));
      hits.push({
        label: `Shared content: ${sections[i].label} ↔ ${sections[j].label}`,
        sectionIds: [sections[i].id, sections[j].id],
        estimatedWastedTokens: wasted,
        snippet: shared[0] + "…",
      });
    }
  }
  return hits.slice(0, 8);
}

function buildInefficiencies(
  breakdown: PromptAuditBreakdown,
  duplicates: PromptDuplicateHit[],
  sections: TrackedPromptSection[]
): string[] {
  const tips: string[] = [];
  const dupWaste = duplicates.reduce((n, d) => n + d.estimatedWastedTokens, 0);
  if (dupWaste > 200) {
    tips.push(`중복 주입으로 추정 ~${dupWaste.toLocaleString()} 토큰 낭비 — tail reminder·base rule 통합 검토`);
  }
  if (breakdown.systemRules > breakdown.characterSetting + breakdown.worldLore) {
    tips.push(
      `시스템 규칙(${breakdown.systemRules.toLocaleString()})이 캐릭터+세계관(${(breakdown.characterSetting + breakdown.worldLore).toLocaleString()})보다 큼 — 규칙 블록 압축 여지`
    );
  }
  const lengthSections = sections.filter((s) => /length|분량|BUFFER/i.test(s.label + s.text.slice(0, 80)));
  if (lengthSections.length >= 3) {
    tips.push(`출력 분량 규칙 ${lengthSections.length}회 주입 — dynamic + base + final + user-turn 중복`);
  }
  const speechSections = sections.filter((s) => /speech|말투/i.test(s.label));
  if (speechSections.length >= 2) {
    tips.push(`Speech Lock ${speechSections.length}회 주입 — Gemini priority + base + enforcement reminder`);
  }
  if (breakdown.recentConversation > 8000) {
    tips.push(`최근 대화 ${breakdown.recentConversation.toLocaleString()} 토큰 — 히스토리 예산·턴 수 축소 검토`);
  }
  const statusSections = sections.filter((s) => /status.?window|상태창/i.test(s.label + s.text.slice(0, 60)));
  if (statusSections.length >= 2) {
    tips.push(`상태창 규칙 ${statusSections.length}회 — user note/spec과 system tail 중복 가능`);
  }
  return tips;
}

export function auditAssembledPrompt(opts: {
  systemSections: TrackedPromptSection[];
  systemPrompt: string;
  history: ChatMsg[];
  openRouterOverlaySections?: TrackedPromptSection[];
  deepSeekXmlMode?: boolean;
}): PromptAuditResult {
  const allSystemSections = [...(opts.openRouterOverlaySections ?? []), ...opts.systemSections];
  const historyOnly = opts.history.slice(0, -1);
  const currentTurn = opts.history.at(-1);

  const historySections: TrackedPromptSection[] = historyOnly.map((m, i) => ({
    id: `history-${i}-${m.role}`,
    label: `History ${i + 1} (${m.role})`,
    category: "recentConversation" as const,
    text: m.content,
  }));

  if (currentTurn) {
    historySections.push({
      id: "history-current-user",
      label: "Current user turn",
      category: "recentConversation",
      text: currentTurn.content,
    });
  }

  const allSections = [...allSystemSections, ...historySections];

  const breakdown: PromptAuditBreakdown = {
    systemRules: sumCategory(allSystemSections, "systemRules"),
    characterSetting: sumCategory(allSystemSections, "characterSetting"),
    worldLore: sumCategory(allSystemSections, "worldLore"),
    memory: sumCategory(allSystemSections, "memory"),
    persona: sumCategory(allSystemSections, "persona"),
    userNote: sumCategory(allSystemSections, "userNote"),
    dialogueExamples: sumCategory(allSystemSections, "dialogueExamples"),
    recentConversation: sumCategory(historySections, "recentConversation"),
  };

  const systemPromptTokens = estimateTokens(opts.systemPrompt);
  const overlayTokens = opts.openRouterOverlaySections
    ? estimateTokens(opts.openRouterOverlaySections.map((s) => s.text).join("\n\n"))
    : 0;
  const fullSystemTokens = systemPromptTokens + overlayTokens;
  const historyTokens = historyOnly.reduce((n, m) => n + estimateTokens(m.content), 0);
  const currentUserTurnTokens = currentTurn ? estimateTokens(currentTurn.content) : 0;
  const totalAssembledTokens = fullSystemTokens + historyTokens + currentUserTurnTokens;

  const signatureDups = detectSignatureDuplicates(allSystemSections);
  const contentDups = detectContentDuplicates(allSystemSections);
  const duplicates = [...signatureDups, ...contentDups.filter((c) => !signatureDups.some((s) => s.label === c.label))];

  const inefficiencies = buildInefficiencies(breakdown, duplicates, allSystemSections);

  const deepSeekStructure = opts.deepSeekXmlMode
    ? {
        taggedSections: {
          PERSONA: opts.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.persona}>`),
          WORLD_LORE: opts.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.worldLore}>`),
          LONG_TERM_MEMORY: opts.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.longTermMemory}>`),
        },
        chatHistoryTagged: formatDeepSeekChatHistoryBlock(historyOnly).includes(
          `<${DEEPSEEK_XML_TAGS.chatHistory}>`
        ),
        bottomReminderBeforeCurrentTurn:
          currentTurn?.role === "user" &&
          currentTurn.content.trim().startsWith(DEEPSEEK_BOTTOM_REMINDER),
      }
    : undefined;

  return {
    breakdown,
    systemPromptTokens: fullSystemTokens,
    historyTokens,
    currentUserTurnTokens,
    totalAssembledTokens,
    totalChars:
      opts.systemPrompt.length +
      (opts.openRouterOverlaySections?.reduce((n, s) => n + s.text.length, 0) ?? 0) +
      opts.history.reduce((n, m) => n + m.content.length, 0),
    sectionCount: allSections.length,
    duplicates,
    inefficiencies,
    sections: allSections.map((s) => ({
      id: s.id,
      label: s.label,
      category: s.category,
      tokens: estimateTokens(s.text),
    })),
    deepSeekStructure,
  };
}

export function formatPromptAuditLog(audit: PromptAuditResult, opts?: { route?: string }): string {
  const b = audit.breakdown;
  const lines = [
    "",
    "══════════════════════════════════════════════════════",
    `PROMPT AUDIT${opts?.route ? ` — ${opts.route}` : ""}`,
    "══════════════════════════════════════════════════════",
    `1. System rules:          ${b.systemRules.toLocaleString().padStart(6)} tokens`,
    `2. Character setting:     ${b.characterSetting.toLocaleString().padStart(6)} tokens`,
    `3. World lore:            ${b.worldLore.toLocaleString().padStart(6)} tokens`,
    `4. Memory (LTM+meta):     ${b.memory.toLocaleString().padStart(6)} tokens`,
    `5. Recent conversation:   ${b.recentConversation.toLocaleString().padStart(6)} tokens`,
    `6. Persona:               ${b.persona.toLocaleString().padStart(6)} tokens`,
    `7. Dialogue examples:     ${b.dialogueExamples.toLocaleString().padStart(6)} tokens`,
    `   User note:             ${b.userNote.toLocaleString().padStart(6)} tokens`,
    "──────────────────────────────────────────────────────",
    `   System prompt total:   ${audit.systemPromptTokens.toLocaleString().padStart(6)} tokens`,
    `   History (excl. curr):  ${audit.historyTokens.toLocaleString().padStart(6)} tokens`,
    `   Current user turn:     ${audit.currentUserTurnTokens.toLocaleString().padStart(6)} tokens`,
    `   FINAL ASSEMBLED:       ${audit.totalAssembledTokens.toLocaleString().padStart(6)} tokens (${audit.totalChars.toLocaleString()} chars)`,
    `   Sections tracked:      ${audit.sectionCount}`,
  ];

  if (audit.duplicates.length > 0) {
    lines.push("──────────────────────────────────────────────────────", "DUPLICATED SECTIONS:");
    for (const d of audit.duplicates.slice(0, 12)) {
      lines.push(
        `  • ${d.label}`,
        `    sections: [${d.sectionIds.join(", ")}] · ~${d.estimatedWastedTokens} wasted tokens`
      );
    }
  }

  if (audit.inefficiencies.length > 0) {
    lines.push("──────────────────────────────────────────────────────", "TOKEN INEFFICIENCIES:");
    for (const tip of audit.inefficiencies) {
      lines.push(`  ⚠ ${tip}`);
    }
  }

  if (audit.deepSeekStructure) {
    const ds = audit.deepSeekStructure;
    lines.push(
      "──────────────────────────────────────────────────────",
      "DEEPSEEK CONTEXT STRUCTURE:",
      `  <PERSONA>:            ${ds.taggedSections.PERSONA ? "✓" : "✗"}`,
      `  <WORLD_LORE>:         ${ds.taggedSections.WORLD_LORE ? "✓" : "✗"}`,
      `  <LONG_TERM_MEMORY>:   ${ds.taggedSections.LONG_TERM_MEMORY ? "✓" : "—"}`,
      `  <CHAT_HISTORY> (virt): ${ds.chatHistoryTagged ? "✓" : "✗"}`,
      `  Bottom reminder:      ${ds.bottomReminderBeforeCurrentTurn ? "✓ (before current user turn)" : "✗"}`
    );
  }

  lines.push("══════════════════════════════════════════════════════");
  return lines.join("\n");
}

/** OpenRouter 19+ prefix/suffix around base system — audit only */
export function trackOpenRouterOverlaySections(baseSystem: string, finalSystem: string): TrackedPromptSection[] {
  const baseIdx = finalSystem.indexOf(baseSystem);
  if (baseIdx < 0) {
    return [
      {
        id: "or-overlay-full",
        label: "OpenRouter system (full rewrite)",
        category: "systemRules",
        text: finalSystem,
      },
    ];
  }

  const sections: TrackedPromptSection[] = [];
  const prefix = finalSystem.slice(0, baseIdx).trim();
  const suffix = finalSystem.slice(baseIdx + baseSystem.length).trim();

  if (prefix) {
    prefix.split(/\n\n+/).forEach((text, i) => {
      if (!text.trim()) return;
      let category: PromptSectionCategory = "systemRules";
      if (/Story Context/i.test(text)) category = "memory";
      sections.push({
        id: `or-prefix-${i}`,
        label: `OpenRouter prefix ${i + 1}`,
        category,
        text: text.trim(),
      });
    });
  }

  if (suffix) {
    suffix.split(/\n\n+/).forEach((text, i) => {
      if (!text.trim()) return;
      sections.push({
        id: `or-suffix-${i}`,
        label: `OpenRouter suffix ${i + 1}`,
        category: "systemRules",
        text: text.trim(),
      });
    });
  }

  return sections;
}
