#!/usr/bin/env npx tsx
/**
 * Read-only infra trace: why #630 H2 had finish_reason=error but
 * PRODUCTION_WOULD_DELIVER_RESPONSE=true. No production changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";

loadEnvLocal();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = join(ROOT, "docs/audits/h2-openrouter-valid-replacement");
const FROZEN = join(OUT, "source-frozen");

function save(rel: string, content: object) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(content, null, 2), "utf8");
}

async function main() {
  const h630Ref = join(FROZEN, "h630-reference");
  const h630Provider = JSON.parse(
    readFileSync(join(h630Ref, "h2-provider-accounting.json"), "utf8")
  ) as Record<string, unknown>;
  const h630FailedRaw = readFileSync(join(h630Ref, "H2-DEEPSEEK-RAW.txt"), "utf8");

  const {
    detectAdultGenerationFailure,
    endsAtCompleteSentence,
    isCatastrophicallyShortResponse,
  } = await import("../../../../src/lib/responseLength");
  const { sanitizeStreamArtifacts } = await import("../../../../src/lib/responseLength");
  const { stripRpMetaLeakage, trimTrailingVisibleSelfCritique } = await import(
    "../../../../src/lib/narrativeRules"
  );
  const { stripFlashOwnedArtifactsOnly } = await import("../../../../src/lib/streamFirstSave");
  const { visibleAssistantDisplayCharCount } = await import(
    "../../../../src/lib/chatDisplayLength"
  );
  const { RECOVERY_SUB_CALLS_ENABLED } = await import("../../../../src/lib/turnApiBudget");

  const finishReason = String(h630Provider.DELIVERED_FINISH_REASON ?? "error");
  const partialPath = join(OUT, "source-frozen/T3-H2-630-FAILED-PARTIAL-PERSISTED.txt");
  const persistedEquivalent = readFileSync(partialPath, "utf8");

  const generationFailure = detectAdultGenerationFailure(
    finishReason,
    persistedEquivalent,
    3200
  );
  const auditWouldDeliver = persistedEquivalent.trim().length > 0;

  const report = {
    SOURCE: "#630 H2 production failover path (CI 502 → OpenRouter backup)",
    FINISH_REASON_ERROR_OWNER:
      "OpenRouter SSE emitted finish_reason=error on backup stream; " +
      "detectAdultGenerationFailure() does not treat finish_reason=error as failure; " +
      "audit script PRODUCTION_WOULD_DELIVER_RESPONSE = non-empty sanitized text only",
    FINISH_REASON_ERROR_TREATED_AS_PROVIDER_FAILURE: false,
    PARTIAL_ERROR_STREAM_PERSISTED_BY_PRODUCTION: generationFailure === null && auditWouldDeliver,
    RECOVERY_OR_FAILOVER_AFTER_VISIBLE_ERROR: false,
    evidence: {
      DELIVERED_FINISH_REASON: finishReason,
      DELIVERED_HTTP: h630Provider.OPENROUTER_BACKUP_SUCCESS ? 200 : h630Provider.CI_HTTP_STATUS,
      PRODUCTION_WOULD_DELIVER_RESPONSE: h630Provider.PRODUCTION_WOULD_DELIVER_RESPONSE ?? auditWouldDeliver,
      ENDS_COMPLETE_SENTENCE: h630Provider.DELIVERED_ENDS_COMPLETE_SENTENCE ?? endsAtCompleteSentence(persistedEquivalent),
      VISIBLE_CHARS: visibleAssistantDisplayCharCount(persistedEquivalent),
      detectAdultGenerationFailure_result: generationFailure,
      isCatastrophicallyShortResponse: isCatastrophicallyShortResponse(persistedEquivalent, 3200),
      RECOVERY_SUB_CALLS_ENABLED,
      raw_ends_mid_sentence: !endsAtCompleteSentence(persistedEquivalent),
      raw_tail_preview: h630FailedRaw.slice(-40) || persistedEquivalent.slice(-40),
    },
    code_owners: {
      stream_accepts_error_with_body:
        "src/lib/openRouterAdult.ts — non-empty fullText returned when finishReason=error",
      generation_gate:
        "src/lib/responseLength.ts detectAdultGenerationFailure — no finish_reason=error branch",
      route_persist_on_null_failure:
        "src/app/api/chat/route.ts — generationFailure null → normal persist path",
      audit_script_gate:
        "docs/audits/h2-minimal-handoff-style-reminder/scripts/run-h2-baseline.ts — wouldDeliver = trim().length > 0",
    },
    NO_PRODUCTION_CHANGE: true,
  };

  save("meta/infra-finish-reason-error-trace.json", report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
