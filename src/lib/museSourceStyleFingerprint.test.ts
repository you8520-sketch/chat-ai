import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
} from "@/lib/chatModels";
import {
  LIKE_SPECIFIC_V1_PHRASES,
  MUSE_FINGERPRINT_FORBIDDEN_LABELS,
  MUSE_SOURCE_STYLE_FINGERPRINT_HEADER,
  MUSE_SOURCE_STYLE_FINGERPRINT_MAX_CHARS,
  buildMuseSourceStyleFingerprint,
  canonicalizeLastVisibleAssistantRaw,
  computeMuseSourceStyleMetrics,
  extractFingerprintDialogueSpans,
  resolveMuseSourceStyleFingerprintBlock,
} from "./museSourceStyleFingerprint";

function paragraph(n: number, seed: string): string {
  return `${seed} ${"이어지는 서술 문장이다. ".repeat(Math.max(1, n))}장면이 조금 더 이어진다.`;
}

function longSource(opts?: { paragraphs?: number; chars?: number; dialogue?: boolean }): string {
  const count = opts?.paragraphs ?? 12;
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (opts?.dialogue && i % 3 === 1) {
      parts.push(`"이건 고유대사토큰_${i}_XYZ 이다."`);
    } else {
      parts.push(paragraph(4, `문단${i} 시작. 창밖 공기가 조금 달라졌다.`));
    }
  }
  let text = parts.join("\n\n");
  const target = opts?.chars ?? 2400;
  while (text.length < target) {
    text += `\n\n${paragraph(5, "추가 문단. 같은 호흡으로 이어진다.")}`;
  }
  return text;
}

describe("buildMuseSourceStyleFingerprint", () => {
  it("generates a fingerprint for a long HIGH source", () => {
    const raw = longSource({ paragraphs: 12, chars: 2400 });
    const first = buildMuseSourceStyleFingerprint(raw);
    const second = buildMuseSourceStyleFingerprint(raw);
    assert.equal(first.confidence, "HIGH");
    assert.ok(first.block);
    assert.ok(first.block!.startsWith(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER));
    assert.ok(first.block!.length <= MUSE_SOURCE_STYLE_FINGERPRINT_MAX_CHARS);
    assert.equal(first.block, second.block);
    assert.deepEqual(first.metrics, second.metrics);
  });

  it("generates a fingerprint for a MEDIUM source", () => {
    const filler = "같은 호흡의 서술 문장이 이어진다. ";
    const parts = [0, 1, 2].map((i) => {
      let p = `중간 문단 ${i}. `;
      while (p.length < 450) p += filler;
      return p;
    });
    const raw = parts.join("\n\n");
    assert.ok(raw.length >= 1000 && raw.length < 2000);
    assert.ok(raw.split(/\n\s*\n/).length < 8);
    const out = buildMuseSourceStyleFingerprint(raw);
    assert.equal(out.confidence, "MEDIUM");
    assert.ok(out.block);
  });

  it("omits the fingerprint for a LOW source", () => {
    const out = buildMuseSourceStyleFingerprint("짧은 문장 하나.");
    assert.equal(out.confidence, "LOW");
    assert.equal(out.block, null);
  });

  it("excludes status widget values from metrics", () => {
    const prose = longSource({ paragraphs: 10, chars: 2100 });
    const withWidget =
      `${prose}\n\n<<<STATUS_VALUES>>>\n{"time":"밤","place":"복도","secret":"WIDGET_ONLY_TOKEN"}\n<<<END_STATUS>>>`;
    const out = buildMuseSourceStyleFingerprint(withWidget);
    assert.ok(out.metrics);
    assert.equal(out.canonicalRaw.includes("WIDGET_ONLY_TOKEN"), false);
    assert.equal(out.block?.includes("WIDGET_ONLY_TOKEN"), false);
    assert.equal(
      out.metrics!.source_visible_chars,
      computeMuseSourceStyleMetrics(canonicalizeLastVisibleAssistantRaw(prose)).source_visible_chars
    );
  });

  it("excludes noncanonical OOC render", () => {
    const raw = `[NONCANONICAL OOC SCENE]\n${longSource({ chars: 2400 })}`;
    const out = buildMuseSourceStyleFingerprint(raw);
    assert.equal(out.confidence, "LOW");
    assert.equal(out.block, null);
    assert.equal(out.canonicalRaw, "");
  });

  it("excludes system and internal markers", () => {
    const raw = `${longSource({ chars: 2100 })}\n\n[SPEECH LOCK — 말투 테스트]\n<PERSONA>hidden</PERSONA>\n<think>hidden reasoning</think>`;
    const out = buildMuseSourceStyleFingerprint(raw);
    assert.ok(out.block);
    assert.equal(out.canonicalRaw.includes("hidden reasoning"), false);
    assert.equal(out.canonicalRaw.includes("SPEECH LOCK"), false);
    assert.equal(out.canonicalRaw.includes("<PERSONA>"), false);
  });

  it("is Muse-target only", () => {
    const raw = longSource({ chars: 2100 });
    assert.ok(
      resolveMuseSourceStyleFingerprintBlock({
        lastVisibleCanonicalAssistantRaw: raw,
        adultTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      })
    );
    assert.equal(
      resolveMuseSourceStyleFingerprintBlock({
        lastVisibleCanonicalAssistantRaw: raw,
        adultTargetModelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      }),
      null
    );
    assert.equal(
      resolveMuseSourceStyleFingerprintBlock({
        lastVisibleCanonicalAssistantRaw: raw,
        adultTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      null
    );
  });

  it("does not copy source dialogue into the fingerprint", () => {
    const raw = longSource({ paragraphs: 12, chars: 2400, dialogue: true });
    const out = buildMuseSourceStyleFingerprint(raw);
    assert.ok(out.block);
    const unique = extractFingerprintDialogueSpans(raw).find((s) => s.includes("고유대사토큰"));
    assert.ok(unique);
    assert.equal(out.block!.includes("고유대사토큰"), false);
    assert.equal(out.block!.includes(unique!.slice(1, -1)), false);
  });

  it("contains no Like-specific phrases or semantic personality labels", () => {
    const out = buildMuseSourceStyleFingerprint(longSource({ chars: 2400 }));
    assert.ok(out.block);
    for (const phrase of LIKE_SPECIFIC_V1_PHRASES) {
      assert.equal(out.block!.includes(phrase), false);
    }
    for (const label of MUSE_FINGERPRINT_FORBIDDEN_LABELS) {
      assert.equal(out.block!.includes(label), false);
    }
  });
});
