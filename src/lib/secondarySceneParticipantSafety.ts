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
} from "@/lib/secondarySceneParticipantSafetySchema";
import {
  deleteSecondarySafetyEventsForSourceMessages,
  getSecondaryParticipantSafety,
  insertSecondarySafetyEvent,
  listPresentSecondaryParticipants,
  listSecondaryParticipantSafetyForScene,
  listSecondarySafetyEventsForParticipant,
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
  "branch/noncanon": "UNSUPPORTED",
  fork: "UNSUPPORTED",
} as const;

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
};

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
  _opts?: { sexualContextActive?: boolean }
): SecondarySceneSafetySnapshot {
  const presentSecondaryParticipants = presentRows.map(rowToView);
  const restrictiveParticipantIds = presentRows
    .filter(
      (row) =>
        row.restrictive_age != null ||
        row.restrictive_adult_status != null ||
        row.restrictive_is_real_person === 1 ||
        row.evidence_trust === "RESTRICTIVE_ONLY"
    )
    .map((row) => row.participant_id);
  const unknownParticipantIds = presentRows
    .filter((row) => (row.adult_status ?? "unknown") === "unknown")
    .map((row) => row.participant_id);
  const minorParticipantIds = presentRows
    .filter((row) => row.adult_status === "minor")
    .map((row) => row.participant_id);
  const conflictParticipantIds = presentRows
    .filter((row) => row.adult_status === "conflict")
    .map((row) => row.participant_id);
  const realPersonParticipantIds = presentRows
    .filter((row) => row.adult_status === "real_person")
    .map((row) => row.participant_id);
  const confirmedParticipantIds = presentRows
    .filter((row) => row.adult_status === "confirmed")
    .map((row) => row.participant_id);

  const wouldBlockAdultScene =
    minorParticipantIds.length > 0 ||
    conflictParticipantIds.length > 0 ||
    realPersonParticipantIds.length > 0 ||
    unknownParticipantIds.length > 0;
  const reason = wouldBlockAdultScene
    ? minorParticipantIds.length > 0
      ? "present_minor"
      : realPersonParticipantIds.length > 0
        ? "present_real_person"
        : conflictParticipantIds.length > 0
          ? "present_conflict"
          : "present_unknown"
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
    wouldDisableAdultHandoff: wouldBlockAdultScene,
    reason,
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
}): SceneSecondaryParticipantSafetyRow[] {
  const applied: SceneSecondaryParticipantSafetyRow[] = [];
  for (const event of opts.events) {
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
        evidenceTrust: opts.trust,
        evidenceSource: opts.source,
        attachedAge: event.attachedAge ?? null,
        restrictiveAge: rest.age ?? null,
        restrictiveAdultStatus: rest.adultStatus ?? null,
        restrictiveIsRealPerson: rest.isRealPerson === true,
      },
      opts.db
    );
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

export function evaluateCurrentTurnSecondarySceneSafetyShadow(
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
    });
  }

  return computeSecondarySceneSafetySnapshot(
    listPresentSecondaryParticipants(boundary.scene.id, db),
    { sexualContextActive: input.sexualContextActive }
  );
}

export function persistAssistantTurnSecondarySceneSafety(opts: {
  chatId: number;
  assistantText: string;
  currentTurn: number;
  sourceMessageId?: number | null;
  db?: Database.Database;
}): SceneSecondaryParticipantSafetyRow[] {
  const db = opts.db ?? getDb();
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
  });
}

export function retractSecondarySafetyEventsForSourceMessages(opts: {
  chatId: number;
  sourceMessageIds: number[];
  sourceRole?: "user" | "assistant";
  db?: Database.Database;
}): { deleted: number } {
  const db = opts.db ?? getDb();
  ensureSecondarySceneParticipantSafetySchema(db);
  const { deleted, participantKeys } = deleteSecondarySafetyEventsForSourceMessages({
    chatId: opts.chatId,
    sourceMessageIds: opts.sourceMessageIds,
    sourceRole: opts.sourceRole,
    db,
  });
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
    return computeSecondarySceneSafetySnapshot([]);
  }
  return computeSecondarySceneSafetySnapshot(
    listPresentSecondaryParticipants(scene.id, db)
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
