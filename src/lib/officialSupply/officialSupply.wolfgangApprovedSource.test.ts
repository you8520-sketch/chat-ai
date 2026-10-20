import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import type { OfficialCharacterBible } from "@/lib/officialSupply/bible";
import {
  OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH_ENV,
  WOLFGANG_IN_PLACE_TARGET,
  wolfgangApprovedPersistedSourcePath,
} from "@/lib/officialSupply/inPlaceWolfgang";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import type { OfficialAppearanceLock } from "@/lib/officialSupply/types";

const SOURCE_KEY = WOLFGANG_IN_PLACE_TARGET.sourceDraftKey;
const PILOT_SOURCE_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const PREVIOUS_SOURCE_FIXTURE = path.join(
  PILOT_SOURCE_DIR,
  "fixtures",
  "pilot-rf-02-approved-c91ba66a.source.json"
);
const PUBLIC_GREETING_PREFIX = "흑철 요새의 집무실에는 세 가지 소리만 남아 있었다";
const SYNTHETIC_GREETING = "합성 승인 첫 메시지입니다. 이 문장은 기계 동작 검증용이며 운영 원고가 아닙니다.";

type EnvSnapshot = {
  dataDir?: string;
  pilotDir?: string;
  targetPath?: string;
  testContext?: string;
};

const originalEnv: EnvSnapshot = {
  dataDir: process.env.DATA_DIR,
  pilotDir: process.env.OFFICIAL_SUPPLY_PILOT_DIR,
  targetPath: process.env[OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH_ENV],
  testContext: process.env.NODE_TEST_CONTEXT,
};

const tempDirs: string[] = [];

function restoreEnv(): void {
  if (originalEnv.dataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalEnv.dataDir;
  if (originalEnv.pilotDir === undefined) delete process.env.OFFICIAL_SUPPLY_PILOT_DIR;
  else process.env.OFFICIAL_SUPPLY_PILOT_DIR = originalEnv.pilotDir;
  if (originalEnv.targetPath === undefined) delete process.env[OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH_ENV];
  else process.env[OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH_ENV] = originalEnv.targetPath;
  if (originalEnv.testContext === undefined) delete process.env.NODE_TEST_CONTEXT;
  else process.env.NODE_TEST_CONTEXT = originalEnv.testContext;
}

function isolateDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-approved-persist-"));
  tempDirs.push(dir);
  process.env.DATA_DIR = dir;
  delete process.env.OFFICIAL_SUPPLY_PILOT_DIR;
  return dir;
}

function writeSyntheticApprovedSource(dest: string): void {
  const base = JSON.parse(fs.readFileSync(PREVIOUS_SOURCE_FIXTURE, "utf8")) as {
    slot: number;
    draftKey: string;
    brief: unknown;
    bible: OfficialCharacterBible;
    appearance: OfficialAppearanceLock;
    assetPlan?: unknown;
  };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(
    dest,
    JSON.stringify({
      slot: base.slot,
      draftKey: SOURCE_KEY,
      brief: base.brief,
      appearance: base.appearance,
      assetPlan: base.assetPlan ?? { slots: [] },
      bible: {
        ...base.bible,
        usesSharedWorld: true,
        greeting: SYNTHETIC_GREETING,
        publicProfile: {
          ...base.bible.publicProfile,
          tagline: "합성 승인 한 줄. 운영 태그라인이 아닙니다.",
        },
        speech: {
          ...base.bible.speech,
          examples: "“합성 예시 하나.”\n“합성 예시 둘.”\n“합성 예시 셋.”\n“합성 예시 넷.”\n“합성 예시 다섯.”",
        },
      },
    })
  );
}

function compileThroughPilotDir(characterFile: string): ReturnType<typeof loadCompiledOfficialCharacterSource> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-approved-pilot-"));
  tempDirs.push(dir);
  fs.cpSync(PILOT_SOURCE_DIR, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}fixtures`) });
  fs.copyFileSync(characterFile, path.join(dir, "characters", `${SOURCE_KEY}.json`));
  process.env.OFFICIAL_SUPPLY_PILOT_DIR = dir;
  const compiled = loadCompiledOfficialCharacterSource(SOURCE_KEY);
  delete process.env.OFFICIAL_SUPPLY_PILOT_DIR;
  return compiled;
}

function installSyntheticTarget(approvedTextLockHash: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-synthetic-target-"));
  tempDirs.push(dir);
  const targetPath = path.join(dir, "wolfgang-synthetic-target.json");
  fs.writeFileSync(
    targetPath,
    JSON.stringify({
      ...WOLFGANG_IN_PLACE_TARGET,
      approvedTextLockHash,
    })
  );
  process.env[OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH_ENV] = targetPath;
  return targetPath;
}

function assertGate(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof OfficialSupplyGateError, `expected OfficialSupplyGateError, got ${String(error)}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected ${code}`);
}

describe("Wolfgang approved persist source", () => {
  afterEach(() => {
    restoreEnv();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the production Text Lock and Appearance Lock pins", () => {
    assert.equal(
      WOLFGANG_IN_PLACE_TARGET.previousTextLockHash,
      "599854610891ee4e09224d1bec863501227157584b66068f0e1cab5e0e1ca89c"
    );
    assert.equal(
      WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash,
      "e22ba966bdeab1babb331bdc916fe43a0e0d4e8adb3f5f2ba32f969c28ba2af2"
    );
    assert.equal(
      WOLFGANG_IN_PLACE_TARGET.appearanceLockHash,
      "1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3"
    );
  });

  it("throws approved_source_missing on the production path when persist is absent", () => {
    isolateDataDir();
    delete process.env.NODE_TEST_CONTEXT;
    assert.equal(fs.existsSync(wolfgangApprovedPersistedSourcePath()), false);
    assertGate(() => loadCompiledOfficialCharacterSource(SOURCE_KEY), "approved_source_missing");
  });

  it("does not fall back to the previous manuscript when persist Text Lock mismatches", () => {
    isolateDataDir();
    delete process.env[OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH_ENV];
    const persist = wolfgangApprovedPersistedSourcePath();
    fs.mkdirSync(path.dirname(persist), { recursive: true });
    fs.copyFileSync(PREVIOUS_SOURCE_FIXTURE, persist);
    assertGate(() => loadCompiledOfficialCharacterSource(SOURCE_KEY), "approved_source_text_lock_mismatch");
    const publicSheet = JSON.parse(
      fs.readFileSync(path.join(PILOT_SOURCE_DIR, "characters", `${SOURCE_KEY}.json`), "utf8")
    ) as { bible: { greeting: string } };
    assert.match(publicSheet.bible.greeting, new RegExp(PUBLIC_GREETING_PREFIX));
  });

  it("does not fall back when persist Appearance Lock mismatches a matching Text Lock", () => {
    isolateDataDir();
    const persist = wolfgangApprovedPersistedSourcePath();
    writeSyntheticApprovedSource(persist);
    const compiled = compileThroughPilotDir(persist);
    installSyntheticTarget(computeTextLockHash(compiled.draft));
    const mutated = JSON.parse(fs.readFileSync(persist, "utf8")) as {
      appearance: OfficialAppearanceLock;
    };
    mutated.appearance = {
      ...mutated.appearance,
      identity: { ...mutated.appearance.identity, heightCm: mutated.appearance.identity.heightCm + 1 },
    };
    fs.writeFileSync(persist, JSON.stringify(mutated));
    assertGate(() => loadCompiledOfficialCharacterSource(SOURCE_KEY), "approved_source_appearance_lock_mismatch");
  });

  it("loads a matching persisted synthetic source instead of the public repo sheet", () => {
    isolateDataDir();
    const persist = wolfgangApprovedPersistedSourcePath();
    writeSyntheticApprovedSource(persist);
    const compiled = compileThroughPilotDir(persist);
    installSyntheticTarget(computeTextLockHash(compiled.draft));
    const loaded = loadCompiledOfficialCharacterSource(SOURCE_KEY);
    assert.equal(loaded.draft.greeting, SYNTHETIC_GREETING);
    assert.equal(computeTextLockHash(loaded.draft), computeTextLockHash(compiled.draft));
    assert.doesNotMatch(loaded.draft.greeting, new RegExp(PUBLIC_GREETING_PREFIX));
  });
});
