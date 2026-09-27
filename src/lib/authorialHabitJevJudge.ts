/**
 * Authorial Habit lexical candidate → bounded JEV semantic refinement.
 *
 * Shared semantic-shape owner for benchmark and read-only runtime shadow.
 * This file does not schedule provider calls, mutate prompts, rewrite RP
 * output, or change user billing.
 */
import {
  analyzeAuthorialHabits,
  type HabitCategory,
  type SampleHabitMetrics,
} from "@/lib/authorialHabitAudit";
import type {
  AuthorialHabitJevFixture,
  AuthorialHabitSemanticVerdict,
  AuthorialHabitTarget,
} from "@/lib/authorialHabitJevCorpus";
import type { JevDecisionQuestions } from "@/lib/jevDecisions";

export const AUTHORIAL_HABIT_JEV_QUESTION_ID = "authorial_habit_verdict";
export const AUTHORIAL_HABIT_JEV_VERDICTS = [
  "HABIT_PRESENT",
  "CONTEXTUALLY_JUSTIFIED",
  "UNCERTAIN",
] as const satisfies readonly AuthorialHabitSemanticVerdict[];

const EXCERPT_MAX_CHARS = 1200;

export const AUTHORIAL_HABIT_TARGETS: readonly AuthorialHabitTarget[] = [
  "hand_finger_anchor",
  "explain_interpret_conclude",
  "simile_machi_cherom",
  "gaze_silence_wait_end",
] as const;

const TARGET_CATEGORIES: Record<AuthorialHabitTarget, readonly HabitCategory[]> = {
  hand_finger_anchor: ["hand_anchor", "finger_anchor"],
  explain_interpret_conclude: ["explain_conclude", "interpret_leak"],
  simile_machi_cherom: ["simile_machi", "simile_like"],
  gaze_silence_wait_end: [
    "turn_end_gaze",
    "turn_end_silence",
    "turn_end_wait",
  ],
};

const FORBIDDEN_STATE_KEYS = [
  "userId",
  "user_id",
  "accountId",
  "account_id",
  "billing",
  "personaSecret",
  "persona_secret",
  "memoryDb",
  "memory_db",
  "openRouterApiKey",
  "apiKey",
  "credential",
  "password",
  "email",
  "systemPrompt",
  "characterSetting",
] as const;

export type AuthorialHabitLexicalSignals = {
  hitCount: number;
  maxDensityPer1k: number;
  categories: Array<{ category: HabitCategory; hits: number; densityPer1k: number }>;
  endingTags: string[];
  topPhrases: { phrase: string; count: number }[];
};

export type AuthorialHabitJevState = {
  task: "authorial_habit_quality_triage";
  target: AuthorialHabitTarget;
  lexicalSignals: AuthorialHabitLexicalSignals;
  excerpt: string;
};

export type AuthorialHabitCandidateEvaluation = {
  candidate: boolean;
  signals: AuthorialHabitLexicalSignals;
  metrics: SampleHabitMetrics;
};

export function takeAuthorialHabitExcerpt(text: string, maxChars = EXCERPT_MAX_CHARS): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(-maxChars);
}

export function evaluateAuthorialHabitTarget(input: {
  id: string;
  source: string;
  target: AuthorialHabitTarget;
  text: string;
}): AuthorialHabitCandidateEvaluation {
  const metrics = analyzeAuthorialHabits(input.id, input.source, input.text);
  const categories = TARGET_CATEGORIES[input.target].map((category) => ({
    category,
    hits: metrics.hitsByCategory[category] ?? 0,
    densityPer1k: metrics.densityPer1k[category] ?? 0,
  }));
  const hitCount = categories.reduce((sum, row) => sum + row.hits, 0);
  const maxDensityPer1k = categories.reduce(
    (max, row) => Math.max(max, row.densityPer1k),
    0
  );
  return {
    candidate: hitCount > 0,
    signals: {
      hitCount,
      maxDensityPer1k,
      categories,
      endingTags: [...metrics.endingTags],
      topPhrases: [...metrics.topPhrases],
    },
    metrics,
  };
}

export function evaluateAuthorialHabitCandidate(
  fixture: Pick<AuthorialHabitJevFixture, "id" | "target" | "text">
): AuthorialHabitCandidateEvaluation {
  return evaluateAuthorialHabitTarget({
    id: fixture.id,
    source: "jev-benchmark",
    target: fixture.target,
    text: fixture.text,
  });
}

export function buildAuthorialHabitJevQuestions(): JevDecisionQuestions {
  return {
    [AUTHORIAL_HABIT_JEV_QUESTION_ID]: {
      type: "choice",
      instructions:
        "Judge the highlighted prose pattern, not the overall story quality. Decide whether the lexical signal is an undesirable repetitive/canned authorial habit, a contextually necessary use, or genuinely ambiguous from this bounded excerpt.",
      criteria: {
        HABIT_PRESENT:
          "The flagged pattern acts mainly as repetitive, generic, redundant, or canned narration/padding; removing or varying it would preserve the scene's concrete information.",
        CONTEXTUALLY_JUSTIFIED:
          "The flagged pattern is materially required by the physical task, deduction, relationship continuity, tactical explanation, or other concrete scene function; it is not merely generic padding.",
        UNCERTAIN:
          "The bounded excerpt does not provide enough context to distinguish a meaningful character/scene-specific choice from a generic authorial habit.",
      },
    },
  };
}

export function buildAuthorialHabitJevStateFromText(input: {
  target: AuthorialHabitTarget;
  text: string;
  signals: AuthorialHabitLexicalSignals;
}): AuthorialHabitJevState {
  return {
    task: "authorial_habit_quality_triage",
    target: input.target,
    lexicalSignals: {
      hitCount: input.signals.hitCount,
      maxDensityPer1k: input.signals.maxDensityPer1k,
      categories: input.signals.categories.map((row) => ({ ...row })),
      endingTags: [...input.signals.endingTags],
      topPhrases: input.signals.topPhrases.map((row) => ({ ...row })),
    },
    excerpt: takeAuthorialHabitExcerpt(input.text),
  };
}

export function buildAuthorialHabitJevState(input: {
  fixture: AuthorialHabitJevFixture;
  signals: AuthorialHabitLexicalSignals;
}): AuthorialHabitJevState {
  return buildAuthorialHabitJevStateFromText({
    target: input.fixture.target,
    text: input.fixture.text,
    signals: input.signals,
  });
}

export function parseAuthorialHabitJevVerdict(
  answers: Record<string, { type?: string; choice?: string }>
): AuthorialHabitSemanticVerdict | null {
  const row = answers[AUTHORIAL_HABIT_JEV_QUESTION_ID];
  if (!row || row.type !== "choice" || typeof row.choice !== "string") return null;
  const choice = row.choice.trim();
  if ((AUTHORIAL_HABIT_JEV_VERDICTS as readonly string[]).includes(choice)) {
    return choice as AuthorialHabitSemanticVerdict;
  }
  return null;
}

export function assertAuthorialHabitJevStateHasNoPrivateIdentifiers(
  state: Record<string, unknown>
): string[] {
  const hits: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      for (const forbidden of FORBIDDEN_STATE_KEYS) {
        const needle = forbidden.toLowerCase();
        if (lower === needle || lower.includes(needle)) {
          hits.push(`${path}.${key}`);
        }
      }
      walk(nested, `${path}.${key}`);
    }
  };
  walk(state, "state");
  return hits;
}
