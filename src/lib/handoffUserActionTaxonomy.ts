/**
 * Test/live judge for adult-handoff user-action continuation.
 * Not injected into production prompts.
 *
 * Actor ownership is subject-tracked. Object-of-action names such as
 * "렌의 몸" / "렌의 손목" do not make [B] the actor.
 */

export type FlagValue = boolean | "UNCERTAIN";
export type ActorId = "A" | "B" | "unknown";

export type TaxonomyFlag = {
  value: FlagValue;
  evidence: string | null;
};

export type TrueNewUserActionBeatFlag = TaxonomyFlag & {
  actor: string | null;
  target: string | null;
  action: string | null;
  passage: string | null;
};

const B_LABEL = "렌 [B]";

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m || m.index == null) return null;
  const start = Math.max(0, m.index - 16);
  const end = Math.min(text.length, m.index + Math.max(64, m[0].length + 24));
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function passageAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 16);
  const end = Math.min(text.length, index + Math.max(64, length + 24));
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

const SAME_BEAT_RE =
  /재킷|후드티|후드|옷을\s*(?:천천히\s*)?(?:벗|걷어|끌어올|밀어)|키스|입술|고개를\s*(?:기울|숙|들)|몸을\s*(?:기울|기대)|가까이|숨이|숨을|떨렸|소름|심장|맥박|체온/;

const LOW_STAKES_AMBIENT_RE =
  /렌의\s*(?:숨|시선|고개|어깨|손가락|손끝|체온|떨림)|숨을\s*(?:삼키|고르)|가볍게\s*(?:스치|기대|맞닿)/;

const NEW_ANSWER_RE =
  /렌이\s*(?:대답|고개를\s*(?:끄덕|저)|입술을\s*열어)|렌(?:이|은|가)?[^「“"\n]{0,20}(?:말했다|답했다)\s*[「“"]/;

const NEW_CHOICE_RE =
  /렌(?:이|은|가|도)?[^.\n]{0,24}(?:동의했|거절했|원했|허락했|선택한)/;

const MAJOR_REWIND_STILL_HALLWAY_RE =
  /아직\s*복도에서|키스를\s*(?:하지\s*않|시작하지\s*않)|옷을\s*벗기지\s*않/;

type NewBeatKind = {
  re: RegExp;
  action: string;
  target: string;
};

const B_OWNED_NEW_BEATS: NewBeatKind[] = [
  { re: /문고리/, action: "문고리를 잡음", target: "문고리" },
  { re: /문을\s*열/, action: "문을 염", target: "문" },
  {
    re: /(?:안으로\s*(?:밀어|들여)|밀어\s*넣|들여보냈|밀쳐\s*안)/,
    action: "안으로 밀어 넣음",
    target: "태형",
  },
  { re: /문을\s*닫/, action: "문을 닫음", target: "문" },
  {
    re: /(?:보조실|회의실|숙소)(?:로|의|에)?/,
    action: "장소를 새로 정함",
    target: "장소",
  },
  { re: /자리를\s*옮|침대를\s*쓸/, action: "자리를 옮김", target: "장소" },
  {
    re: /(?:전자\s*)?(?:초커|목걸이|버클)[을를]?\s*(?:만지|건드|잡|잡아당)/,
    action: "새 대상(초커/버클)을 건드림",
    target: "초커/버클",
  },
  {
    re: /(?:목에\s*이빨|하반신|바지를\s*(?:내리|끌어)|벨트\s*버클)/,
    action: "새 신체/의복 대상을 선택함",
    target: "새 신체/의복 대상",
  },
];

const B_OWNED_REWIND_BEATS: NewBeatKind[] = [
  { re: /문고리/, action: "이미 닫힌 문을 다시 다룸", target: "문고리" },
  { re: /문을\s*열/, action: "문을 다시 염", target: "문" },
  {
    re: /(?:안으로\s*(?:밀어|들여)|밀어\s*넣|들여보냈|밀쳐\s*안)/,
    action: "이미 닫힌 공간으로 다시 밀어 넣음",
    target: "태형",
  },
  { re: /문을\s*닫/, action: "이미 닫힌 문을 다시 닫음", target: "문" },
  { re: /보조실/, action: "이미 닫힌 뒤 보조실을 새로 염", target: "보조실" },
];

function splitUnits(text: string): string[] {
  return text
    .split(/(?<=다\.|까\.|요\.|다!”|다\.”|[.?!\n])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function detectUnitActor(unit: string, lastActor: ActorId): ActorId {
  if (
    /(?:조태형|태형|라이크)(?:은|이|가)/.test(unit) ||
    /(?:조태형|태형|라이크)의\s*(?:입술|손(?:끝|가락)?|혀|이빨|무릎|허벅지|허리|골반|시선)(?:이|은|가)/.test(
      unit
    )
  ) {
    return "A";
  }
  if (
    /(?:^|[.\s])그(?:는|가)\s/.test(unit) ||
    /^그(?:는|가)\s/.test(unit)
  ) {
    if (
      /그(?:는|가)\s*렌의\s*(?:몸|등|허리|손목|어깨)/.test(unit) &&
      lastActor !== "B"
    ) {
      return "A";
    }
    return lastActor === "unknown" ? "A" : lastActor;
  }
  if (
    /렌(?:이|은|가)\s/.test(unit) ||
    /^렌(?:이|은|가)/.test(unit) ||
    /렌의\s*(?:손(?:끝|가락)?|혀|입|고개|시선|숨)(?:이|은|가)/.test(unit)
  ) {
    return "B";
  }
  if (
    /(?:조태형|태형|라이크|그)(?:은|는|이|가)?[^.\n]{0,16}렌(?:을|의\s*(?:몸|등|허리|손목|어깨|양\s*손목))/
      .test(unit)
  ) {
    return "A";
  }
  return lastActor;
}

function scanActorOwnedHits(
  text: string,
  kinds: NewBeatKind[],
  requiredActor: ActorId
): { kind: NewBeatKind; actor: ActorId; index: number; match: string } | null {
  let lastActor: ActorId = "A";
  let cursor = 0;
  for (const unit of splitUnits(text)) {
    const actor = detectUnitActor(unit, lastActor);
    lastActor = actor === "unknown" ? lastActor : actor;
    const unitIndex = text.indexOf(unit, cursor);
    cursor = unitIndex >= 0 ? unitIndex + unit.length : cursor;
    if (actor !== requiredActor) continue;
    for (const kind of kinds) {
      const m = unit.match(kind.re);
      if (!m || m.index == null) continue;
      return {
        kind,
        actor,
        index: (unitIndex >= 0 ? unitIndex : 0) + m.index,
        match: m[0],
      };
    }
  }
  return null;
}

export function classifySameBeatMicroContinuation(text: string): TaxonomyFlag {
  const evidence = firstMatch(text, SAME_BEAT_RE);
  return { value: Boolean(evidence), evidence };
}

export function classifyLowStakesAmbientCoaction(text: string): TaxonomyFlag {
  const evidence = firstMatch(text, LOW_STAKES_AMBIENT_RE);
  return { value: Boolean(evidence), evidence };
}

export function classifyTrueNewUserActionBeat(text: string): TrueNewUserActionBeatFlag {
  const answer = firstMatch(text, NEW_ANSWER_RE);
  if (answer) {
    return {
      value: true,
      actor: B_LABEL,
      target: "대사/대답",
      action: "새로운 사용자 대사 또는 대답을 확정함",
      passage: answer,
      evidence: answer,
    };
  }
  const choice = firstMatch(text, NEW_CHOICE_RE);
  if (choice) {
    return {
      value: true,
      actor: B_LABEL,
      target: "선택",
      action: "새로운 동의/거절/중요한 선택을 확정함",
      passage: choice,
      evidence: choice,
    };
  }
  const hit = scanActorOwnedHits(text, B_OWNED_NEW_BEATS, "B");
  if (!hit) {
    return {
      value: false,
      actor: null,
      target: null,
      action: null,
      passage: null,
      evidence: null,
    };
  }
  const passage = passageAround(text, hit.index, hit.match.length);
  return {
    value: true,
    actor: B_LABEL,
    target: hit.kind.target,
    action: hit.kind.action,
    passage,
    evidence: passage,
  };
}

export function classifyNewUserActionBeat(text: string): TaxonomyFlag {
  const judged = classifyTrueNewUserActionBeat(text);
  return { value: judged.value, evidence: judged.evidence };
}

export function classifyCurrentUserMajorRewind(text: string): TaxonomyFlag {
  const hallway = firstMatch(text, MAJOR_REWIND_STILL_HALLWAY_RE);
  if (hallway) return { value: true, evidence: hallway };
  const hit = scanActorOwnedHits(text, B_OWNED_REWIND_BEATS, "B");
  if (!hit) return { value: false, evidence: null };
  return {
    value: true,
    evidence: passageAround(text, hit.index, hit.match.length),
  };
}
