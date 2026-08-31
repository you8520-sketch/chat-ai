import type Database from "better-sqlite3";
import { refreshWorldBlueprintArtifact } from "@/lib/derivedCache/worldBlueprintPregen";
import { TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION } from "./blueprintValidity";
import { loadWorldForTrpg } from "./catalog";
import {
  loadValidWorldBlueprintPlan,
  loadWorldSnapshotForBlueprint,
} from "./worldBlueprintArtifact";
import type { TrpgAuthoringComplete } from "./scenarioDraftCall";

export type AdminBlueprintWarmupStatus = "already_warm" | "warmed" | "failed";

export type AdminBlueprintWarmupSuccess = {
  ok: true;
  status: "already_warm" | "warmed";
  worldId: number;
};

export type AdminBlueprintWarmupFailure = {
  ok: false;
  status: "failed";
  worldId: number;
  error: string;
};

export type AdminBlueprintWarmupResult = AdminBlueprintWarmupSuccess | AdminBlueprintWarmupFailure;

export class AdminBlueprintWarmupInputError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "AdminBlueprintWarmupInputError";
  }
}

/** Parse exactly one positive integer worldId from an admin warmup request body. */
export function parseAdminBlueprintWarmupWorldId(body: unknown): number {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new AdminBlueprintWarmupInputError("worldId is required", 400);
  }
  const record = body as Record<string, unknown>;
  if ("worldIds" in record || "worldIdList" in record || "ids" in record) {
    throw new AdminBlueprintWarmupInputError("worldId must be a single integer", 400);
  }
  const raw = record.worldId;
  if (raw === undefined || raw === null) {
    throw new AdminBlueprintWarmupInputError("worldId is required", 400);
  }
  if (Array.isArray(raw)) {
    throw new AdminBlueprintWarmupInputError("worldId must be a single integer", 400);
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new AdminBlueprintWarmupInputError("worldId must be a positive integer", 400);
  }
  return raw;
}

const WARMUP_GENERATION_FAILED_MESSAGE = "Blueprint generation failed.";
const WARMUP_VALIDITY_FAILED_MESSAGE =
  "Blueprint warmup did not produce a valid current artifact.";

/** Single canonical owner: admin explicit one-world Blueprint warmup orchestration. */
export async function warmWorldBlueprintForAdmin(
  db: Database.Database,
  worldId: number,
  deps?: { complete?: TrpgAuthoringComplete }
): Promise<AdminBlueprintWarmupResult> {
  const world = loadWorldForTrpg(db, worldId);
  if (!world) {
    throw new AdminBlueprintWarmupInputError("세계관을 찾을 수 없습니다.", 404);
  }
  if (world.trpg_enabled !== 1) {
    throw new AdminBlueprintWarmupInputError("TRPG가 활성화된 세계관만 워밍업할 수 있습니다.", 400);
  }

  const snapshot = loadWorldSnapshotForBlueprint(db, worldId);
  if (!snapshot) {
    throw new AdminBlueprintWarmupInputError("세계관 스냅샷을 불러올 수 없습니다.", 400);
  }

  if (loadValidWorldBlueprintPlan(db, worldId, snapshot)) {
    return { ok: true, status: "already_warm", worldId };
  }

  const sourceFingerprint = snapshot.sourceFingerprint;
  const outcome = await refreshWorldBlueprintArtifact(
    db,
    worldId,
    sourceFingerprint,
    TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
    deps
  );

  const currentSnapshot = loadWorldSnapshotForBlueprint(db, worldId);
  if (!currentSnapshot) {
    return {
      ok: false,
      status: "failed",
      worldId,
      error: WARMUP_VALIDITY_FAILED_MESSAGE,
    };
  }

  if (loadValidWorldBlueprintPlan(db, worldId, currentSnapshot)) {
    return { ok: true, status: "warmed", worldId };
  }

  if (!outcome.ok) {
    return {
      ok: false,
      status: "failed",
      worldId,
      error: WARMUP_GENERATION_FAILED_MESSAGE,
    };
  }

  return {
    ok: false,
    status: "failed",
    worldId,
    error: WARMUP_VALIDITY_FAILED_MESSAGE,
  };
}
