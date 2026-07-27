import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  serializeVariantsForClient,
  type MessageVariant,
} from "@/lib/messageAlternates";
import type { Usage } from "@/lib/chatUsage";

function usageWithTelemetry(extra: Partial<Usage> = {}): Usage {
  return {
    input: 10,
    output: 20,
    model: "meta/muse-spark-1.1",
    route: "nsfw",
    cost: 42,
    breakdown: [],
    museAcceptance: {
      classificationScope: "length_and_local_output_health",
      acceptanceClass: "NORMAL_PASS",
      visibleChars: 2200,
    },
    finishReason: "stop",
    ...extra,
  };
}

describe("serializeVariantsForClient — Muse acceptance never exposed", () => {
  it("strips museAcceptance from every variant.usage", () => {
    const variants: MessageVariant[] = [
      {
        content: "one",
        model: "meta/muse-spark-1.1",
        usage: usageWithTelemetry(),
        created_at: "a",
      },
      {
        content: "two",
        model: "meta/muse-spark-1.1",
        usage: usageWithTelemetry({ cost: 99 }),
        created_at: "b",
      },
    ];
    const payload = serializeVariantsForClient(variants, 1);
    assert.equal(payload.variants.length, 2);
    for (const v of payload.variants) {
      assert.equal(v.usage?.museAcceptance, undefined);
      assert.ok(v.usage?.finishReason === "stop");
    }
    assert.equal(payload.variants[1]!.usage?.cost, 99);
    // Source variants unchanged (DB may keep telemetry).
    assert.ok(variants[0]!.usage?.museAcceptance);
  });

  it("full billing fields can remain while museAcceptance is absent", () => {
    const variants: MessageVariant[] = [
      {
        content: "admin",
        model: "meta/muse-spark-1.1",
        usage: usageWithTelemetry({
          statusWidgetExtract: {
            model: "x",
            modelLabel: "w",
            input: 1,
            output: 1,
            apiRawCostKrw: 1,
          },
        }),
        created_at: "c",
      },
    ];
    const payload = serializeVariantsForClient(variants, 0);
    assert.equal(payload.variants[0]!.usage?.museAcceptance, undefined);
    assert.ok(payload.variants[0]!.usage?.statusWidgetExtract);
  });
});
