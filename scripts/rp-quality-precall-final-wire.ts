/**
 * Operator PRECALL runner: production final-wire plans + cost planning.
 *
 * Runs INSIDE the approved Railway production container (see
 * `scripts/railway-precall-final-wire.sh`). Raw production rows are read
 * read-only into memory, assembled in-process, and only metadata leaves the
 * process: hashes, lengths, token estimates, model/fixture metadata, cost
 * scenarios and parity results. Raw rows never reach stdout, SSH, a pipe or a file.
 *
 * Provider egress is blocked fail-closed by the egress guard, which must stay
 * the first import. DB write = 0 (DATA_DIR is an empty temp dir that must stay
 * empty), prose scores = null.
 */
import "./lib/rpQualityPrecallEgressGuard";

import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  buildRpQualityPrecallReport,
  computeRpQualityPrecallCostPlanning,
  stringContainsSecretShape,
  validateLiveProof,
  type RpQualityPrecallLiveProofInput,
} from "../src/lib/rpQualityPrecall";
import {
  precallEgressAttempts,
  precallUnexpectedEgressAttempts,
  precallOriginalDataDir,
  precallTempDataDir,
} from "./lib/rpQualityPrecallEgressGuard";
import {
  PrecallAssemblyStop,
  assemblePrecallFinalWire,
  type PrecallAssemblyRows,
} from "./lib/rpQualityPrecallFinalWire";
import { PrecallRowsStop, loadPrecallProductionRows } from "./lib/rpQualityPrecallProductionRows";

const PROOF_HASH_FIELDS = [
  "greetingSha256",
  "systemPromptSha256",
  "worldSha256",
  "settingChunksSha256",
  "personaPublicSha256",
] as const;

const REQUIRED_PROOF_STRING_FIELDS = [
  "source",
  "generatedAt",
  "deployedGitSha",
  "characterName",
  "personaName",
  "authoringLevel",
  "contentMode",
  ...PROOF_HASH_FIELDS,
] as const;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Typed hash-only subset. Anything else in the supplied file is ignored. */
function typedProofSubset(raw: unknown): RpQualityPrecallLiveProofInput {
  if (!raw || typeof raw !== "object") throw new Error("supplied proof is not an object");
  const record = raw as Record<string, unknown>;
  for (const field of REQUIRED_PROOF_STRING_FIELDS) {
    if (typeof record[field] !== "string") throw new Error(`supplied proof missing ${field}`);
  }
  if (typeof record.characterId !== "number") throw new Error("supplied proof missing characterId");
  return {
    source: record.source as string,
    generatedAt: record.generatedAt as string,
    deployedGitSha: record.deployedGitSha as string,
    characterId: record.characterId,
    characterName: record.characterName as string,
    greetingSha256: record.greetingSha256 as string,
    systemPromptSha256: record.systemPromptSha256 as string,
    worldSha256: record.worldSha256 as string,
    settingChunksSha256: record.settingChunksSha256 as string,
    personaName: record.personaName as string,
    personaPublicSha256: record.personaPublicSha256 as string,
    authoringLevel: record.authoringLevel as RpQualityPrecallLiveProofInput["authoringLevel"],
    contentMode: record.contentMode as RpQualityPrecallLiveProofInput["contentMode"],
    personaId: typeof record.personaId === "number" ? record.personaId : undefined,
    personaGender: typeof record.personaGender === "string" ? record.personaGender : undefined,
    personaPublicChars:
      typeof record.personaPublicChars === "number" ? record.personaPublicChars : undefined,
  };
}

function hashFieldsEqual(
  a: RpQualityPrecallLiveProofInput,
  b: RpQualityPrecallLiveProofInput
): Record<(typeof PROOF_HASH_FIELDS)[number], boolean> {
  return Object.fromEntries(
    PROOF_HASH_FIELDS.map((field) => [field, a[field] === b[field]])
  ) as Record<(typeof PROOF_HASH_FIELDS)[number], boolean>;
}

function describeFlags(flags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(flags).map(([name, value]) => [
      name,
      value.length <= 40 ? value : `<${value.length} chars>`,
    ])
  );
}

function rawTextsForLeakCheck(rows: PrecallAssemblyRows): string[] {
  const character = rows.character as unknown as Record<string, unknown>;
  const texts = [
    "greeting",
    "system_prompt",
    "world",
    "setting_chunks",
    "example_dialog",
    "description",
    "speech_profile",
    "creator_raw_description",
  ].map((field) => String(character[field] ?? ""));
  texts.push(String(rows.persona.description ?? ""), String(rows.user.user_note ?? ""));
  for (const entry of rows.globalLorebook) texts.push(String(entry.content ?? ""));
  return texts.filter((text) => text.length >= 24);
}

/** Any 24-char window of a raw source string appearing in the output is a leak. */
function findRawSourceLeak(output: string, rawTexts: readonly string[]): boolean {
  const width = 24;
  for (const text of rawTexts) {
    for (let offset = 0; offset + width <= text.length; offset += 12) {
      const window = text.slice(offset, offset + width);
      if (!window.trim()) continue;
      if (output.includes(window) || output.includes(JSON.stringify(window).slice(1, -1))) {
        return true;
      }
    }
  }
  return false;
}

function fail(code: string, extra: Record<string, unknown> = {}): never {
  process.stdout.write(
    `${JSON.stringify({ ok: false, code, providerPosts: 0, egressAttemptsBlocked: precallEgressAttempts().length, ...extra }, null, 2)}\n`
  );
  process.exit(2);
}

function main(): void {
  const expectedDeploySha = argValue("--expected-deploy-sha")?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{40}$/.test(expectedDeploySha)) fail("EXPECTED_DEPLOY_SHA_REQUIRED");
  const prHead = argValue("--pr-head")?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{40}$/.test(prHead)) fail("PR_HEAD_REQUIRED");
  if (expectedDeploySha === prHead) fail("EXPECTED_SHA_IS_PR_HEAD_NOT_PRODUCTION");

  const dbPath = argValue("--db-path") ?? path.join(precallOriginalDataDir, "app.db");
  let loaded;
  try {
    loaded = loadPrecallProductionRows({
      dbPath,
      deployedGitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? "",
      env: process.env,
    });
  } catch (error) {
    if (error instanceof PrecallRowsStop) fail(`ROWS_${error.code}`);
    throw error;
  }
  const { proof: freshProofInput, rows, fx, flags } = loaded;

  const suppliedFile = argValue("--supplied-proof");
  const suppliedExpected = argValue("--supplied-expected-sha")?.trim().toLowerCase();
  const suppliedProofInput = suppliedFile
    ? typedProofSubset(JSON.parse(readFileSync(suppliedFile, "utf8")))
    : null;

  const freshProof = validateLiveProof(freshProofInput, { expectedDeploySha });
  const suppliedAgainstCurrent = suppliedProofInput
    ? validateLiveProof(suppliedProofInput, { expectedDeploySha })
    : null;
  const suppliedAgainstEra =
    suppliedProofInput && suppliedExpected
      ? validateLiveProof(suppliedProofInput, { expectedDeploySha: suppliedExpected })
      : null;
  const proofSummary = {
    expectedDeploySha,
    prHead,
    fresh: { status: freshProof.status, deployedGitSha: freshProofInput.deployedGitSha },
    suppliedAgainstEraSha: suppliedAgainstEra
      ? {
          expectedSha: suppliedExpected,
          status: suppliedAgainstEra.status,
          reasons: suppliedAgainstEra.status === "UNVERIFIED" ? suppliedAgainstEra.reasons : [],
        }
      : null,
    suppliedAgainstCurrentSha: suppliedAgainstCurrent
      ? {
          status: suppliedAgainstCurrent.status,
          reasons:
            suppliedAgainstCurrent.status === "UNVERIFIED" ? suppliedAgainstCurrent.reasons : [],
        }
      : null,
    suppliedVsFreshHashEquality: suppliedProofInput
      ? hashFieldsEqual(suppliedProofInput, freshProofInput)
      : null,
    defaultNoInput: validateLiveProof(undefined, { expectedDeploySha }).status,
    wrongSha: validateLiveProof(freshProofInput, {
      expectedDeploySha: prHead,
    }).status,
    wrongCharacter: validateLiveProof(
      { ...freshProofInput, characterId: 99 },
      { expectedDeploySha }
    ).status,
    wrongPersona: validateLiveProof(
      { ...freshProofInput, personaName: "다른이름" },
      { expectedDeploySha }
    ).status,
  };
  if (freshProof.status !== "VERIFIED") fail("FRESH_LIVE_PROOF_NOT_VERIFIED", { proofSummary });
  if (
    freshProofInput.characterId !== RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId ||
    String(rows.character.id) !== String(freshProofInput.characterId)
  ) {
    fail("ROW_PROOF_IDENTITY_MISMATCH");
  }

  let finalWire;
  try {
    finalWire = assemblePrecallFinalWire(rows);
  } catch (error) {
    if (error instanceof PrecallAssemblyStop) fail(`ASSEMBLY_STOP_${error.code}`, { proofSummary });
    throw error;
  }

  const costPlanning = computeRpQualityPrecallCostPlanning({
    sizeRows: finalWire.plans.map((plan) => plan.size),
    fxRow: fx,
  });
  const precall = buildRpQualityPrecallReport({
    liveProofInput: freshProofInput,
    expectedDeploySha,
  });

  const scratchDbFiles = readdirSync(precallTempDataDir).length;
  rmSync(precallTempDataDir, { recursive: true, force: true });
  const egressAttempts = precallEgressAttempts();

  const output = {
    ok: true,
    providerPosts: 0,
    egress: {
      attemptsBlocked: egressAttempts.length,
      unexpectedAttempts: 0,
      blockedAttempts: egressAttempts,
      transmitted: 0,
      guard: "fail_closed_before_transport",
    },
    dbWrites: 0,
    scratchDataDir: { filesFromModuleInit: scratchDbFiles, removedAfterRun: true },
    productionDbAccess: {
      readOnly: loaded.dbReadOnly,
      queryOnly: loaded.queryOnly,
      singleReadTransaction: loaded.singleReadTransaction,
      rawRowsLeftProcess: false,
    },
    proofSummary,
    classification: precall.classification,
    precallReady: precall.precallReady,
    readinessScope: precall.readinessScope,
    productionFlagsObserved: describeFlags(flags),
    observedFlagCount: Object.keys(flags).length,
    finalWire: {
      plans: finalWire.plans.map((plan) => ({
        fixtureId: plan.fixtureId,
        stimulusId: plan.stimulusId,
        canonicalId: plan.canonicalId,
        displayLabel: plan.displayLabel,
        semanticFingerprint: plan.semanticFingerprint,
        finalWireFingerprint: plan.finalWireFingerprint,
        adapter: plan.adapter,
        canon: plan.canon,
        size: plan.size,
        statusWidgetActive: plan.statusWidgetActive,
        scenePacingOwner: plan.scenePacingOwner,
        historyRoles: plan.historyRoles,
        sectionCount: plan.sections.length,
        sections: plan.sections,
      })),
      parity: finalWire.parity,
      assembly: finalWire.assembly,
    },
    costPlanning,
    scores: null,
    rawSourceTextPrinted: false,
  };

  const serialized = JSON.stringify(output, null, 2);
  const unexpectedEgress = precallUnexpectedEgressAttempts();
  if (unexpectedEgress.length !== 0) fail("EGRESS_ATTEMPTED", { attempts: unexpectedEgress });
  if (stringContainsSecretShape(serialized)) fail("SECRET_SHAPED_VALUE_IN_OUTPUT");
  if (findRawSourceLeak(serialized, rawTextsForLeakCheck(rows))) fail("RAW_SOURCE_LEAK_IN_OUTPUT");

  process.stdout.write(`${serialized}\n`);
}

try {
  main();
} catch (error) {
  fail("RUNNER_FAILED", { errorName: error instanceof Error ? error.name : "Error" });
}
