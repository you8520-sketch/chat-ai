import { resolveOfficialGenerationReferencePlan } from "@/lib/officialSupply/generationReferences";
import type { OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { OfficialAnchorQaReport } from "@/lib/officialSupply/types";

/**
 * Test reviewer for a generated representative: cites the candidate URL and exactly the references the
 * generator sent, the way a real review evidence file must.
 */
export function withAnchorCompositionEvidence(
  store: OfficialSupplyStore,
  draftKey: string,
  qa: OfficialAnchorQaReport
): OfficialAnchorQaReport {
  const rep = store.representativeAsset(draftKey);
  const sent = resolveOfficialGenerationReferencePlan({
    kind: "representative",
    styleSeed: store.getStyle(store.getCharacter(draftKey).styleKey).styleSeed,
    representativeUrl: null,
  });
  if (!sent.ok) throw new Error(sent.reason);
  return {
    ...qa,
    compositionIndependence: {
      ...qa.compositionIndependence,
      ok: qa.compositionIndependence?.ok ?? true,
      note: qa.compositionIndependence?.note ?? "head angle, gaze, crop and hand position differ from every sent reference",
      evidence: {
        candidateUrl: rep.resultUrl ?? "",
        candidateSha256: "a".repeat(64),
        references: sent.plan.references.map((id) => ({
          id,
          sha256: /^official-review-candidate:([0-9a-f]{64}):/.exec(id)?.[1] ?? "c".repeat(64),
        })),
      },
    },
  };
}
