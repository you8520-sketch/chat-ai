import {
  INVESTIGATION_ACTION_TYPES,
} from "@/lib/investigationCatalog";
import type {
  InvestigationActionType,
  InvestigationAuthoritativeOutcome,
  InvestigationExplicitAction,
  InvestigationSourceType,
} from "@/lib/investigationTypes";

export type InvestigationRequestCandidate = {
  actionType: InvestigationActionType;
  targetKey: string;
  sourceType: InvestigationSourceType;
  actionId?: string;
  /** Only set for authoritative server/creator outcomes. */
  outcomeOverride?: Omit<
    InvestigationAuthoritativeOutcome,
    "actionType" | "targetKey" | "sourceType"
  >;
};

const ACTION_SET = new Set<string>(INVESTIGATION_ACTION_TYPES);

function looksLikeSecretSmuggle(keys: string[]): boolean {
  return keys.some((k) =>
    /secret|knowledge|canonical|discovery|alias|revealed/i.test(k)
  );
}

/**
 * Parse client investigationActions — never accepts secret-bearing keys
 * or free-form result payloads from the user (S3A remains secret-blind).
 */
export function parseInvestigationExplicitActions(
  raw: unknown
): InvestigationExplicitAction[] {
  if (!Array.isArray(raw)) return [];
  const out: InvestigationExplicitAction[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (looksLikeSecretSmuggle(Object.keys(o))) continue;
    // User must not inject result payloads.
    if (
      "resultType" in o ||
      "resultTags" in o ||
      "resultState" in o ||
      "observableFacts" in o
    ) {
      continue;
    }
    const actionType = String(o.actionType ?? "");
    const targetKey = String(o.targetKey ?? "").trim().slice(0, 128);
    if (!ACTION_SET.has(actionType) || !targetKey) continue;
    out.push({
      actionType: actionType as InvestigationActionType,
      targetKey,
    });
  }
  return out;
}

/**
 * Parse server/creator investigation outcomes. May include result overrides
 * but still must reference an existing targetKey (resolver verifies).
 */
export function parseInvestigationAuthoritativeOutcomes(
  raw: unknown
): InvestigationAuthoritativeOutcome[] {
  if (!Array.isArray(raw)) return [];
  const out: InvestigationAuthoritativeOutcome[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (looksLikeSecretSmuggle(Object.keys(o))) continue;
    const actionType = String(o.actionType ?? "");
    const targetKey = String(o.targetKey ?? "").trim().slice(0, 128);
    const sourceType = String(o.sourceType ?? "");
    if (!ACTION_SET.has(actionType) || !targetKey) continue;
    if (sourceType !== "SERVER_SCENE_EVENT" && sourceType !== "CREATOR_TRIGGER") {
      continue;
    }
    out.push({
      actionType: actionType as InvestigationActionType,
      targetKey,
      sourceType,
      ...(typeof o.resultType === "string"
        ? { resultType: o.resultType as InvestigationAuthoritativeOutcome["resultType"] }
        : {}),
      ...(o.resultState === "PARTIAL" || o.resultState === "VERIFIED"
        ? { resultState: o.resultState }
        : {}),
      ...(Array.isArray(o.resultTags)
        ? { resultTags: o.resultTags.map(String).slice(0, 12) }
        : {}),
      ...(Array.isArray(o.observableFacts)
        ? { observableFacts: o.observableFacts.map(String).slice(0, 8) }
        : {}),
      ...(typeof o.confidence === "number" ? { confidence: o.confidence } : {}),
    });
  }
  return out;
}

/**
 * High-precision deterministic request candidates from user prose.
 * Creates REQUESTS only — never invents success results or targets.
 */
export function extractInvestigationRequestCandidatesFromUserMessage(
  userMessage: string
): InvestigationRequestCandidate[] {
  const msg = userMessage.replace(/\r\n?/g, "\n").trim();
  if (!msg || msg.length > 2000) return [];
  const out: InvestigationRequestCandidate[] = [];

  // Document read — requires concrete document label + read verb.
  const docRead = msg.match(
    /(?:([가-힣A-Za-z0-9]{2,24})(?:을|를|은|는)?\s*)?(?:펼쳐\s*읽|내용을\s*(?:읽|확인)|문서를\s*읽|읽어\s*보)/
  );
  if (docRead) {
    const label = (docRead[1] ?? extractNearbyDocumentLabel(msg) ?? "").trim();
    if (label && !/조사|기록|신원/.test(label)) {
      out.push({
        actionType: "READ_DOCUMENT",
        targetKey: `doc:${label.toLowerCase()}`,
        sourceType: "USER_MESSAGE_DETERMINISTIC",
        actionId: `msg-read-${label.toLowerCase()}`,
      });
    }
  }

  // Document verify / authenticity
  if (/(진위|위조\s*여부|원본\s*대조|공식\s*대조).{0,24}(확인|검증|대조)/.test(msg)
    || /(확인|검증|대조).{0,24}(진위|위조|원본)/.test(msg)) {
    const label = extractNearbyDocumentLabel(msg);
    if (label) {
      out.push({
        actionType: "VERIFY_DOCUMENT",
        targetKey: `doc:${label.toLowerCase()}`,
        sourceType: "USER_MESSAGE_DETERMINISTIC",
        actionId: `msg-verify-${label.toLowerCase()}`,
      });
    }
  }

  // Identity verification
  if (
    /(신원|신분|신분증|주민등록).{0,20}(조회|확인|검증|대조)/.test(msg) ||
    /(조회|확인|검증).{0,20}(신원|신분|신분증)/.test(msg)
  ) {
    out.push({
      actionType: "VERIFY_IDENTITY",
      targetKey: "identity_record",
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      actionId: "msg-verify-identity",
    });
  }

  // Financial records
  if (
    /(금융|채무|빚|부채|계좌).{0,20}(기록|원장|조회|확인)/.test(msg) ||
    /(기록|원장|조회).{0,20}(금융|채무|빚)/.test(msg)
  ) {
    out.push({
      actionType: "CHECK_FINANCIAL_RECORDS",
      targetKey: "financial_record",
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      actionId: "msg-check-financial",
    });
  }

  // Medical exam
  if (/(의료\s*검사|진단\s*검사|병원\s*검사|진찰).{0,12}(하|받|실시|완료)/.test(msg)
    || /(검사|진찰).{0,16}(실시|완료|받)/.test(msg)) {
    out.push({
      actionType: "RUN_MEDICAL_EXAM",
      targetKey: "medical_exam",
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      actionId: "msg-medical-exam",
    });
  }

  // Mark meaning / org record cross-check
  if (
    /(문신|표식|번호).{0,24}(의미|기록).{0,16}(대조|조회|확인)/.test(msg) ||
    /(기관|연구소).{0,16}(기록).{0,12}(대조|조회)/.test(msg)
  ) {
    out.push({
      actionType: "QUERY_DATABASE",
      targetKey: "mark_meaning_record",
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      actionId: "msg-mark-meaning",
    });
  }

  // Item examination
  const itemExam = msg.match(
    /([가-힣A-Za-z0-9]{2,24})(?:을|를)\s*(?:감식|조사|감정|분석)(?:한다|했다|해\s*보)/
  );
  if (itemExam) {
    const label = itemExam[1].trim();
    out.push({
      actionType: "EXAMINE_ITEM",
      targetKey: `item:${label.toLowerCase()}`,
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      actionId: `msg-item-${label.toLowerCase()}`,
    });
  }

  // Deduplicate by actionType+targetKey
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.actionType}:${c.targetKey}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 6);
}

function extractNearbyDocumentLabel(msg: string): string | null {
  const m = msg.match(
    /(독촉장|계약서|진단서|처방전|결과지|신분증|여권|서류|문서|편지|봉투|파일)/
  );
  return m?.[1] ?? null;
}

export function collectInvestigationRequestCandidates(opts: {
  explicitActions?: InvestigationExplicitAction[];
  authoritativeOutcomes?: InvestigationAuthoritativeOutcome[];
  userMessage?: string;
}): InvestigationRequestCandidate[] {
  const out: InvestigationRequestCandidate[] = [];

  for (const a of opts.explicitActions ?? []) {
    out.push({
      actionType: a.actionType,
      targetKey: a.targetKey,
      sourceType: "USER_EXPLICIT_ACTION",
      actionId: `explicit-${a.actionType}-${a.targetKey}`,
    });
  }

  for (const o of opts.authoritativeOutcomes ?? []) {
    out.push({
      actionType: o.actionType,
      targetKey: o.targetKey,
      sourceType: o.sourceType,
      actionId: `auth-${o.sourceType}-${o.actionType}-${o.targetKey}`,
      outcomeOverride: {
        resultType: o.resultType,
        resultState: o.resultState,
        resultTags: o.resultTags,
        observableFacts: o.observableFacts,
        confidence: o.confidence,
      },
    });
  }

  if (opts.userMessage?.trim()) {
    out.push(...extractInvestigationRequestCandidatesFromUserMessage(opts.userMessage));
  }

  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.sourceType}:${c.actionType}:${c.targetKey}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
