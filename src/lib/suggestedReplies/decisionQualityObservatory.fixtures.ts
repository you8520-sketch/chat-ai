import type { SuggestedRepliesDecisionQualityIssue } from "./decisionQualityObservatory";

export type SuggestedRepliesDecisionQualityFixture = {
  id: string;
  label: string;
  rawModelText: string;
  expectedValid: boolean;
  expectedIssues: SuggestedRepliesDecisionQualityIssue[];
};

function text(seed: string, length = 80): string {
  return (seed + "가".repeat(length)).slice(0, length);
}

function raw(items: unknown[]): string {
  return JSON.stringify({ items });
}

/**
 * Frozen offline corpus for the existing suggested-reply contract.
 * No provider output is generated here and no production path imports this file.
 */
export const SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS: SuggestedRepliesDecisionQualityFixture[] = [
  {
    id: "SRDQ-01",
    label: "canonical three-way decision",
    rawModelText: raw([
      { kind: "natural", text: text("자연스럽게 다음 반응을 이어간다. ") },
      { kind: "twist", text: text("예상 밖이지만 개연성 있는 각도로 전환한다. ") },
      { kind: "banter", text: text("말투를 유지하며 가볍게 받아친다. ") },
    ]),
    expectedValid: true,
    expectedIssues: [],
  },
  {
    id: "SRDQ-02",
    label: "malformed JSON",
    rawModelText: "not-json",
    expectedValid: false,
    expectedIssues: ["malformed_json"],
  },
  {
    id: "SRDQ-03",
    label: "missing items array",
    rawModelText: JSON.stringify({ replies: [] }),
    expectedValid: false,
    expectedIssues: ["missing_items"],
  },
  {
    id: "SRDQ-04",
    label: "wrong item count",
    rawModelText: raw([
      { kind: "natural", text: text("정석 반응 ") },
      { kind: "twist", text: text("한 수 반응 ") },
    ]),
    expectedValid: false,
    expectedIssues: ["wrong_item_count", "missing_kind"],
  },
  {
    id: "SRDQ-05",
    label: "legacy unknown category",
    rawModelText: raw([
      { kind: "natural", text: text("정석 반응 ") },
      { kind: "twist", text: text("한 수 반응 ") },
      { kind: "escalate", text: text("레거시 분류 반응 ") },
    ]),
    expectedValid: false,
    expectedIssues: ["unknown_kind", "missing_kind"],
  },
  {
    id: "SRDQ-06",
    label: "duplicate category",
    rawModelText: raw([
      { kind: "natural", text: text("첫 정석 반응 ") },
      { kind: "natural", text: text("둘째 정석 반응 ") },
      { kind: "banter", text: text("드립 반응 ") },
    ]),
    expectedValid: false,
    expectedIssues: ["duplicate_kind", "missing_kind"],
  },
  {
    id: "SRDQ-07",
    label: "missing text",
    rawModelText: raw([
      { kind: "natural", text: text("정석 반응 ") },
      { kind: "twist", text: "" },
      { kind: "banter", text: text("드립 반응 ") },
    ]),
    expectedValid: false,
    expectedIssues: ["missing_text"],
  },
  {
    id: "SRDQ-08",
    label: "text below contract minimum",
    rawModelText: raw([
      { kind: "natural", text: text("정석 반응 ") },
      { kind: "twist", text: "너무 짧다" },
      { kind: "banter", text: text("드립 반응 ") },
    ]),
    expectedValid: false,
    expectedIssues: ["text_out_of_bounds"],
  },
  {
    id: "SRDQ-09",
    label: "duplicate normalized text",
    rawModelText: (() => {
      const duplicate = text("같은 반응 ");
      return raw([
        { kind: "natural", text: duplicate },
        { kind: "twist", text: duplicate },
        { kind: "banter", text: text("다른 드립 반응 ") },
      ]);
    })(),
    expectedValid: false,
    expectedIssues: ["duplicate_text"],
  },
  {
    id: "SRDQ-10",
    label: "multiple simultaneous contract failures",
    rawModelText: raw([
      { kind: "natural", text: text("같은 반응 ") },
      { kind: "natural", text: text("같은 반응 ") },
      { kind: "pivot", text: "짧음" },
      { text: text("종류 없음 ") },
    ]),
    expectedValid: false,
    expectedIssues: [
      "wrong_item_count",
      "duplicate_kind",
      "duplicate_text",
      "unknown_kind",
      "text_out_of_bounds",
      "missing_kind",
    ],
  },
];
