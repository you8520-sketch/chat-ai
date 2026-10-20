/**
 * 보조 출력(상태 메타·추천 답장) 저장 레코드에 남기는 승인 증명.
 * 본문 usage와 같은 정책 버전·정확한 문자열 해시만 인정한다.
 * 분류기, 테이블, 조회 시 유료 호출은 여기 없다.
 */

export type AdultOffAuxApprovalProof = {
  policyVersion: number;
  approvedTextHashes: string[];
};

export function parseAdultOffAuxApproval(raw: unknown): AdultOffAuxApprovalProof | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const guard = raw as { policyVersion?: unknown; approvedTextHashes?: unknown };
  if (typeof guard.policyVersion !== "number" || !Number.isInteger(guard.policyVersion)) {
    return undefined;
  }
  if (!Array.isArray(guard.approvedTextHashes)) return undefined;
  const approvedTextHashes = guard.approvedTextHashes.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
  return { policyVersion: guard.policyVersion, approvedTextHashes };
}

/** `adultOffStoredTextDisposition`이 읽는 usage 모양으로 감싼다. */
export function adultOffProofCarrier(
  proof: AdultOffAuxApprovalProof | null | undefined
): { adultOffGuard: AdultOffAuxApprovalProof } | null {
  return proof ? { adultOffGuard: proof } : null;
}

export class AdultOffVariantUnapprovedError extends Error {
  readonly code = "adult_off_variant_unapproved" as const;
  constructor() {
    super("이 버전은 성인 OFF에서 확인할 수 없어 전환하지 않았습니다.");
    this.name = "AdultOffVariantUnapprovedError";
  }
}
