/**
 * Bounded JEV semantic contract for Main RP completion-integrity shadow benchmark.
 * FEATURE / BENCHMARK only — not wired into production recovery or billing.
 */
import type { JevDecisionQuestions } from "@/lib/jevDecisions";
import type {
  CompletionIntegrityFixture,
  CompletionIntegrityVerdict,
} from "@/lib/completionIntegrityCorpus";
import type { CompletionCandidateReason } from "@/lib/completionIntegrityCandidate";

export const COMPLETION_INTEGRITY_JEV_QUESTION_ID = "completion_verdict";

export const COMPLETION_INTEGRITY_JEV_VERDICTS = [
  "ABRUPT_CUT",
  "COMPLETE",
  "UNCERTAIN",
] as const satisfies readonly CompletionIntegrityVerdict[];

const TAIL_MAX_CHARS = 800;

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

export type CompletionIntegrityJevState = {
  task: "main_rp_completion_integrity";
  candidateReasons: CompletionCandidateReason[];
  finishReason: string | null;
  localRecoveryApplied: boolean;
  localRecoveryActions: string[];
  finalProseTail: string;
};

export function buildCompletionIntegrityJevQuestions(): JevDecisionQuestions {
  return {
    [COMPLETION_INTEGRITY_JEV_QUESTION_ID]: {
      type: "choice",
      instructions:
        "Decide whether the delivered assistant prose appears physically/semantically cut off before its current sentence, utterance, or action completes. Do not judge whether the larger story could continue.",
      criteria: {
        ABRUPT_CUT:
          "Output ends inside an unfinished word/predicate/clause/utterance/action or otherwise clearly looks like generation stopped before completing the immediate expression.",
        COMPLETE:
          "Current response is semantically self-contained enough to end here, even if the larger scene remains unresolved or intentionally open-ended.",
        UNCERTAIN:
          "Bounded tail/context is insufficient to distinguish intentional fragment/style from actual generation cut.",
      },
    },
  };
}

export function takeFinalProseTail(prose: string, maxChars = TAIL_MAX_CHARS): string {
  const t = prose.trimEnd();
  if (t.length <= maxChars) return t;
  return t.slice(-maxChars);
}

export function buildCompletionIntegrityJevState(input: {
  fixture: CompletionIntegrityFixture;
  candidateReasons: CompletionCandidateReason[];
}): CompletionIntegrityJevState {
  return {
    task: "main_rp_completion_integrity",
    candidateReasons: [...input.candidateReasons],
    finishReason: input.fixture.finishReason,
    localRecoveryApplied: input.fixture.localRecoveryApplied,
    localRecoveryActions: [...input.fixture.localRecoveryActions],
    finalProseTail: takeFinalProseTail(input.fixture.finalProse),
  };
}

export function assertCompletionIntegrityJevStateHasNoPrivateIdentifiers(
  state: Record<string, unknown>
): string[] {
  const hits: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof value !== "object") return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      for (const forbidden of FORBIDDEN_STATE_KEYS) {
        if (lower === forbidden.toLowerCase() || lower.includes(forbidden.toLowerCase())) {
          hits.push(`${path}.${k}`);
        }
      }
      walk(v, `${path}.${k}`);
    }
  };
  walk(state, "state");
  return hits;
}

export function parseCompletionIntegrityJevVerdict(
  answers: Record<string, { type?: string; choice?: string }>
): CompletionIntegrityVerdict | null {
  const row = answers[COMPLETION_INTEGRITY_JEV_QUESTION_ID];
  if (!row || row.type !== "choice" || typeof row.choice !== "string") return null;
  const choice = row.choice.trim();
  if ((COMPLETION_INTEGRITY_JEV_VERDICTS as readonly string[]).includes(choice)) {
    return choice as CompletionIntegrityVerdict;
  }
  return null;
}
