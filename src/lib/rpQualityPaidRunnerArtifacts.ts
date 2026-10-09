/**
 * Operator-local private output artifacts for the paid runner.
 * Stores raw generated text only under a content hash. Never writes secrets,
 * prompts, or keys. Public journal stores the fingerprint, not the text.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type PaidRunnerArtifactRecord = {
  requestOrder: number;
  fingerprint: string;
  text: string;
};

export type PaidRunnerArtifactStore = {
  kind: "memory" | "file";
  persist(record: PaidRunnerArtifactRecord): string;
  load(fingerprint: string): string | null;
};

function assertSafeFingerprint(fingerprint: string): void {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("ARTIFACT_FINGERPRINT_INVALID");
  }
}

export function paidRunnerArtifactFingerprint(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function createMemoryPaidRunnerArtifactStore(): PaidRunnerArtifactStore {
  const records = new Map<string, string>();
  return {
    kind: "memory",
    persist(record) {
      const fingerprint = paidRunnerArtifactFingerprint(record.text);
      if (fingerprint !== record.fingerprint) {
        throw new Error("ARTIFACT_FINGERPRINT_MISMATCH");
      }
      records.set(fingerprint, record.text);
      return fingerprint;
    },
    load(fingerprint) {
      return records.get(fingerprint) ?? null;
    },
  };
}

export function createFilePaidRunnerArtifactStore(directory: string): PaidRunnerArtifactStore {
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
    throw new Error("ARTIFACT_STORE_UNAVAILABLE");
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    /* best-effort on filesystems that ignore mode */
  }
  return {
    kind: "file",
    persist(record) {
      const fingerprint = paidRunnerArtifactFingerprint(record.text);
      if (fingerprint !== record.fingerprint) {
        throw new Error("ARTIFACT_FINGERPRINT_MISMATCH");
      }
      assertSafeFingerprint(fingerprint);
      const dest = path.join(directory, `${fingerprint}.txt`);
      const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
      const fd = openSync(tmp, "w", 0o600);
      try {
        writeFileSync(fd, record.text, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      try {
        chmodSync(tmp, 0o600);
      } catch {
        /* ignore */
      }
      renameSync(tmp, dest);
      try {
        chmodSync(dest, 0o600);
      } catch {
        /* ignore */
      }
      const dirFd = openSync(directory, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
      return fingerprint;
    },
    load(fingerprint) {
      assertSafeFingerprint(fingerprint);
      const file = path.join(directory, `${fingerprint}.txt`);
      if (!existsSync(file)) return null;
      return readFileSync(file, "utf8");
    },
  };
}
