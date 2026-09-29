import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import { resolveOpenRouterModelId } from "@/lib/openRouterConfig";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import {
  RP_MODEL_QUALIFICATION_PACKET_OWNERS,
  buildActiveRpModelQualificationPacket,
} from "./rpModelQualificationPacket";
import { buildCanonicalRpQualificationCases } from "./rpModelQualificationFixture";

function main() {
  const packet = buildActiveRpModelQualificationPacket();

  assert.equal(packet.packetVersion, 2);
  assert.equal(packet.providerCalls, 0);
  assert.equal(packet.runtimeObservations, "NOT_RUN");
  assert.deepEqual(packet.activeModelIds, MAIN_RP_MODEL_IDS);
  assert.deepEqual(
    packet.models.map((entry) => entry.modelId),
    MAIN_RP_USER_SELECTABLE_OPTIONS.map((entry) => entry.id)
  );

  const canonicalCases = buildCanonicalRpQualificationCases();
  for (const model of packet.models) {
    const registry = MAIN_RP_USER_SELECTABLE_OPTIONS.find(
      (entry) => entry.id === model.modelId
    );
    assert.ok(registry);
    assert.equal(model.provider, registry.provider);
    const exactPricing = resolvePublishedPricingExact(model.modelId);
    assert.ok(exactPricing, `${model.modelId}: exact published pricing required`);
    assert.equal(model.pricing.canonicalModelId, exactPricing.canonicalModelId);
    assert.equal(model.pricing.pricingVersion, exactPricing.pricing.pricingVersion);
    assert.deepEqual(
      model.cases.map((entry) => entry.caseId),
      canonicalCases.map((entry) => entry.id)
    );

    for (const casePacket of model.cases) {
      assert.equal(casePacket.collaborativeOwnerCount, 0);
      assert.equal(casePacket.effectiveCoauthorOwnerCount, 1);
      assert.ok(casePacket.systemPromptChars > 1000);
      assert.equal(casePacket.systemPromptSha256.length, 64);
      assert.equal(casePacket.wireMessagesSha256.length, 64);
      assert.equal(casePacket.requestBodySha256.length, 64);
      assert.ok(casePacket.wireMessageCount >= 2);
      assert.equal(
        casePacket.wireControls.model,
        model.provider === "openrouter"
          ? resolveOpenRouterModelId(model.modelId)
          : model.modelId
      );
      assert.equal(casePacket.wireControls.stream, true);
      if (model.provider === "openrouter") {
        assert.ok(casePacket.requestBodyKeys.includes("provider"));
        assert.equal(casePacket.wireControls.service_tier, "flex");
      }
      assert.ok(casePacket.requestBodyKeys.includes("messages"));
      assert.ok(casePacket.requestBodyKeys.includes("model"));
    }
  }

  assert.equal(
    RP_MODEL_QUALIFICATION_PACKET_OWNERS.activeModelRegistry,
    "src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS"
  );
  assert.equal(
    RP_MODEL_QUALIFICATION_PACKET_OWNERS.wireAssembly,
    "src/lib/openRouterAdult.ts#assemblePrimaryRpRequest"
  );

  const source = readFileSync(
    resolve(process.cwd(), "scripts/lib/rpModelQualificationPacket.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /process\.env|fetch\s*\(|API_KEY/);
  assert.doesNotMatch(source, /MAIN_RP_MODEL_IDS\s*[:=]\s*\[/);

  const second = buildActiveRpModelQualificationPacket();
  assert.deepEqual(second, packet, "offline qualification packet must be deterministic");

  console.log(
    JSON.stringify(
      {
        ok: true,
        active_models: packet.activeModelIds,
        cases_per_model: canonicalCases.length,
        provider_calls: packet.providerCalls,
        runtime_observations: packet.runtimeObservations,
      },
      null,
      2
    )
  );
}

main();
