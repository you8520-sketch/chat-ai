import {
  CONFIDENCE_DETERMINISTIC_DEFAULT,
} from "@/lib/sceneEvidenceCatalog";
import type {
  BodyRegion,
  SceneEvidenceDraft,
  SceneEvidenceExplicitAction,
  SceneEvidenceServerEvent,
} from "@/lib/sceneEvidenceTypes";
import {
  CONFIDENCE_CREATOR,
  CONFIDENCE_EXPLICIT,
  CONFIDENCE_SERVER,
} from "@/lib/sceneEvidenceCatalog";

function defaultVisibility(opts: {
  requiresLineOfSight?: boolean;
}): SceneEvidenceDraft["visibility"] {
  return {
    mode: "CURRENT_CHARACTER",
    requiresLineOfSight: opts.requiresLineOfSight ?? false,
  };
}

function baseDraft(opts: {
  chatId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  characterId: number;
  publicPersonaId?: number | null;
}): Pick<
  SceneEvidenceDraft,
  "chatId" | "turnNumber" | "sourceMessageId" | "subjectType" | "subjectId" | "actorType" | "actorId"
> {
  const subjectId =
    opts.publicPersonaId != null
      ? `persona:${opts.publicPersonaId}`
      : "persona-user";
  return {
    chatId: opts.chatId,
    turnNumber: opts.turnNumber,
    sourceMessageId: opts.sourceMessageId ?? null,
    subjectType: "USER",
    subjectId,
    actorType: "USER",
    actorId: subjectId,
  };
}

/** Conservative rejectors — prefer false negative. */
export function isNonAssertiveSceneUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // Question
  if (/[?？]|인가\??|일까\??|할까요|겠니|볼\s*거야|보일까/.test(t)) return true;
  // Hypothetical / conditional
  if (
    /(?:라면|다면|였다면|왔다면|만약|만약에|한다면|한다면|할\s*경우|보일지도|보일\s*것)/.test(
      t
    )
  ) {
    return true;
  }
  // Future plan / intention
  if (
    /(?:생각이다|생각이야|예정이다|하겠다|보여주겠|할\s*것이다|할\s*거야|나중에|조금\s*뒤|곧\s*할)/.test(
      t
    )
  ) {
    return true;
  }
  // Past recollection (not current scene)
  if (
    /(?:예전에는|예전에|그때는|적이\s*있었|보여준\s*적|벗은\s*적|회상)/.test(t)
  ) {
    return true;
  }
  // Negation of the action
  if (
    /(?:벗지\s*않|드러내지\s*않|보여주지\s*않|꺼내지\s*않|쓰지\s*않|토하지\s*않|않은\s*채|않았다|안\s*했다|그런\s*적\s*없|쓴\s*적은\s*없)/.test(
      t
    )
  ) {
    return true;
  }
  // Fiction / quote / third-party storytelling
  if (
    /(?:소설|설정(?:으로|상)|작품\s*속|이야기(?:를)?\s*들었|친구가|누군가|들었는데)/.test(
      t
    )
  ) {
    return true;
  }
  // Failed attempt / third party forcing
  if (
    /(?:벗기려\s*했|찢으려\s*했|시도했|하려\s*했으나|하려다\s*말|실패)/.test(t)
  ) {
    return true;
  }
  // Metaphorical / soft state (never treat as physical scene evidence)
  if (/(?:속마음|비유적으로|마치|것처럼|듯한\s*느낌|느껴졌)/.test(t)) {
    return true;
  }
  if (/(?:^|\s)가정\s*[:：]|가정이\s*:/.test(t)) return true;
  return false;
}

function mapBodyRegion(fragment: string): BodyRegion | null {
  const f = fragment.replace(/\s+/g, "");
  if (/얼굴|뺨|이마/.test(f)) return "face";
  if (/목덜미|쇄골/.test(f)) return "neck";
  if ((f === "목" || /^목/.test(f)) && !/손목|발목/.test(f)) return "neck";
  if (/어깨/.test(f)) return "shoulder";
  if (/위팔|상완/.test(f)) return "upper_arm";
  if (/팔뚝|아래팔|전완/.test(f)) return "forearm";
  if (/손목|손등|손바닥/.test(f)) return "hand";
  if (/손/.test(f) && !/어깨/.test(f)) return "hand";
  if (/팔/.test(f) && !/어깨|위팔/.test(f)) return "forearm";
  if (/가슴|흉부/.test(f)) return "chest";
  if (/배|복부/.test(f)) return "abdomen";
  if (/아랫등|허리뒤|등아래/.test(f)) return "lower_back";
  if (/윗등|등위/.test(f)) return "upper_back";
  if (/등/.test(f)) return "upper_back";
  if (/허리/.test(f)) return "waist";
  if (/허벅지/.test(f)) return "thigh";
  if (/종아리|다리/.test(f)) return "leg";
  if (/발등|^발$|발목/.test(f) || f === "발") return "foot";
  if (/전신|온몸/.test(f)) return "full_body";
  return null;
}

function extractDocumentLabel(text: string): string | null {
  const m = text.match(
    /(계약서|검사\s*결과지|결과지|진단서|서류|문서|처방전|주민등록증|신분증|여권)/
  );
  if (!m?.[1]) return null;
  return m[1].replace(/\s+/g, "");
}

function extractItemLabel(text: string): string | null {
  // Prefer concrete presented items; avoid inventing from secrets.
  const m = text.match(
    /(독촉장|편지|목걸이|반지|사진|열쇠|상자|병|약병|칼|권총|가방|지갑)/
  );
  return m?.[1] ?? null;
}

function extractMarkLabel(text: string): string | null {
  const m = text.match(/(문신|흉터|낙인|표식|점)/);
  return m?.[1] ?? null;
}

function extractManifestation(text: string): string | null {
  if (/중력/.test(text) && /(?:뒤집|조작|멈췄|띄우|들어\s*올)/.test(text)) {
    return "gravity_alteration";
  }
  if (/치유|회복/.test(text) && /(?:빛|손|감싸|치료)/.test(text)) {
    return "healing_manifestation";
  }
  if (/불|화염/.test(text) && /(?:피워|내뿜|타오|소환)/.test(text)) {
    return "fire_manifestation";
  }
  if (/순간\s*이동|텔레포트/.test(text)) return "teleportation";
  if (/투시/.test(text) && /(?:보|사용|발동)/.test(text)) return "clairvoyance";
  // Generic high-precision: "능력을 써/사용했다" + visible effect verb
  if (/능력/.test(text) && /(?:써|사용|발동|드러냈)/.test(text)) {
    return "ability_use";
  }
  return null;
}

function extractSymptom(text: string): string | null {
  if (/피(?:를)?\s*토|토혈|입(?:을)?\s*막.{0,12}피|손가락\s*사이로\s*피/.test(text)) {
    return "coughing_blood";
  }
  if (/코피/.test(text)) return "nosebleed";
  if (/쓰러졌|의식을\s*잃/.test(text)) return "collapse";
  if (/열이\s*나|고열/.test(text)) return "fever";
  if (/기침/.test(text) && /(?:심하|멈추지|피)/.test(text)) return "severe_cough";
  if (/손이?\s*.{0,8}떨|경련/.test(text)) return "tremor";
  return null;
}

/**
 * Deterministic secret-blind parser over the current user message only.
 * Never consults persona secret DB / aliases / knowledge.
 */
export function extractDeterministicSceneEvidenceFromUserMessage(opts: {
  chatId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  userMessage: string;
  publicPersonaId?: number | null;
}): SceneEvidenceDraft[] {
  const msg = opts.userMessage.replace(/\r\n?/g, "\n").trim();
  if (!msg) return [];
  if (isNonAssertiveSceneUtterance(msg)) return [];

  const base = baseDraft(opts);
  const out: SceneEvidenceDraft[] = [];
  const push = (draft: SceneEvidenceDraft) => {
    out.push(draft);
  };

  // BODY_REGION_EXPOSED — clothing removal / deliberate expose
  const bodyExpose =
    /(?:셔츠|웃옷|상의|재킷|코트|블라우스).{0,24}(?:벗|벗어|벗어\s*던|머리\s*위로\s*벗)/.test(
      msg
    ) ||
    /(?:소매를?\s*걷어|팔을?\s*내보|등을?\s*드러|등을?\s*보|가슴을?\s*드러|벗고)/.test(
      msg
    );

  if (bodyExpose) {
    let region: BodyRegion | null = null;
    if (/등/.test(msg)) region = mapBodyRegion(msg.includes("아랫등") || /허리\s*뒤/.test(msg) ? "아랫등" : "등");
    else if (/팔|소매|손목/.test(msg)) region = mapBodyRegion(/손목/.test(msg) ? "손목" : /팔뚝/.test(msg) ? "팔뚝" : "팔");
    else if (/가슴/.test(msg)) region = "chest";
    else if (/(?:셔츠|웃옷|상의|재킷|코트|블라우스).{0,24}벗/.test(msg)) {
      region = "upper_back";
    }
    if (region) {
      push({
        ...base,
        eventType: "BODY_REGION_EXPOSED",
        sourceType: "USER_MESSAGE_DETERMINISTIC",
        confidence: CONFIDENCE_DETERMINISTIC_DEFAULT,
        attributes: { region },
        visibility: defaultVisibility({ requiresLineOfSight: true }),
      });
    }
  }

  // VISIBLE_MARK_PRESENTED — only when user explicitly shows mark
  if (
    /(?:문신|흉터|낙인|표식).{0,20}(?:보여|내보|드러냈|제시)/.test(msg) ||
    /(?:보여|내보|드러냈).{0,20}(?:문신|흉터|낙인|표식)/.test(msg)
  ) {
    const markLabel = extractMarkLabel(msg);
    if (markLabel) {
      const region = /등/.test(msg)
        ? "upper_back"
        : /팔|손목/.test(msg)
          ? "forearm"
          : undefined;
      push({
        ...base,
        eventType: "VISIBLE_MARK_PRESENTED",
        sourceType: "USER_MESSAGE_DETERMINISTIC",
        confidence: CONFIDENCE_DETERMINISTIC_DEFAULT,
        attributes: region ? { markLabel, region } : { markLabel },
        visibility: defaultVisibility({ requiresLineOfSight: true }),
      });
    }
  }

  // DOCUMENT_PRESENTED / IDENTITY
  if (
    /(?:꺼내|건네|내밀|펼쳤|내려놓|제시|보여주)/.test(msg) &&
    /(?:계약서|검사\s*결과지|결과지|진단서|서류|문서|처방전|주민등록증|신분증|여권)/.test(
      msg
    )
  ) {
    const documentLabel = extractDocumentLabel(msg);
    if (documentLabel) {
      const identity = /주민등록증|신분증|여권/.test(documentLabel);
      push({
        ...base,
        eventType: identity ? "IDENTITY_DOCUMENT_PRESENTED" : "DOCUMENT_PRESENTED",
        sourceType: "USER_MESSAGE_DETERMINISTIC",
        confidence: CONFIDENCE_DETERMINISTIC_DEFAULT,
        attributes: { documentLabel },
        visibility: defaultVisibility({ requiresLineOfSight: true }),
      });
    }
  }

  // VISIBLE_ITEM_PRESENTED
  if (
    /(?:꺼내|내밀|건네|보여주|제시)/.test(msg) &&
    /(?:독촉장|편지|목걸이|반지|사진|열쇠|상자|병|약병|칼|권총|지갑)/.test(msg)
  ) {
    const itemLabel = extractItemLabel(msg);
    if (itemLabel && !/(?:계약서|결과지|서류|문서|신분증)/.test(itemLabel)) {
      push({
        ...base,
        eventType: "VISIBLE_ITEM_PRESENTED",
        sourceType: "USER_MESSAGE_DETERMINISTIC",
        confidence: CONFIDENCE_DETERMINISTIC_DEFAULT,
        attributes: { itemLabel },
        visibility: defaultVisibility({ requiresLineOfSight: true }),
      });
    }
  }

  // ABILITY_MANIFESTED — actual use, not capability statement alone
  const manifestation = extractManifestation(msg);
  if (
    manifestation &&
    !/(?:할\s*수\s*있|있다면|쓴\s*적은\s*없|쓰지\s*않)/.test(msg) &&
    /(?:뒤집|멈췄|띄우|피워|내뿜|써|사용|발동|드러냈|감싸|치료|소환|순간\s*이동)/.test(
      msg
    )
  ) {
    push({
      ...base,
      eventType: "ABILITY_MANIFESTED",
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      confidence: CONFIDENCE_DETERMINISTIC_DEFAULT,
      attributes: { manifestation },
      visibility: defaultVisibility({ requiresLineOfSight: false }),
    });
  }

  // PHYSICAL_SYMPTOM_DISPLAYED
  const symptom = extractSymptom(msg);
  if (symptom) {
    push({
      ...base,
      eventType: "PHYSICAL_SYMPTOM_DISPLAYED",
      sourceType: "USER_MESSAGE_DETERMINISTIC",
      confidence: CONFIDENCE_DETERMINISTIC_DEFAULT,
      attributes: { symptom },
      visibility: defaultVisibility({ requiresLineOfSight: true }),
    });
  }

  return out;
}

export function draftsFromExplicitActions(opts: {
  chatId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  publicPersonaId?: number | null;
  actions: SceneEvidenceExplicitAction[];
}): SceneEvidenceDraft[] {
  const base = baseDraft(opts);
  const out: SceneEvidenceDraft[] = [];
  for (const action of opts.actions) {
    switch (action.actionType) {
      case "EXPOSE_BODY_REGION":
        out.push({
          ...base,
          eventType: "BODY_REGION_EXPOSED",
          sourceType: "USER_EXPLICIT_ACTION",
          confidence: CONFIDENCE_EXPLICIT,
          attributes: {
            region: action.region,
            ...(action.exposureLevel ? { exposureLevel: action.exposureLevel } : {}),
          },
          visibility: defaultVisibility({ requiresLineOfSight: true }),
        });
        break;
      case "COVER_BODY_REGION":
        out.push({
          ...base,
          eventType: "BODY_REGION_COVERED",
          sourceType: "USER_EXPLICIT_ACTION",
          confidence: CONFIDENCE_EXPLICIT,
          attributes: { region: action.region },
          visibility: defaultVisibility({ requiresLineOfSight: true }),
        });
        break;
      case "PRESENT_ITEM":
        out.push({
          ...base,
          eventType: "VISIBLE_ITEM_PRESENTED",
          sourceType: "USER_EXPLICIT_ACTION",
          confidence: CONFIDENCE_EXPLICIT,
          attributes: { itemLabel: action.itemLabel.slice(0, 64) },
          visibility: defaultVisibility({ requiresLineOfSight: true }),
        });
        break;
      case "PRESENT_VISIBLE_MARK":
        out.push({
          ...base,
          eventType: "VISIBLE_MARK_PRESENTED",
          sourceType: "USER_EXPLICIT_ACTION",
          confidence: CONFIDENCE_EXPLICIT,
          attributes: { markLabel: action.markLabel.slice(0, 64) },
          visibility: defaultVisibility({ requiresLineOfSight: true }),
        });
        break;
      case "PRESENT_DOCUMENT":
        out.push({
          ...base,
          eventType: "DOCUMENT_PRESENTED",
          sourceType: "USER_EXPLICIT_ACTION",
          confidence: CONFIDENCE_EXPLICIT,
          attributes: { documentLabel: action.documentLabel.slice(0, 64) },
          visibility: defaultVisibility({ requiresLineOfSight: true }),
        });
        break;
      case "MANIFEST_ABILITY":
        out.push({
          ...base,
          eventType: "ABILITY_MANIFESTED",
          sourceType: "USER_EXPLICIT_ACTION",
          confidence: CONFIDENCE_EXPLICIT,
          attributes: {
            manifestation: action.manifestation.slice(0, 64),
            ...(action.visibleEffect
              ? { visibleEffect: action.visibleEffect.slice(0, 64) }
              : {}),
          },
          visibility: defaultVisibility({}),
        });
        break;
      case "DISPLAY_SYMPTOM":
        out.push({
          ...base,
          eventType: "PHYSICAL_SYMPTOM_DISPLAYED",
          sourceType: "USER_EXPLICIT_ACTION",
          confidence: CONFIDENCE_EXPLICIT,
          attributes: {
            symptom: action.symptom.slice(0, 64),
            ...(action.severity ? { severity: action.severity.slice(0, 32) } : {}),
          },
          visibility: defaultVisibility({ requiresLineOfSight: true }),
        });
        break;
      default:
        break;
    }
  }
  return out;
}

export function draftsFromServerOrCreatorEvents(opts: {
  chatId: number;
  characterId: number;
  turnNumber: number;
  sourceMessageId?: number | null;
  publicPersonaId?: number | null;
  events: SceneEvidenceServerEvent[];
  sourceType: "SERVER_SCENE_EVENT" | "CREATOR_TRIGGER";
}): SceneEvidenceDraft[] {
  const base = baseDraft(opts);
  const confidence =
    opts.sourceType === "CREATOR_TRIGGER" ? CONFIDENCE_CREATOR : CONFIDENCE_SERVER;
  return opts.events.map((ev) => ({
    ...base,
    eventType: ev.eventType,
    subjectType: ev.subjectType ?? base.subjectType,
    subjectId: ev.subjectId ?? base.subjectId,
    actorType: opts.sourceType === "SERVER_SCENE_EVENT" ? "SERVER" : base.actorType,
    actorId: opts.sourceType === "SERVER_SCENE_EVENT" ? "server" : base.actorId,
    sourceType: opts.sourceType,
    confidence: ev.confidence ?? confidence,
    attributes: ev.attributes,
    visibility: ev.visibility ?? defaultVisibility({}),
  }));
}
