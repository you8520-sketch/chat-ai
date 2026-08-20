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
  type SceneSecondaryParticipantSafetyRow,
  type SecondaryAdultStatus,
  type SecondaryEvidenceSource,
  type SecondaryEvidenceTrust,
} from "@/lib/secondarySceneParticipantSafetySchema";
import {
  getSecondaryParticipantSafety,
  listPresentSecondaryParticipants,
  listSecondaryParticipantSafetyForScene,
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

export type EvaluateSecondarySceneSafetyInput = {
  chatId: number;
  userMessage: string;
  sceneReset: boolean;
  currentTurn: number;
  /** Accepted for a future S2 guard. Production classifySceneMode usually sets true on tension. */
  sexualContextActive?: boolean;
  authoritativeActors?: AuthoritativeSecondaryActor[];
  /**
   * Public body claims are ignored. Accepted only so tests can prove they
   * never become authoritative.
   */
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
  currentTurn: number;
  db?: Database.Database;
}): { scene: ChatSceneRow; closedPrevious: boolean; created: boolean } {
  const db = opts.db ?? getDb();
  ensureSecondarySceneParticipantSafetySchema(db);
  let closedPrevious = false;
  if (opts.sceneReset) {
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
  };
}

export function computeSecondarySceneSafetySnapshot(
  presentRows: SceneSecondaryParticipantSafetyRow[],
  _opts?: { sexualContextActive?: boolean }
): SecondarySceneSafetySnapshot {
  const presentSecondaryParticipants = presentRows.map(rowToView);
  const restrictiveParticipantIds = presentRows
    .filter((row) => row.evidence_trust === "RESTRICTIVE_ONLY")
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

function storedMetadataFromRow(
  row: SceneSecondaryParticipantSafetyRow
): ParticipantAdultMetadata {
  return {
    age: row.age,
    adultStatus:
      row.adult_status === "real_person" ? undefined : row.adult_status,
    isRealPerson: row.is_real_person === 1,
  };
}

function mergeAndAssess(opts: {
  existing: SceneSecondaryParticipantSafetyRow | null;
  trust: SecondaryEvidenceTrust;
  source: SecondaryEvidenceSource;
  metadata: ParticipantAdultMetadata;
  authoritativeProfile?: ParticipantAdultMetadata | null;
}): {
  trust: SecondaryEvidenceTrust;
  source: SecondaryEvidenceSource;
  age: number | null;
  adultStatus: SecondaryAdultStatus;
  isRealPerson: boolean | null;
} {
  const existingTrust = opts.existing?.evidence_trust;
  const trust: SecondaryEvidenceTrust =
    existingTrust === "AUTHORITATIVE" || opts.trust === "AUTHORITATIVE"
      ? "AUTHORITATIVE"
      : opts.trust;

  const source =
    trust === "AUTHORITATIVE" && opts.existing?.evidence_trust === "AUTHORITATIVE"
      ? opts.existing.evidence_source
      : opts.source;

  const existingMeta = opts.existing
    ? storedMetadataFromRow(opts.existing)
    : {};

  let metadata: ParticipantAdultMetadata;
  if (trust === "AUTHORITATIVE") {
    metadata = {
      ...(opts.existing?.evidence_trust === "AUTHORITATIVE"
        ? existingMeta
        : {}),
      ...opts.metadata,
    };
    const restrictiveOverlay = toRestrictiveOnlyMetadata({
      ...existingMeta,
      ...opts.metadata,
    });
    if (
      restrictiveOverlay.age != null ||
      restrictiveOverlay.adultStatus ||
      restrictiveOverlay.isRealPerson
    ) {
      metadata = { ...metadata, ...restrictiveOverlay };
    }
  } else {
    metadata = toRestrictiveOnlyMetadata({
      ...existingMeta,
      ...opts.metadata,
    });
  }

  const assessed = toStoredAdultStatus(
    assessTrustedParticipantAdultStatus({
      trust,
      metadata,
      authoritativeProfile: opts.authoritativeProfile,
    })
  );

  const storedAge =
    trust === "AUTHORITATIVE"
      ? typeof metadata.age === "number" && Number.isFinite(metadata.age)
        ? metadata.age
        : null
      : typeof metadata.age === "number" && metadata.age < 19
        ? metadata.age
        : null;

  return {
    trust,
    source,
    age: storedAge,
    adultStatus: assessed,
    isRealPerson: assessed === "real_person" ? true : metadata.isRealPerson === true ? true : null,
  };
}

export function applySceneParticipantEvents(opts: {
  sceneId: string;
  chatId: number;
  currentTurn: number;
  events: SceneParticipantEvent[];
  trust: SecondaryEvidenceTrust;
  source: SecondaryEvidenceSource;
  db?: Database.Database;
}): SceneSecondaryParticipantSafetyRow[] {
  const db = opts.db ?? getDb();
  ensureSecondarySceneParticipantSafetySchema(db);
  const applied: SceneSecondaryParticipantSafetyRow[] = [];

  for (const event of opts.events) {
    const dynamic = resolveDynamicEventIdentity(event);
    const sameNameAuth =
      opts.trust !== "AUTHORITATIVE"
        ? findSameNameAuthoritative(opts.sceneId, dynamic.displayName, db)
        : null;
    const participantId = sameNameAuth?.participant_id ?? dynamic.participantId;
    const existing = getSecondaryParticipantSafety(
      opts.sceneId,
      participantId,
      db
    );
    const metadata =
      opts.trust === "RESTRICTIVE_ONLY"
        ? eventToRestrictiveMetadata(event)
        : {
            age: event.attachedAge,
            adultStatus: event.attachedAdultStatus,
            isRealPerson: event.attachedIsRealPerson === true,
            currentSchool: event.attachedSchoolRole,
          };
    const assessed = mergeAndAssess({
      existing,
      trust: sameNameAuth ? "AUTHORITATIVE" : opts.trust,
      source: opts.source,
      metadata,
    });

    let presenceState = existing?.presence_state ?? "UNKNOWN";
    let leftTurn = existing?.left_turn ?? null;
    switch (event.action) {
      case "ENTER":
      case "PRESENT":
        presenceState = "PRESENT";
        leftTurn = null;
        break;
      case "LEAVE":
        presenceState = "ABSENT";
        leftTurn = opts.currentTurn;
        break;
      default: {
        const _never: never = event.action;
        void _never;
      }
    }

    applied.push(
      upsertSecondaryParticipantSafety(
        {
          sceneId: opts.sceneId,
          chatId: opts.chatId,
          participantId,
          displayName: sameNameAuth?.display_name ?? dynamic.displayName,
          participantKind:
            sameNameAuth?.participant_kind ?? dynamic.participantKind,
          presenceState,
          age: assessed.age,
          adultStatus: assessed.adultStatus,
          isRealPerson: assessed.isRealPerson,
          evidenceTrust: assessed.trust,
          evidenceSource: assessed.source,
          firstSeenTurn: existing?.first_seen_turn ?? opts.currentTurn,
          lastSeenTurn: opts.currentTurn,
          leftTurn,
        },
        db
      )
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
    const assessed = mergeAndAssess({
      existing,
      trust: "AUTHORITATIVE",
      source: projected.source,
      metadata: projected.metadata,
    });
    upsertSecondaryParticipantSafety(
      {
        sceneId: opts.sceneId,
        chatId: opts.chatId,
        participantId: projected.participantId,
        displayName: projected.displayName,
        participantKind: projected.participantKind,
        presenceState: existing?.presence_state ?? "PRESENT",
        age: assessed.age,
        adultStatus: assessed.adultStatus,
        isRealPerson: assessed.isRealPerson,
        evidenceTrust: "AUTHORITATIVE",
        evidenceSource: projected.source,
        firstSeenTurn: existing?.first_seen_turn ?? opts.currentTurn,
        lastSeenTurn: existing?.last_seen_turn ?? opts.currentTurn,
        leftTurn: existing?.left_turn ?? null,
      },
      opts.db
    );
  }
}

/**
 * Current-user-turn shadow evaluation.
 * Does not change AdultDeliveryPlan, eligibility, or provider routing.
 */
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

  const boundary = resolveSafetySceneBoundary({
    chatId: input.chatId,
    sceneReset: input.sceneReset,
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

  const events = extractCurrentTurnSceneParticipantEvents(input.userMessage);
  applySceneParticipantEvents({
    sceneId: boundary.scene.id,
    chatId: input.chatId,
    currentTurn: input.currentTurn,
    events,
    trust: "RESTRICTIVE_ONLY",
    source: "USER_PROSE",
    db,
  });

  return computeSecondarySceneSafetySnapshot(
    listPresentSecondaryParticipants(boundary.scene.id, db),
    { sexualContextActive: input.sexualContextActive }
  );
}

/**
 * Persist assistant-introduced actors for the next turn.
 * Does not alter or retry the already-delivered assistant turn.
 */
export function persistAssistantTurnSecondarySceneSafety(opts: {
  chatId: number;
  assistantText: string;
  currentTurn: number;
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
  const events = extractCurrentTurnSceneParticipantEvents(opts.assistantText);
  return applySceneParticipantEvents({
    sceneId: active.id,
    chatId: opts.chatId,
    currentTurn: opts.currentTurn,
    events,
    trust: "RESTRICTIVE_ONLY",
    source: "ASSISTANT_PROSE",
    db,
  });
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
