import type Database from "better-sqlite3";
import type { ChatSceneRow } from "@/lib/observerTypes";
import {
  closeActiveChatScene,
  ensureActiveChatScene,
  getActiveChatScene,
} from "@/lib/chatScenes";
import { getDb } from "@/lib/db";
import type { ParticipantAdultMetadata } from "@/lib/adultSceneRouting";
import {
  assessTrustedParticipantAdultStatus,
  deriveEffectiveSecondaryAdultStatus,
  eventToRestrictiveMetadata,
  extractCurrentTurnSceneParticipantEvents,
  isAuthoritativeParticipantId,
  projectAuthoritativeSecondaryActor,
  rejectPublicTrustedParticipantIdentity,
  resolveDynamicEventIdentity,
  toRestrictiveOnlyMetadata,
  toStoredAdultStatus,
  type AuthoritativeSecondaryActor,
  type SceneParticipantEvent,
} from "@/lib/secondarySceneParticipantEvidence";
import {
  ensureSecondarySceneParticipantSafetySchema,
  type SceneSecondaryParticipantSafetyEventRow,
  type SceneSecondaryParticipantSafetyRow,
  type SecondaryAdultStatus,
  type SecondaryEvidenceSource,
  type SecondaryEvidenceTrust,
  type SecondarySafetyCoverage,
} from "@/lib/secondarySceneParticipantSafetySchema";
import {
  deleteSecondarySafetyEventsForSourceMessages,
  getSecondarySafetyCoverage,
  getSecondaryParticipantSafety,
  insertSecondarySafetyEvent,
  listPresentSecondaryParticipants,
  listSecondaryParticipantSafetyForScene,
  listSecondarySafetyEventsForParticipant,
  resolveSecondarySafetyCoverage,
  setSecondarySafetyCoverageCore,
  upsertSecondaryParticipantSafety,
} from "@/lib/secondarySceneParticipantSafetyStore";

export type SecondaryParticipantView = {
  participantId: string;
  displayName: string;
  participantKind: SceneSecondaryParticipantSafetyRow["participant_kind"];
  presenceState: SceneSecondaryParticipantSafetyRow["presence_state"];
  adultStatus: SecondaryAdultStatus;
  evidenceTrust: SecondaryEvidenceTrust;
  evidenceSource: SecondaryEvidenceSource;
  age: number | null;
  authoritativeAge: number | null;
  authoritativeAdultStatus: SecondaryAdultStatus | null;
  restrictiveAge: number | null;
  restrictiveAdultStatus: SecondaryAdultStatus | null;
};

export type SecondarySceneSafetySnapshot = {
  presentSecondaryParticipants: SecondaryParticipantView[];
  restrictiveParticipantIds: string[];
  unknownParticipantIds: string[];
  minorParticipantIds: string[];
  conflictParticipantIds: string[];
  realPersonParticipantIds: string[];
  confirmedParticipantIds: string[];
  wouldBlockAdultScene: boolean;
  wouldDisableAdultHandoff: boolean;
  reason: string | null;
  coverage: SecondarySafetyCoverage;
};

/**
 * S1.1 canonical mutation matrix. Unsupported paths must stay out of S2
 * enforcement until they can retract source-owned evidence.
 */
export const SECONDARY_SAFETY_CANONICAL_RECONCILIATION = {
  regen: "SUPPORTED",
  delete: "SUPPORTED",
  assistantReplacement: "SUPPORTED",
  materialAssistantEdit: "SUPPORTED",
  variantSwitch: "SUPPORTED",
  "branch/noncanon": "NOT_APPLICABLE_TO_SECONDARY_SAFETY",
  fork: "COVERAGE_INCOMPLETE",
} as const;

export const SECONDARY_SAFETY_FUTURE_EXECUTION_ORDER = [
  "classify_scene",
  "base_main_persona_eligibility",
  "prospective_secondary_safety",
  "SecondarySceneParticipantGuard",
  "durable_user_assistant_bootstrap",
  "commit_secondary_safety_evidence",
  "background_extractors",
  "adult_route_delivery",
  "provider",
  "billing_deduction",
] as const;

export const SECONDARY_SAFETY_FUTURE_FAILURE_POLICY = {
  normalRp: "continue_general_model_adult_handoff_disabled",
  adultOrSexual: "fail_closed_before_provider",
} as const;

export const SECONDARY_SAFETY_BRANCH_NONCANON_AUDIT = {
  classification: "NOT_APPLICABLE_TO_SECONDARY_SAFETY",
  reason:
    "memory branch/noncanon changes memory-record canonicality only; it does not replace message rows, switch variants, mutate chat_scenes, or create/copy chats",
} as const;

export const SECONDARY_SAFETY_USER_EDIT_BOUNDARY_POLICY = {
  classification: "UNSUPPORTED_FOR_S2",
  action:
    "mark coverage INCOMPLETE until a fresh sceneReset or clearSceneTransition",
} as const;

export type SecondarySafetyFailurePoint =
  | "AFTER_EVENT_INSERT"
  | "AFTER_PROJECTION_WRITE"
  | "AFTER_EVENT_DELETE"
  | "MID_EVENT_BATCH";

export type EvaluateSecondarySceneSafetyInput = {
  chatId: number;
  userMessage: string;
  sceneReset: boolean;
  clearSceneTransition?: boolean;
  currentTurn: number;
  sourceMessageId?: number | null;
  skipSceneBoundary?: boolean;
  applyUserEvents?: boolean;
  sexualContextActive?: boolean;
  authoritativeActors?: AuthoritativeSecondaryActor[];
  publicParticipantClaims?: Array<{
    participantId?: unknown;
    age?: unknown;
    adultStatus?: unknown;
    isRealPerson?: unknown;
  }>;
  db?: Database.Database;
  /** @internal test-only */
  __testFailurePoint?: SecondarySafetyFailurePoint;
};

function runSecondarySafetyAtomic<T>(
  db: Database.Database,
  core: () => T
): T {
  // Callers such as last-turn delete already own the transaction. Running the
  // core directly avoids nested transaction/savepoint ownership.
  return db.inTransaction ? core() : db.transaction(core).immediate();
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase().normalize("NFC");
}

export function resolveSafetySceneBoundary(opts: {
  chatId: number;
  sceneReset: boolean;
  clearSceneTransition?: boolean;
  currentTurn: number;
  db?: Database.Database;
}): { scene: ChatSceneRow; closedPrevious: boolean; created: boolean } {
  const db = opts.db ?? getDb();
  ensureSecondarySceneParticipantSafetySchema(db);
  const shouldClose = opts.sceneReset === true || opts.clearSceneTransition === true;
  let closedPrevious = false;
  if (shouldClose) {
    const closed = closeActiveChatScene({
      chatId: opts.chatId,
      endedTurn: opts.currentTurn,
      db,
    });
    closedPrevious = Boolean(closed);
  }
  const ensured = ensureActiveChatScene({
    chatId: opts.chatId,
    startedTurn: opts.currentTurn,
    db,
  });
  return {
    scene: ensured.scene,
    closedPrevious,
    created: ensured.created,
  };
}

function rowToView(
  row: SceneSecondaryParticipantSafetyRow
): SecondaryParticipantView {
  return {
    participantId: row.participant_id,
    displayName: row.display_name,
    participantKind: row.participant_kind,
    presenceState: row.presence_state,
    adultStatus: row.adult_status ?? "unknown",
    evidenceTrust: row.evidence_trust,
    evidenceSource: row.evidence_source,
    age: row.age,
    authoritativeAge: row.authoritative_age ?? null,
    authoritativeAdultStatus: row.authoritative_adult_status ?? null,
    restrictiveAge: row.restrictive_age ?? null,
    restrictiveAdultStatus: row.restrictive_adult_status ?? null,
  };
}

export function computeSecondarySceneSafetySnapshot(
  presentRows: SceneSecondaryParticipantSafetyRow[],
  opts?: {
    sexualContextActive?: boolean;
    coverage?: SecondarySafetyCoverage;
  }
): SecondarySceneSafetySnapshot {
  const canonicalRows = [...presentRows].sort((a, b) =>
    a.participant_id.localeCompare(b.participant_id)
  );
  const presentSecondaryParticipants = canonicalRows.map(rowToView);
  const restrictiveParticipantIds = canonicalRows
    .filter(
      (row) =>
        row.restrictive_age != null ||
        row.restrictive_adult_status != null ||
        row.restrictive_is_real_person === 1 ||
        row.evidence_trust === "RESTRICTIVE_ONLY"
    )
    .map((row) => row.participant_id);
  const unknownParticipantIds = canonicalRows
    .filter((row) => (row.adult_status ?? "unknown") === "unknown")
    .map((row) => row.participant_id);
  const minorParticipantIds = canonicalRows
    .filter((row) => row.adult_status === "minor")
    .map((row) => row.participant_id);
  const conflictParticipantIds = canonicalRows
    .filter((row) => row.adult_status === "conflict")
    .map((row) => row.participant_id);
  const realPersonParticipantIds = canonicalRows
    .filter((row) => row.adult_status === "real_person")
    .map((row) => row.participant_id);
  const confirmedParticipantIds = canonicalRows
    .filter((row) => row.adult_status === "confirmed")
    .map((row) => row.participant_id);

  const wouldBlockAdultScene =
    minorParticipantIds.length > 0 ||
    conflictParticipantIds.length > 0 ||
    realPersonParticipantIds.length > 0 ||
    unknownParticipantIds.length > 0;
  const coverage = opts?.coverage ?? "COMPLETE";
  const reason = wouldBlockAdultScene
    ? minorParticipantIds.length > 0
      ? "present_minor"
      : realPersonParticipantIds.length > 0
        ? "present_real_person"
        : conflictParticipantIds.length > 0
          ? "present_conflict"
          : "present_unknown"
    : coverage === "INCOMPLETE"
      ? "coverage_incomplete"
      : null;

  return {
    presentSecondaryParticipants,
    restrictiveParticipantIds,
    unknownParticipantIds,
    minorParticipantIds,
    conflictParticipantIds,
    realPersonParticipantIds,
    confirmedParticipantIds,
    wouldBlockAdultScene,
    wouldDisableAdultHandoff:
      wouldBlockAdultScene || coverage === "INCOMPLETE",
    reason,
    coverage,
  };
}

function findSameNameAuthoritative(
  sceneId: string,
  displayName: string,
  db: Database.Database
): SceneSecondaryParticipantSafetyRow | null {
  const needle = normalizeName(displayName);
  return (
    listSecondaryParticipantSafetyForScene(sceneId, db).find(
      (row) =>
        isAuthoritativeParticipantId(row.participant_id) &&
        normalizeName(row.display_name) === needle
    ) ?? null
  );
}

function authoritativeMetadataFromRow(
  row: SceneSecondaryParticipantSafetyRow | null
): ParticipantAdultMetadata {
  if (!row) return {};
  return {
    age: row.authoritative_age,
    adultStatus:
      row.authoritative_adult_status === "real_person"
        ? undefined
        : row.authoritative_adult_status,
    isRealPerson: row.authoritative_is_real_person === 1,
  };
}

function restrictiveMetadataFromOverlay(input: {
  age?: number | null;
  adultStatus?: string | null;
  isRealPerson?: boolean | null;
}): ParticipantAdultMetadata {
  return toRestrictiveOnlyMetadata({
    age: input.age,
    adultStatus: input.adultStatus,
    isRealPerson: input.isRealPerson === true,
  });
}

function mergeRestrictiveOverlay(
  existing: ParticipantAdultMetadata,
  incoming: ParticipantAdultMetadata
): ParticipantAdultMetadata {
  const a = toRestrictiveOnlyMetadata(existing);
  const b = toRestrictiveOnlyMetadata(incoming);
  return {
    age: b.age ?? a.age,
    adultStatus: b.adultStatus ?? a.adultStatus,
    isRealPerson: b.isRealPerson === true || a.isRealPerson === true,
    currentSchool: b.currentSchool ?? a.currentSchool,
    ageGroup: b.ageGroup ?? a.ageGroup,
  };
}

function rebuildParticipantProjection(opts: {
  sceneId: string;
  chatId: number;
  participantId: string;
  displayName: string;
  participantKind: SceneSecondaryParticipantSafetyRow["participant_kind"];
  db: Database.Database;
}): SceneSecondaryParticipantSafetyRow {
  const existing = getSecondaryParticipantSafety(
    opts.sceneId,
    opts.participantId,
    opts.db
  );
  const events = listSecondarySafetyEventsForParticipant(
    opts.sceneId,
    opts.participantId,
    opts.db
  );
  const authMeta = authoritativeMetadataFromRow(existing);
  const hasAuth = Boolean(
    existing?.authoritative_source ||
      existing?.authoritative_age != null ||
      existing?.authoritative_adult_status ||
      existing?.authoritative_is_real_person === 1
  );

  let presence: SceneSecondaryParticipantSafetyRow["presence_state"] = hasAuth
    ? "PRESENT"
    : "UNKNOWN";
  let firstSeen = existing?.first_seen_turn ?? null;
  let lastSeen = existing?.last_seen_turn ?? null;
  let leftTurn: number | null = hasAuth ? null : existing?.left_turn ?? null;
  let rest = restrictiveMetadataFromOverlay({
    age: existing?.restrictive_age,
    adultStatus: existing?.restrictive_adult_status,
    isRealPerson: existing?.restrictive_is_real_person === 1,
  });
  // Rebuild restrictive overlay from remaining events only — never from
  // authoritative columns.
  rest = {};
  let restSource: SecondaryEvidenceSource | null = existing?.restrictive_source ?? null;
  if (events.length > 0) {
    restSource = null;
  }

  for (const event of events) {
    switch (event.action) {
      case "ENTER":
      case "PRESENT":
        presence = "PRESENT";
        leftTurn = null;
        firstSeen = firstSeen ?? event.source_turn;
        lastSeen = event.source_turn ?? lastSeen;
        break;
      case "LEAVE":
        presence = "ABSENT";
        leftTurn = event.source_turn;
        lastSeen = event.source_turn ?? lastSeen;
        break;
      default: {
        const _never: never = event.action;
        void _never;
      }
    }
    if (event.evidence_trust === "RESTRICTIVE_ONLY") {
      rest = mergeRestrictiveOverlay(rest, {
        age: event.restrictive_age,
        adultStatus: event.restrictive_adult_status,
        isRealPerson: event.restrictive_is_real_person === 1,
      });
      restSource = event.evidence_source;
    }
  }

  const effective = deriveEffectiveSecondaryAdultStatus({
    authoritative: hasAuth ? authMeta : null,
    restrictive: rest,
  });
  const restAssessed =
    rest.age != null || rest.adultStatus || rest.isRealPerson === true
      ? toStoredAdultStatus(
          assessTrustedParticipantAdultStatus({
            trust: "RESTRICTIVE_ONLY",
            metadata: rest,
          })
        )
      : null;
  const trust: SecondaryEvidenceTrust = hasAuth
    ? "AUTHORITATIVE"
    : restSource
      ? "RESTRICTIVE_ONLY"
      : "UNKNOWN";
  const source: SecondaryEvidenceSource =
    existing?.authoritative_source ??
    restSource ??
    existing?.evidence_source ??
    "USER_PROSE";
  const effectiveAge =
    rest.age != null
      ? rest.age
      : hasAuth && typeof authMeta.age === "number"
        ? authMeta.age
        : null;

  return upsertSecondaryParticipantSafety(
    {
      sceneId: opts.sceneId,
      chatId: opts.chatId,
      participantId: opts.participantId,
      displayName: opts.displayName,
      participantKind: opts.participantKind,
      presenceState: presence,
      age: effectiveAge,
      adultStatus: effective,
      isRealPerson: effective === "real_person",
      evidenceTrust: trust,
      evidenceSource: source,
      authoritativeAge: hasAuth ? existing?.authoritative_age ?? null : null,
      authoritativeAdultStatus: hasAuth
        ? existing?.authoritative_adult_status ?? null
        : null,
      authoritativeIsRealPerson: hasAuth
        ? existing?.authoritative_is_real_person === 1
        : null,
      authoritativeSource: hasAuth ? existing?.authoritative_source ?? null : null,
      restrictiveAge: rest.age ?? null,
      restrictiveAdultStatus: restAssessed,
      restrictiveIsRealPerson: rest.isRealPerson === true,
      restrictiveSource: restSource,
      firstSeenTurn: firstSeen,
      lastSeenTurn: lastSeen,
      leftTurn,
    },
    opts.db
  );
}

function applyPresenceEvents(opts: {
  sceneId: string;
  chatId: number;
  currentTurn: number;
  events: SceneParticipantEvent[];
  trust: SecondaryEvidenceTrust;
  source: SecondaryEvidenceSource;
  sourceRole: "user" | "assistant";
  sourceMessageId?: number | null;
  db: Database.Database;
  __testFailurePoint?: SecondarySafetyFailurePoint;
}): SceneSecondaryParticipantSafetyRow[] {
  const applied: SceneSecondaryParticipantSafetyRow[] = [];
  for (const [eventIndex, event] of opts.events.entries()) {
    const dynamic = resolveDynamicEventIdentity(event);
    const sameNameAuth =
      opts.trust !== "AUTHORITATIVE"
        ? findSameNameAuthoritative(opts.sceneId, dynamic.displayName, opts.db)
        : null;
    const participantId = sameNameAuth?.participant_id ?? dynamic.participantId;
    const rest = eventToRestrictiveMetadata(event);
    insertSecondarySafetyEvent(
      {
        sceneId: opts.sceneId,
        chatId: opts.chatId,
        participantId,
        action: event.action,
        sourceRole: opts.sourceRole,
        sourceMessageId: opts.sourceMessageId,
        sourceTurn: opts.currentTurn,
        eventIndex,
        evidenceTrust: opts.trust,
        evidenceSource: opts.source,
        attachedAge: event.attachedAge ?? null,
        restrictiveAge: rest.age ?? null,
        restrictiveAdultStatus: rest.adultStatus ?? null,
        restrictiveIsRealPerson: rest.isRealPerson === true,
      },
      opts.db
    );
    if (opts.__testFailurePoint === "AFTER_EVENT_INSERT") {
      throw new Error("TEST_SECONDARY_SAFETY_AFTER_EVENT_INSERT");
    }
    applied.push(
      rebuildParticipantProjection({
        sceneId: opts.sceneId,
        chatId: opts.chatId,
        participantId,
        displayName: sameNameAuth?.display_name ?? dynamic.displayName,
        participantKind:
          sameNameAuth?.participant_kind ?? dynamic.participantKind,
        db: opts.db,
      })
    );
    if (opts.__testFailurePoint === "AFTER_PROJECTION_WRITE") {
      throw new Error("TEST_SECONDARY_SAFETY_AFTER_PROJECTION_WRITE");
    }
    if (
      opts.__testFailurePoint === "MID_EVENT_BATCH" &&
      eventIndex === 0 &&
      opts.events.length > 1
    ) {
      throw new Error("TEST_SECONDARY_SAFETY_MID_EVENT_BATCH");
    }
  }
  return applied;
}

function seedAuthoritativeActors(opts: {
  sceneId: string;
  chatId: number;
  currentTurn: number;
  actors: AuthoritativeSecondaryActor[];
  db: Database.Database;
}): void {
  for (const actor of opts.actors) {
    const projected = projectAuthoritativeSecondaryActor(actor);
    const existing = getSecondaryParticipantSafety(
      opts.sceneId,
      projected.participantId,
      opts.db
    );
    const authAge =
      typeof projected.metadata.age === "number" &&
      Number.isFinite(projected.metadata.age)
        ? projected.metadata.age
        : null;
    upsertSecondaryParticipantSafety(
      {
        sceneId: opts.sceneId,
        chatId: opts.chatId,
        participantId: projected.participantId,
        displayName: projected.displayName,
        participantKind: projected.participantKind,
        presenceState: existing?.presence_state ?? "PRESENT",
        age: existing?.age ?? null,
        adultStatus: existing?.adult_status ?? "unknown",
        isRealPerson: existing?.is_real_person === 1,
        evidenceTrust: "AUTHORITATIVE",
        evidenceSource: projected.source,
        authoritativeAge: authAge,
        authoritativeAdultStatus:
          projected.adultStatus === "real_person"
            ? "real_person"
            : projected.adultStatus,
        authoritativeIsRealPerson:
          projected.metadata.isRealPerson === true ||
          projected.adultStatus === "real_person",
        authoritativeSource: projected.source,
        restrictiveAge: existing?.restrictive_age ?? null,
        restrictiveAdultStatus: existing?.restrictive_adult_status ?? null,
        restrictiveIsRealPerson: existing?.restrictive_is_real_person === 1,
        restrictiveSource: existing?.restrictive_source ?? null,
        firstSeenTurn: existing?.first_seen_turn ?? opts.currentTurn,
        lastSeenTurn: existing?.last_seen_turn ?? opts.currentTurn,
        leftTurn: existing?.left_turn ?? null,
      },
      opts.db
    );
    rebuildParticipantProjection({
      sceneId: opts.sceneId,
      chatId: opts.chatId,
      participantId: projected.participantId,
      displayName: projected.displayName,
      participantKind: projected.participantKind,
      db: opts.db,
    });
  }
}

/**
 * Transaction-free current-user safety commit core. Enforcement callers must
 * compose this with durable turn bootstrap in one outer transaction.
 */
export function commitCurrentTurnSecondarySafetyCore(
  input: EvaluateSecondarySceneSafetyInput
): SecondarySceneSafetySnapshot {
  const db = input.db ?? getDb();
  ensureSecondarySceneParticipantSafetySchema(db);

  if (input.publicParticipantClaims?.length) {
    for (const claim of input.publicParticipantClaims) {
      rejectPublicTrustedParticipantIdentity(claim);
    }
  }

  const skipBoundary = input.skipSceneBoundary === true;
  const boundary = skipBoundary
    ? {
        scene: (getActiveChatScene(input.chatId, db) ??
          ensureActiveChatScene({
            chatId: input.chatId,
            startedTurn: input.currentTurn,
            db,
          }).scene),
        closedPrevious: false,
        created: false,
      }
    : resolveSafetySceneBoundary({
        chatId: input.chatId,
        sceneReset: input.sceneReset,
        clearSceneTransition: input.clearSceneTransition === true,
        currentTurn: input.currentTurn,
        db,
      });

  if (input.authoritativeActors?.length) {
    seedAuthoritativeActors({
      sceneId: boundary.scene.id,
      chatId: input.chatId,
      currentTurn: input.currentTurn,
      actors: input.authoritativeActors,
      db,
    });
  }

  if (input.applyUserEvents !== false) {
    if (input.sourceMessageId != null) {
      retractSecondarySafetyEventsForSourceMessages({
        chatId: input.chatId,
        sourceMessageIds: [input.sourceMessageId],
        sourceRole: "user",
        db,
      });
    }
    const events = extractCurrentTurnSceneParticipantEvents(input.userMessage);
    applyPresenceEvents({
      sceneId: boundary.scene.id,
      chatId: input.chatId,
      currentTurn: input.currentTurn,
      events,
      trust: "RESTRICTIVE_ONLY",
      source: "USER_PROSE",
      sourceRole: "user",
      sourceMessageId: input.sourceMessageId,
      db,
      __testFailurePoint: input.__testFailurePoint,
    });
  }

  if (input.sceneReset || input.clearSceneTransition) {
    setSecondarySafetyCoverageCore({
      chatId: input.chatId,
      coverage: "COMPLETE",
      reason: input.sceneReset ? "scene_reset" : "clear_scene_transition",
      coveredFromTurn: input.currentTurn,
      db,
    });
  } else if (input.currentTurn === 1) {
    const stored = db
      .prepare(
        `SELECT coverage FROM chat_secondary_safety_coverage WHERE chat_id=?`
      )
      .get(input.chatId) as { coverage?: string } | undefined;
    if (!stored) {
      setSecondarySafetyCoverageCore({
        chatId: input.chatId,
        coverage: "COMPLETE",
        reason: "tracked_from_chat_start",
        coveredFromTurn: 1,
        db,
      });
    }
  }

  const coverage = resolveSecondarySafetyCoverage({
    chatId: input.chatId,
    priorPlayableTurns: Math.max(0, input.currentTurn - 1),
    sceneReset: input.sceneReset,
    clearSceneTransition: input.clearSceneTransition === true,
    db,
  }).coverage;

  return computeSecondarySceneSafetySnapshot(
    listPresentSecondaryParticipants(boundary.scene.id, db),
    {
      sexualContextActive: input.sexualContextActive,
      coverage,
    }
  );
}

export function evaluateCurrentTurnSecondarySceneSafetyShadow(
  input: EvaluateSecondarySceneSafetyInput
): SecondarySceneSafetySnapshot {
  const db = input.db ?? getDb();
  return runSecondarySafetyAtomic(db, () =>
    commitCurrentTurnSecondarySafetyCore({ ...input, db })
  );
}

export function persistAssistantTurnSecondarySceneSafety(opts: {
  chatId: number;
  assistantText: string;
  currentTurn: number;
  sourceMessageId?: number | null;
  db?: Database.Database;
  /** @internal test-only */
  __testFailurePoint?: SecondarySafetyFailurePoint;
}): SceneSecondaryParticipantSafetyRow[] {
  const db = opts.db ?? getDb();
  return runSecondarySafetyAtomic(db, () => {
    ensureSecondarySceneParticipantSafetySchema(db);
    const { scene: active } = ensureActiveChatScene({
      chatId: opts.chatId,
      startedTurn: opts.currentTurn,
      db,
    });
    if (!active) return [];
    if (opts.sourceMessageId != null) {
      retractSecondarySafetyEventsForSourceMessages({
        chatId: opts.chatId,
        sourceMessageIds: [opts.sourceMessageId],
        sourceRole: "assistant",
        db,
      });
    }
    const events = extractCurrentTurnSceneParticipantEvents(opts.assistantText);
    return applyPresenceEvents({
      sceneId: active.id,
      chatId: opts.chatId,
      currentTurn: opts.currentTurn,
      events,
      trust: "RESTRICTIVE_ONLY",
      source: "ASSISTANT_PROSE",
      sourceRole: "assistant",
      sourceMessageId: opts.sourceMessageId,
      db,
      __testFailurePoint: opts.__testFailurePoint,
    });
  });
}

export function retractSecondarySafetyEventsForSourceMessages(opts: {
  chatId: number;
  sourceMessageIds: number[];
  sourceRole?: "user" | "assistant";
  db?: Database.Database;
  /** @internal test-only */
  __testFailurePoint?: SecondarySafetyFailurePoint;
}): { deleted: number } {
  const db = opts.db ?? getDb();
  return runSecondarySafetyAtomic(db, () => {
    ensureSecondarySceneParticipantSafetySchema(db);
    const { deleted, participantKeys } =
      deleteSecondarySafetyEventsForSourceMessages({
        chatId: opts.chatId,
        sourceMessageIds: opts.sourceMessageIds,
        sourceRole: opts.sourceRole,
        db,
      });
    if (opts.__testFailurePoint === "AFTER_EVENT_DELETE") {
      throw new Error("TEST_SECONDARY_SAFETY_AFTER_EVENT_DELETE");
    }
    for (const key of participantKeys) {
      const existing = getSecondaryParticipantSafety(
        key.sceneId,
        key.participantId,
        db
      );
      rebuildParticipantProjection({
        sceneId: key.sceneId,
        chatId: opts.chatId,
        participantId: key.participantId,
        displayName: existing?.display_name ?? "",
        participantKind: existing?.participant_kind ?? "dynamic",
        db,
      });
    }
    return { deleted };
  });
}

export function resolveCanonicalUserPlayableTurn(opts: {
  chatId: number;
  userMessageId: number;
  db?: Database.Database;
}): number | null {
  const db = opts.db ?? getDb();
  ensureSecondarySceneParticipantSafetySchema(db);
  const existing = db
    .prepare(
      `SELECT source_turn AS sourceTurn
       FROM scene_secondary_participant_safety_events
       WHERE chat_id=? AND source_role='user' AND source_message_id=?
       ORDER BY event_index ASC, id ASC
       LIMIT 1`
    )
    .get(opts.chatId, opts.userMessageId) as
    | { sourceTurn: number | null }
    | undefined;
  if (existing?.sourceTurn != null) return existing.sourceTurn;

  const row = db
    .prepare(
      `SELECT COUNT(*) AS turnNumber
       FROM messages
       WHERE chat_id=? AND role='user' AND id<=?`
    )
    .get(opts.chatId, opts.userMessageId) as { turnNumber: number };
  return row.turnNumber > 0 ? row.turnNumber : null;
}

export function markSecondarySafetyCoverageIncompleteCore(opts: {
  chatId: number;
  reason: string;
  db: Database.Database;
}): void {
  ensureSecondarySceneParticipantSafetySchema(opts.db);
  setSecondarySafetyCoverageCore({
    chatId: opts.chatId,
    coverage: "INCOMPLETE",
    reason: opts.reason,
    coveredFromTurn: null,
    db: opts.db,
  });
}

export function markSecondarySafetyCoverageIncomplete(opts: {
  chatId: number;
  reason: string;
  db?: Database.Database;
}): void {
  const db = opts.db ?? getDb();
  runSecondarySafetyAtomic(db, () =>
    markSecondarySafetyCoverageIncompleteCore({ ...opts, db })
  );
}

export type SecondarySafetyReconciliationFailureReason =
  | "user_postbootstrap_safety_failed"
  | "assistant_postturn_safety_failed"
  | "assistant_edit_safety_failed"
  | "user_edit_safety_failed"
  | "variant_switch_safety_failed"
  | "assistant_replacement_safety_failed";

export function markSecondarySafetyReconciliationFailure(opts: {
  chatId: number;
  reason: SecondarySafetyReconciliationFailureReason;
  db?: Database.Database;
  /** @internal test-only */
  __testMarkIncomplete?: () => void;
}): void {
  try {
    if (opts.__testMarkIncomplete) {
      opts.__testMarkIncomplete();
    } else {
      markSecondarySafetyCoverageIncomplete(opts);
    }
  } catch (err) {
    console.error(
      "[secondary-scene-safety-critical] coverage degradation failed",
      {
        chatId: opts.chatId,
        reason: opts.reason,
        error: err,
      }
    );
    throw err;
  }
}

export function reconcileSecondarySafetyAfterCanonicalMutation(opts: {
  chatId: number;
  reason: SecondarySafetyReconciliationFailureReason;
  reconcile: () => void;
  db?: Database.Database;
}): boolean {
  try {
    opts.reconcile();
    return true;
  } catch (err) {
    console.warn(
      "[secondary-scene-safety] post-canonical reconciliation failed",
      {
        chatId: opts.chatId,
        reason: opts.reason,
        error: err,
      }
    );
    markSecondarySafetyReconciliationFailure({
      chatId: opts.chatId,
      reason: opts.reason,
      db: opts.db,
    });
    return false;
  }
}

function prospectiveAuthoritativeRow(
  chatId: number,
  actor: AuthoritativeSecondaryActor,
  currentTurn: number
): SceneSecondaryParticipantSafetyRow {
  const projected = projectAuthoritativeSecondaryActor(actor);
  const age =
    typeof projected.metadata.age === "number" &&
    Number.isFinite(projected.metadata.age)
      ? projected.metadata.age
      : null;
  return {
    scene_id: "prospective",
    chat_id: chatId,
    participant_id: projected.participantId,
    display_name: projected.displayName,
    participant_kind: projected.participantKind,
    presence_state: "PRESENT",
    age,
    adult_status: projected.adultStatus,
    is_real_person: projected.adultStatus === "real_person" ? 1 : 0,
    evidence_trust: "AUTHORITATIVE",
    evidence_source: projected.source,
    authoritative_age: age,
    authoritative_adult_status: projected.adultStatus,
    authoritative_is_real_person:
      projected.metadata.isRealPerson === true ||
      projected.adultStatus === "real_person"
        ? 1
        : 0,
    authoritative_source: projected.source,
    restrictive_age: null,
    restrictive_adult_status: null,
    restrictive_is_real_person: null,
    restrictive_source: null,
    first_seen_turn: currentTurn,
    last_seen_turn: currentTurn,
    left_turn: null,
    created_at: "",
    updated_at: "",
  };
}

function applyProspectiveEvent(
  rows: Map<string, SceneSecondaryParticipantSafetyRow>,
  event: SceneParticipantEvent,
  chatId: number,
  currentTurn: number
): void {
  const dynamic = resolveDynamicEventIdentity(event);
  const sameNameAuth = [...rows.values()].find(
    (row) =>
      isAuthoritativeParticipantId(row.participant_id) &&
      normalizeName(row.display_name) === normalizeName(dynamic.displayName)
  );
  const participantId = sameNameAuth?.participant_id ?? dynamic.participantId;
  const existing = rows.get(participantId);
  const row: SceneSecondaryParticipantSafetyRow = existing
    ? { ...existing }
    : {
        scene_id: "prospective",
        chat_id: chatId,
        participant_id: participantId,
        display_name: sameNameAuth?.display_name ?? dynamic.displayName,
        participant_kind:
          sameNameAuth?.participant_kind ?? dynamic.participantKind,
        presence_state: "UNKNOWN",
        age: null,
        adult_status: "unknown",
        is_real_person: 0,
        evidence_trust: "UNKNOWN",
        evidence_source: "USER_PROSE",
        authoritative_age: null,
        authoritative_adult_status: null,
        authoritative_is_real_person: null,
        authoritative_source: null,
        restrictive_age: null,
        restrictive_adult_status: null,
        restrictive_is_real_person: null,
        restrictive_source: null,
        first_seen_turn: null,
        last_seen_turn: null,
        left_turn: null,
        created_at: "",
        updated_at: "",
      };

  switch (event.action) {
    case "ENTER":
    case "PRESENT":
      row.presence_state = "PRESENT";
      row.left_turn = null;
      row.first_seen_turn = row.first_seen_turn ?? currentTurn;
      row.last_seen_turn = currentTurn;
      break;
    case "LEAVE":
      row.presence_state = "ABSENT";
      row.left_turn = currentTurn;
      row.last_seen_turn = currentTurn;
      break;
    default: {
      const _never: never = event.action;
      void _never;
    }
  }

  const incoming = eventToRestrictiveMetadata(event);
  const restrictive = mergeRestrictiveOverlay(
    restrictiveMetadataFromOverlay({
      age: row.restrictive_age,
      adultStatus: row.restrictive_adult_status,
      isRealPerson: row.restrictive_is_real_person === 1,
    }),
    incoming
  );
  const hasAuth = row.authoritative_source != null;
  const auth = authoritativeMetadataFromRow(row);
  const effective = deriveEffectiveSecondaryAdultStatus({
    authoritative: hasAuth ? auth : null,
    restrictive,
  });
  const restrictiveStatus =
    restrictive.age != null ||
    restrictive.adultStatus ||
    restrictive.isRealPerson === true
      ? toStoredAdultStatus(
          assessTrustedParticipantAdultStatus({
            trust: "RESTRICTIVE_ONLY",
            metadata: restrictive,
          })
        )
      : null;
  row.restrictive_age =
    typeof restrictive.age === "number" ? restrictive.age : null;
  row.restrictive_adult_status = restrictiveStatus;
  row.restrictive_is_real_person =
    restrictive.isRealPerson === true ? 1 : 0;
  row.restrictive_source = "USER_PROSE";
  row.age =
    row.restrictive_age ??
    (typeof auth.age === "number" ? auth.age : null);
  row.adult_status = effective;
  row.is_real_person = effective === "real_person" ? 1 : 0;
  row.evidence_trust = hasAuth
    ? "AUTHORITATIVE"
    : "RESTRICTIVE_ONLY";
  row.evidence_source =
    row.authoritative_source ?? row.restrictive_source ?? "USER_PROSE";
  rows.set(participantId, row);
}

/**
 * Pure S1.2 preflight owner. It reads persisted state and applies the current
 * input in memory. It never ensures schema, mutates chat_scenes, writes
 * messages/events/projections, bills, or calls a provider.
 */
export function buildProspectiveSecondarySceneSafetySnapshot(input: {
  chatId: number;
  currentTurn: number;
  currentUserMessage: string;
  sceneReset: boolean;
  clearSceneTransition?: boolean;
  authoritativeActors?: AuthoritativeSecondaryActor[];
  sexualContextActive?: boolean;
  db?: Database.Database;
}): SecondarySceneSafetySnapshot {
  const db = input.db ?? getDb();
  const boundary = input.sceneReset || input.clearSceneTransition === true;
  const active = db
    .prepare(
      `SELECT id FROM chat_scenes
       WHERE chat_id=? AND status='ACTIVE'
       ORDER BY started_turn DESC, created_at DESC LIMIT 1`
    )
    .get(input.chatId) as { id: string } | undefined;
  const persistedRows =
    !boundary && active
      ? (db
          .prepare(
            `SELECT * FROM scene_secondary_participant_safety WHERE scene_id=?`
          )
          .all(active.id) as SceneSecondaryParticipantSafetyRow[])
      : [];
  const rows = new Map(
    persistedRows.map((row) => [row.participant_id, { ...row }])
  );

  for (const actor of input.authoritativeActors ?? []) {
    const prospective = prospectiveAuthoritativeRow(
      input.chatId,
      actor,
      input.currentTurn
    );
    const existing = rows.get(prospective.participant_id);
    const merged = {
      ...prospective,
      restrictive_age: existing?.restrictive_age ?? null,
      restrictive_adult_status:
        existing?.restrictive_adult_status ?? null,
      restrictive_is_real_person:
        existing?.restrictive_is_real_person ?? null,
      restrictive_source: existing?.restrictive_source ?? null,
    };
    const restrictive = restrictiveMetadataFromOverlay({
      age: merged.restrictive_age,
      adultStatus: merged.restrictive_adult_status,
      isRealPerson: merged.restrictive_is_real_person === 1,
    });
    const effective = deriveEffectiveSecondaryAdultStatus({
      authoritative: authoritativeMetadataFromRow(merged),
      restrictive,
    });
    merged.adult_status = effective;
    merged.age =
      merged.restrictive_age ?? merged.authoritative_age ?? null;
    merged.is_real_person = effective === "real_person" ? 1 : 0;
    rows.set(prospective.participant_id, merged);
  }
  for (const event of extractCurrentTurnSceneParticipantEvents(
    input.currentUserMessage
  )) {
    applyProspectiveEvent(rows, event, input.chatId, input.currentTurn);
  }

  const coverage = resolveSecondarySafetyCoverage({
    chatId: input.chatId,
    priorPlayableTurns: Math.max(0, input.currentTurn - 1),
    sceneReset: input.sceneReset,
    clearSceneTransition: input.clearSceneTransition === true,
    db,
  }).coverage;
  return computeSecondarySceneSafetySnapshot(
    [...rows.values()].filter((row) => row.presence_state === "PRESENT"),
    { sexualContextActive: input.sexualContextActive, coverage }
  );
}

export function readSecondarySceneSafetySnapshot(opts: {
  chatId: number;
  sceneId?: string;
  db?: Database.Database;
}): SecondarySceneSafetySnapshot {
  const db = opts.db ?? getDb();
  const scene = opts.sceneId
    ? { id: opts.sceneId }
    : getActiveChatScene(opts.chatId, db);
  if (!scene) {
    return computeSecondarySceneSafetySnapshot([], {
      coverage: getSecondarySafetyCoverage(opts.chatId, db),
    });
  }
  return computeSecondarySceneSafetySnapshot(
    listPresentSecondaryParticipants(scene.id, db),
    { coverage: getSecondarySafetyCoverage(opts.chatId, db) }
  );
}

export function reconcileAssistantOwnedSecondarySafety(opts: {
  chatId: number;
  assistantText: string;
  currentTurn: number;
  sourceMessageId: number;
  db?: Database.Database;
}): SceneSecondaryParticipantSafetyRow[] {
  return persistAssistantTurnSecondarySceneSafety({
    chatId: opts.chatId,
    assistantText: opts.assistantText,
    currentTurn: opts.currentTurn,
    sourceMessageId: opts.sourceMessageId,
    db: opts.db,
  });
}

export type { SceneSecondaryParticipantSafetyEventRow };
export { resolveSecondarySafetyCoverage } from "@/lib/secondarySceneParticipantSafetyStore";
