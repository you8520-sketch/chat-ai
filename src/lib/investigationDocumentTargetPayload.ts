/**
 * Secret-blind investigation target payloads from publicly observable document labels.
 * MUST NOT read persona secrets, secret_description, or canonical text.
 */
import type { InvestigationResultPayload } from "@/lib/investigationTypes";

function normalizeDocumentLabel(label: string): string {
  return label.trim().replace(/\s+/g, "");
}

/**
 * Build a verification payload from document type semantics only.
 * Tags are generic observables — matching discovery rules depends on persona rules,
 * not on reading stored secrets.
 */
export function buildSecretBlindDocumentTargetPayload(opts: {
  documentLabel: string;
  identityDocument?: boolean;
}): InvestigationResultPayload {
  const label = normalizeDocumentLabel(opts.documentLabel);
  const identity = opts.identityDocument === true || /신분증|주민등록|여권/.test(label);

  if (/독촉장/.test(label)) {
    return {
      resultType: "DOCUMENT_CONTENT_VERIFIED",
      resultState: "VERIFIED",
      resultTags: ["debt_notice", "debtor_identity_match"],
      observableFacts: ["독촉장에 채무 관련 기재가 확인된다."],
    };
  }

  if (identity) {
    return {
      resultType: "DOCUMENT_CONTENT_VERIFIED",
      resultState: "VERIFIED",
      resultTags: ["identity_document_presented"],
      observableFacts: [`${label}이 장면에 제시되었다.`],
    };
  }

  if (/계약서/.test(label)) {
    return {
      resultType: "DOCUMENT_CONTENT_VERIFIED",
      resultState: "VERIFIED",
      resultTags: ["contract_document"],
      observableFacts: [`${label}에 계약 관련 기재가 확인된다.`],
    };
  }

  if (/진단서|결과지|처방전|검사\s*결과지/.test(label)) {
    return {
      resultType: "DOCUMENT_CONTENT_VERIFIED",
      resultState: "VERIFIED",
      resultTags: ["medical_record_document"],
      observableFacts: [`${label}에 의료 관련 기재가 확인된다.`],
    };
  }

  return {
    resultType: "DOCUMENT_CONTENT_VERIFIED",
    resultState: "VERIFIED",
    resultTags: ["document_presented"],
    observableFacts: [`${label}이 장면에 제시되었다.`],
  };
}
