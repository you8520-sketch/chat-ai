import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION } from "@/lib/adultSceneRouting";

const MAIN = "origin/main";

function sha(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function fileMatchesMain(rel: string): boolean {
  const now = readFileSync(rel);
  const main = execFileSync("git", ["show", `${MAIN}:${rel}`]);
  return sha(now) === sha(main);
}

describe("H1S handoff-scope guards vs current main", () => {
  it("GLOBAL_NO_GODMODDING_DIFF_FROM_MAIN=0", () => {
    assert.equal(fileMatchesMain("src/lib/noGodmodding.ts"), true);
  });

  it("GLOBAL_CURRENT_USER_WRAPPER_SEMANTIC_DIFF_FROM_MAIN=0", () => {
    assert.equal(fileMatchesMain("src/lib/currentUserInputLabel.ts"), true);
  });

  it("COMMON_PROSE_OWNER_DIFF_FROM_MAIN=0", () => {
    assert.equal(fileMatchesMain("src/lib/advancedProseNsfwGuidelines.ts"), true);
    assert.equal(fileMatchesMain("src/lib/sceneExpansionPolicy.ts"), true);
    assert.equal(fileMatchesMain("src/lib/webnovelOutputFormat.ts"), true);
    assert.equal(fileMatchesMain("src/lib/responseLength.ts"), true);
    assert.equal(fileMatchesMain("src/lib/deepseekPromptStructure.ts"), true);
  });

  it("HANDOFF_CONTINUITY_OWNER_COUNT=1 and owner budget", () => {
    const owner = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION;
    assert.equal((owner.match(/현재 사용자 턴 전체가 최신 장면 상태다/g) ?? []).length, 1);
    assert.equal(owner.length <= 800, true);
    assert.doesNotMatch(owner, /잘못된 의상/);
    assert.doesNotMatch(owner, /라이크|Like|Gemini|제미니/);
    assert.doesNotMatch(owner, /활성 의상|outfit variant/i);
  });
});
