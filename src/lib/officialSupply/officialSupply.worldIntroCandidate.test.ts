import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { compileOfficialDraftFromBible, type OfficialWorldBible } from "@/lib/officialSupply/bible";
import {
  evaluateOfficialStagedSaveLength,
  officialRpSettingOverflowChars,
} from "@/lib/officialSupply/characterText";
import { renderRuntimeAppearanceBlock } from "@/lib/officialSupply/appearance";
import {
  loadCompiledOfficialCharacterSource,
  loadOfficialPilotWorldBible,
} from "@/lib/officialSupply/compiledOfficialSource";
import { assertOfficialSharedWorldProjection } from "@/lib/officialSupply/officialSharedWorld";
import {
  evaluateOfficialCreatorComment,
  evaluateOfficialPlayerGenderNeutral,
  evaluateOfficialPlayerGenderNeutrality,
  evaluateOfficialPublicDescription,
} from "@/lib/officialSupply/publicProfileText";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";
import { WORLD_CONTENT_LIMIT, worldContentBundleCharCount } from "@/lib/worlds";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const CANDIDATE_DIR = path.join(process.cwd(), "docs/official-supply/candidates/world-intro-quality");

function candidate(file: string): string {
  return fs.readFileSync(path.join(CANDIDATE_DIR, file), "utf8").trim();
}

type SourceOptions = { bibleMutation?: (bible: Record<string, unknown>) => void };

function compileWithOptions(draftKey: string, options: SourceOptions = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(PILOT_DIR, "manifest.json"), "utf8")) as {
    worldKey: string;
    styleKey: string;
  };
  const world = JSON.parse(fs.readFileSync(path.join(PILOT_DIR, "world-bible.json"), "utf8")) as {
    bible: OfficialWorldBible;
  };
  const file = JSON.parse(
    fs.readFileSync(path.join(PILOT_DIR, "characters", `${draftKey}.json`), "utf8")
  ) as {
    slot: number;
    bible: Record<string, unknown>;
    brief: { audience: "all" | "female" | "male" };
    appearance: Parameters<typeof renderRuntimeAppearanceBlock>[0];
  };
  options.bibleMutation?.(file.bible);
  const brief = world.bible.portfolio.find((item) => item.slot === file.slot)!;
  const draft = compileOfficialDraftFromBible(file.bible as never, {
    draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    worldBible: world.bible,
    hook: {
      archetype: brief.archetype,
      relationshipTrope: brief.relationshipTrope,
      occupation: brief.occupation,
      rpHook: brief.rpHook,
    },
  });
  return { draft, appearanceBlock: renderRuntimeAppearanceBlock(file.appearance) };
}

function withoutSectionLines(
  draft: OfficialCharacterDraft,
  section: "characterCore" | "relationshipsAndDrives",
  prefixes: string[]
): OfficialCharacterDraft {
  return {
    ...draft,
    sections: {
      ...draft.sections,
      [section]: draft.sections[section]
        .split("\n")
        .filter((line) => !prefixes.some((prefix) => line.startsWith(prefix)))
        .join("\n"),
    },
  };
}

describe("official RP setting injection cap (staged save gate)", () => {
  it("accepts every pilot draft as currently compiled", () => {
    for (let slot = 1; slot <= 10; slot += 1) {
      const key = `pilot-rf-${String(slot).padStart(2, "0")}`;
      const source = loadCompiledOfficialCharacterSource(key);
      assert.equal(
        officialRpSettingOverflowChars(source.draft, source.appearanceBlock),
        0,
        `${key} RP setting must not be truncated`
      );
      assert.equal(evaluateOfficialStagedSaveLength(source.draft, source.appearanceBlock).ok, true, key);
    }
  });

  it("warns when a draft speech tail would be cut by the 10,000 char RP injection cap", () => {
    const moved = compileWithOptions("pilot-rf-02", {
      bibleMutation: (bible) => {
        bible.promptStandard = "compact_rp_v1";
      },
    });
    const overflow = officialRpSettingOverflowChars(moved.draft, moved.appearanceBlock);
    assert.ok(overflow > 0, "current shared projection + Wolfgang compact must overflow the injection cap");
    const result = evaluateOfficialStagedSaveLength(moved.draft, moved.appearanceBlock);
    assert.equal(result.ok, true, "advisory only: approved historical locks must stay reconcilable");
    assert.equal(result.warnings[0]?.code, "rp_setting_truncated");
  });
});

describe("official world / public intro candidates (not applied, gate-checked)", () => {
  const sharedWorld = candidate("shared-world.txt");
  const bible = loadOfficialPilotWorldBible();

  it("keeps the shared world candidate inside the shared-owner boundaries", () => {
    assert.ok(sharedWorld.length >= 2000 && sharedWorld.length <= 3000, `world ${sharedWorld.length}`);
    assertOfficialSharedWorldProjection(sharedWorld);
    assert.ok(worldContentBundleCharCount(sharedWorld, "") <= WORLD_CONTENT_LIMIT);
    assert.doesNotMatch(sharedWorld, /당신|유저/u, "world must not address or bind the user");
    assert.doesNotMatch(sharedWorld, /마석|명령서|인장|금고|경보/u, "character-local incidents belong to currentSituation");
  });

  it("covers the shared bible facts the old projection dropped", () => {
    for (const faction of bible.factions) {
      const leader = faction.leadership.match(/'([^']+)'/u)?.[1];
      if (leader && !leader.includes("알렉세이")) {
        assert.ok(sharedWorld.includes(leader), `leader ${leader}`);
      }
    }
    for (const anchor of ["5년 전", "3년 전", "1년 전", "6개월 전", "태양의 눈", "공허의 밤", "1성", "7성", "정략결혼"]) {
      assert.ok(sharedWorld.includes(anchor), `anchor ${anchor}`);
    }
    for (const taboo of ["생체 에테르 핵", "침식 마법"]) assert.ok(sharedWorld.includes(taboo), taboo);
    for (const role of bible.userEntry.allowedRoles) {
      const keyword = role.match(/귀족|수사청|용병|전령|시종/u)?.[0];
      assert.ok(keyword && sharedWorld.includes(keyword), `persona entry ${role}`);
    }
  });

  it("fits Lucian with the candidate world and passes his public intro and comment gates", () => {
    const { draft, appearanceBlock } = compileWithOptions("pilot-rf-03");
    const next: OfficialCharacterDraft = {
      ...draft,
      description: candidate("lucian.public-detail.txt"),
      sections: { ...draft.sections, worldAndSituation: sharedWorld },
    };
    const comment = candidate("lucian.creator-comment.html");
    assert.equal(officialRpSettingOverflowChars(next, appearanceBlock), 0);
    assert.equal(evaluateOfficialPublicDescription(next.description, next.name).ok, true);
    assert.equal(evaluateOfficialCreatorComment(comment, next.description).ok, true);
    assert.equal(evaluateOfficialPlayerGenderNeutral({ description: next.description, comment }).ok, true);
    assert.equal(evaluateOfficialPlayerGenderNeutrality(next, comment).ok, true);
    assert.equal(next.sections.currentSituation, draft.sections.currentSituation, "Lucian incident text is untouched");
    assert.equal(next.secrets.join("\n"), draft.secrets.join("\n"));
  });

  it("moves Wolfgang onto the shared world only after the RP cap is aligned or his sheet is trimmed", () => {
    const compactWolfgang = (extra?: SourceOptions["bibleMutation"]) =>
      compileWithOptions("pilot-rf-02", {
        bibleMutation: (bible) => {
          bible.promptStandard = "compact_rp_v1";
          extra?.(bible);
        },
      });
    const { draft, appearanceBlock } = compactWolfgang();
    const legacy = loadCompiledOfficialCharacterSource("pilot-rf-02").draft;
    const relocated = candidate("wolfgang.current-situation.txt");
    assert.equal(draft.sections.currentSituation, relocated, "personal situation + user entry are relocated verbatim");
    assert.equal(draft.sections.characterCore, legacy.sections.characterCore);
    assert.equal(draft.secrets.join("\n"), legacy.secrets.join("\n"));

    const withCandidateWorld: OfficialCharacterDraft = {
      ...draft,
      description: candidate("wolfgang.public-detail.txt"),
      sections: { ...draft.sections, worldAndSituation: sharedWorld },
    };
    assert.ok(officialRpSettingOverflowChars(withCandidateWorld, appearanceBlock) > 0, "untrimmed Wolfgang overflows");

    const trimmedSource = compactWolfgang((bible) => {
      const relationship = bible.userRelationship as { progression: string[] };
      relationship.progression = relationship.progression.filter((_, index) => index !== 3);
    });
    let trimmed: OfficialCharacterDraft = {
      ...trimmedSource.draft,
      description: withCandidateWorld.description,
      sections: { ...trimmedSource.draft.sections, worldAndSituation: sharedWorld },
    };
    trimmed = withoutSectionLines(trimmed, "characterCore", ["일상:", "취미:"]);
    trimmed = withoutSectionLines(trimmed, "relationshipsAndDrives", ["장기 변화:"]);
    assert.equal(officialRpSettingOverflowChars(trimmed, appearanceBlock), 0);
    assert.equal(evaluateOfficialStagedSaveLength(trimmed, appearanceBlock).ok, true);

    const comment = candidate("wolfgang.creator-comment.html");
    assert.equal(evaluateOfficialPublicDescription(trimmed.description, trimmed.name).ok, true);
    assert.equal(evaluateOfficialCreatorComment(comment, trimmed.description).ok, true);
    assert.equal(evaluateOfficialPlayerGenderNeutral({ description: trimmed.description, comment }).ok, true);
    assert.equal(evaluateOfficialPlayerGenderNeutrality(trimmed, comment).ok, true);
  });
});
