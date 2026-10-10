/**
 * Versioned private snapshot store for MAIN_RP_STYLE_LENGTH.
 * Never overwrites an existing version. Public GitHub must not import sealed bytes.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT,
  MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA,
  MainRpStyleLengthFixtureError,
  type MainRpStyleLengthPublicManifest,
} from "@/lib/rpMainRpStyleLengthFixture";

export const MAIN_RP_STYLE_LENGTH_SEALED_FILENAME = "sealed.json";
export const MAIN_RP_STYLE_LENGTH_PUBLIC_FILENAME = "manifest.public.json";

export type MainRpStyleLengthSnapshotRecord = {
  version: number;
  sealedSha256: string;
  publicManifest: MainRpStyleLengthPublicManifest;
  sealed: unknown;
};

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function assertSafeVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("SNAPSHOT_VERSION_INVALID");
  }
}

function writeAtomicFile(dest: string, body: string, mode: number): void {
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "w", mode);
  try {
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(tmp, mode);
  } catch {
    /* filesystems may ignore mode */
  }
  renameSync(tmp, dest);
  try {
    chmodSync(dest, mode);
  } catch {
    /* ignore */
  }
}

function fsyncDir(directory: string): void {
  const dirFd = openSync(directory, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

export function mainRpStyleLengthVersionDir(root: string, version: number): string {
  assertSafeVersion(version);
  return path.join(root, `v${version}`);
}

export function createMainRpStyleLengthSnapshotStore(root = MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    chmodSync(root, 0o700);
  } catch {
    /* best-effort */
  }

  return {
    root,
    createVersion(input: {
      version: number;
      sealed: unknown;
      publicManifest: MainRpStyleLengthPublicManifest;
    }): MainRpStyleLengthSnapshotRecord {
      assertSafeVersion(input.version);
      if (input.publicManifest.snapshotVersion !== input.version) {
        throw new Error("SNAPSHOT_VERSION_MISMATCH");
      }
      if (input.publicManifest.snapshotSchema !== MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA) {
        throw new Error("SNAPSHOT_SCHEMA_MISMATCH");
      }
      const dir = mainRpStyleLengthVersionDir(root, input.version);
      if (existsSync(dir)) {
        throw new MainRpStyleLengthFixtureError("GOLDEN_VERSION_EXISTS");
      }
      const sealedText = `${JSON.stringify(input.sealed)}\n`;
      const publicText = `${JSON.stringify(input.publicManifest, null, 2)}\n`;
      const sealedSha256 = sha256Text(sealedText);
      mkdirSync(dir, { recursive: false, mode: 0o700 });
      try {
        chmodSync(dir, 0o700);
      } catch {
        /* ignore */
      }
      writeAtomicFile(path.join(dir, MAIN_RP_STYLE_LENGTH_SEALED_FILENAME), sealedText, 0o600);
      writeAtomicFile(path.join(dir, MAIN_RP_STYLE_LENGTH_PUBLIC_FILENAME), publicText, 0o600);
      writeAtomicFile(path.join(dir, "sealed.sha256"), `${sealedSha256}\n`, 0o600);
      fsyncDir(dir);
      fsyncDir(root);
      return {
        version: input.version,
        sealedSha256,
        publicManifest: input.publicManifest,
        sealed: input.sealed,
      };
    },
    loadVersion(version: number): MainRpStyleLengthSnapshotRecord {
      assertSafeVersion(version);
      const dir = mainRpStyleLengthVersionDir(root, version);
      const sealedPath = path.join(dir, MAIN_RP_STYLE_LENGTH_SEALED_FILENAME);
      const publicPath = path.join(dir, MAIN_RP_STYLE_LENGTH_PUBLIC_FILENAME);
      const hashPath = path.join(dir, "sealed.sha256");
      if (!existsSync(sealedPath) || !existsSync(publicPath) || !existsSync(hashPath)) {
        throw new MainRpStyleLengthFixtureError("GOLDEN_VERSION_MISSING");
      }
      const sealedText = readFileSync(sealedPath, "utf8");
      const expectedHash = readFileSync(hashPath, "utf8").trim();
      const actualHash = sha256Text(sealedText);
      if (expectedHash !== actualHash) {
        throw new MainRpStyleLengthFixtureError("SNAPSHOT_TAMPERED");
      }
      return {
        version,
        sealedSha256: actualHash,
        publicManifest: JSON.parse(readFileSync(publicPath, "utf8")) as MainRpStyleLengthPublicManifest,
        sealed: JSON.parse(sealedText) as unknown,
      };
    },
  };
}
