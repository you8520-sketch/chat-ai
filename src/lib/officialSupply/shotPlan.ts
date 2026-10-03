import {
  qaResult,
  type OfficialAssetSlotKind,
  type OfficialAssetSlotPlan,
  type QaIssue,
  type QaResult,
} from "@/lib/officialSupply/types";

/**
 * Canonical shot-responsibility owner for official asset sets.
 * Prompt assembly (`imagePrompt.ts`) and plan QA (`assetPlan.ts`) both read
 * this table — slot variety is not left to the planner or style DNA.
 */
export type OfficialFaceDirection = "front" | "left_three_quarter" | "right_three_quarter" | "profile";
export type OfficialCameraAngle = "eye_level" | "high_angle" | "low_angle";
export type OfficialShotDistance = "close_up" | "bust" | "medium" | "knee_or_full";
export type OfficialPoseFamily = "static" | "twist" | "move" | "sit" | "prop";
export type OfficialExpressionFamily =
  | "smile"
  | "alert"
  | "tease"
  | "tense"
  | "flustered"
  | "annoyed"
  | "relief"
  | "serious";
export type OfficialBackgroundRole = "simple" | "environment" | "scene";

export type OfficialSlotShotResponsibility = {
  slotKey: string;
  kind: OfficialAssetSlotKind;
  faceDirection: OfficialFaceDirection;
  cameraAngle: OfficialCameraAngle;
  distance: OfficialShotDistance;
  poseFamily: OfficialPoseFamily;
  expressionFamily: OfficialExpressionFamily;
  background: OfficialBackgroundRole;
};

const FACE_PROMPT: Record<OfficialFaceDirection, string> = {
  front: "face toward camera, near-frontal",
  left_three_quarter: "head turned left three-quarter view",
  right_three_quarter: "head turned right three-quarter view",
  profile: "clear profile / side-face view",
};

const CAMERA_PROMPT: Record<OfficialCameraAngle, string> = {
  eye_level: "eye-level camera",
  high_angle: "high-angle camera looking slightly down",
  low_angle: "low-angle camera looking slightly up",
};

const DISTANCE_PROMPT: Record<OfficialShotDistance, string> = {
  close_up: "close-up (face and shoulders)",
  bust: "bust / upper-body card crop",
  medium: "medium shot (waist-up or mid-thigh)",
  knee_or_full: "knee-up or full-body shot with space around the figure",
};

/** QA lexicon only — paid prompts use slot.pose, not this map. */
export const OFFICIAL_POSE_FAMILY_PROMPT: Record<OfficialPoseFamily, string> = {
  static: "a still, grounded stance",
  twist: "a torso or shoulder twist — not a straight-on mannequin pose",
  move: "a mid-motion or walking beat",
  sit: "a seated or kneeling posture",
  prop: "hands interacting with a character-owned prop or surface",
};

/** QA lexicon only — paid prompts use slot.expression, not this map. */
export const OFFICIAL_EXPRESSION_FAMILY_PROMPT: Record<OfficialExpressionFamily, string> = {
  smile: "a readable smile or warmth",
  alert: "alert / guarded watchfulness",
  tease: "a teasing or provocative glint",
  tense: "tension held in the jaw or eyes",
  flustered: "fluster / hesitation",
  annoyed: "irritation or suppressed anger",
  relief: "relief after strain",
  serious: "serious, unsmiling focus",
};

const BACKGROUND_PROMPT: Record<OfficialBackgroundRole, string> = {
  simple: "simple, uncluttered background — no competing scene",
  environment: "an identifiable environment behind the character (architecture, weather, or workplace cue)",
  scene: "scene-first background: the place and incident must be readable, not a portrait backdrop",
};

/**
 * Fixed 14-slot shot table. Representative stays a card bust; every other slot
 * is a different cut of the same person.
 */
export const OFFICIAL_SLOT_SHOT_PLAN: Readonly<Record<string, OfficialSlotShotResponsibility>> = {
  rep: {
    slotKey: "rep",
    kind: "representative",
    faceDirection: "front",
    cameraAngle: "eye_level",
    distance: "bust",
    poseFamily: "sit",
    expressionFamily: "serious",
    background: "simple",
  },
  sig1: {
    slotKey: "sig1",
    kind: "signature",
    faceDirection: "left_three_quarter",
    cameraAngle: "eye_level",
    distance: "medium",
    poseFamily: "static",
    expressionFamily: "serious",
    background: "simple",
  },
  sig2: {
    slotKey: "sig2",
    kind: "signature",
    faceDirection: "right_three_quarter",
    cameraAngle: "low_angle",
    distance: "knee_or_full",
    poseFamily: "prop",
    expressionFamily: "tense",
    background: "environment",
  },
  sig3: {
    slotKey: "sig3",
    kind: "signature",
    faceDirection: "profile",
    cameraAngle: "high_angle",
    distance: "close_up",
    poseFamily: "twist",
    expressionFamily: "alert",
    background: "simple",
  },
  sig4: {
    slotKey: "sig4",
    kind: "signature",
    faceDirection: "front",
    cameraAngle: "eye_level",
    distance: "knee_or_full",
    poseFamily: "move",
    expressionFamily: "smile",
    background: "environment",
  },
  emo1: {
    slotKey: "emo1",
    kind: "emotion",
    faceDirection: "left_three_quarter",
    cameraAngle: "low_angle",
    distance: "close_up",
    poseFamily: "static",
    expressionFamily: "smile",
    background: "simple",
  },
  emo2: {
    slotKey: "emo2",
    kind: "emotion",
    faceDirection: "right_three_quarter",
    cameraAngle: "high_angle",
    distance: "medium",
    poseFamily: "twist",
    expressionFamily: "alert",
    background: "environment",
  },
  emo3: {
    slotKey: "emo3",
    kind: "emotion",
    faceDirection: "profile",
    cameraAngle: "eye_level",
    distance: "knee_or_full",
    poseFamily: "sit",
    expressionFamily: "serious",
    background: "environment",
  },
  emo4: {
    slotKey: "emo4",
    kind: "emotion",
    faceDirection: "front",
    cameraAngle: "high_angle",
    distance: "close_up",
    poseFamily: "prop",
    expressionFamily: "annoyed",
    background: "simple",
  },
  emo5: {
    slotKey: "emo5",
    kind: "emotion",
    faceDirection: "left_three_quarter",
    cameraAngle: "eye_level",
    distance: "knee_or_full",
    poseFamily: "move",
    expressionFamily: "flustered",
    background: "environment",
  },
  emo6: {
    slotKey: "emo6",
    kind: "emotion",
    faceDirection: "right_three_quarter",
    cameraAngle: "low_angle",
    distance: "medium",
    poseFamily: "sit",
    expressionFamily: "relief",
    background: "simple",
  },
  scene1: {
    slotKey: "scene1",
    kind: "scene",
    faceDirection: "left_three_quarter",
    cameraAngle: "eye_level",
    distance: "medium",
    poseFamily: "prop",
    expressionFamily: "tense",
    background: "scene",
  },
  scene2: {
    slotKey: "scene2",
    kind: "scene",
    faceDirection: "right_three_quarter",
    cameraAngle: "high_angle",
    distance: "knee_or_full",
    poseFamily: "move",
    expressionFamily: "alert",
    background: "scene",
  },
  scene3: {
    slotKey: "scene3",
    kind: "scene",
    faceDirection: "profile",
    cameraAngle: "low_angle",
    distance: "knee_or_full",
    poseFamily: "sit",
    expressionFamily: "tease",
    background: "scene",
  },
};

const KIND_FALLBACK: Record<OfficialAssetSlotKind, OfficialSlotShotResponsibility> = {
  representative: OFFICIAL_SLOT_SHOT_PLAN.rep!,
  signature: OFFICIAL_SLOT_SHOT_PLAN.sig1!,
  emotion: OFFICIAL_SLOT_SHOT_PLAN.emo1!,
  scene: OFFICIAL_SLOT_SHOT_PLAN.scene1!,
};

const KIND_FAMILY_KEYS: Record<OfficialAssetSlotKind, readonly string[]> = {
  representative: ["rep"],
  signature: ["sig1", "sig2", "sig3", "sig4"],
  emotion: ["emo1", "emo2", "emo3", "emo4", "emo5", "emo6"],
  scene: ["scene1", "scene2", "scene3"],
};

const KIND_ROTATE_SALT: Record<OfficialAssetSlotKind, number> = {
  representative: 0,
  signature: 1,
  emotion: 11,
  scene: 23,
};

/** Deterministic FNV-1a seed so the same draft always gets the same rotation. */
export function officialShotSeed(draftKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < draftKey.length; i += 1) {
    hash ^= draftKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotateItems<T>(items: readonly T[], offset: number): T[] {
  const count = items.length;
  if (count === 0) return [];
  const shift = ((offset % count) + count) % count;
  return items.slice(shift).concat(items.slice(0, shift));
}

/**
 * Resolve the shot for a slot. Representative stays the card bust.
 * Signature / emotion / scene families rotate by draftKey so two official
 * characters do not share the same 14-slot storyboard order.
 */
export function resolveOfficialSlotShot(
  slot: Pick<OfficialAssetSlotPlan, "slotKey" | "kind">,
  draftKey = ""
): OfficialSlotShotResponsibility {
  const planned = OFFICIAL_SLOT_SHOT_PLAN[slot.slotKey];
  const base =
    planned && planned.kind === slot.kind
      ? planned
      : { ...KIND_FALLBACK[slot.kind], slotKey: slot.slotKey, kind: slot.kind };
  if (!draftKey || slot.kind === "representative") {
    return { ...base, slotKey: slot.slotKey, kind: slot.kind };
  }
  const familyKeys = KIND_FAMILY_KEYS[slot.kind];
  const familyShots = familyKeys.map((key) => OFFICIAL_SLOT_SHOT_PLAN[key]!);
  const rotated = rotateItems(familyShots, officialShotSeed(draftKey) + KIND_ROTATE_SALT[slot.kind]);
  const index = familyKeys.indexOf(slot.slotKey);
  const picked = index >= 0 ? rotated[index]! : base;
  return { ...picked, slotKey: slot.slotKey, kind: slot.kind };
}

export function officialShotComboKey(shot: OfficialSlotShotResponsibility): string {
  return `${shot.faceDirection}|${shot.distance}|${shot.expressionFamily}`;
}

export function renderOfficialShotResponsibility(shot: OfficialSlotShotResponsibility): string {
  return [
    `SHOT RESPONSIBILITY (${shot.slotKey}/${shot.kind}):`,
    `${FACE_PROMPT[shot.faceDirection]}; ${CAMERA_PROMPT[shot.cameraAngle]}; ${DISTANCE_PROMPT[shot.distance]}.`,
    `Background: ${BACKGROUND_PROMPT[shot.background]}.`,
    "This cut must look different from the other slots in face direction, camera, and framing.",
    "Do not inherit the representative card's camera, head angle, crop, or hand position.",
    "SHOT CHANGE MUST NOT CHANGE IDENTITY: same face structure, hair, eyes, marks, age, and body type as the IDENTITY LOCK.",
  ].join(" ");
}

export function renderOfficialStyleFramingOverride(kind: OfficialAssetSlotKind): string {
  if (kind === "representative") {
    return "ART STYLE describes rendering language, color, and illustration grammar only. Card crop stays with the representative framing lines.";
  }
  return [
    "ART STYLE describes rendering language, color, and illustration grammar only.",
    "Camera, face direction, and crop follow SHOT RESPONSIBILITY — not card bust framing or a face-first 2:3 crop.",
  ].join(" ");
}

const SLOT_ORDER = [
  "rep",
  "sig1",
  "sig2",
  "sig3",
  "sig4",
  "emo1",
  "emo2",
  "emo3",
  "emo4",
  "emo5",
  "emo6",
  "scene1",
  "scene2",
  "scene3",
] as const;

/**
 * Structural diversity QA for a 14-slot set. Responsibilities are resolved
 * from slot keys, so a well-formed official plan inherits the canonical table.
 */
export function evaluateOfficialShotPlan(slots: readonly OfficialAssetSlotPlan[], draftKey = ""): QaResult {
  const errors: QaIssue[] = [];
  const comboCounts = new Map<string, string[]>();
  let bustCount = 0;
  const ordered = SLOT_ORDER.map((key) => slots.find((slot) => slot.slotKey === key)).filter(
    (slot): slot is OfficialAssetSlotPlan => Boolean(slot)
  );

  for (const slot of slots) {
    const shot = resolveOfficialSlotShot(slot, draftKey);
    if (slot.kind === "scene" && shot.background !== "scene") {
      errors.push({
        code: "scene_shot_not_scenic",
        message: `${slot.slotKey}: scene slots must use scene-centric background responsibility`,
      });
    }
    if (shot.distance === "bust") bustCount += 1;
    const combo = officialShotComboKey(shot);
    const holders = comboCounts.get(combo) ?? [];
    holders.push(slot.slotKey);
    comboCounts.set(combo, holders);
  }

  for (const [combo, holders] of comboCounts) {
    if (holders.length > 2) {
      errors.push({
        code: "shot_combo_repeat",
        message: `similar face+framing+expression combo "${combo}" used ${holders.length} times (${holders.join(", ")})`,
      });
    }
  }
  if (bustCount > 2) {
    errors.push({
      code: "bust_shot_overuse",
      message: `bust-shot count ${bustCount} exceeds 2 (representative plus at most one more)`,
    });
  }
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = resolveOfficialSlotShot(ordered[i - 1]!, draftKey);
    const next = resolveOfficialSlotShot(ordered[i]!, draftKey);
    if (prev.distance === "bust" && next.distance === "bust") {
      errors.push({
        code: "bust_shot_consecutive",
        message: `${ordered[i - 1]!.slotKey} and ${ordered[i]!.slotKey} are consecutive bust shots`,
      });
    }
  }
  return qaResult(errors);
}
