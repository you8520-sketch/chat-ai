/**
 * Step 7.6 — Character register activation audit helpers (read-only).
 */

import { parseCharacterSetting } from "@/utils/characterParser";
import { buildContext } from "@/services/contextBuilder";
import {
  buildStructuredCharacterCanonBlock,
  buildCharacterSpeechRecencyTail,
} from "@/lib/characterKnowledgeBoundary";
import { collectCharacterSettingText } from "@/lib/bodyHairRules";
import {
  formatSpeechSectionAsMetadata,
  isSpeechMetadataSection,
} from "@/lib/speechMetadataPolicy";
import { composeExampleDialog } from "@/lib/speechCreatorFields";
import type { RegisterPatchId } from "@/lib/registerPatchExperiment";
import type { TrackedPromptSection } from "@/services/promptAudit";
import {
  REGISTER_VALIDATION_SCENES,
  buildRegisterValidationContext,
  type RegisterValidationScene,
} from "./leon-ren-register-fixtures";
import { evaluateRegisterCompliance } from "@/lib/characterRegisterCompliance";

export const LEON_SPEECH_RAW = `# 말투
공적인 자리: 건조한 군대식 다나까체
유저와 둘만 있을 때: 해요체
침대: 속삭이는 해요체, 짧은 문장

# 성격
냉정하고 절제된 기사. 감정을 드러내지 않으려 한다.`;

export const LEON_EXAMPLE_RAW = `유저: 괜찮아?
레온: …괜찮아요.
유저: 적이다!
레온: …각오하십시오.`;

export type ContextCondition = "공적인 자리" | "유저와 둘만" | "침대";

export type ParserProbe = {
  label: string;
  body: string;
  isSpeechSection: boolean;
  extractedPairs: { context: string; register: string }[];
  metadataPreview: string;
  parseOk: boolean;
  parseNotes: string[];
};

export type SceneActivationRow = {
  sceneId: string;
  contextTag: string;
  expectedRegister: string;
  patch: RegisterPatchId | "production";
  /** No runtime code selects register — always false */
  runtimeRegisterSelector: false;
  canonHasContextRule: boolean;
  promptHasRegisterByContext: boolean;
  canonSpeechSnippet: string;
  activeConditionsInCanon: string[];
  sceneCueKeywords: string[];
  sceneCueHitsCardCondition: boolean;
  sectionOrder: { id: string; index: number; hasRegisterHint: boolean }[];
  speechVsProseGap: number;
  genreToneIndex: number | null;
  characterCanonIndex: number;
  proseBundleIndex: number;
  conflictingRegisterHints: string[];
  logicalPath: string[];
};

export type FailureCause = {
  id: string;
  category: "parser" | "priority" | "runtime_wiring" | "model_inference" | "card_content";
  rank: number;
  weight: number;
  evidence: string;
  rewriteOnlyFix: "yes" | "partial" | "no";
};

function parseRegisterByContextFromMetadata(meta: string): { context: string; register: string }[] {
  const pairs: { context: string; register: string }[] = [];
  const block = meta.split("register_by_context:")[1];
  if (!block) return pairs;
  for (const line of block.split("\n")) {
    const m = line.trim().match(/^-\s*(.+?)\s*→\s*(.+)$/);
    if (m?.[1] && m[2]) pairs.push({ context: m[1].trim(), register: m[2].trim() });
  }
  return pairs;
}

function probeParser(label: string, body: string): ParserProbe {
  const isSpeechSection = isSpeechMetadataSection("[말투]", body, "speech");
  const meta = formatSpeechSectionAsMetadata("[말투]", body);
  const extractedPairs = parseRegisterByContextFromMetadata(meta);
  const notes: string[] = [];
  if (isSpeechSection && extractedPairs.length === 0) {
    notes.push("classified as speech but no context:register pairs extracted");
  }
  if (!isSpeechSection && /해요체|다나까/.test(body)) {
    notes.push("register keywords present but isSpeechMetadataSection=false");
  }
  return {
    label,
    body,
    isSpeechSection,
    extractedPairs,
    metadataPreview: meta.split("\n").slice(0, 12).join("\n"),
    parseOk: isSpeechSection && (extractedPairs.length > 0 || /default_register:/.test(meta)),
    parseNotes: notes,
  };
}

export function runParserProbes(): ParserProbe[] {
  return [
    probeParser("Leon production card", LEON_SPEECH_RAW.split("\n").slice(1, 4).join("\n")),
    probeParser("Missing colon", "공적인 자리 다나까체\n유저와 둘만 해요체"),
    probeParser("Bullet prefix", "- 평소: 해요체\n- 전투: 다나까체"),
    probeParser("English keys", "formal: danakka\nprivate: haeyo"),
    probeParser("Bed without modifier", "침대: 해요체"),
    probeParser("Inline examples", `공적인 자리: 다나까체\n"…각오하십시오."\n유저와 둘만: 해요체`),
    probeParser("Hash header only", "# 말투\n평소 해요체"),
  ];
}

function cardConditionMatchesScene(contextTag: string, canonConditions: string[]): boolean {
  const tag = contextTag.trim();
  return canonConditions.some((c) => {
    if (tag === "공적인 자리") return /공적/.test(c);
    if (tag === "유저와 둘만") return /둘만|사적|private/i.test(c);
    if (tag === "침대") return /침대|bed/i.test(c);
    return c.includes(tag);
  });
}

function extractSceneCueKeywords(scene: RegisterValidationScene): string[] {
  const blob = [
    scene.contextTag,
    scene.label,
    scene.currentUserMessage,
    ...scene.shortTermHistory.map((m) => m.content),
  ].join("\n");
  const cues: string[] = [];
  if (/공적|전장|회의|병영|성벽|전하|부대|각오|십시오/.test(blob)) cues.push("public/military");
  if (/둘만|둘뿐|우리 둘|친밀|편한/.test(blob)) cues.push("private/intimate");
  if (/침대|불 끌|가까이|속삭|밤/.test(blob)) cues.push("bed/intimate");
  return cues;
}

function findRegisterHints(text: string): string[] {
  const hints: string[] = [];
  if (/register_by_context:/.test(text)) hints.push("register_by_context block");
  if (/\[genre_tone\].*합니다|대사 register/.test(text)) hints.push("genre_tone dialogue register");
  if (/공적인 자리[:：]/.test(text)) hints.push("canon context: 공적인 자리");
  if (/둘만/.test(text)) hints.push("canon context: 둘만");
  if (/침대[:：]/.test(text)) hints.push("canon context: 침대");
  if (/SPEECH METADATA/.test(text)) hints.push("SPEECH METADATA invisible rule");
  if (/NARRATION REGISTER/.test(text)) hints.push("NARRATION REGISTER (-다 only)");
  if (/examples always win/i.test(text)) hints.push("SPEECH CONSISTENCY examples-win");
  return hints;
}

function sectionIndex(sections: TrackedPromptSection[], id: string): number {
  return sections.findIndex((s) => s.id === id);
}

function buildSceneRow(
  scene: RegisterValidationScene,
  patch: RegisterPatchId | "production"
): SceneActivationRow {
  if (patch === "production") {
    delete process.env.REGISTER_PATCH;
  } else {
    process.env.REGISTER_PATCH = patch;
  }

  const built = buildContext(buildRegisterValidationContext(scene));
  const sections = built.meta?.trackedSections ?? [];
  const system = built.systemPrompt;

  const canonIdx = sectionIndex(sections, "character-core-identity");
  const proseIdx = sectionIndex(sections, "prose-style-xml-bundle");
  const genreIdx = sectionIndex(sections, "narrative-style");

  const canonText = sections[canonIdx]?.text ?? "";
  const canonPairs = parseRegisterByContextFromMetadata(canonText);
  const activeConditions =
    canonPairs.length > 0
      ? canonPairs.map((p) => p.context)
      : [...canonText.matchAll(/^([^:：\n]{2,48})[:：]\s*.+$/gm)].map((m) => m[1]!.trim());

  const conflicting: string[] = [];
  if (/합니다|그렇습니다/.test(system) && scene.expectedRegister === "haeyo") {
    if (!/genre_tone.*합니다/.test(system)) {
      /* Patch A removed explicit genre register — check other sources */
    }
  }
  if (/LEGACY|대사 register 현대/.test(system)) conflicting.push("legacy genre_tone register (REGISTER_PATCH=none)");
  const genreSec = sections[genreIdx]?.text ?? "";
  if (/대사 register|합니다·입니다/.test(genreSec)) {
    conflicting.push("[genre_tone] mandates modern formal dialogue");
  }

  const logicalPath: string[] = [
    "1. Model reads full system prompt (no per-turn register selector in code)",
    canonIdx >= 0
      ? `2. CHARACTER CANON @ section ${canonIdx + 1} — static prose with all context rules`
      : "2. CHARACTER CANON missing",
  ];
  if (proseIdx >= 0) {
    logicalPath.push(
      `3. Prose bundle @ ${proseIdx + 1} — SPEECH METADATA ban + NARRATION REGISTER (-다); no dialogue register pick`
    );
  }
  if (genreIdx >= 0) {
    logicalPath.push(`4. [genre_tone] @ ${genreIdx + 1} — atmosphere${conflicting.length ? " (+ legacy register conflict if none patch)" : " only (Patch A prod)"}`);
  }
  logicalPath.push(
    `5. Scene cues (${extractSceneCueKeywords(scene).join(", ") || "none"}) — model must map to card condition "${scene.contextTag}"`
  );
  logicalPath.push("6. Example dialog in canon may override traits (SPEECH CONSISTENCY — examples win)");

  const orderSlice = sections.map((s, i) => ({
    id: s.id,
    index: i + 1,
    hasRegisterHint: findRegisterHints(s.text).length > 0,
  }));

  return {
    sceneId: scene.id,
    contextTag: scene.contextTag,
    expectedRegister: scene.expectedRegister,
    patch,
    runtimeRegisterSelector: false,
    canonHasContextRule: cardConditionMatchesScene(scene.contextTag, activeConditions),
    promptHasRegisterByContext: /register_by_context:/.test(system),
    canonSpeechSnippet: canonText.slice(0, 480),
    activeConditionsInCanon: activeConditions,
    sceneCueKeywords: extractSceneCueKeywords(scene),
    sceneCueHitsCardCondition: extractSceneCueKeywords(scene).length > 0,
    sectionOrder: orderSlice.filter((s) => s.hasRegisterHint || s.id.includes("character") || s.id.includes("prose") || s.id.includes("narrative")),
    speechVsProseGap: proseIdx >= 0 && canonIdx >= 0 ? proseIdx - canonIdx : -1,
    genreToneIndex: genreIdx >= 0 ? genreIdx + 1 : null,
    characterCanonIndex: canonIdx + 1,
    proseBundleIndex: proseIdx + 1,
    conflictingRegisterHints: conflicting,
    logicalPath,
  };
}

export function buildLeonSceneActivationMap(
  patches: (RegisterPatchId | "production")[] = ["production", "B"]
): SceneActivationRow[] {
  const leonScenes = REGISTER_VALIDATION_SCENES.filter((s) => s.character === "leon");
  const pick = [
    leonScenes.find((s) => s.id === "leon-public-0")!,
    leonScenes.find((s) => s.id === "leon-private-0")!,
    leonScenes.find((s) => s.id === "leon-private-1")!,
  ];
  const rows: SceneActivationRow[] = [];
  for (const patch of patches) {
    for (const scene of pick) {
      rows.push(buildSceneRow(scene, patch));
    }
  }
  return rows;
}

export function buildSaveVsRuntimeCanonAudit(): {
  saveTimeExampleDialog: string;
  runtimeCanonFromRawCard: string;
  runtimeCanonIfPatchB: string;
  recencyTailPatchD: string;
} {
  const saveTimeExampleDialog = composeExampleDialog({
    speech_personality: "",
    speech_traits: LEON_SPEECH_RAW.split("\n").slice(1, 4).join("\n"),
    speech_examples: LEON_EXAMPLE_RAW,
  });

  const chunks = parseCharacterSetting({
    characterId: "audit-leon",
    characterName: "레온",
    gender: "male",
    systemPrompt: LEON_SPEECH_RAW,
    world: "제국 기사단.",
    exampleDialog: LEON_EXAMPLE_RAW,
    statusWindowPrompt: "",
  });
  const combined = collectCharacterSettingText(chunks);
  const runtimeCanonFromRawCard = buildStructuredCharacterCanonBlock(combined, "레온");

  delete process.env.REGISTER_PATCH;
  const runtimeCanonProd = runtimeCanonFromRawCard;

  process.env.REGISTER_PATCH = "B";
  const runtimeCanonIfPatchB = buildStructuredCharacterCanonBlock(combined, "레온");

  process.env.REGISTER_PATCH = "D";
  const recencyTailPatchD = buildCharacterSpeechRecencyTail(combined);

  delete process.env.REGISTER_PATCH;

  return {
    saveTimeExampleDialog,
    runtimeCanonFromRawCard: runtimeCanonProd,
    runtimeCanonIfPatchB,
    recencyTailPatchD,
  };
}

export type ComplianceByContext = {
  contextTag: string;
  count: number;
  avgCompliance: number;
  failIds: string[];
};

export function summarizePatchJson(
  samples: { id: string; expectedRegister: string; text: string; compliance: number }[]
): ComplianceByContext[] {
  const leon = REGISTER_VALIDATION_SCENES.filter((s) => s.character === "leon");
  const byTag = new Map<string, ComplianceByContext>();

  for (const scene of leon) {
    const row = samples.find((s) => s.id === scene.id);
    if (!row) continue;
    const tag = scene.contextTag;
    const cur = byTag.get(tag) ?? { contextTag: tag, count: 0, avgCompliance: 0, failIds: [] };
    cur.count++;
    cur.avgCompliance += row.compliance;
    if (row.compliance < 70) cur.failIds.push(scene.id);
    byTag.set(tag, cur);
  }

  return [...byTag.values()].map((v) => ({
    ...v,
    avgCompliance: v.count ? Math.round((v.avgCompliance / v.count) * 10) / 10 : 0,
  }));
}

export function rankFailureCauses(opts: {
  parserOkRate: number;
  productionHasMetadataWire: boolean;
  complianceByContext: ComplianceByContext[];
  patchBCompliance?: number;
  patchACompliance?: number;
}): FailureCause[] {
  const causes: FailureCause[] = [
    {
      id: "no_runtime_selector",
      category: "runtime_wiring",
      rank: 0,
      weight: 95,
      evidence:
        "No code maps scene context (공적/둘만/침대) → active register at generation time; model must infer from static canon prose.",
      rewriteOnlyFix: "partial",
    },
    {
      id: "metadata_dead_path",
      category: "runtime_wiring",
      rank: 0,
      weight: 88,
      evidence:
        "formatSpeechSectionAsMetadata + register_by_context only at character save (exampleDialog) and optionally REGISTER_PATCH=B; production canon uses formatSection() plain prose.",
      rewriteOnlyFix: "no",
    },
    {
      id: "examples_win_conflict",
      category: "card_content",
      rank: 0,
      weight: 72,
      evidence:
        "Leon example mixes 해요(괜찮아요) + 다나까(각오하십시오); SPEECH CONSISTENCY says examples win over trait prose.",
      rewriteOnlyFix: "yes",
    },
    {
      id: "implicit_context_mapping",
      category: "model_inference",
      rank: 0,
      weight: 68,
      evidence:
        "All three context rules injected every turn; no 'active register for this scene' flag — model must match scene cues to card labels.",
      rewriteOnlyFix: "partial",
    },
    {
      id: "parser_colon_format",
      category: "parser",
      rank: 0,
      weight: 15,
      evidence:
        "Leon card format parses 3/3 context pairs; failures are not from missing colon parse on standard cards.",
      rewriteOnlyFix: "yes",
    },
    {
      id: "genre_tone_priority",
      category: "priority",
      rank: 0,
      weight: opts.patchACompliance && opts.patchACompliance > 40 ? 35 : 75,
      evidence:
        "Pre-Patch A: [genre_tone] late in stack mandated 합니다 register vs canon 해요. Patch A (prod) removes dialogue register from genre_tone.",
      rewriteOnlyFix: "no",
    },
    {
      id: "patch_b_metadata_regression",
      category: "runtime_wiring",
      rank: 0,
      weight: opts.patchBCompliance !== undefined ? 55 : 40,
      evidence:
        "Patch B wired register_by_context at runtime but validation avg compliance 40.4% vs Patch A 48.1% — structured metadata alone does not improve activation.",
      rewriteOnlyFix: "no",
    },
    {
      id: "prose_recency",
      category: "priority",
      rank: 0,
      weight: 25,
      evidence:
        "Prose bundle (SPEECH METADATA, length, beat flow) sits after CHARACTER CANON in cacheCharacter/dynamic; genre_tone after prose in dynamic tail.",
      rewriteOnlyFix: "partial",
    },
  ];

  if (opts.parserOkRate >= 0.85) {
    const p = causes.find((c) => c.id === "parser_colon_format");
    if (p) p.weight = 8;
  }
  if (opts.productionHasMetadataWire) {
    const m = causes.find((c) => c.id === "metadata_dead_path");
    if (m) m.weight = 20;
  }

  const privateFail = opts.complianceByContext.find((c) => c.contextTag === "유저와 둘만");
  const publicFail = opts.complianceByContext.find((c) => c.contextTag === "공적인 자리");
  if (privateFail && publicFail) {
    if (publicFail.avgCompliance > privateFail.avgCompliance) {
      const im = causes.find((c) => c.id === "implicit_context_mapping");
      if (im) im.weight += 12;
    }
  }

  causes.sort((a, b) => b.weight - a.weight);
  causes.forEach((c, i) => {
    c.rank = i + 1;
  });
  return causes;
}

export function evaluateSamplesFromJson(
  samples: { id: string; text: string; compliance: number }[]
): void {
  for (const s of samples) {
    const scene = REGISTER_VALIDATION_SCENES.find((sc) => sc.id === s.id);
    if (!scene) continue;
    const comp = evaluateRegisterCompliance(s.text, scene.expectedRegister);
    s.compliance = comp.complianceRate;
  }
}
