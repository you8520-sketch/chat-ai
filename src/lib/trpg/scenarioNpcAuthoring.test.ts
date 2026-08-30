import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { withAssetSize } from "@/lib/characterAssets";
import {
  enforceGmSceneAssetMarkers,
  formatNpcAssetMarker,
  stripTrpgAssetControlMarkers,
} from "./gmSceneAssets";
import { mergeScenarioDraft } from "./scenarioDraft";
import { emptyTrpgScenarioPlan } from "./scenarioPlan";
import { assertScenarioAssetOrientations } from "./scenarioAssets";
import {
  applyNpcSpeakerImageFallback,
  buildGmSceneAssetPrompt,
  collectUsedNpcKeys,
  normalizeDraftBossIntoNpcs,
  toPublicScenarioNpcImages,
} from "./scenarioNpcAssets";
import { serializeTrpgScenarioPlanForGm } from "./scenarioPlan";
import {
  createScenarioNpcKey,
  parseScenarioNpcs,
  scenarioHasBossNpc,
  type TrpgScenarioNpc,
} from "./scenarioTypes";
import { splitTrpgGmProseForAssets } from "./trpgTaggedProse";

const EDITOR_SOURCE = fs.readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");

function bossNpc(overrides: Partial<TrpgScenarioNpc> = {}): TrpgScenarioNpc {
  return {
    npcKey: createScenarioNpcKey(),
    role: "boss",
    name: "한도윤",
    description: "연구소장. 후반부 주요 적.",
    greeting: "존댓말",
    systemPrompt: "초반에는 협력자인 척한다.",
    stats: null,
    image: withAssetSize({ url: "/npc/han.webp", tag: "한도윤", visualSubjectKey: "" }, 800, 1200),
    ...overrides,
  };
}

function supportingNpc(overrides: Partial<TrpgScenarioNpc> = {}): TrpgScenarioNpc {
  return {
    npcKey: createScenarioNpcKey(),
    role: "supporting",
    name: "역무원",
    description: "역 안내원",
    greeting: "",
    systemPrompt: "",
    stats: null,
    ...overrides,
  };
}

describe("TRPG NPC / boss authoring unification", () => {
  it("NO_SEPARATE_HUMAN_PLAN_BOSS_FIELD", () => {
    assert.doesNotMatch(EDITOR_SOURCE, /핵심 적 \/ 보스/);
    assert.doesNotMatch(EDITOR_SOURCE, /patchPlan\(\{ boss:/);
  });

  it("BOSS_AND_SUPPORTING_NPC_SHARE_ONE_AUTHORING_OWNER", () => {
    assert.match(EDITOR_SOURCE, /보스 \/ 조연 NPC/);
    assert.match(EDITOR_SOURCE, /\+ 보스·조연 NPC 추가/);
    assert.match(EDITOR_SOURCE, /data-scenario-field="npcs"/);
  });

  it("NPC_ROLE_ROUND_TRIP", () => {
    const raw = [{ role: "boss", name: "한도윤", description: "적", greeting: "", systemPrompt: "", stats: null }];
    const parsed = parseScenarioNpcs(raw);
    assert.equal(parsed[0]?.role, "boss");
    assert.match(parsed[0]?.npcKey ?? "", /^npc_/);
  });

  it("NPC_IMAGE_ROUND_TRIP", () => {
    const key = createScenarioNpcKey();
    const raw = [
      {
        npcKey: key,
        role: "boss",
        name: "한도윤",
        description: "적",
        greeting: "",
        systemPrompt: "",
        stats: null,
        image: { url: "/npc/han.webp", tag: "한도윤", width: 800, height: 1200, orientation: "portrait" },
      },
    ];
    const parsed = parseScenarioNpcs(raw);
    assert.equal(parsed[0]?.image?.url, "/npc/han.webp");
    assert.equal(parsed[0]?.image?.visualSubjectKey, key);
  });

  it("NPC_PORTRAIT_IMAGE_ACCEPTED", () => {
    const npc = bossNpc({
      image: withAssetSize({ url: "/p.webp", tag: "한도윤" }, 800, 1200),
    });
    assert.equal(toPublicScenarioNpcImages([npc]).length, 1);
  });

  it("NPC_SQUARE_IMAGE_ACCEPTED", () => {
    const npc = bossNpc({
      image: withAssetSize({ url: "/s.webp", tag: "한도윤" }, 900, 900),
    });
    assert.equal(toPublicScenarioNpcImages([npc]).length, 1);
  });

  it("GENERIC_SCENARIO_EXTRA_PORTRAIT_STILL_REJECTED", () => {
    assert.throws(
      () =>
        assertScenarioAssetOrientations([
          withAssetSize({ url: "/cover.webp", tag: "표지" }, 800, 1200),
          withAssetSize({ url: "/tall.webp", tag: "세로" }, 800, 1200),
        ]),
      /가로로 긴 이미지/
    );
  });

  it("NPC_IMAGE_DOES_NOT_REQUIRE_NEW_DB_COLUMN", () => {
    const schema = fs.readFileSync("src/lib/trpg/schema.ts", "utf8");
    assert.match(schema, /npcs_json TEXT/);
    assert.doesNotMatch(schema, /npc_image/);
  });

  it("NPC_PRIVATE_NOTES_NOT_EXPOSED_TO_PLAYER", () => {
    const npc = bossNpc({ systemPrompt: "SECRET_GM_NOTE" });
    const publicRows = toPublicScenarioNpcImages([npc]);
    assert.equal(publicRows.length, 1);
    assert.doesNotMatch(JSON.stringify(publicRows), /SECRET_GM_NOTE/);
    assert.doesNotMatch(JSON.stringify(publicRows), /description/);
  });

  it("NPC_IMAGE_MARKER_VALIDATED", () => {
    const npc = bossNpc();
    npc.image!.visualSubjectKey = npc.npcKey;
    const marker = formatNpcAssetMarker(npc.npcKey);
    const out = enforceGmSceneAssetMarkers(`장면.\n${marker}`, {
      aiParticipantIds: new Set<number>(),
      characterTagsByParticipant: new Map(),
      scenarioTags: new Set<string>(),
      npcImageKeys: new Set([npc.npcKey]),
      usedNpcKeys: new Set<string>(),
    });
    assert.match(out.text, new RegExp(formatNpcAssetMarker(npc.npcKey).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(out.kept, [{ kind: "npc", npcKey: npc.npcKey }]);
  });

  it("UNKNOWN_NPC_IMAGE_MARKER_REMOVED", () => {
    const out = enforceGmSceneAssetMarkers("앞.\n[NPC에셋: npc_00000000-0000-4000-8000-000000000000]\n뒤.", {
      aiParticipantIds: new Set<number>(),
      characterTagsByParticipant: new Map(),
      scenarioTags: new Set<string>(),
      npcImageKeys: new Set<string>(),
      usedNpcKeys: new Set<string>(),
    });
    assert.doesNotMatch(out.text, /NPC에셋/);
    assert.equal(out.kept.length, 0);
  });

  it("NPC_IMAGE_CONTROL_MARKER_NOT_VISIBLE", () => {
    const npc = bossNpc();
    const marker = formatNpcAssetMarker(npc.npcKey);
    const visible = stripTrpgAssetControlMarkers(`본문\n${marker}`);
    assert.doesNotMatch(visible, /NPC에셋/);
    assert.match(visible, /본문/);
  });

  it("NPC_FIRST_APPEARANCE_IMAGE_RENDERED", () => {
    const npc = bossNpc();
    const catalog = toPublicScenarioNpcImages([npc]);
    const parts = splitTrpgGmProseForAssets(`등장.\n${formatNpcAssetMarker(npc.npcKey)}`, {
      scenarioAssets: [],
      npcCatalog: catalog,
      campaignId: 1,
      roundNumber: 2,
    });
    assert.equal(parts.some((part) => part.kind === "npc"), true);
  });

  it("NPC_NAME_REFERENCE_ONLY_DOES_NOT_AUTO_RENDER", () => {
    const npc = bossNpc();
    const fallback = applyNpcSpeakerImageFallback("한도윤을 찾아야 한다.", {
      npcs: [npc],
      usedNpcKeys: new Set<string>(),
    });
    assert.equal(fallback, "한도윤을 찾아야 한다.");
  });

  it("NPC_DIRECT_SPEAKER_FALLBACK_RENDERED", () => {
    const npc = bossNpc();
    const fallback = applyNpcSpeakerImageFallback('한도윤: "여기까지 왔군."', {
      npcs: [npc],
      usedNpcKeys: new Set<string>(),
    });
    assert.equal(fallback.includes(formatNpcAssetMarker(npc.npcKey)), true);
  });

  it("NEW_HUMAN_BOSS_NOT_DUPLICATED_IN_PLAN_BOSS", () => {
    const plan = { ...emptyTrpgScenarioPlan(), boss: "한도윤" };
    const npcs = [bossNpc({ name: "한도윤" })];
    const serialized = serializeTrpgScenarioPlanForGm(plan, { npcs });
    assert.doesNotMatch(serialized, /보스:/);
    assert.equal(scenarioHasBossNpc(npcs), true);
  });

  it("AI_DRAFT_BOSS_VISIBLE_AS_NPC_CARD", () => {
    const merged = mergeScenarioDraft({
      mode: "fill_empty",
      existing: { plan: emptyTrpgScenarioPlan(), npcs: [] },
      generated: {
        title: "t",
        summary: "s",
        startLocation: "",
        startInventory: [],
        npcs: [],
        plan: { ...emptyTrpgScenarioPlan(), boss: "한도윤", startingSituation: "시작", goal: "목표" },
      },
    });
    assert.equal(merged.npcs.some((npc) => npc.role === "boss" && npc.name.includes("한도윤")), true);
  });

  it("GM_NPC_ROLE_CONTEXT_PRESERVED", () => {
    const prompt = buildGmSceneAssetPrompt({
      scenarioAssetPrompt: "",
      npcs: [bossNpc()],
    });
    assert.match(prompt, /role=boss/);
    assert.match(prompt, /\[SCENARIO NPC IMAGES\]/);
  });

  it("TOTAL_SCENE_IMAGE_CAP_PRESERVED", () => {
    const npc = bossNpc();
    const marker = formatNpcAssetMarker(npc.npcKey);
    const out = enforceGmSceneAssetMarkers(`${marker}\n[태그: 대합실]\n[캐릭터에셋: 12|분노]`, {
      aiParticipantIds: new Set([12]),
      characterTagsByParticipant: new Map([[12, new Set(["분노"])]]),
      scenarioTags: new Set(["대합실"]),
      npcImageKeys: new Set([npc.npcKey]),
      usedNpcKeys: new Set<string>(),
    });
    assert.equal(out.kept.length, 2);
  });

  it("WORLD_ONLY_TRPG_UNCHANGED", () => {
    const sandbox = fs.readFileSync("src/lib/trpg/sandboxDirector.ts", "utf8");
    assert.doesNotMatch(sandbox, /scenarioNpcAssets/);
  });

  it("normalizeDraftBossIntoNpcs does not duplicate existing boss card", () => {
    const existing = [bossNpc({ name: "한도윤" })];
    const merged = normalizeDraftBossIntoNpcs("다른 보스", existing);
    assert.equal(merged.filter((npc) => npc.role === "boss").length, 1);
  });

  it("collectUsedNpcKeys tracks prior campaign markers", () => {
    const key = createScenarioNpcKey();
    const used = collectUsedNpcKeys([`이전 장면\n${formatNpcAssetMarker(key)}`]);
    assert.equal(used.has(key), true);
  });
});
