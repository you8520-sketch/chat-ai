import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import {
  PrecallAssemblyStop,
  assertGreetingHistoryShape,
  buildParity,
  type PrecallFinalWirePlan,
} from "../../scripts/lib/rpQualityPrecallFinalWire";

describe("rp quality PRECALL final-wire helpers", () => {
  it("accepts only the production opening history shape", () => {
    const history: ChatMsg[] = [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: "안녕." },
    ];
    assert.doesNotThrow(() => assertGreetingHistoryShape(history, " 안녕. ", "렌", "렌"));
    const drift = () => assertGreetingHistoryShape(history.slice(1), "안녕.", "렌", "렌");
    assert.throws(drift, (error: unknown) => error instanceof PrecallAssemblyStop && error.code === "HISTORY_SHAPE_DRIFT");
    const other = () => assertGreetingHistoryShape(history, "다른 인사", "렌", "렌");
    assert.throws(other, (error: unknown) => error instanceof PrecallAssemblyStop);
  });

  it("separates semantic parity from model-specific section differences", () => {
    const section = (id: string, sha256: string) => ({
      id,
      category: "test",
      cacheBucket: "rules" as const,
      chars: 1,
      estimatedTokens: 1,
      sha256,
    });
    const plan = (canonicalId: string, canonSha: string, extra: boolean): PrecallFinalWirePlan =>
      ({
        fixtureId: "A_relationship_emotion",
        canonicalId,
        semanticFingerprint: "same",
        finalWireFingerprint: canonicalId,
        sections: [section("shared", "s"), section("canon", canonSha), ...(extra ? [section("only-some", "o")] : [])],
      }) as unknown as PrecallFinalWirePlan;
    const [parity] = buildParity([plan("m1", "x", true), plan("m2", "y", false), plan("m3", "y", false)]);
    assert.equal(parity?.semanticFingerprintIdentical, true);
    assert.deepEqual(parity?.sectionsOnlyInSomeModels, ["only-some"]);
    assert.equal(parity?.differingSections.length, 1);
    assert.equal(parity?.differingSections[0]?.sectionId, "canon");
    assert.equal(parity?.finalWireFingerprintsDistinct, 3);
  });
});
