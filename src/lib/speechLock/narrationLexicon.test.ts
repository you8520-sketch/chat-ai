import Module from "module";
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  detectRegisterLexiconInNarration,
  stripDialogueForNarrationScan,
  isNarrationLexiconGateEnabled,
} from "./narrationLexicon";
import { buildNarrationLexiconRewriteUserMessage } from "./prompts";
import {
  NARRATION_LEXICON_FIXTURES,
  REWRITE_SIMULATION_PAIRS,
} from "./narrationLexiconFixtures";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

describe("narrationLexicon", () => {
  it("ignores register labels inside dialogue quotes", () => {
    const text = `레온이 말했다.\n\n"해요체로 말할게요."\n\n그는 고개를 끄덕였다.`;
    const r = detectRegisterLexiconInNarration(text);
    assert.equal(r.fail, false);
  });

  it("flags literal register label in narration", () => {
    const text = `목소리는 해요체의 끝부분이었다.\n\n"…그래요."`;
    const r = detectRegisterLexiconInNarration(text);
    assert.equal(r.fail, true);
    assert.ok(r.hits.some((h) => /해요체/.test(h)));
  });

  it("flags meta label+particle pattern in narration", () => {
    const text = `그의 말투는 해요체로 바뀌었다.\n\n"…알겠어요."`;
    const r = detectRegisterLexiconInNarration(text);
    assert.equal(r.fail, true);
  });

  it("stripDialogueForNarrationScan removes quoted speech", () => {
    const stripped = stripDialogueForNarrationScan(`서사.\n\n"대사 해요체"\n\n더 서사.`);
    assert.ok(!stripped.includes("대사"));
    assert.ok(stripped.includes("서사"));
  });

  it("gate env — Leon only by default", () => {
    const prev = process.env.SPEECH_LOCK_NARRATION_LEXICON;
    const prevLeon = process.env.SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY;
    try {
      process.env.SPEECH_LOCK_NARRATION_LEXICON = "1";
      delete process.env.SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY;
      assert.equal(isNarrationLexiconGateEnabled("레온"), true);
      assert.equal(isNarrationLexiconGateEnabled("백하율"), false);
      process.env.SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY = "0";
      assert.equal(isNarrationLexiconGateEnabled("백하율"), true);
    } finally {
      if (prev === undefined) delete process.env.SPEECH_LOCK_NARRATION_LEXICON;
      else process.env.SPEECH_LOCK_NARRATION_LEXICON = prev;
      if (prevLeon === undefined) delete process.env.SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY;
      else process.env.SPEECH_LOCK_NARRATION_LEXICON_LEON_ONLY = prevLeon;
    }
  });
});

describe("narrationLexicon fixtures (Step 7.7 corpus, API-free)", () => {
  for (const fx of NARRATION_LEXICON_FIXTURES) {
    it(`${fx.id}: expect ${fx.expectFail ? "HIT" : "MISS"} — ${fx.note}`, () => {
      const r = detectRegisterLexiconInNarration(fx.text);
      assert.equal(
        r.fail,
        fx.expectFail,
        `fail=${r.fail} hits=${JSON.stringify(r.hits)} for ${fx.id}`
      );
      if (fx.expectFail && fx.expectHitSubstrings?.length) {
        const joined = r.hits.join(" ");
        for (const sub of fx.expectHitSubstrings) {
          assert.ok(
            joined.includes(sub) || stripDialogueForNarrationScan(fx.text).includes(sub),
            `expected hit containing "${sub}", got ${JSON.stringify(r.hits)}`
          );
        }
      }
    });
  }

  it("rewrite prompt includes detected hits for HIT fixtures", () => {
    const hit = NARRATION_LEXICON_FIXTURES.find((f) => f.id === "n16-run2-haeyo-label")!;
    const { hits } = detectRegisterLexiconInNarration(hit.text);
    assert.ok(hits.length > 0);
    const msg = buildNarrationLexiconRewriteUserMessage(hits);
    assert.match(msg, /NARRATION LEXICON REWRITE/);
    assert.match(msg, /해요체/);
    assert.match(msg, /Never describe honorific|register labels/i);
  });
});

describe("maybeRewriteNarrationLexicon (mocked API, API-free)", () => {
  let mockRewriteText = "";
  let maybeRewriteNarrationLexicon: typeof import("./narrationLexiconRewrite").maybeRewriteNarrationLexicon;

  before(async () => {
    const orig = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === "server-only") return {};
      if (typeof request === "string" && /openRouterCompletion/.test(request)) {
        return {
          callOpenRouterCompletion: async () => ({
            text: mockRewriteText,
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        };
      }
      return orig.call(this, request, parent, isMain);
    } as typeof Module._load;

    ({ maybeRewriteNarrationLexicon } = await import("./narrationLexiconRewrite"));
  });

  it("returns original when gate disabled", async () => {
    const prev = process.env.SPEECH_LOCK_NARRATION_LEXICON;
    delete process.env.SPEECH_LOCK_NARRATION_LEXICON;
    try {
      const text = NARRATION_LEXICON_FIXTURES.find((f) => f.id === "n16-run2-haeyo-label")!.text;
      const r = await maybeRewriteNarrationLexicon({
        text,
        charName: "레온",
        system: "sys",
        history: [],
        model: "test",
        targetResponseChars: 3200,
        requestKind: "test-gate-off",
      });
      assert.equal(r.rewritten, false);
      assert.equal(r.text, text);
    } finally {
      if (prev !== undefined) process.env.SPEECH_LOCK_NARRATION_LEXICON = prev;
    }
  });

  it("returns original when detector clean (MISS fixture)", async () => {
    process.env.SPEECH_LOCK_NARRATION_LEXICON = "1";
    const text = NARRATION_LEXICON_FIXTURES.find((f) => f.id === "pure-action")!.text;
    const r = await maybeRewriteNarrationLexicon({
      text,
      charName: "레온",
      system: "sys",
      history: [],
      model: "test",
      targetResponseChars: 3200,
      requestKind: "test-clean",
    });
    assert.equal(r.rewritten, false);
    assert.equal(r.text, text);
  });

  for (const pair of REWRITE_SIMULATION_PAIRS) {
    it(`mock rewrite clears detector: ${pair.id}`, async () => {
      process.env.SPEECH_LOCK_NARRATION_LEXICON = "1";
      mockRewriteText = pair.mockRewritten;

      const before = detectRegisterLexiconInNarration(pair.input);
      assert.equal(before.fail, true, "fixture must be HIT before rewrite");

      const r = await maybeRewriteNarrationLexicon({
        text: pair.input,
        charName: "레온",
        system: "sys",
        history: [{ role: "user", content: "test" }],
        model: "test",
        targetResponseChars: 3200,
        requestKind: `test-${pair.id}`,
      });

      assert.equal(r.rewritten, true);
      const after = detectRegisterLexiconInNarration(r.text);
      assert.equal(after.fail, false, `still hits: ${JSON.stringify(after.hits)}`);
      assert.match(r.text, /"…/);
      assert.ok(r.text.length > 20, "rewritten text should preserve substance");
    });
  }
});
