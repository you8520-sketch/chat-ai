import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveVariantContent } from "./messageAlternates";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  adultOffApprovedTextHash,
  adultOffStoredTextDisposition,
  applyAdultOffStoredInspection,
  filterAdultOffStatusMeta,
  listAdultOffInspectionTargets,
  presentAdultOffStoredRead,
} from "./adultOffOutputGuard";

const SECRET = "ROW_CONTENT_SECRET_RESTRICTED";
const APPROVED = "그는 가볍게 입을 맞추고 그녀를 안았다.";

function approvedUsage(text: string, extra: Record<string, unknown> = {}) {
  return {
    cost: 12,
    model: "gemini",
    ...extra,
    adultOffGuard: {
      policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
      approvedTextHashes: [adultOffApprovedTextHash(text)],
      restrictedTextHashes: [],
      ...(extra.adultOffGuard as object | undefined),
    },
  };
}

describe("adult-off stored read", () => {
  it("keeps the row.content fallback when the guard is off", () => {
    const presented = presentAdultOffStoredRead({
      applyGuard: false,
      rowContent: SECRET,
      variants: [{ content: "", usage: null }],
      activeVariant: 0,
    });
    assert.equal(presented.content, SECRET);
    assert.equal(
      resolveActiveVariantContent({
        content: SECRET,
        variants: [{ content: "", model: "", usage: null, created_at: "" }],
        activeVariant: 0,
      }),
      SECRET
    );
  });

  it("shows creator greeting without Luna approval when the guard is on", () => {
    const greeting = "창가에서 천천히 고개를 돌렸다.";
    const presented = presentAdultOffStoredRead({
      applyGuard: true,
      rowContent: greeting,
      messageModel: "greeting",
      storedAlternates: null,
      variants: [{ content: greeting, usage: null }],
      activeVariant: 0,
    });
    assert.equal(presented.content, greeting);
    assert.equal(presented.activeDisposition, "unreviewed");
    assert.equal(presented.withheld, false);
  });

  it("withholds user-edited greeting that stored alternates after PATCH", () => {
    const edited = "사용자가 바꾼 인사말";
    const alternates = JSON.stringify([
      { content: edited, model: "greeting", usage: null, created_at: "" },
    ]);
    const presented = presentAdultOffStoredRead({
      applyGuard: true,
      rowContent: edited,
      messageModel: "greeting",
      storedAlternates: alternates,
      variants: [{ content: edited, usage: null }],
      activeVariant: 0,
    });
    assert.equal(presented.content, "");
    assert.equal(presented.activeDisposition, "unreviewed");
    assert.equal(presented.withheld, true);
  });

  it("still hides greeting body when a current-policy restricted hash is stored", () => {
    const greeting = "제한된 인사말 본문";
    const usage = {
      adultOffGuard: {
        policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
        approvedTextHashes: [],
        restrictedTextHashes: [adultOffApprovedTextHash(greeting)],
      },
    };
    const presented = presentAdultOffStoredRead({
      applyGuard: true,
      rowContent: greeting,
      messageModel: "greeting",
      storedAlternates: null,
      variants: [{ content: greeting, usage }],
      activeVariant: 0,
    });
    assert.equal(presented.content, "");
    assert.equal(presented.activeDisposition, "restricted");
    assert.equal(presented.withheld, true);
  });

  it("does not let an empty withheld variant fall back to row.content", () => {
    const presented = presentAdultOffStoredRead({
      applyGuard: true,
      rowContent: SECRET,
      variants: [{ content: "", usage: { cost: 12 } }],
      activeVariant: 0,
    });
    assert.equal(presented.content, "");
    assert.equal(presented.activeDisposition, "unreviewed");
    assert.equal(presented.variants[0]?.content, "");
    assert.equal(
      resolveActiveVariantContent({
        content: presented.content,
        variants: presented.variants.map((variant) => ({
          content: variant.content ?? "",
          model: "",
          usage: null,
          created_at: "",
        })),
        activeVariant: 0,
      }),
      ""
    );
  });

  it("shows an approved body and hides a restricted sibling without moving the index", () => {
    const restricted = "노골적인 제한 본문";
    const usage = {
      cost: 40,
      adultOffGuard: {
        policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
        approvedTextHashes: [adultOffApprovedTextHash(APPROVED), adultOffApprovedTextHash("창가")],
        restrictedTextHashes: [adultOffApprovedTextHash(restricted)],
      },
    };
    const presented = presentAdultOffStoredRead({
      applyGuard: true,
      rowContent: restricted,
      variants: [
        { content: restricted, usage, statusWidgetValues: { character: { 장소: restricted } } },
        { content: APPROVED, usage, statusWidgetValues: { character: { 장소: "창가" } } },
      ],
      activeVariant: 1,
      statusWidgetValues: { character: { 장소: "창가" } },
      suggestedReplies: [{ text: APPROVED }, { text: restricted }],
    });
    assert.equal(presented.activeVariant, 1);
    assert.equal(presented.content, APPROVED);
    assert.equal(presented.activeDisposition, "approved");
    assert.equal(presented.variants[0]?.content, "");
    assert.equal(presented.variants[1]?.content, APPROVED);
    assert.equal(presented.variants[0]?.statusWidgetValues, null);
    assert.equal(presented.suggestedReplies.length, 0);
    assert.equal(presented.statusWidgetValues?.character?.장소, "창가");
  });

  it("withholds unreviewed widget, reply, and status meta text", () => {
    const presented = presentAdultOffStoredRead({
      applyGuard: true,
      rowContent: APPROVED,
      variants: [{ content: APPROVED, usage: approvedUsage(APPROVED) }],
      activeVariant: 0,
      statusWidgetValues: { character: { 장소: "아직 검사하지 않은 상태" } },
      suggestedReplies: [{ text: "아직 검사하지 않은 답장" }],
    });
    assert.equal(presented.content, APPROVED);
    assert.equal(presented.statusWidgetValues, null);
    assert.deepEqual(presented.suggestedReplies, []);
    assert.equal(
      filterAdultOffStatusMeta(true, approvedUsage(APPROVED), {
        location: "아직 검사하지 않은 장소",
      }),
      null
    );
    assert.deepEqual(
      filterAdultOffStatusMeta(false, null, { location: "창가" }),
      { location: "창가" }
    );
  });

  it("does not record a missing hash as restricted and leaves settlement untouched", () => {
    const stored = { cost: 40, model: "gemini" };
    assert.equal(adultOffStoredTextDisposition(stored, SECRET), "unreviewed");
    const failed = applyAdultOffStoredInspection(stored, SECRET, "unresolved");
    assert.equal(failed.wrote, false);
    assert.equal(failed.usage.cost, 40);
    assert.equal(failed.usage.model, "gemini");
    assert.equal(adultOffStoredTextDisposition(failed.usage, SECRET), "unreviewed");
    assert.equal(
      (failed.usage.adultOffGuard as { restrictedTextHashes?: unknown } | undefined)
        ?.restrictedTextHashes,
      undefined
    );
  });

  it("reuses a same-policy verdict and drops hashes from an older policy", () => {
    const text = APPROVED;
    const first = applyAdultOffStoredInspection({ cost: 7 }, text, "approved");
    assert.equal(first.wrote, true);
    assert.equal(first.usage.cost, 7);
    const second = applyAdultOffStoredInspection(first.usage, text, "approved");
    assert.equal(second.wrote, false);
    assert.equal(second.usage, first.usage);
    const hashes = (
      first.usage.adultOffGuard as { approvedTextHashes: string[] }
    ).approvedTextHashes;
    assert.deepEqual(hashes, [adultOffApprovedTextHash(text)]);

    const oldPolicy = {
      cost: 7,
      adultOffGuard: {
        policyVersion: 1,
        approvedTextHashes: [adultOffApprovedTextHash(text)],
      },
    };
    assert.equal(adultOffStoredTextDisposition(oldPolicy, text), "unreviewed");
    const renewed = applyAdultOffStoredInspection(oldPolicy, text, "restricted");
    assert.equal(renewed.wrote, true);
    assert.equal(adultOffStoredTextDisposition(renewed.usage, text), "restricted");
    assert.equal(renewed.usage.cost, 7);
    const guard = renewed.usage.adultOffGuard as {
      policyVersion: number;
      approvedTextHashes: string[];
      restrictedTextHashes: string[];
    };
    assert.equal(guard.policyVersion, ADULT_OFF_GUARD_POLICY_VERSION);
    assert.deepEqual(guard.approvedTextHashes, []);
    assert.deepEqual(guard.restrictedTextHashes, [adultOffApprovedTextHash(text)]);
  });
});

describe("adult-off inspection target mapping", () => {
  it("counts the production-shaped 1347 nonempty assistant variants once", () => {
    const rows: Array<{
      id: number;
      role: string;
      content: string;
      model: string;
      usage: string | null;
      alternates: string | null;
      active_variant: number | null;
    }> = [];
    let id = 1;
    for (let i = 0; i < 576; i += 1) {
      rows.push({
        id: id++,
        role: "assistant",
        content: `합성 본문 ${i}`,
        model: "gemini",
        usage: JSON.stringify({ cost: 1 }),
        alternates: null,
        active_variant: null,
      });
    }
    for (let i = 0; i < 699; i += 1) {
      rows.push({
        id: id++,
        role: "assistant",
        content: `활성 ${i}`,
        model: "gemini",
        usage: JSON.stringify({ cost: 2 }),
        alternates: JSON.stringify([
          { content: `활성 ${i}`, model: "gemini", usage: { cost: 2 }, created_at: "" },
        ]),
        active_variant: 0,
      });
    }
    for (let i = 0; i < 36; i += 1) {
      rows.push({
        id: id++,
        role: "assistant",
        content: `현재 ${i}`,
        model: "gemini",
        usage: JSON.stringify({ cost: 3 }),
        alternates: JSON.stringify([
          { content: `이전 ${i}`, model: "gemini", usage: { cost: 3 }, created_at: "" },
          { content: `현재 ${i}`, model: "gemini", usage: { cost: 4 }, created_at: "" },
        ]),
        active_variant: 1,
      });
    }
    for (let i = 0; i < 25; i += 1) {
      rows.push({
        id: id++,
        role: "assistant",
        content: "   ",
        model: "gemini",
        usage: JSON.stringify({ cost: 0 }),
        alternates: null,
        active_variant: null,
      });
    }
    rows.push({
      id: id++,
      role: "user",
      content: "사용자 본문은 대상이 아니다",
      model: "",
      usage: null,
      alternates: null,
      active_variant: null,
    });

    const targets = listAdultOffInspectionTargets(rows);
    assert.equal(targets.length, 1347);
    assert.equal(targets.filter((target) => target.active).length, 1311);
    assert.equal(targets.filter((target) => !target.active).length, 36);
    const previous = targets.find((target) => target.text === "이전 0");
    assert.equal(previous?.variantIndex, 0);
    assert.equal(previous?.active, false);
    const current = targets.find((target) => target.text === "현재 0");
    assert.equal(current?.variantIndex, 1);
    assert.equal(current?.active, true);

    const duringScan = listAdultOffInspectionTargets([
      ...rows,
      {
        id: 90000,
        role: "assistant",
        content: "검사 중에 저장된 새 본문",
        model: "gemini",
        usage: JSON.stringify({ cost: 8 }),
        alternates: null,
        active_variant: 0,
      },
    ]);
    assert.equal(duringScan.length, 1348);
    assert.equal(duringScan.at(-1)?.messageId, 90000);
    const again = applyAdultOffStoredInspection(
      applyAdultOffStoredInspection({ cost: 8 }, "검사 중에 저장된 새 본문", "approved").usage,
      "검사 중에 저장된 새 본문",
      "approved"
    );
    assert.equal(again.wrote, false);
    assert.equal(again.usage.cost, 8);
  });
});
