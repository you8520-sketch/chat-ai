import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  catalogItemMatches,
  catalogLiveRanking,
  catalogNewReleases,
  catalogScenarioById,
  catalogWorldById,
  genresInCatalog,
  visibleScenarioSecret,
} from "./catalogBrowse";
import { parseWorldTrpgFlags } from "@/lib/worlds";
import { loadTrpgCatalogPlayScores, type TrpgCatalog, type TrpgCatalogWorld } from "./catalog";
import { EMPTY_TRPG_CATALOG_PLAY_SCORES } from "./catalogPlayScores";
import type { TrpgScenarioTemplate } from "./scenarioTypes";
import { ensureTrpgTables } from "./schema";

describe("TRPG catalog browse", () => {
  it("filters by query and genre hashtags", () => {
    const item = {
      title: "북부 대공국",
      summary: "눈과 정치",
      creatorName: "렌",
      genres: ["판타지", "동양풍"] as const,
    };
    assert.equal(catalogItemMatches({ ...item, query: "대공", genre: null }), true);
    assert.equal(catalogItemMatches({ ...item, query: "서울", genre: null }), false);
    assert.equal(catalogItemMatches({ ...item, query: "", genre: "판타지" }), true);
    assert.equal(catalogItemMatches({ ...item, query: "", genre: "SF" }), false);
    assert.deepEqual(
      genresInCatalog([{ genres: ["SF"] }, { genres: ["판타지", "SF"] }]),
      ["판타지", "SF"]
    );
  });

  it("turns TRPG on as public listing and off as private", () => {
    assert.deepEqual(parseWorldTrpgFlags({ trpgEnabled: true, trpgVisibility: "private" }), {
      trpgEnabled: 1,
      trpgVisibility: "public",
    });
    assert.deepEqual(parseWorldTrpgFlags({ trpgEnabled: false, trpgVisibility: "public" }), {
      trpgEnabled: 0,
      trpgVisibility: "private",
    });
  });

  it("prefers the owner's catalog copy and hides GM secrets from everyone else", () => {
    const world: TrpgCatalogWorld = {
      id: 9,
      name: "북부",
      summary: "눈",
      content: "왕국의 겨울은 길다.",
      creatorId: 2,
      creatorName: "렌",
      visibility: "public",
      trpgEnabled: true,
      mine: false,
      genres: ["판타지"],
      coverUrl: "",
      updatedAt: "2026-08-01 12:00:00",
    };
    const leaked: TrpgScenarioTemplate = {
      id: 4,
      creatorId: 2,
      worldId: null,
      title: "폐역",
      summary: "유령 기차",
      content: "표를 사라.",
      secretContent: "진범은역무원SECRET",
      visibility: "public",
      startLocation: "대합실",
      startInventory: [],
      defaultPcStats: null,
      statKeys: ["str", "dex", "int", "wis", "cha", "con"],
      npcs: [],
      characterIds: [],
      genres: ["공포/추리"],
      assets: [],
      scenarioPlan: null,
      createdAt: "",
      updatedAt: "",
    };
    const catalog: TrpgCatalog = {
      publicWorlds: [world],
      myWorlds: [],
      myCharacters: [],
      publicScenarios: [leaked],
      myScenarios: [],
    };
    assert.equal(catalogWorldById(catalog, 9)?.content, "왕국의 겨울은 길다.");
    assert.equal(catalogScenarioById(catalog, 4)?.viewerIsCreator, false);
    assert.equal(visibleScenarioSecret(leaked.secretContent, false), "");
    assert.equal(visibleScenarioSecret(leaked.secretContent, true), "진범은역무원SECRET");
    const ownerCatalog: TrpgCatalog = {
      ...catalog,
      myScenarios: [{ ...leaked, secretContent: "진범은역무원SECRET" }],
    };
    assert.equal(catalogScenarioById(ownerCatalog, 4)?.viewerIsCreator, true);
  });

  it("mixes public worlds and scenarios by recency for the 신작 row", () => {
    const olderWorld: TrpgCatalogWorld = {
      id: 1,
      name: "옛 왕국",
      summary: "",
      content: "",
      creatorId: 2,
      creatorName: "렌",
      visibility: "public",
      trpgEnabled: true,
      mine: false,
      genres: [],
      coverUrl: "",
      updatedAt: "2026-08-01 10:00:00",
    };
    const newerWorld: TrpgCatalogWorld = {
      ...olderWorld,
      id: 2,
      name: "새 왕국",
      updatedAt: "2026-08-10 10:00:00",
    };
    const midScenario: TrpgScenarioTemplate = {
      id: 9,
      creatorId: 3,
      worldId: null,
      title: "중간 시나리오",
      summary: "",
      content: "본문",
      secretContent: "",
      visibility: "public",
      startLocation: "",
      startInventory: [],
      defaultPcStats: null,
      statKeys: ["str", "dex", "int", "wis", "cha", "con"],
      npcs: [],
      characterIds: [],
      genres: [],
      assets: [],
      scenarioPlan: null,
      createdAt: "2026-08-05 00:00:00",
      updatedAt: "2026-08-05 12:00:00",
    };
    const catalog: TrpgCatalog = {
      publicWorlds: [olderWorld, newerWorld],
      myWorlds: [],
      myCharacters: [],
      publicScenarios: [midScenario],
      myScenarios: [],
    };
    assert.deepEqual(
      catalogNewReleases(catalog, 3).map((item) => `${item.kind}:${item.id}`),
      ["world:2", "scenario:9", "world:1"]
    );
    assert.deepEqual(
      catalogNewReleases(catalog, 1).map((item) => `${item.kind}:${item.id}`),
      ["world:2"]
    );
  });

  it("ranks public worlds and scenarios by recent starts, then all-time, then recency", () => {
    const quietWorld: TrpgCatalogWorld = {
      id: 1,
      name: "조용한 왕국",
      summary: "",
      content: "",
      creatorId: 2,
      creatorName: "렌",
      visibility: "public",
      trpgEnabled: true,
      mine: false,
      genres: [],
      coverUrl: "",
      updatedAt: "2026-08-20 10:00:00",
    };
    const hotWorld: TrpgCatalogWorld = {
      ...quietWorld,
      id: 2,
      name: "뜨거운 왕국",
      updatedAt: "2026-08-01 10:00:00",
    };
    const midScenario: TrpgScenarioTemplate = {
      id: 9,
      creatorId: 3,
      worldId: null,
      title: "중간 시나리오",
      summary: "",
      content: "본문",
      secretContent: "",
      visibility: "public",
      startLocation: "",
      startInventory: [],
      defaultPcStats: null,
      statKeys: ["str", "dex", "int", "wis", "cha", "con"],
      npcs: [],
      characterIds: [],
      genres: [],
      assets: [],
      scenarioPlan: null,
      createdAt: "2026-08-05 00:00:00",
      updatedAt: "2026-08-18 12:00:00",
    };
    const catalog: TrpgCatalog = {
      publicWorlds: [quietWorld, hotWorld],
      myWorlds: [],
      myCharacters: [],
      publicScenarios: [midScenario],
      myScenarios: [],
    };
    assert.deepEqual(
      catalogLiveRanking(catalog, EMPTY_TRPG_CATALOG_PLAY_SCORES, 3).map(
        (item) => `${item.kind}:${item.id}`
      ),
      ["world:1", "scenario:9", "world:2"]
    );
    assert.deepEqual(
      catalogLiveRanking(
        catalog,
        {
          worlds: {
            1: { recent: 0, all: 4 },
            2: { recent: 2, all: 2 },
          },
          scenarios: {
            9: { recent: 2, all: 9 },
          },
        },
        3
      ).map((item) => `${item.kind}:${item.id}:${item.recentStarts}:${item.allStarts}`),
      ["scenario:9:2:9", "world:2:2:2", "world:1:0:4"]
    );
  });

  it("counts recent and all-time campaign starts for lobby ranking", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(
      `INSERT INTO trpg_campaigns (host_user_id, title, source_world_id, template_id, created_at)
       VALUES (1, '오늘 세계관', 11, NULL, datetime('now')),
              (1, '어제 세계관', 11, NULL, datetime('now', '-2 days')),
              (1, '오늘 시나리오', NULL, 22, datetime('now'))`
    ).run();
    const scores = loadTrpgCatalogPlayScores(db);
    assert.deepEqual(scores.worlds[11], { recent: 1, all: 2 });
    assert.deepEqual(scores.scenarios[22], { recent: 1, all: 1 });
    db.close();
  });

  it("replaces the dedicated 내 세계관 lobby row with live ranking", () => {
    const browse = fs.readFileSync("src/app/trpg/TrpgCatalogBrowse.tsx", "utf8");
    assert.doesNotMatch(browse, /title="내 세계관"/);
    assert.match(browse, /title="실시간 랭킹"/);
    assert.match(browse, /catalogLiveRanking/);
  });
});
