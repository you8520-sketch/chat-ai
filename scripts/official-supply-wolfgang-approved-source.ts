import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeAppearanceLockHash } from "@/lib/officialSupply/appearance";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  WOLFGANG_APPROVED_SOURCE_RELATIVE,
  WOLFGANG_IN_PLACE_TARGET,
  wolfgangApprovedPersistedSourcePath,
} from "@/lib/officialSupply/inPlaceWolfgang";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";

const RAILWAY_PROJECT = "072644e5-ce50-49bb-ab2e-1f13bae6b149";
const RAILWAY_SERVICE = "chat-ai";
const RAILWAY_ENVIRONMENT = "production";
const PERSIST_BASENAME = "pilot-rf-02.source.json";
const PERSIST_REMOTE = `/data/${WOLFGANG_APPROVED_SOURCE_RELATIVE.replace(/\\/g, "/")}`;

function railwaySsh(remote: string): string {
  return `railway ssh -p ${RAILWAY_PROJECT} -s ${RAILWAY_SERVICE} -e ${RAILWAY_ENVIRONMENT} -i "$SSH_IDENTITY" -- ${remote}`;
}

function placeCommand(): string {
  return [
    `tar cz -C "$(dirname "$SOURCE")" "$(basename "$SOURCE")" | ${railwaySsh(
      `sh -c 'set -e; DEST=/data/official-supply/approved; mkdir -p "$DEST"; if [ -f "$DEST/${PERSIST_BASENAME}" ]; then cp -f "$DEST/${PERSIST_BASENAME}" "$DEST/${PERSIST_BASENAME}.bak"; fi; TMP=$(mktemp "$DEST/${PERSIST_BASENAME}.tmp.XXXXXX"); trap "rm -f \\"$TMP\\"" EXIT; tar xz -O > "$TMP"; test -s "$TMP"; mv -f "$TMP" "$DEST/${PERSIST_BASENAME}"'`
    )}`,
  ].join(" ");
}

function restoreCommand(): string {
  return railwaySsh(
    `sh -c 'set -e; DEST=/data/official-supply/approved; test -s "$DEST/${PERSIST_BASENAME}.bak"; cp -f "$DEST/${PERSIST_BASENAME}.bak" "$DEST/${PERSIST_BASENAME}"'`
  );
}

function inspect(): void {
  console.log(
    JSON.stringify(
      {
        status: "INSPECT",
        persistedToProduction: false,
        providerCalls: 0,
        sourceDraftKey: WOLFGANG_IN_PLACE_TARGET.sourceDraftKey,
        persistRelative: WOLFGANG_APPROVED_SOURCE_RELATIVE,
        persistResolved: wolfgangApprovedPersistedSourcePath(),
        persistRemote: PERSIST_REMOTE,
        previousTextLockHash: WOLFGANG_IN_PLACE_TARGET.previousTextLockHash,
        approvedTextLockHash: WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash,
        appearanceLockHash: WOLFGANG_IN_PLACE_TARGET.appearanceLockHash,
        missingBehavior: "approved_source_missing — no repo-sheet or previous-manuscript fallback",
        mismatchBehavior: "approved_source_text_lock_mismatch / approved_source_appearance_lock_mismatch",
        railwayReuse: "existing railway ssh tar-over-ssh atomic write; persistent DATA_DIR=/data",
        place: placeCommand(),
        restore: restoreCommand(),
        verify: "npm run official-supply:wolfgang-approved-source -- --verify <decrypted-source.json>",
      },
      null,
      2
    )
  );
}

function verify(sourcePath: string): void {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new OfficialSupplyGateError("approved_source_missing", `local approved source is missing at ${resolved}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-approved-verify-"));
  const previousDataDir = process.env.DATA_DIR;
  const previousPilotDir = process.env.OFFICIAL_SUPPLY_PILOT_DIR;
  try {
    const dest = path.join(tmp, WOLFGANG_APPROVED_SOURCE_RELATIVE);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(resolved, dest);
    process.env.DATA_DIR = tmp;
    delete process.env.OFFICIAL_SUPPLY_PILOT_DIR;
    const source = loadCompiledOfficialCharacterSource(WOLFGANG_IN_PLACE_TARGET.sourceDraftKey);
    console.log(
      JSON.stringify(
        {
          status: "verified",
          persistedToProduction: false,
          persistRemote: PERSIST_REMOTE,
          textLockHash: computeTextLockHash(source.draft),
          appearanceLockHash: computeAppearanceLockHash(source.appearanceLock),
          approvedTextLockHash: WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash,
          approvedAppearanceLockHash: WOLFGANG_IN_PLACE_TARGET.appearanceLockHash,
        },
        null,
        2
      )
    );
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousPilotDir === undefined) delete process.env.OFFICIAL_SUPPLY_PILOT_DIR;
    else process.env.OFFICIAL_SUPPLY_PILOT_DIR = previousPilotDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    inspect();
    return;
  }
  if (argv[0] === "--verify" && argv[1] && argv.length === 2) {
    verify(argv[1]);
    return;
  }
  throw new OfficialSupplyGateError(
    "approved_source_usage",
    "usage: official-supply-wolfgang-approved-source [--verify <decrypted-source.json>]"
  );
}

main();
