/**
 * Operator PRECALL runner: production final-wire plans + cost planning.
 *
 * Usage (stdout of the Railway extractor is piped straight in; it carries raw
 * rows and must never be redirected to a file):
 *   railway ssh ... node /tmp/x.js | node --conditions=react-server --import tsx \
 *     scripts/rp-quality-precall-final-wire.ts --expected-deploy-sha <railway sha> \
 *     [--supplied-proof <hash-only json> --supplied-expected-sha <sha>]
 *
 * Provider POST = 0 (fetch is trapped), DB write = 0 (DATA_DIR is an empty temp
 * dir that must stay empty), prose scores = null. Output is size/hash metadata.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  buildRpQualityPrecallReport,
  computeRpQualityPrecallCostPlanning,
  stringContainsSecretShape,
  validateLiveProof,
  type RpQualityPrecallFxSnapshotRow,
  type RpQualityPrecallLiveProofInput,
} from "../src/lib/rpQualityPrecall";
import {
  PrecallAssemblyStop,
  assemblePrecallFinalWire,
  type PrecallAssemblyRows,
} from "./lib/rpQualityPrecallFinalWire";

type ExtractorOk = {
  ok: true;
  proof: RpQualityPrecallLiveProofInput;
  rows: PrecallAssemblyRows & {
    fx: RpQualityPrecallFxSnapshotRow;
    flags: Record<string, string>;
  };
  flagNamePattern: string;
  providerPosts: 0;
  dbReadOnly: true;
  queryOnly: true;
  singleReadTransaction: true;
};

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

const PROVIDER_CREDENTIAL_ENV = [
  "CHEAPER_INFERENCE_API_KEY",
  "CHEAPER_INFERENCE_BENCHMARK_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "FLUENCE_API_KEY",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "TURSO_DATABASE_TURSO_AUTH_TOKEN",
] as const;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readStdin(): string {
  const text = readFileSync(0, "utf8");
  if (!text.trim()) fail("EXTRACTOR_OUTPUT_EMPTY");
  return text;
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
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

function applyProductionFlags(flags: Record<string, string>, namePattern: string): string[] {
  const pattern = new RegExp(namePattern);
  for (const name of Object.keys(process.env)) {
    if (pattern.test(name)) delete process.env[name];
  }
  for (const [name, value] of Object.entries(flags)) process.env[name] = value;
  return Object.keys(flags).sort();
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
  process.stdout.write(`${JSON.stringify({ ok: false, code, providerPosts: 0, ...extra }, null, 2)}\n`);
  process.exit(2);
}

function main(): void {
  let providerPosts = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    providerPosts += 1;
    return realFetch(...args);
  }) as typeof fetch;
  for (const name of PROVIDER_CREDENTIAL_ENV) delete process.env[name];
  const dataDir = mkdtempSync(path.join(tmpdir(), "precall-empty-data-"));
  process.env.DATA_DIR = dataDir;

  const expectedDeploySha = argValue("--expected-deploy-sha")?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{40}$/.test(expectedDeploySha)) fail("EXPECTED_DEPLOY_SHA_REQUIRED");
  const prHead = git(["rev-parse", "HEAD"]).toLowerCase();
  if (expectedDeploySha === prHead) fail("EXPECTED_SHA_IS_PR_HEAD_NOT_PRODUCTION");

  const extracted = JSON.parse(readStdin()) as ExtractorOk | { ok: false; code: string };
  if (!extracted.ok) fail(`EXTRACTOR_${extracted.code}`);
  const { proof: freshProofInput, rows } = extracted;

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

  const appliedFlags = applyProductionFlags(rows.flags, extracted.flagNamePattern);

  let finalWire;
  try {
    finalWire = assemblePrecallFinalWire(rows);
  } catch (error) {
    if (error instanceof PrecallAssemblyStop) fail(`ASSEMBLY_STOP_${error.code}`, { proofSummary });
    throw error;
  }

  const costPlanning = computeRpQualityPrecallCostPlanning({
    sizeRows: finalWire.plans.map((plan) => plan.size),
    fxRow: rows.fx,
  });
  const precall = buildRpQualityPrecallReport({
    liveProofInput: freshProofInput,
    expectedDeploySha,
  });

  const localDbOpened = readdirSync(dataDir).length;
  rmSync(dataDir, { recursive: true, force: true });

  const output = {
    ok: true,
    providerPosts,
    dbWrites: 0,
    localDbFilesCreated: localDbOpened,
    productionDbAccess: {
      readOnly: extracted.dbReadOnly,
      queryOnly: extracted.queryOnly,
      singleReadTransaction: extracted.singleReadTransaction,
    },
    proofSummary,
    classification: precall.classification,
    precallReady: precall.precallReady,
    readinessScope: precall.readinessScope,
    productionFlagsApplied: describeFlags(rows.flags),
    appliedFlagCount: appliedFlags.length,
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
  if (providerPosts !== 0) fail("PROVIDER_POST_ATTEMPTED");
  if (localDbOpened !== 0) fail("LOCAL_DB_FILE_CREATED");
  if (stringContainsSecretShape(serialized)) fail("SECRET_SHAPED_VALUE_IN_OUTPUT");
  if (findRawSourceLeak(serialized, rawTextsForLeakCheck(rows))) fail("RAW_SOURCE_LEAK_IN_OUTPUT");

  const artifactPath = argValue("--write-artifact");
  if (artifactPath) writeFileSync(artifactPath, `${serialized}\n`, "utf8");
  process.stdout.write(`${serialized}\n`);
}

main();
