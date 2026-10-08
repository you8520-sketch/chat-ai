import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_PLANNED_CALLS,
} from "@/lib/rpQualityPrecall";
import {
  createMockPaidRunnerTransport,
  planPaidRunnerCost,
  runPaidRunner,
} from "@/lib/rpQualityPaidRunner";
import type { PrecallAssemblyRows } from "../../scripts/lib/rpQualityPrecallFinalWire";
import { preparePaidRunnerPack } from "../../scripts/lib/rpQualityPaidRunnerPrepare";

const MAIN_SHA = "b1ade0f7f89708a3d29ca22e69a16256fab17413";

function syntheticRows(): PrecallAssemblyRows {
  return {
    character: {
      id: 18,
      name: "라이크",
      greeting: "창가에 서서 잠시 너를 바라본다.",
      system_prompt: "라이크는 말수가 적고 상대의 말을 끝까지 듣는다.",
      world: "늦은 오후 도시.",
      setting_chunks: "",
      gender: "male",
      content_kind: "character",
      genres: "[]",
      assets: "[]",
      status_widget_allow_user_override: 1,
    },
    persona: {
      id: 5,
      name: "렌",
      gender: "male",
      description: "조용한 사람",
    },
    user: {
      id: 1,
      nickname: "렌",
      user_note: "",
    },
    creatorLorebookAttachments: 0,
    globalLorebook: [],
  };
}

describe("rp quality paid runner sealed prepare", () => {
  it("seals 12 provider-ready bodies from the PRECALL assembler", async () => {
    const pack = preparePaidRunnerPack({
      rows: syntheticRows(),
      mainSha: MAIN_SHA,
      productionDeploySha: MAIN_SHA,
    });
    assert.equal(pack.manifest.calls.length, RP_QUALITY_PRECALL_PLANNED_CALLS);
    assert.equal(pack.sealedCalls.length, 12);
    assert.equal(pack.manifest.characterId, 18);
    assert.equal(pack.manifest.personaName, "렌");
    assert.equal(pack.manifest.approvalStatus, "NOT_APPROVED");
    assert.equal(pack.manifest.providerPosts, 0);
    assert.equal(pack.manifest.unknownSingleCallCost, true);
    const fixtures = new Set(pack.manifest.calls.map((call) => call.fixtureId));
    const models = new Set(pack.manifest.calls.map((call) => call.canonicalId));
    assert.deepEqual([...fixtures], [...RP_QUALITY_PRECALL_FIXTURE_IDS]);
    assert.deepEqual([...models], [...MAIN_RP_MODEL_IDS]);
    for (const call of pack.sealedCalls) {
      assert.equal("max_tokens" in call.requestBody, false);
      assert.equal(call.requestBodyFingerprint.length, 64);
      assert.equal(call.finalWireFingerprint.length, 64);
      assert.ok(call.endpoint.startsWith("https://"));
    }
    const publicJson = JSON.stringify(pack.manifest);
    assert.doesNotMatch(publicJson, /창가에 서서|system_prompt|Authorization|Bearer /);
    const planning = planPaidRunnerCost(pack.sizeRows, {
      date_key: "2026-10-08",
      base_usd_krw: 1300,
      source: "api_daily",
      fetched_at: "2026-10-07T18:51:32.128Z",
    });
    assert.equal(planning.status, "PLANNING_ONLY_NOT_APPROVED");
    assert.equal(planning.maxSingleCallExposure.status, "UNKNOWN");
    const result = await runPaidRunner({
      mode: "AUTHORIZED",
      manifest: pack.manifest,
      sealedCalls: pack.sealedCalls,
      authorization: {
        userCostApproved: true,
        approvedManifestFingerprint: pack.manifest.manifestFingerprint,
        expectedProductionSha: MAIN_SHA,
        expectedIdentityHash: pack.manifest.identityHash,
        experimentSecret: "rpq-paid-prepare-secret-0000000001",
        allowlist: [...MAIN_RP_MODEL_IDS],
        plannedCalls: 12,
      },
      transport: createMockPaidRunnerTransport(),
    });
    assert.equal(result.transportPosts, 12);
    assert.equal(result.providerPosts, 0);
    assert.equal(result.networkAttempts, 0);
  });

  it("authorized CLI never ships a live transport", () => {
    const stdout = execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/rp-quality-paid-runner-authorized.ts",
        "--user-cost-approved",
      ],
      { encoding: "utf8" }
    );
    const report = JSON.parse(stdout) as {
      providerPosts: number;
      liveTransport: string;
      authorized: boolean;
    };
    assert.equal(report.providerPosts, 0);
    assert.equal(report.liveTransport, "LIVE_TRANSPORT_NOT_SHIPPED");
    assert.equal(report.authorized, false);
  });
});
