/**
 * Phase B1-C.1 — Pre-LLM latest-regen numeric chain readiness (fail-closed).
 *
 * Distinguishes from historical replay:
 *   historical = later canonical turn exists
 *   chain-not-ready = latest turn but numeric event tip not aligned / absent
 *
 * V1 does NOT reconstruct a ledger from legacy status snapshots.
 */
import type Database from "better-sqlite3";
import type { CanonicalEligibleNumericField } from "./canonicalPolicy";
import { getNumericStateCurrent } from "./persistence";

type Db = Database.Database;

export type NumericRegenChainGateCode =
  | "numeric_state_regen_not_bootstrapped"
  | "numeric_state_regen_chain_not_ready";

export type NumericRegenChainReadiness =
  | { ok: true }
  | {
      ok: false;
      code: NumericRegenChainGateCode;
      error: string;
    };

/**
 * For latest regeneration (caller already excluded historical turns):
 * every eligible field must have a current row tipped at regenerateMessageId
 * with a non-null last_event_id.
 */
export function evaluateNumericRegenChainReadiness(input: {
  db: Db;
  chatId: number;
  regenerateMessageId: number;
  fields: CanonicalEligibleNumericField[];
}): NumericRegenChainReadiness {
  const fields = input.fields;
  if (fields.length === 0) return { ok: true };

  let missingCurrent = false;
  let chainMismatch = false;

  for (const field of fields) {
    const current = getNumericStateCurrent(
      input.db,
      input.chatId,
      field.stateKey
    );
    if (!current) {
      missingCurrent = true;
      continue;
    }
    if (
      current.lastSourceMessageId !== input.regenerateMessageId ||
      current.lastEventId == null
    ) {
      chainMismatch = true;
    }
  }

  // Prefer not_bootstrapped when any field lacks current (legacy transition).
  if (missingCurrent) {
    return {
      ok: false,
      code: "numeric_state_regen_not_bootstrapped",
      error:
        "이 대화는 아직 숫자 상태 체인이 없어 바로 재생성할 수 없습니다. 새 턴을 먼저 진행해 주세요.",
    };
  }
  if (chainMismatch) {
    return {
      ok: false,
      code: "numeric_state_regen_chain_not_ready",
      error:
        "숫자 상태 체인이 이 답변과 일치하지 않아 재생성할 수 없습니다.",
    };
  }
  return { ok: true };
}
