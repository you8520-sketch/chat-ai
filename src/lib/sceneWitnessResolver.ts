/**
 * PR-S4B — Secret-blind scene event witness resolver.
 *
 * MUST NOT import persona secret storage, discovery rules, knowledge,
 * compiler, or secret_description accessors.
 */
import type {
  ChatObserverRow,
  ChatSceneRow,
  SceneObserverPresenceRow,
} from "@/lib/observerTypes";
import type { SceneEvidenceEvent } from "@/lib/sceneEvidenceTypes";
import {
  MAX_WITNESS_CANDIDATES,
  MIN_AUTOMATIC_OBSERVATION_CONFIDENCE,
  SCENE_WITNESS_RESOLVER_VERSION,
  type EventScopeSnapshot,
  type ObservationModality,
  type ObservationReasonCode,
  type ObserverStateSnapshot,
  type SceneEventObservationDecision,
} from "@/lib/sceneObservationTypes";

export { SCENE_WITNESS_RESOLVER_VERSION };

const AUTHORITATIVE_SOURCES = new Set([
  "USER_MESSAGE_DETERMINISTIC",
  "USER_EXPLICIT_ACTION",
  "SERVER_SCENE_EVENT",
  "CREATOR_TRIGGER",
]);

export function modalityForEventType(
  eventType: SceneEvidenceEvent["eventType"]
): ObservationModality | null {
  switch (eventType) {
    case "BODY_REGION_EXPOSED":
    case "BODY_REGION_COVERED":
    case "VISIBLE_MARK_PRESENTED":
    case "VISIBLE_ITEM_PRESENTED":
    case "VISIBLE_ITEM_EXPOSED":
    case "ABILITY_MANIFESTED":
    case "PHYSICAL_SYMPTOM_DISPLAYED":
    case "DOCUMENT_PRESENTED":
    case "IDENTITY_DOCUMENT_PRESENTED":
      return "VISUAL";
    default:
      return null;
  }
}

function attrBool(
  attrs: SceneEvidenceEvent["attributes"],
  key: string
): boolean {
  const v = attrs[key];
  return v === true || v === 1 || v === "true" || v === "1";
}

function eventLocationKey(event: SceneEvidenceEvent): string | null {
  const raw = event.attributes.locationKey ?? event.attributes.location_key;
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 64);
  return null;
}

function buildScopeSnapshot(opts: {
  event: SceneEvidenceEvent;
  scene: ChatSceneRow;
  modality: ObservationModality | null;
}): EventScopeSnapshot {
  return {
    visibilityMode: opts.event.visibility?.mode ?? "UNKNOWN",
    observerIds: opts.event.visibility?.observerIds,
    sceneId: opts.scene.id,
    sceneLocationKey: opts.scene.location_key,
    eventLocationKey: eventLocationKey(opts.event) ?? opts.scene.location_key,
    modality: opts.modality,
    sceneWide: attrBool(opts.event.attributes, "sceneWide"),
    directPresentation: attrBool(opts.event.attributes, "directPresentation"),
    overcomesVisualObstruction: attrBool(
      opts.event.attributes,
      "overcomesVisualObstruction"
    ),
  };
}

function snapshotFromPresence(
  presence: SceneObserverPresenceRow,
  observer: ChatObserverRow | null,
  scope: EventScopeSnapshot
): ObserverStateSnapshot {
  return {
    presenceState: presence.presence_state,
    awarenessState: presence.awareness_state,
    visualCapability: presence.visual_capability,
    auditoryCapability: presence.auditory_capability,
    observerLocationKey: presence.location_key,
    eventLocationKey: scope.eventLocationKey,
    visibilityMode: scope.visibilityMode,
    presenceUpdatedAt: presence.updated_at,
    observerActive: observer?.is_active === 1,
  };
}

function decide(opts: {
  observerType: string;
  observerId: string;
  modality: ObservationModality;
  observationState: SceneEventObservationDecision["observationState"];
  reasonCode: ObservationReasonCode;
  snapshot: ObserverStateSnapshot;
  scope: EventScopeSnapshot;
  confidence?: number;
}): SceneEventObservationDecision {
  return {
    observerType: opts.observerType,
    observerId: opts.observerId,
    modality: opts.modality,
    observationState: opts.observationState,
    reasonCode: opts.reasonCode,
    confidence: opts.confidence ?? 0,
    observerStateSnapshot: opts.snapshot,
    eventScopeSnapshot: opts.scope,
  };
}

type Candidate = {
  presence: SceneObserverPresenceRow;
  observer: ChatObserverRow;
};

export function selectCandidatesByVisibility(opts: {
  event: SceneEvidenceEvent;
  presenceRows: SceneObserverPresenceRow[];
  observersByKey: Map<string, ChatObserverRow>;
  currentCharacterId: string;
}): { candidates: Candidate[]; rejectAllReason?: ObservationReasonCode } {
  const mode = opts.event.visibility?.mode ?? "UNKNOWN";
  if (mode === "UNKNOWN") {
    return { candidates: [], rejectAllReason: "VISIBILITY_UNKNOWN" };
  }

  const activePresence = opts.presenceRows.filter((p) => {
    const key = `${p.observer_type}:${p.observer_id}`;
    const obs = opts.observersByKey.get(key);
    return Boolean(obs && obs.is_active === 1);
  });

  let selected: Candidate[] = [];

  if (mode === "CURRENT_CHARACTER") {
    const hit = activePresence.find(
      (p) =>
        p.observer_type === "CHARACTER" &&
        p.observer_id === opts.currentCharacterId
    );
    if (hit) {
      selected = [
        {
          presence: hit,
          observer: opts.observersByKey.get(
            `${hit.observer_type}:${hit.observer_id}`
          )!,
        },
      ];
    }
  } else if (mode === "EXPLICIT_OBSERVERS") {
    const ids = new Set(
      (opts.event.visibility.observerIds ?? []).map(String).filter(Boolean)
    );
    for (const p of activePresence) {
      if (!ids.has(p.observer_id)) continue;
      selected.push({
        presence: p,
        observer: opts.observersByKey.get(
          `${p.observer_type}:${p.observer_id}`
        )!,
      });
    }
  } else if (mode === "SCENE_PARTICIPANTS") {
    for (const p of activePresence) {
      selected.push({
        presence: p,
        observer: opts.observersByKey.get(
          `${p.observer_type}:${p.observer_id}`
        )!,
      });
    }
  }

  if (selected.length > MAX_WITNESS_CANDIDATES) {
    return { candidates: [], rejectAllReason: "TOO_MANY_CANDIDATES" };
  }
  return { candidates: selected };
}

function evaluateSensoryAndPresence(opts: {
  candidate: Candidate;
  event: SceneEvidenceEvent;
  modality: ObservationModality;
  scope: EventScopeSnapshot;
}): SceneEventObservationDecision {
  const { candidate, event, modality, scope } = opts;
  const p = candidate.presence;
  const snap = snapshotFromPresence(p, candidate.observer, scope);

  if (candidate.observer.is_active !== 1) {
    return decide({
      observerType: p.observer_type,
      observerId: p.observer_id,
      modality,
      observationState: "NOT_OBSERVED",
      reasonCode: "OBSERVER_INACTIVE",
      snapshot: snap,
      scope,
    });
  }

  if (p.presence_state === "ABSENT") {
    return decide({
      observerType: p.observer_type,
      observerId: p.observer_id,
      modality,
      observationState: "NOT_OBSERVED",
      reasonCode: "ABSENT",
      snapshot: snap,
      scope,
    });
  }
  if (p.presence_state === "UNKNOWN") {
    return decide({
      observerType: p.observer_type,
      observerId: p.observer_id,
      modality,
      observationState: "NOT_OBSERVED",
      reasonCode: "PRESENCE_UNKNOWN",
      snapshot: snap,
      scope,
    });
  }

  if (p.awareness_state === "UNCONSCIOUS") {
    return decide({
      observerType: p.observer_type,
      observerId: p.observer_id,
      modality,
      observationState: "NOT_OBSERVED",
      reasonCode: "UNCONSCIOUS",
      snapshot: snap,
      scope,
    });
  }
  if (p.awareness_state === "ASLEEP") {
    return decide({
      observerType: p.observer_type,
      observerId: p.observer_id,
      modality,
      observationState: "NOT_OBSERVED",
      reasonCode: "ASLEEP",
      snapshot: snap,
      scope,
    });
  }
  if (p.awareness_state === "INCAPACITATED") {
    return decide({
      observerType: p.observer_type,
      observerId: p.observer_id,
      modality,
      observationState: "NOT_OBSERVED",
      reasonCode: "INCAPACITATED",
      snapshot: snap,
      scope,
    });
  }
  if (p.awareness_state === "UNKNOWN") {
    return decide({
      observerType: p.observer_type,
      observerId: p.observer_id,
      modality,
      observationState: "NOT_OBSERVED",
      reasonCode: "AWARENESS_UNKNOWN",
      snapshot: snap,
      scope,
    });
  }

  const evLoc = eventLocationKey(event);
  if (evLoc && !scope.sceneWide) {
    const obsLoc = p.location_key ?? scope.sceneLocationKey;
    if (obsLoc && obsLoc !== evLoc) {
      return decide({
        observerType: p.observer_type,
        observerId: p.observer_id,
        modality,
        observationState: "NOT_OBSERVED",
        reasonCode: "LOCATION_MISMATCH",
        snapshot: snap,
        scope,
      });
    }
  }

  if (modality === "VISUAL" || modality === "DOCUMENT_READ") {
    if (p.visual_capability === "BLIND") {
      return decide({
        observerType: p.observer_type,
        observerId: p.observer_id,
        modality,
        observationState: "NOT_OBSERVED",
        reasonCode: "BLIND",
        snapshot: snap,
        scope,
      });
    }
    if (p.visual_capability === "UNKNOWN") {
      return decide({
        observerType: p.observer_type,
        observerId: p.observer_id,
        modality,
        observationState: "NOT_OBSERVED",
        reasonCode: "VISUAL_CAPABILITY_UNKNOWN",
        snapshot: snap,
        scope,
      });
    }
    if (p.visual_capability === "OBSTRUCTED") {
      if (!(scope.directPresentation && scope.overcomesVisualObstruction)) {
        return decide({
          observerType: p.observer_type,
          observerId: p.observer_id,
          modality,
          observationState: "NOT_OBSERVED",
          reasonCode: "VISUAL_BLOCKED",
          snapshot: snap,
          scope,
        });
      }
    }
  }

  if (modality === "AUDITORY" || modality === "DIRECT_ADDRESS") {
    if (p.auditory_capability === "DEAF") {
      return decide({
        observerType: p.observer_type,
        observerId: p.observer_id,
        modality,
        observationState: "NOT_OBSERVED",
        reasonCode: "DEAF",
        snapshot: snap,
        scope,
      });
    }
    if (p.auditory_capability === "UNKNOWN") {
      return decide({
        observerType: p.observer_type,
        observerId: p.observer_id,
        modality,
        observationState: "NOT_OBSERVED",
        reasonCode: "AUDITORY_CAPABILITY_UNKNOWN",
        snapshot: snap,
        scope,
      });
    }
    if (p.auditory_capability === "OBSTRUCTED") {
      return decide({
        observerType: p.observer_type,
        observerId: p.observer_id,
        modality,
        observationState: "NOT_OBSERVED",
        reasonCode: "AUDITORY_BLOCKED",
        snapshot: snap,
        scope,
      });
    }
  }

  const visMode = event.visibility?.mode ?? "UNKNOWN";
  let reason: ObservationReasonCode = "PRESENT_AND_CAPABLE";
  if (visMode === "EXPLICIT_OBSERVERS") reason = "EXPLICIT_TARGET";
  else if (visMode === "CURRENT_CHARACTER") reason = "CURRENT_CHARACTER_SCOPE";
  else if (scope.sceneWide) reason = "SCENE_WIDE_EVENT";

  return decide({
    observerType: p.observer_type,
    observerId: p.observer_id,
    modality,
    observationState: "OBSERVED",
    reasonCode: reason,
    snapshot: snap,
    scope,
    confidence: Math.min(100, Math.max(0, Math.round(event.confidence))),
  });
}

function rejectAllPresence(opts: {
  presenceRows: SceneObserverPresenceRow[];
  observersByKey: Map<string, ChatObserverRow>;
  modality: ObservationModality;
  reason: ObservationReasonCode;
  scope: EventScopeSnapshot;
}): SceneEventObservationDecision[] {
  return opts.presenceRows.map((p) => {
    const obs = opts.observersByKey.get(`${p.observer_type}:${p.observer_id}`);
    return decide({
      observerType: p.observer_type,
      observerId: p.observer_id,
      modality: opts.modality,
      observationState:
        opts.reason === "TOO_MANY_CANDIDATES" ? "UNKNOWN" : "NOT_OBSERVED",
      reasonCode: opts.reason,
      snapshot: snapshotFromPresence(p, obs ?? null, opts.scope),
      scope: opts.scope,
    });
  });
}

/**
 * Pure witness resolution — no DB writes, no persona-secret access.
 */
export function resolveSceneEventWitnesses(input: {
  event: SceneEvidenceEvent;
  activeScene: ChatSceneRow;
  presenceRows: SceneObserverPresenceRow[];
  registeredObservers: ChatObserverRow[];
  currentCharacterId: string;
}): SceneEventObservationDecision[] {
  const modality = modalityForEventType(input.event.eventType);
  const scope = buildScopeSnapshot({
    event: input.event,
    scene: input.activeScene,
    modality,
  });

  const observersByKey = new Map<string, ChatObserverRow>();
  for (const o of input.registeredObservers) {
    observersByKey.set(`${o.observer_type}:${o.observer_id}`, o);
  }

  const scenePresence = input.presenceRows.filter(
    (p) =>
      p.scene_id === input.activeScene.id && p.chat_id === input.event.chatId
  );

  if (!AUTHORITATIVE_SOURCES.has(input.event.sourceType)) {
    return rejectAllPresence({
      presenceRows: scenePresence,
      observersByKey,
      modality: modality ?? "VISUAL",
      reason: "SOURCE_NOT_AUTHORITATIVE",
      scope,
    });
  }

  if (input.event.confidence < MIN_AUTOMATIC_OBSERVATION_CONFIDENCE) {
    return rejectAllPresence({
      presenceRows: scenePresence,
      observersByKey,
      modality: modality ?? "VISUAL",
      reason: "EVENT_CONFIDENCE_TOO_LOW",
      scope,
    });
  }

  if (!modality) {
    return rejectAllPresence({
      presenceRows: scenePresence,
      observersByKey,
      modality: "VISUAL",
      reason: "UNSUPPORTED_MODALITY",
      scope,
    });
  }

  const { candidates, rejectAllReason } = selectCandidatesByVisibility({
    event: input.event,
    presenceRows: scenePresence,
    observersByKey,
    currentCharacterId: input.currentCharacterId,
  });

  if (rejectAllReason === "VISIBILITY_UNKNOWN") {
    return rejectAllPresence({
      presenceRows: scenePresence,
      observersByKey,
      modality,
      reason: "VISIBILITY_UNKNOWN",
      scope,
    });
  }

  if (rejectAllReason === "TOO_MANY_CANDIDATES") {
    return rejectAllPresence({
      presenceRows: scenePresence,
      observersByKey,
      modality,
      reason: "TOO_MANY_CANDIDATES",
      scope,
    });
  }

  const decisions: SceneEventObservationDecision[] = [];
  const selectedKeys = new Set(
    candidates.map(
      (c) => `${c.presence.observer_type}:${c.presence.observer_id}`
    )
  );

  for (const c of candidates) {
    decisions.push(
      evaluateSensoryAndPresence({
        candidate: c,
        event: input.event,
        modality,
        scope,
      })
    );
  }

  const visMode = input.event.visibility?.mode;
  if (visMode === "EXPLICIT_OBSERVERS" || visMode === "CURRENT_CHARACTER") {
    for (const p of scenePresence) {
      const key = `${p.observer_type}:${p.observer_id}`;
      if (selectedKeys.has(key)) continue;
      const obs = observersByKey.get(key);
      if (!obs || obs.is_active !== 1) continue;
      decisions.push(
        decide({
          observerType: p.observer_type,
          observerId: p.observer_id,
          modality,
          observationState: "NOT_OBSERVED",
          reasonCode:
            visMode === "EXPLICIT_OBSERVERS"
              ? "NOT_IN_EXPLICIT_OBSERVERS"
              : "CURRENT_CHARACTER_SCOPE",
          snapshot: snapshotFromPresence(p, obs, scope),
          scope,
        })
      );
    }
  }

  return decisions;
}
