/**
 * Diagnostic ablation fixtures — recompose existing few-shot templates only (no new prose).
 */
import {
  buildHandHeavyFewShot,
  buildSpaceSoundFewShot,
  defaultPlatformNarrationFewShot,
  NARRATION_FEWSHOT_PROFILES,
  type NarrationFewShotProfile,
} from "@/lib/narrationFewShotTemplates";

export type PersonalityVariant = "terse" | "formal" | "casual";

export function profileById(id: string): NarrationFewShotProfile {
  const p = NARRATION_FEWSHOT_PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`unknown profile ${id}`);
  return p;
}

/** Few-shot dialogue lines from `dialogueFrom`, rest from `base`. */
export function mergeProfileDialogue(
  base: NarrationFewShotProfile,
  dialogueFrom: NarrationFewShotProfile
): NarrationFewShotProfile {
  return {
    ...base,
    replyDaily: dialogueFrom.replyDaily,
    replyWorried: dialogueFrom.replyWorried,
    replyAlert: dialogueFrom.replyAlert,
    replyHush: dialogueFrom.replyHush,
  };
}

/** Platform-default 존댓말 reply lines on arbitrary charName (production fallback shape). */
export function platformFallbackDialogueProfile(charName: string): NarrationFewShotProfile {
  const raw = defaultPlatformNarrationFewShot(charName.trim() || "캐릭터");
  const replies = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  if (replies.length < 4) {
    throw new Error("platform fallback dialogue parse failed");
  }
  const base = profileById("terse");
  return {
    ...base,
    charName: charName.trim() || base.charName,
    replyDaily: replies[0]!,
    replyWorried: replies[1]!,
    replyAlert: replies[2]!,
    replyHush: replies[3]!,
  };
}

/** Formal narration+dialogue few-shot with charName substituted (structure transplant). */
export function formalFewShotTransplantedTo(base: NarrationFewShotProfile): NarrationFewShotProfile {
  const formal = profileById("formal");
  return mergeProfileDialogue(
    { ...formal, charName: base.charName, id: base.id, label: base.label },
    formal
  );
}

export function systemPromptForPersonality(variant: PersonalityVariant): string {
  if (variant === "formal") {
    return `# 성격\n냉정하고 규율적이다.\n\n# 말투\n- 평소: "~습니다", "~요" 존댓말\n- 긴장: 문장 단축`;
  }
  if (variant === "casual") {
    return `# 성격\n다정하고 관찰력이 있다.\n\n# 말투\n- 평소: "~요", "~네" 부드러운 존댓말`;
  }
  return `# 성격\n냉철하고 직설적이다.\n\n# 말투\n- 평소: 반말, 짧은 문장`;
}

export function buildExampleDialog(
  profile: NarrationFewShotProfile,
  handHeavy: boolean,
  lengthMode: "full" | "twoBeats" | "quotesOnly" = "full"
): string {
  let text = handHeavy ? buildHandHeavyFewShot(profile) : buildSpaceSoundFewShot(profile);
  if (lengthMode === "full") return text;
  if (lengthMode === "quotesOnly") return truncateFewShotQuotesOnly(text);
  return truncateFewShotBeats(text, 2);
}

/** Keep first N user/char exchange blocks from existing few-shot. */
export function truncateFewShotBeats(text: string, maxBeats: number): string {
  const parts = text.split(/\n(?=유저:)/).filter(Boolean);
  return parts.slice(0, maxBeats).join("\n").trim();
}

/** Strip narration; keep 유저/캐릭터 cue lines and quoted dialogue from existing few-shot. */
export function truncateFewShotQuotesOnly(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^유저:/.test(t)) {
      kept.push(t);
      continue;
    }
    if (/^[^:]+:\s*"/.test(t) || /^"[^"]+"$/.test(t)) {
      kept.push(t);
    }
  }
  return kept.join("\n\n");
}

export function fewShotCharLength(text: string): { chars: number; beats: number; quoteLines: number } {
  return {
    chars: text.length,
    beats: text.split(/\n(?=유저:)/).filter(Boolean).length,
    quoteLines: (text.match(/^"[^"]+"$/gm) ?? []).length,
  };
}

export type DiagnosticFactor =
  | "speech-tone"
  | "personality"
  | "fewshot-length"
  | "honorific-fallback"
  | "structure-transplant";

export type FactorArm = {
  factorId: DiagnosticFactor;
  arm: "control" | "variant";
  label: string;
  profile: NarrationFewShotProfile;
  personality: PersonalityVariant;
  lengthMode: "full" | "twoBeats" | "quotesOnly";
};

export function armsForFactor(factorId: DiagnosticFactor): FactorArm[] {
  const terse = profileById("terse");
  const formal = profileById("formal");

  switch (factorId) {
    case "speech-tone":
      return [
        {
          factorId,
          arm: "control",
          label: "terse personality + terse few-shot dialogue",
          profile: terse,
          personality: "terse",
          lengthMode: "full",
        },
        {
          factorId,
          arm: "variant",
          label: "terse personality + formal few-shot dialogue (말투 only)",
          profile: mergeProfileDialogue(terse, formal),
          personality: "terse",
          lengthMode: "full",
        },
      ];
    case "personality":
      return [
        {
          factorId,
          arm: "control",
          label: "terse personality + terse few-shot",
          profile: terse,
          personality: "terse",
          lengthMode: "full",
        },
        {
          factorId,
          arm: "variant",
          label: "formal personality + terse few-shot (성격 only)",
          profile: terse,
          personality: "formal",
          lengthMode: "full",
        },
      ];
    case "fewshot-length":
      return [
        {
          factorId,
          arm: "control",
          label: "terse full 4-beat few-shot",
          profile: terse,
          personality: "terse",
          lengthMode: "full",
        },
        {
          factorId,
          arm: "variant",
          label: "terse quotes-only few-shot (길이 only)",
          profile: terse,
          personality: "terse",
          lengthMode: "quotesOnly",
        },
      ];
    case "honorific-fallback":
      return [
        {
          factorId,
          arm: "control",
          label: "terse few-shot dialogue",
          profile: terse,
          personality: "terse",
          lengthMode: "full",
        },
        {
          factorId,
          arm: "variant",
          label: "platform 존댓말 fallback dialogue on 수아",
          profile: platformFallbackDialogueProfile(terse.charName),
          personality: "terse",
          lengthMode: "full",
        },
      ];
    case "structure-transplant":
      return [
        {
          factorId,
          arm: "control",
          label: "terse-native space/hand structure + terse dialogue",
          profile: terse,
          personality: "terse",
          lengthMode: "full",
        },
        {
          factorId,
          arm: "variant",
          label: "formal narration+dialogue transplanted to 수아 + terse personality",
          profile: formalFewShotTransplantedTo(terse),
          personality: "terse",
          lengthMode: "full",
        },
      ];
    default:
      throw new Error(`unknown factor ${String(factorId)}`);
  }
}

export const ALL_DIAGNOSTIC_FACTORS: DiagnosticFactor[] = [
  "speech-tone",
  "personality",
  "fewshot-length",
  "honorific-fallback",
  "structure-transplant",
];
