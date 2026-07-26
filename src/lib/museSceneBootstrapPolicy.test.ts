import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isMuseCompactSceneStateEnabledForUser,
  isMuseStructuralLengthAnchorEnabledForUser,
  MUSE_SCENE_BOOTSTRAP_ENV,
  MUSE_SPARK_MODEL_ID,
} from "@/lib/museSceneBootstrapPolicy";

const MUSE = MUSE_SPARK_MODEL_ID;
const DEEPSEEK = "deepseek/deepseek-v4-pro";
const GEMINI = "google/gemini-2.5-pro";

const ENV_KEYS = [
  MUSE_SCENE_BOOTSTRAP_ENV.SEMANTIC_ENABLED,
  MUSE_SCENE_BOOTSTRAP_ENV.ANCHOR_ENABLED,
  MUSE_SCENE_BOOTSTRAP_ENV.USER_IDS,
  MUSE_SCENE_BOOTSTRAP_ENV.MODEL_IDS,
  MUSE_SCENE_BOOTSTRAP_ENV.SEMANTIC_CHAT_IDS,
  MUSE_SCENE_BOOTSTRAP_ENV.ANCHOR_CHAT_IDS,
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function enableShared(userIds = "1") {
  process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = userIds;
}

describe("museSceneBootstrapPolicy — fail-closed independent 2×2 + chat allowlists", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("all env unset → both OFF", () => {
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 101), false);
  });

  it("enabled + allowed user/model + chat list unset → OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    enableShared("1");
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 101), false);
  });

  it("empty chat list → OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = " , ";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 101), false);
  });

  it("malformed chat IDs → OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "0,-1,1.5,abc,";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "0,-1,1.5,abc,";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 101), false);
  });

  it("wrong chat → OFF; correct chat → ON", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 999), false);
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), true);
  });

  it("null/unsafe chatId → OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, null), false);
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, undefined), false);
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 0), false);
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, -1), false);
  });

  it("Semantic and Anchor chat allowlists are independent", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "102";

    // chat 101 semantic only
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), true);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 101), false);

    // chat 102 anchor only
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 102), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 102), true);

    // chat 103 hybrid
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101,103";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "102,103";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 103), true);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 103), true);

    // chat 104 baseline
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 104), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 104), false);
  });

  it("wrong user → both OFF even when chat allowlisted", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "101";
    assert.equal(isMuseCompactSceneStateEnabledForUser(2, MUSE, 101), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(2, MUSE, 101), false);
  });

  it("non-Muse → both OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "101";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, DEEPSEEK, 101), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, GEMINI, 101), false);
  });

  it("malformed user allowlist → both OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    process.env.MUSE_SCENE_BOOTSTRAP_USER_IDS = "0,-1,1.5,abc,";
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "101";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 101), false);
  });

  it("empty model list → both OFF", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_SCENE_BOOTSTRAP_MODEL_IDS = " , ";
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "101";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), false);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 101), false);
  });

  it("exact canonical model only", () => {
    process.env.MUSE_COMPACT_SCENE_STATE_ENABLED = "1";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_ENABLED = "1";
    enableShared("1");
    process.env.MUSE_SCENE_BOOTSTRAP_MODEL_IDS = MUSE;
    process.env.MUSE_COMPACT_SCENE_STATE_CHAT_IDS = "101";
    process.env.MUSE_STRUCTURAL_LENGTH_ANCHOR_CHAT_IDS = "101";
    assert.equal(isMuseCompactSceneStateEnabledForUser(1, MUSE, 101), true);
    assert.equal(isMuseStructuralLengthAnchorEnabledForUser(1, MUSE, 101), true);
    assert.equal(
      isMuseCompactSceneStateEnabledForUser(1, `foo-${MUSE}-bar`, 101),
      false
    );
    assert.equal(
      isMuseStructuralLengthAnchorEnabledForUser(1, "muse-spark-1.1", 101),
      false
    );
  });
});
