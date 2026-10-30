import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveVariantContent } from "./messageAlternates";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  adultOffApprovedTextHash,
  adultOffStoredTextDisposition,
  filterAdultOffStatusMeta,
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

  it("leaves a hash from another policy version unreviewed", () => {
    const oldPolicy = {
      cost: 7,
      adultOffGuard: {
        policyVersion: 1,
        approvedTextHashes: [adultOffApprovedTextHash(APPROVED)],
        restrictedTextHashes: [adultOffApprovedTextHash(SECRET)],
      },
    };
    assert.equal(adultOffStoredTextDisposition(oldPolicy, APPROVED), "unreviewed");
    assert.equal(adultOffStoredTextDisposition(oldPolicy, SECRET), "unreviewed");
    assert.equal(adultOffStoredTextDisposition({ cost: 40, model: "gemini" }, SECRET), "unreviewed");
  });
});
