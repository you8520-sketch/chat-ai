/**
 * judgePostprocessPrimary verdict tests.
 * Run: node --conditions=react-server --import tsx --test src/lib/rpDiagnosticCanary.judgePostprocess.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capturePostprocessPipeline,
  judgePostprocessPrimary,
} from "@/lib/rpDiagnosticCanary";

const RAW_5_PARA_5_QUOTES = [
  '"본기억이 안 난다고?"',
  "태형은 고개를 갸웃했다.",
  '"글쎄, 우리 어디서 만난 사이였나?"',
  "그는 잠시 생각에 잠겼다.",
  '"아, 참고로 나는 조태형. 라이크라고도 해."',
].join("\n\n");

function buildCapture(opts: {
  raw?: string;
  postDisplay?: string;
  sse?: string;
  db?: string;
}) {
  const raw = opts.raw ?? RAW_5_PARA_5_QUOTES;
  const postDisplay = opts.postDisplay ?? raw;
  const sse = opts.sse ?? raw;
  const db = opts.db ?? raw;
  return capturePostprocessPipeline({
    providerRawMerged: raw,
    preNormalize: raw,
    postNormalize: postDisplay,
    preDisplayGrouping: postDisplay,
    postDisplayGrouping: postDisplay,
    sseFinal: sse,
    dbSaved: db,
  });
}

describe("judgePostprocessPrimary", () => {
  it("RAW 5 paragraphs → SSE 12 paragraphs, same quotes = DISPLAY_ONLY_PARAGRAPH_AMPLIFIER", () => {
    const sse = (RAW_5_PARA_5_QUOTES + "\n\n").replace(/\n\n/g, "\n\n\n\n") + "\n\nextra\n\nblock\n\nhere\n\nsplit";
    const capture = buildCapture({ sse });
    const verdict = judgePostprocessPrimary(capture);
    assert.equal(verdict, "DISPLAY_ONLY_PARAGRAPH_AMPLIFIER");
  });

  it("RAW quote 5 → SSE quote 5, same paragraphs = POSTPROCESS_NOT_PRIMARY", () => {
    const capture = buildCapture({ sse: RAW_5_PARA_5_QUOTES });
    const verdict = judgePostprocessPrimary(capture);
    assert.equal(verdict, "POSTPROCESS_NOT_PRIMARY");
  });

  it("RAW quote 5 → SSE quote 8 = TEXT_MUTATION_CREATES_FRAGMENTATION", () => {
    const sse =
      RAW_5_PARA_5_QUOTES +
      '\n\n"추가 대사 하나"\n\n"추가 대사 둘"\n\n"추가 대사 셋"';
    const capture = buildCapture({ sse });
    const verdict = judgePostprocessPrimary(capture);
    assert.equal(verdict, "TEXT_MUTATION_CREATES_FRAGMENTATION");
  });

  it("postDisplay splits an utterance into more quote blocks = TEXT_MUTATION", () => {
    // One utterance physically split into two quote blocks at postDisplay stage
    const splitPostDisplay = RAW_5_PARA_5_QUOTES.replace(
      '"아, 참고로 나는 조태형. 라이크라고도 해."',
      '"아, 참고로 나는 조태형."\n\n"라이크라고도 해."'
    );
    const capture = buildCapture({ postDisplay: splitPostDisplay, sse: splitPostDisplay });
    const verdict = judgePostprocessPrimary(capture);
    assert.equal(verdict, "TEXT_MUTATION_CREATES_FRAGMENTATION");
  });

  it("visual amplifier direction: SSE fewer paragraphs than RAW is NOT amplifier", () => {
    // SSE collapses paragraphs (fewer) but keeps same quotes. This is a visual
    // change (deflation), but NOT amplification. Must not return AMPLIFIER.
    const sse = RAW_5_PARA_5_QUOTES.replace(/\n\n/g, "\n");
    const capture = buildCapture({ sse });
    const verdict = judgePostprocessPrimary(capture);
    assert.notEqual(verdict, "DISPLAY_ONLY_PARAGRAPH_AMPLIFIER");
  });
});
