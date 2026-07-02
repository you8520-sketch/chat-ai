import { parseCharacterSettingIntoSections as splitSettingSections } from "@/lib/characterSettingSections";
import {
  formatSpeechSectionAsMetadata,
  isSpeechMetadataSection,
} from "@/lib/speechMetadataPolicy";
import { isRegisterPatch } from "@/lib/registerPatchExperiment";

/** Injected before structured canon — knowledge is per-character, not shared prompt context. */
export const CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK = `[CHARACTER KNOWLEDGE BOUNDARY]
Knowledge is character-specific. Never transfer knowledge between characters.

Each character may only know:
- what they personally experienced
- what they personally observed
- what they were explicitly told in-scene

Never expose as [A] memory or dialogue unless canonically known:
- timeline / loop / regression mechanics
- future events
- system commands or status UI rules
- scenario notes or creator notes
- prompt metadata

Scenario canon is not character memory.
Narrative context is not character awareness.
World information does not imply every character knows it.

Knowledge is independent for every character.
Do not synchronize memories between characters.
Shared prompt context does not imply shared memories.

Only [B] retains player-only secrets unless [A] was explicitly told in the story.
Other characters must not behave as if they remember previous timelines, past lives, or off-screen loops unless the CHARACTER CANON section explicitly grants that memory (e.g. déjà vu without factual recall).

[KNOWLEDGE PRECEDENCE — highest to lowest]
1. CHARACTER CANON — what [A] may know and roleplay
2. Observed conversation — events witnessed in this chat
3. WORLD CANON — public in-world facts (not automatic [A] memory)
4. SCENARIO META — lowest; story structure only, never spoken as [A] memory

PLAYER CANON is [B]-only — [A] must never treat it as memory.
WORLD CANON does not become CHARACTER knowledge unless [A] witnessed it or was told in-scene.
SCENARIO META never overrides CHARACTER knowledge boundaries.`;

const SCENARIO_META_TITLE =
  /(?:system\s*command|time\s*&\s*event|status\s*display|bad\s*end|happy\s*end|loop\s*trigger|system\s*reset|ooc\s*:|시스템\s*명령|상태\s*표시|배드\s*엔드|해피\s*엔드|루프|회귀\s*트리거|타임\s*라인|메타\s*규칙)/i;

const WORLD_TITLE =
  /(?:세계관|worldview|world|empire|kingdom|continent|monsters?|erebus|cult|국가|제국|왕국|대륙|괴물|교단)/i;

const CHARACTER_TITLE =
  /(?:name|identity|appearance|personality|current\s*status|말투|외형|외모|성격|정체성|이름|현재\s*신분|레온|speech|personality\s*keywords|피의\s*저주)/i;

/** Paragraphs describing player-only or loop/scenario facts — not [A] memory. */
const PLAYER_SCENARIO_PARAGRAPH =
  /(?:{{user}}|{{char}}|\[B\]\s*(?:only|만)|only\s*(?:the\s*)?player|유저(?:만|에게만)|플레이어만|회귀(?:했다|함|한|를)|regress(?:ion|ed)|reborn\s+as|빙의|transmigr|car\s*accident|교통\s*사고|현대\s*(?:인|에서)|two\s*failures|third\s*regression|loop\s*restart(?:ing)?|retaining\s+all\s*memories|System\s*Reset|Bad\s*End\s*Condition|D-\[?Days|won['']t\s+hold\s+back|이(?:번이|가)?\s*(?:세|두)번째\s*회귀|두\s*번(?:의)?\s*(?:삶|실패)|지난\s*(?:두\s*번|이\s*전)\s*(?:의\s*)?(?:삶|번)|previous\s*(?:lives|timelines))/i;

/** In-character knowledge cues — keep even when paragraph mentions regression causally. */
const CHARACTER_KNOWLEDGE_CUE =
  /(?:데자뷔|d[ée]j[àa]\s*vu|기시감|unnervingly\s+drawn|political\s+traps|suspecting|느낀\s*적|끌린|신경(?:이)?\s*쓰|어쩐지|의심(?:했|한다|함))/i;

function scrubRegressionCausationForCharacter(text: string): string {
  return text
    .replace(/유저(?:의)?\s*회귀(?:의)?\s*영향(?:으로)?/gi, "")
    .replace(/\{\{user\}\}(?:의|'s)?\s*regression[^\n,.]*[,\s]*/gi, "")
    .replace(/due to\s+[^\n,.]*regression[^\n,.]*[,\s]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type CanonKnowledgeBucket = "character" | "world" | "player" | "scenario_meta";

export type ClassifiedCanonSection = {
  title: string;
  body: string;
  bucket: CanonKnowledgeBucket;
};

function formatSection(title: string, body: string): string {
  const t = title.trim();
  const b = body.trim();
  if (!b) return "";
  return t ? `${t}\n${b}` : b;
}

function formatCanonSectionBlock(title: string, body: string): string {
  if (isRegisterPatch("B") && isSpeechMetadataSection(title, body)) {
    return formatSpeechSectionAsMetadata(title, body);
  }
  return formatSection(title, body);
}

/** Patch D — re-emit speech metadata from canon at prompt tail (existing text only). */
export function buildCharacterSpeechRecencyTail(combinedSetting: string): string {
  const trimmed = combinedSetting.trim();
  if (!trimmed) return "";

  const blocks: string[] = [];
  for (const section of splitSettingSections(trimmed)) {
    for (const classified of classifySettingSectionKnowledge(section)) {
      if (
        classified.bucket !== "character" ||
        !isSpeechMetadataSection(classified.title, classified.body, "speech")
      ) {
        continue;
      }
      const meta = formatSpeechSectionAsMetadata(classified.title, classified.body);
      if (meta.trim()) blocks.push(meta.trim());
    }
  }

  if (blocks.length === 0) return "";
  return blocks.join("\n\n");
}

function defaultBucketForTitle(title: string, hint?: string): CanonKnowledgeBucket {
  if (SCENARIO_META_TITLE.test(title)) return "scenario_meta";
  if (WORLD_TITLE.test(title) && !/personality|성격|말투/i.test(title)) return "world";
  if (CHARACTER_TITLE.test(title)) return "character";
  if (hint === "world") return "world";
  if (hint === "identity" || hint === "personality" || hint === "speech" || hint === "abilities") {
    return "character";
  }
  return "character";
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function classifyParagraph(
  paragraph: string,
  titleBucket: CanonKnowledgeBucket
): CanonKnowledgeBucket {
  if (CHARACTER_KNOWLEDGE_CUE.test(paragraph)) {
    return "character";
  }
  if (PLAYER_SCENARIO_PARAGRAPH.test(paragraph)) {
    return titleBucket === "world" ? "player" : "player";
  }
  if (SCENARIO_META_TITLE.test(paragraph)) return "scenario_meta";
  return titleBucket;
}

export function classifySettingSectionKnowledge(section: {
  title: string;
  body: string;
  hint?: string;
}): ClassifiedCanonSection[] {
  const title = section.title.trim();
  const body = section.body.trim();
  if (!body) return [];

  const titleBucket = defaultBucketForTitle(title, section.hint);
  if (titleBucket === "scenario_meta") {
    return [{ title, body, bucket: "scenario_meta" }];
  }
  const paragraphs = splitParagraphs(body);
  if (paragraphs.length <= 1) {
    const bucket =
      paragraphs.length === 1
        ? classifyParagraph(paragraphs[0]!, titleBucket)
        : titleBucket;
    return [{ title, body, bucket }];
  }

  const byBucket = new Map<CanonKnowledgeBucket, string[]>();
  for (const p of paragraphs) {
    let bucket = classifyParagraph(p, titleBucket);
    let text = p;
    if (bucket === "character" && PLAYER_SCENARIO_PARAGRAPH.test(p)) {
      text = scrubRegressionCausationForCharacter(p);
    }
    const list = byBucket.get(bucket) ?? [];
    list.push(text);
    byBucket.set(bucket, list);
  }

  const out: ClassifiedCanonSection[] = [];
  for (const [bucket, paras] of byBucket) {
    out.push({ title, body: paras.join("\n\n"), bucket });
  }
  return out;
}

export function buildStructuredCharacterCanonBlock(
  combinedSetting: string,
  charName?: string
): string {
  const trimmed = combinedSetting.trim();
  if (!trimmed) return "";

  const aiLabel = charName?.trim() || "[A]";
  const sections = splitSettingSections(trimmed);
  const buckets: Record<CanonKnowledgeBucket, string[]> = {
    character: [],
    world: [],
    player: [],
    scenario_meta: [],
  };

  if (sections.length === 0) {
    buckets.character.push(trimmed);
  } else {
    for (const section of sections) {
      for (const classified of classifySettingSectionKnowledge(section)) {
        const block = formatCanonSectionBlock(classified.title, classified.body);
        if (block) buckets[classified.bucket].push(block);
      }
    }
  }

  const parts: string[] = [];

  if (buckets.character.length) {
    parts.push(
      `[CHARACTER CANON — ${aiLabel} MAY KNOW & ROLEPLAY]\n${buckets.character.join("\n\n")}`
    );
  }
  if (buckets.world.length) {
    parts.push(
      `[WORLD CANON — IN-WORLD FACTS (not automatic ${aiLabel} memory)]\n${buckets.world.join("\n\n")}`
    );
  }
  if (buckets.player.length) {
    parts.push(
      `[PLAYER CANON — ${aiLabel} DOES NOT KNOW]\nOnly [B] knows this. ${aiLabel} must never speak or think as if they remember, experienced, or were told this.\n\n${buckets.player.join("\n\n")}`
    );
  }
  if (buckets.scenario_meta.length) {
    parts.push(
      `[SCENARIO META — CREATOR / SYSTEM — NOT ${aiLabel} KNOWLEDGE]\nFollow for story structure only. Never quote, paraphrase, or roleplay as if ${aiLabel} knows this metadata.\n\n${buckets.scenario_meta.join("\n\n")}`
    );
  }

  if (parts.length === 0) return "";
  return parts.join("\n\n");
}

/** Structured canon blocks + legacy alias for callers expecting a single header. */
export function buildCharacterCanonBlock(combinedSetting: string, charName?: string): string {
  const structured = buildStructuredCharacterCanonBlock(combinedSetting, charName);
  if (!structured) return "";
  return structured;
}
