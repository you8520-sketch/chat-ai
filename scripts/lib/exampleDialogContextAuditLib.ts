/**
 * Step 7.6a — Example dialog context audit helpers (read-only).
 * Only varies exampleDialog input — CHARACTER CANON speech rules unchanged.
 */

import { parseCharacterSetting } from "@/utils/characterParser";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";
import { buildStructuredCharacterCanonBlock } from "@/lib/characterKnowledgeBoundary";
import {
  classifyLineRegister,
  evaluateRegisterCompliance,
  type ExpectedRegister,
} from "@/lib/characterRegisterCompliance";
import {
  filterTaggedExampleDialogBody,
  inferSceneRegisterContext,
  extractExampleDialogSectionBody,
  stripLeadingContextTag,
} from "@/lib/exampleDialogSceneFilter";
import type { ContextBuildInput } from "@/types";
import type { RegisterValidationScene } from "./leon-ren-register-fixtures";
import {
  REGISTER_VALIDATION_SCENES,
  buildRegisterValidationContext,
} from "./leon-ren-register-fixtures";

export type ExampleContextBucket = "public" | "private" | "bed" | "unknown";

export type ExampleDialogVariant = "mixed" | "public_only" | "private_only" | "tagged";

export type ParsedExampleLine = {
  index: number;
  userCue: string;
  dialogue: string;
  register: ExpectedRegister | "other";
  inferredContext: ExampleContextBucket;
  explicitTag: string | null;
  matchesCardContext: boolean | null;
};

export type ExampleContaminationRow = {
  source: string;
  variant: ExampleDialogVariant | "fixture_default";
  raw: string;
  lines: ParsedExampleLine[];
  registerKinds: string[];
  isMixed: boolean;
  untaggedCount: number;
  contextTaggedCount: number;
  mixedRegisterUntagged: boolean;
};

export const LEON_SPEECH_UNCHANGED = `# 말투
공적인 자리: 건조한 군대식 다나까체
유저와 둘만 있을 때: 해요체
침대: 속삭이는 해요체, 짧은 문장

# 성격
냉정하고 절제된 기사. 감정을 드러내지 않으려 한다.`;

export const LEON_EXAMPLE_MIXED = `유저: 괜찮아?
레온: …괜찮아요.
유저: 적이다!
레온: …각오하십시오.`;

export const LEON_EXAMPLE_PUBLIC_ONLY = `유저: 적이다!
레온: …각오하십시오.
유저: 전하께 보고하라.
레온: …즉시 하겠습니다.
유저: 부대를 정비하라.
레온: …명을 받들겠습니다.`;

export const LEON_EXAMPLE_PRIVATE_ONLY = `유저: 괜찮아?
레온: …괜찮아요.
유저: …가까이 와도 돼?
레온: …그래요.
유저: …불 끌까?
레온: …응, 꺼도 돼요.`;

/** Step 7.6b — context tags on each example pair (rewrite-only shape). */
export const LEON_EXAMPLE_TAGGED = `[공적] 유저: 적이다!
레온: …각오하십시오.
[공적] 유저: 전하께 보고하라.
레온: …즉시 하겠습니다.
[사적] 유저: 괜찮아?
레온: …괜찮아요.
[사적] 유저: …우리 둘뿐이야.
레온: …알겠어요.
[침대] 유저: …불 끌까?
레온: …그래요.
[침대] 유저: …가까이 와도 돼?
레온: …괜찮아요.`;

export const EXAMPLE_VARIANTS: Record<ExampleDialogVariant, { label: string; text: string }> = {
  mixed: { label: "mixed (current Leon fixture)", text: LEON_EXAMPLE_MIXED },
  public_only: { label: "public-only examples", text: LEON_EXAMPLE_PUBLIC_ONLY },
  private_only: { label: "private-only examples", text: LEON_EXAMPLE_PRIVATE_ONLY },
  tagged: { label: "tagged [공적]/[사적]/[침대]", text: LEON_EXAMPLE_TAGGED },
};

const EXPLICIT_TAG_RE =
  /^(?:\[|\()? *(공적|사적|둘만|침대|private|public|formal|bed|intimate) *(?:\]|\/|\)|:|：)/i;

const PUBLIC_CUE_RE =
  /적|전장|전하|부대|병영|성벽|회의|명령|보고|각오|십시오|하라|하십|전투|군|기사단|대장|왕/i;
const PRIVATE_CUE_RE = /괜찮|둘만|둘뿐|솔직|편|우리|고백|손|산책|우산|친|말해봐/i;
const BED_CUE_RE = /침대|불\s*끌|가까이|속삭|밤|안아|누워|이불|키스|스킨십/i;

function inferContextFromCue(userCue: string): ExampleContextBucket {
  const t = userCue.trim();
  if (BED_CUE_RE.test(t)) return "bed";
  if (PUBLIC_CUE_RE.test(t)) return "public";
  if (PRIVATE_CUE_RE.test(t)) return "private";
  return "unknown";
}

function inferContextFromExplicitTag(tag: string): ExampleContextBucket {
  const t = tag.trim();
  if (/공적|public|formal/i.test(t)) return "public";
  if (/침대|bed|intimate/i.test(t)) return "bed";
  if (/사적|private|둘만/i.test(t)) return "private";
  return "unknown";
}

function parseExplicitTag(line: string): string | null {
  const m = line.match(EXPLICIT_TAG_RE);
  return m?.[1]?.trim() ?? null;
}

function parseExampleDialogPairs(raw: string): ParsedExampleLine[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const pairs: ParsedExampleLine[] = [];
  let pendingUser = "";
  let pendingTag: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    const tagged = stripLeadingContextTag(line);
    if (tagged.tag) {
      pendingTag = tagged.tag;
      line = tagged.rest;
      if (!line) continue;
    }

    const userM = line.match(/^(?:유저|user|나|당신)\s*[:：]\s*(.+)$/i);
    if (userM?.[1]) {
      pendingUser = userM[1].trim();
      continue;
    }

    const charM = line.match(/^(?:레온|캐릭터|character|char|[^\s:：]{1,12})\s*[:：]\s*(.+)$/i);
    if (charM?.[1]) {
      const dialogue = charM[1].replace(/^["「『""]|["」』""]$/g, "").trim();
      const register = classifyLineRegister(dialogue);
      const inferredContext = inferContextFromCue(pendingUser);
      const tagForPair = pendingTag ?? parseExplicitTag(line);
      pairs.push({
        index: pairs.length,
        userCue: pendingUser,
        dialogue,
        register,
        inferredContext,
        explicitTag: tagForPair,
        matchesCardContext: null,
      });
      pendingUser = "";
      pendingTag = null;
    }
  }

  return pairs;
}

function expectedRegisterForContext(ctx: ExampleContextBucket): ExpectedRegister | null {
  if (ctx === "public") return "danakka";
  if (ctx === "private" || ctx === "bed") return "haeyo";
  return null;
}

function enrichWithCardMatch(rows: ParsedExampleLine[]): ParsedExampleLine[] {
  return rows.map((r) => {
    const exp = expectedRegisterForContext(r.inferredContext);
    if (!exp) return { ...r, matchesCardContext: null };
    const ok =
      r.register === exp ||
      (exp === "danakka" && r.register === "formal") ||
      (exp === "haeyo" && r.register === "haeyo");
    return { ...r, matchesCardContext: ok };
  });
}

export function analyzeExampleContamination(
  source: string,
  raw: string,
  variant: ExampleContaminationRow["variant"]
): ExampleContaminationRow {
  const lines = enrichWithCardMatch(parseExampleDialogPairs(raw));
  const kinds = [...new Set(lines.map((l) => l.register).filter((k) => k !== "other"))];
  const untaggedCount = lines.filter((l) => !l.explicitTag).length;
  const contextTaggedCount = lines.filter((l) => l.explicitTag).length;
  const mixedRegisterUntagged =
    kinds.length > 1 && untaggedCount === lines.length && lines.length > 1;

  return {
    source,
    variant,
    raw,
    lines,
    registerKinds: kinds,
    isMixed: kinds.length > 1,
    untaggedCount,
    contextTaggedCount,
    mixedRegisterUntagged,
  };
}

export function buildLeonContextWithExampleVariant(
  scene: RegisterValidationScene,
  variant: ExampleDialogVariant
): ContextBuildInput {
  const base = buildRegisterValidationContext(scene);
  const exampleDialog = EXAMPLE_VARIANTS[variant].text;
  const chunks = parseCharacterSetting({
    characterId: `ex-audit-${variant}-${scene.id}`,
    characterName: "레온",
    gender: "male",
    systemPrompt: LEON_SPEECH_UNCHANGED,
    world: "제국 기사단. 귀족과 기사가 공존하는 판타지 세계.",
    exampleDialog,
    statusWindowPrompt: "",
  });
  return { ...base, chunks };
}

export function extractCanonExampleBlock(combinedSetting: string): string {
  const canon = buildStructuredCharacterCanonBlock(combinedSetting, "레온");
  const m = canon.match(/\[예시 대화\]\s*([\s\S]*?)(?:\n\[|$)/);
  return m?.[1]?.trim() ?? "";
}

export function extractFilteredCanonExampleBlock(
  scene: RegisterValidationScene,
  variant: ExampleDialogVariant
): string {
  const ctx = buildLeonContextWithExampleVariant(scene, variant);
  const combined = collectCharacterSettingText(ctx.chunks);
  const rawBlock =
    extractExampleDialogSectionBody(combined) ?? EXAMPLE_VARIANTS[variant].text;
  if (variant !== "tagged") return extractCanonExampleBlock(combined) || rawBlock;

  const sceneCtx = inferSceneRegisterContext({
    userMessage: scene.currentUserMessage,
    recentHistory: scene.shortTermHistory.map((m) => m.content).join("\n"),
  });
  return filterTaggedExampleDialogBody(rawBlock, sceneCtx).filtered;
}

export type ExampleOnlyPrediction = {
  sceneId: string;
  contextTag: string;
  expectedRegister: ExpectedRegister;
  variant: ExampleDialogVariant;
  exampleRegistersInCanon: string[];
  exampleIsMixed: boolean;
  nearestExampleRegister: ExpectedRegister | "mixed" | "other";
  predictsCorrect: boolean;
  explainableByWrongExample: boolean;
  wrongRegisterInCanon: boolean;
};

export function predictFromExamplesOnly(
  scene: RegisterValidationScene,
  variant: ExampleDialogVariant
): ExampleOnlyPrediction {
  const ctx = buildLeonContextWithExampleVariant(scene, variant);
  const combined = collectCharacterSettingText(ctx.chunks);
  const exampleBlock =
    variant === "tagged"
      ? extractFilteredCanonExampleBlock(scene, variant)
      : extractCanonExampleBlock(combined) || EXAMPLE_VARIANTS[variant].text;
  const parsed = parseExampleDialogPairs(exampleBlock);
  const kinds = [...new Set(parsed.map((p) => p.register).filter((k) => k !== "other"))];

  let nearest: ExampleOnlyPrediction["nearestExampleRegister"] = "other";
  if (kinds.length > 1) nearest = "mixed";
  else if (kinds.length === 1) nearest = kinds[0] as ExpectedRegister;

  const tag = scene.contextTag;
  const contextExamples = parsed.filter((p) => {
    if (variant === "tagged" && p.explicitTag) {
      const bucket = inferContextFromExplicitTag(p.explicitTag);
      if (tag === "공적인 자리") return bucket === "public";
      if (tag === "유저와 둘만") return bucket === "private";
      if (tag === "침대") return bucket === "bed" || bucket === "private";
      return false;
    }
    if (tag === "공적인 자리") return p.inferredContext === "public";
    if (tag === "유저와 둘만") return p.inferredContext === "private";
    if (tag === "침대") return p.inferredContext === "bed" || p.inferredContext === "private";
    return false;
  });

  const contextKinds = [...new Set(contextExamples.map((p) => p.register).filter((k) => k !== "other"))];
  let contextNearest: ExampleOnlyPrediction["nearestExampleRegister"] = nearest;

  // Mixed variant: model sees ALL untagged lines — contamination if >1 register in block
  if (variant === "mixed" && kinds.length > 1) {
    contextNearest = "mixed";
  } else if (contextExamples.length > 0) {
    contextNearest = contextKinds.length > 1 ? "mixed" : (contextKinds[0] as ExpectedRegister) ?? "other";
  }

  const wrongRegisterInCanon =
    variant === "mixed" &&
    kinds.length > 1 &&
    parsed.some((p) => {
      const exp = scene.expectedRegister;
      if (exp === "haeyo") return p.register === "danakka" || p.register === "formal";
      if (exp === "danakka") return p.register === "haeyo";
      return false;
    });

  const exp = scene.expectedRegister;
  const matches = (reg: ExpectedRegister | "mixed" | "other") => {
    if (reg === "mixed" || reg === "other") return false;
    if (exp === "haeyo") return reg === "haeyo";
    if (exp === "danakka") return reg === "danakka" || reg === "formal";
    return reg === exp;
  };

  return {
    sceneId: scene.id,
    contextTag: scene.contextTag,
    expectedRegister: exp,
    variant,
    exampleRegistersInCanon: kinds,
    exampleIsMixed: kinds.length > 1,
    nearestExampleRegister: contextExamples.length > 0 ? contextNearest : nearest,
    predictsCorrect: matches(contextExamples.length > 0 ? contextNearest : nearest),
    explainableByWrongExample: wrongRegisterInCanon || (!matches(contextNearest) && contextNearest !== "mixed"),
    wrongRegisterInCanon,
  };
}

export type HistoryExampleContamination = {
  sceneId: string;
  contextTag: string;
  historyDialogueRegisters: string[];
  historyMixed: boolean;
  alignsWithExpected: boolean;
};

export function analyzeHistoryContamination(scene: RegisterValidationScene): HistoryExampleContamination {
  const regs: string[] = [];
  for (const m of scene.shortTermHistory) {
    if (m.role !== "assistant") continue;
    for (const q of m.content.matchAll(/"([^"\n]{1,200})"/g)) {
      if (q[1]) {
        const r = classifyLineRegister(q[1]);
        if (r !== "other") regs.push(r);
      }
    }
  }
  const kinds = [...new Set(regs)];
  const exp = scene.expectedRegister;
  const aligns =
    kinds.length === 1 &&
    (exp === "haeyo"
      ? kinds[0] === "haeyo"
      : exp === "danakka"
        ? kinds[0] === "danakka" || kinds[0] === "formal"
        : kinds[0] === exp);

  return {
    sceneId: scene.id,
    historyDialogueRegisters: kinds,
    historyMixed: kinds.length > 1,
    contextTag: scene.contextTag,
    alignsWithExpected: aligns,
  };
}

export type VariantComplianceSummary = {
  variant: ExampleDialogVariant;
  samples: { id: string; contextTag: string; compliance: number; registerDrift: boolean }[];
  avgCompliance: number;
  byContext: { contextTag: string; avg: number; n: number }[];
};

export function summarizeVariantCompliance(
  variant: ExampleDialogVariant,
  samples: { id: string; compliance: number; registerDrift?: boolean }[]
): VariantComplianceSummary {
  const rows = samples
    .map((s) => {
      const scene = LEON_SCENES.find((x) => x.id === s.id);
      if (!scene) return null;
      return {
        id: s.id,
        contextTag: scene.contextTag,
        compliance: s.compliance,
        registerDrift: s.registerDrift ?? false,
      };
    })
    .filter(Boolean) as VariantComplianceSummary["samples"];

  const byTag = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const cur = byTag.get(r.contextTag) ?? { sum: 0, n: 0 };
    cur.sum += r.compliance;
    cur.n++;
    byTag.set(r.contextTag, cur);
  }

  return {
    variant,
    samples: rows,
    avgCompliance: rows.length ? rows.reduce((a, s) => a + s.compliance, 0) / rows.length : 0,
    byContext: [...byTag.entries()].map(([contextTag, v]) => ({
      contextTag,
      avg: Math.round((v.sum / v.n) * 10) / 10,
      n: v.n,
    })),
  };
}

export function explainPatchAWithExamples(
  samples: { id: string; text: string; compliance: number }[]
): {
  totalFailures: number;
  explainedByMixedExample: number;
  explainedByHistoryMismatch: number;
  explainRate: number;
} {
  const leonScenes = REGISTER_VALIDATION_SCENES.filter((s) => s.character === "leon");
  let totalFailures = 0;
  let explainedByMixedExample = 0;
  let explainedByHistoryMismatch = 0;

  for (const scene of leonScenes) {
    const sample = samples.find((s) => s.id === scene.id);
    if (!sample || sample.compliance >= 70) continue;
    totalFailures++;

    const pred = predictFromExamplesOnly(scene, "mixed");
    const hist = analyzeHistoryContamination(scene);
    const comp = evaluateRegisterCompliance(sample.text, scene.expectedRegister);
    const driftKinds = comp.driftKinds;

    if (pred.wrongRegisterInCanon || (pred.exampleIsMixed && !pred.predictsCorrect)) {
      explainedByMixedExample++;
    }
    if (!hist.alignsWithExpected && driftKinds.some((d) => hist.historyDialogueRegisters.includes(d))) {
      explainedByHistoryMismatch++;
    }
  }

  return {
    totalFailures,
    explainedByMixedExample,
    explainedByHistoryMismatch,
    explainRate: totalFailures ? Math.round((explainedByMixedExample / totalFailures) * 1000) / 10 : 0,
  };
}

export function typicalUserPatternAudit(): {
  pattern: string;
  issues: string[];
  recommendation: string;
} {
  return {
    pattern: `[말투] 공적/사적/침대 labels + [예시] untagged "..." lines`,
    issues: [
      "Card labels (공적/사적/침대) bind to # 말투 prose only — example block has no parallel tags",
      "SPEECH CONSISTENCY: examples win over trait descriptions when they conflict",
      "Untagged mixed registers in [예시 대화] → model averages or picks by user-cue similarity (unreliable)",
      "No runtime code links example line index to register_by_context key",
    ],
    recommendation:
      "Tag each example line with context label (공적/사적/침대) OR split into separate example groups before expecting context register",
  };
}

export const LEON_SCENES = REGISTER_VALIDATION_SCENES.filter((s) => s.character === "leon");
