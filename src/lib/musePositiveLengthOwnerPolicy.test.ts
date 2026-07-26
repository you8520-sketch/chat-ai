import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  isMusePositiveLengthOwnerEnabledForUser,
  MUSE_POSITIVE_LENGTH_OWNER_ENV,
  MUSE_SPARK_MODEL_ID,
} from "@/lib/musePositiveLengthOwnerPolicy";

const MUSE = MUSE_SPARK_MODEL_ID;
const DEEPSEEK = "deepseek/deepseek-v4-pro";
const GEMINI = "google/gemini-2.5-pro";

const ENV_KEYS = [
  MUSE_POSITIVE_LENGTH_OWNER_ENV.ENABLED,
  MUSE_POSITIVE_LENGTH_OWNER_ENV.USER_IDS,
  MUSE_POSITIVE_LENGTH_OWNER_ENV.MODEL_IDS,
  MUSE_POSITIVE_LENGTH_OWNER_ENV.CHAT_IDS,
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

function enableBase(userIds = "1", chatIds = "101") {
  process.env.MUSE_POSITIVE_LENGTH_OWNER_ENABLED = "1";
  process.env.MUSE_POSITIVE_LENGTH_OWNER_USER_IDS = userIds;
  process.env.MUSE_POSITIVE_LENGTH_OWNER_CHAT_IDS = chatIds;
}

describe("musePositiveLengthOwnerPolicy — fail-closed admin gate", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("env unset → OFF", () => {
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), false);
  });

  it("enabled only → OFF", () => {
    process.env.MUSE_POSITIVE_LENGTH_OWNER_ENABLED = "1";
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), false);
  });

  it("missing user/model/chat → OFF", () => {
    enableBase();
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(null, MUSE, 101), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(undefined, MUSE, 101), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, null, 101), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, undefined, 101), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, null), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, undefined), false);
  });

  it("wrong user/model/chat → OFF", () => {
    enableBase("1", "101");
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(2, MUSE, 101), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, DEEPSEEK, 101), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, GEMINI, 101), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 999), false);
  });

  it("exact user/model/chat → ON", () => {
    enableBase("1", "101");
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), true);
  });

  it("malformed lists → OFF", () => {
    process.env.MUSE_POSITIVE_LENGTH_OWNER_ENABLED = "1";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_USER_IDS = "0,-1,1.5,abc,";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_CHAT_IDS = "101";
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), false);

    clearEnv();
    process.env.MUSE_POSITIVE_LENGTH_OWNER_ENABLED = "1";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_USER_IDS = "1";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_CHAT_IDS = "0,-1,1.5,abc,";
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), false);

    clearEnv();
    process.env.MUSE_POSITIVE_LENGTH_OWNER_ENABLED = "1";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_USER_IDS = "1";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_MODEL_IDS = " , ";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_CHAT_IDS = "101";
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), false);
  });

  it("empty chat list → OFF", () => {
    process.env.MUSE_POSITIVE_LENGTH_OWNER_ENABLED = "1";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_USER_IDS = "1";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_CHAT_IDS = " , ";
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), false);
  });

  it("chat list unset → OFF", () => {
    process.env.MUSE_POSITIVE_LENGTH_OWNER_ENABLED = "1";
    process.env.MUSE_POSITIVE_LENGTH_OWNER_USER_IDS = "1";
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), false);
  });

  it("exact canonical model only when MODEL_IDS set", () => {
    enableBase();
    process.env.MUSE_POSITIVE_LENGTH_OWNER_MODEL_IDS = MUSE;
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 101), true);
    assert.equal(
      isMusePositiveLengthOwnerEnabledForUser(1, `foo-${MUSE}-bar`, 101),
      false
    );
    assert.equal(
      isMusePositiveLengthOwnerEnabledForUser(1, "muse-spark-1.1", 101),
      false
    );
  });

  it("unsafe chatId → OFF", () => {
    enableBase();
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, 0), false);
    assert.equal(isMusePositiveLengthOwnerEnabledForUser(1, MUSE, -1), false);
  });
});
