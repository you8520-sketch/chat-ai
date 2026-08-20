import { createHash } from "node:crypto";
import {
  assessParticipantAdultStatus,
  type AdultStatus,
  type ParticipantAdultMetadata,
} from "@/lib/adultSceneRouting";
import type {
  SecondaryAdultStatus,
  SecondaryEvidenceSource,
  SecondaryEvidenceTrust,
  SecondaryParticipantKind,
} from "@/lib/secondarySceneParticipantSafetySchema";

export type SceneParticipantEventAction = "ENTER" | "PRESENT" | "LEAVE";

export type SceneParticipantEvent = {
  action: SceneParticipantEventAction;
  displayName: string;
  participantKind: SecondaryParticipantKind;
  /** Raw numeric age if attached in the same assertion. May be >= 19. */
  attachedAge?: number | null;
  attachedAdultStatus?: string | null;
  attachedIsRealPerson?: boolean | null;
  attachedSchoolRole?: string | null;
};

export type AuthoritativeSecondaryActor = {
  stableId: string;
  displayName: string;
  kind: Extract<
    SecondaryParticipantKind,
    "creator_npc" | "server_npc" | "party_character" | "trusted_cast"
  >;
  metadata?: ParticipantAdultMetadata | null;
};

const AUTHORITATIVE_ID_PREFIX = "auth:";
const DYNAMIC_ID_PREFIX = "dyn:";

const KINSHIP =
  "여동생|남동생|동생|아들|딸|누나|언니|오빠|형님|형|아이";

const GROUP_ACTOR = "(?:세|두|네|다섯|여섯|[0-9]+)\\s*(?:명|사람)";

const ACTOR_CORE = `(?:${KINSHIP}|${GROUP_ACTOR}|[가-힣]{2,4})`;

const NON_ACTOR_TOKEN =
  /^(?:문|방|여기|집|학교|자리|둘만|사람|문을|열고|방에|방으로|함께|이제|다른|어떤|이런|저런|새로운|작은|큰)$/;

const PARTICLE = "(?:이|가|은|는|도|을|를|의)?";

const AGE_PREFIX = "(?:(\\d{1,2})\\s*(?:살|세)\\s*)";

const REAL_PERSON_PREFIX =
  "(?:실존\\s*인물(?:인)?|실제\\s*연예인|real\\s+person|actual\\s+person)\\s*";

const SCHOOL_OR_MINOR_PREFIX =
  "(?:중학생|고등학생|초등학생|미성년자|미성년|underage|minor)\\s*";

const ENTER_VERB =
  "(?:문을\\s*열고\\s*)?(?:들어왔|들어온다|들어왔어|들어와|들어옴|합류했|합류한다|합류했다|합류)";

const HERE_PRESENT =
  "(?:여기\\s*함께\\s*있|함께\\s*있|방에\\s*있)";

const LEAVE_VERB =
  "(?:방을\\s*)?(?:나갔|나간다|나갔어|나가|떠났|떠난다|떠났어|자리를\\s*떴)";

const REJECT_CLAUSE =
  /(?:사진\s*속|전화\s*중|통화\s*중|전화\s*하|\d+\s*살\s*때|어릴\s*적|어렸을\s*때|만났던|이야기|(?:학교|집)에\s*(?:있|가))/;

const OFFSCENE_LOCATION = /(?:학교|집)에\s*(?:있|가)/;

function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?。\n])\s*|(?<=다)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripParticle(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  const stripped = trimmed.replace(/(?:이|가|은|는|도|을|를|의)$/u, "");
  return (stripped || trimmed).normalize("NFC");
}

function normalizeActorKey(displayName: string): string {
  return stripParticle(displayName).toLowerCase();
}

export function buildDynamicParticipantId(displayName: string): string {
  const digest = createHash("sha256")
    .update(normalizeActorKey(displayName), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `${DYNAMIC_ID_PREFIX}${digest}`;
}

export function buildAuthoritativeParticipantId(
  kind: AuthoritativeSecondaryActor["kind"],
  stableId: string
): string {
  return `${AUTHORITATIVE_ID_PREFIX}${kind}:${stableId}`;
}

export function isAuthoritativeParticipantId(participantId: string): boolean {
  return participantId.startsWith(AUTHORITATIVE_ID_PREFIX);
}

/**
 * Public request bodies must never mint or collide with creator/server ids.
 * Age / adultStatus on the public body are also non-authoritative.
 */
export function rejectPublicTrustedParticipantIdentity(input: {
  participantId?: unknown;
  age?: unknown;
  adultStatus?: unknown;
  isRealPerson?: unknown;
}): {
  accepted: false;
  participantId: null;
  metadata: null;
  ignoredFields: string[];
} {
  const ignoredFields: string[] = [];
  if (typeof input.participantId === "string" && input.participantId.trim()) {
    ignoredFields.push("participant_id");
  }
  if (input.age != null) ignoredFields.push("age");
  if (input.adultStatus != null) ignoredFields.push("adultStatus");
  if (input.isRealPerson != null) ignoredFields.push("isRealPerson");
  return {
    accepted: false,
    participantId: null,
    metadata: null,
    ignoredFields,
  };
}

function isGroupActor(name: string): boolean {
  return /(?:세|두|네|다섯|여섯|[0-9]+)\s*(?:명|사람)/.test(name);
}

function clauseIsRejected(clause: string): boolean {
  return REJECT_CLAUSE.test(clause);
}

function extractAttachedEvidence(prefix: {
  age?: string;
  realPerson?: string;
  schoolOrMinor?: string;
}): Pick<
  SceneParticipantEvent,
  | "attachedAge"
  | "attachedAdultStatus"
  | "attachedIsRealPerson"
  | "attachedSchoolRole"
> {
  const age = prefix.age ? Number(prefix.age) : null;
  const schoolOrMinor = prefix.schoolOrMinor?.trim() ?? "";
  const realPerson = Boolean(prefix.realPerson);
  let attachedAdultStatus: string | null = null;
  let attachedSchoolRole: string | null = null;
  if (/^(미성년자|미성년|underage|minor)$/i.test(schoolOrMinor)) {
    attachedAdultStatus = "minor";
  } else if (
    /^(중학생|고등학생|초등학생)$/.test(schoolOrMinor)
  ) {
    attachedSchoolRole = schoolOrMinor;
    attachedAdultStatus = "minor";
  }
  return {
    attachedAge: age != null && Number.isFinite(age) ? age : null,
    attachedAdultStatus,
    attachedIsRealPerson: realPerson ? true : null,
    attachedSchoolRole,
  };
}

function actorPhrasePattern(): RegExp {
  return new RegExp(
    `${AGE_PREFIX}?(${REAL_PERSON_PREFIX})?(${SCHOOL_OR_MINOR_PREFIX})?(${ACTOR_CORE})${PARTICLE}`,
    "gu"
  );
}

function matchAction(clause: string): {
  action: SceneParticipantEventAction;
  verbIndex: number;
} | null {
  const leave = clause.search(new RegExp(LEAVE_VERB, "u"));
  const enter = clause.search(new RegExp(ENTER_VERB, "u"));
  const present = clause.search(new RegExp(HERE_PRESENT, "u"));
  const candidates: Array<{ action: SceneParticipantEventAction; index: number }> =
    [];
  if (leave >= 0) candidates.push({ action: "LEAVE", index: leave });
  if (enter >= 0) candidates.push({ action: "ENTER", index: enter });
  if (present >= 0) candidates.push({ action: "PRESENT", index: present });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  return { action: candidates[0].action, verbIndex: candidates[0].index };
}

/**
 * Narrow deterministic current-turn extractor.
 * Input is the current user or assistant message only — no world/lore/history.
 */
export function extractCurrentTurnSceneParticipantEvents(
  text: string
): SceneParticipantEvent[] {
  if (!text.trim()) return [];
  const events: SceneParticipantEvent[] = [];
  for (const clause of splitClauses(text)) {
    if (clauseIsRejected(clause)) continue;
    const found = matchAction(clause);
    if (!found) continue;
    const { action, verbIndex } = found;
    if (
      (action === "ENTER" || action === "PRESENT") &&
      OFFSCENE_LOCATION.test(clause) &&
      !new RegExp(ENTER_VERB, "u").test(clause) &&
      !new RegExp(HERE_PRESENT, "u").test(clause)
    ) {
      continue;
    }

    const subjectSpan = clause.slice(0, verbIndex);
    const actorRe = actorPhrasePattern();
    const candidates: SceneParticipantEvent[] = [];
    for (const match of subjectSpan.matchAll(actorRe)) {
      const displayName = stripParticle(match[4] ?? "");
      if (!displayName || NON_ACTOR_TOKEN.test(displayName)) continue;
      const evidence = extractAttachedEvidence({
        age: match[1],
        realPerson: match[2],
        schoolOrMinor: match[3],
      });
      candidates.push({
        action,
        displayName,
        participantKind: isGroupActor(displayName) ? "group" : "dynamic",
        ...evidence,
      });
    }
    const matched = candidates.length > 0;
    if (matched) {
      events.push(candidates[candidates.length - 1]);
    }
    if (!matched && action !== "LEAVE") {
      const group = subjectSpan.match(
        /((?:세|두|네|다섯|여섯|[0-9]+)\s*(?:명|사람))/
      );
      if (group?.[1]) {
        events.push({
          action,
          displayName: stripParticle(group[1]),
          participantKind: "group",
        });
      }
    }
  }
  return events;
}

export function toRestrictiveOnlyMetadata(
  metadata: ParticipantAdultMetadata
): ParticipantAdultMetadata {
  const out: ParticipantAdultMetadata = {};
  if (
    typeof metadata.age === "number" &&
    Number.isFinite(metadata.age) &&
    metadata.age < 19
  ) {
    out.age = metadata.age;
  }
  const status = metadata.adultStatus?.trim() ?? "";
  if (/^(minor|underage|child|conflict)$/i.test(status)) {
    out.adultStatus = status;
  }
  if (metadata.isRealPerson === true) {
    out.isRealPerson = true;
  }
  const ageGroup = metadata.ageGroup?.trim() ?? "";
  if (/^(minor|underage|child)$/i.test(ageGroup)) {
    out.ageGroup = ageGroup;
  }
  const school = metadata.currentSchool?.trim() ?? "";
  if (
    /(?:중학생|고등학생|초등학생|middle\s*school|high\s*school|elementary)/i.test(
      school
    )
  ) {
    out.currentSchool = school;
  }
  return out;
}

export function eventToRestrictiveMetadata(
  event: SceneParticipantEvent
): ParticipantAdultMetadata {
  return toRestrictiveOnlyMetadata({
    age: event.attachedAge,
    adultStatus: event.attachedAdultStatus,
    isRealPerson: event.attachedIsRealPerson === true,
    currentSchool: event.attachedSchoolRole,
  });
}

/**
 * Thin trust-aware adapter around assessParticipantAdultStatus().
 * Untrusted prose may never confirm adulthood.
 */
export function assessTrustedParticipantAdultStatus(input: {
  trust: SecondaryEvidenceTrust;
  metadata?: ParticipantAdultMetadata | null;
  authoritativeProfile?: ParticipantAdultMetadata | null;
}): AdultStatus | "real_person" {
  switch (input.trust) {
    case "AUTHORITATIVE":
      return assessParticipantAdultStatus(input.metadata ?? {});
    case "RESTRICTIVE_ONLY":
      return assessParticipantAdultStatus(
        toRestrictiveOnlyMetadata(input.metadata ?? {})
      );
    case "UNKNOWN":
      if (input.authoritativeProfile) {
        return assessParticipantAdultStatus(input.authoritativeProfile);
      }
      return assessParticipantAdultStatus({});
    default: {
      const _never: never = input.trust;
      return _never;
    }
  }
}

export function toStoredAdultStatus(
  status: AdultStatus | "real_person"
): SecondaryAdultStatus {
  switch (status) {
    case "unknown":
    case "confirmed":
    case "minor":
    case "conflict":
    case "real_person":
      return status;
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function resolveDynamicEventIdentity(event: SceneParticipantEvent): {
  participantId: string;
  displayName: string;
  participantKind: SecondaryParticipantKind;
} {
  return {
    participantId: buildDynamicParticipantId(event.displayName),
    displayName: event.displayName,
    participantKind: event.participantKind,
  };
}

export function projectAuthoritativeSecondaryActor(
  actor: AuthoritativeSecondaryActor
): {
  participantId: string;
  displayName: string;
  participantKind: SecondaryParticipantKind;
  trust: "AUTHORITATIVE";
  source: SecondaryEvidenceSource;
  metadata: ParticipantAdultMetadata;
  adultStatus: SecondaryAdultStatus;
} {
  const metadata = actor.metadata ?? {};
  const adultStatus = toStoredAdultStatus(
    assessTrustedParticipantAdultStatus({
      trust: "AUTHORITATIVE",
      metadata,
    })
  );
  const source: SecondaryEvidenceSource = (() => {
    switch (actor.kind) {
      case "creator_npc":
        return "CREATOR_NPC";
      case "server_npc":
        return "SERVER_NPC";
      case "party_character":
        return "PARTY_CHARACTER";
      case "trusted_cast":
        return "TRUSTED_CAST_PROFILE";
      default: {
        const _never: never = actor.kind;
        return _never;
      }
    }
  })();
  return {
    participantId: buildAuthoritativeParticipantId(actor.kind, actor.stableId),
    displayName: actor.displayName,
    participantKind: actor.kind,
    trust: "AUTHORITATIVE",
    source,
    metadata,
    adultStatus,
  };
}
