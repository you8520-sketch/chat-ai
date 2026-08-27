/**
 * Canonical general-chat multi-cast server owner.
 * Grounds client cast intent against server context and builds prompt blocks.
 */

import {
  CHAT_IMAGE_CAST_FOUR_PLUS_WARNING,
  CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP,
  CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP,
  CHAT_IMAGE_CAST_MAX_SELECTED_ERROR,
  CHAT_IMAGE_CAST_MIN_SELECTED_ERROR,
  resolveChatImageCastPolicy,
  validateCastMentions,
  type ChatImageCastCompositionGoal,
  type ChatImageCastImportance,
  type ChatImageCastIntentManifest,
  type ChatImageCastIntentSubject,
  type ChatImageCastRole,
  type ChatImageCastVisibility,
  type SceneCastMention,
  type SceneEventSubjectBinding,
  type SelectableCastAsset,
  normalizeCastPrimaryCap,
  parseCastIntentManifest,
  resolveCastCompositionGoal,
  selectedCastIntentSubjects,
  castNeedsFourPlusWarning,
} from "@/lib/chatImageCast";
import type { ContentKind } from "@/lib/simulationMode";
import type { CharacterAsset } from "@/lib/characterAssets";
import {
  resolveSimulationMemberVisualMetadata,
  resolveVisualSubjectByName,
  type SimulationVisualSubject,
} from "@/lib/simulationVisualSubjects";
import {
  buildImageGenderLockPrompt,
  type ImagePromptGender,
} from "@/lib/chatImageGeneration";
import type { ScenePlan } from "@/lib/chatImageScenePlan";
import {
  bindChatImageReferencePack,
  renderChatImageVisualIdentity,
  type ChatImageAppearanceMode,
  type ChatImageTemplateSlot,
  type ChatImageVisualSourceKind,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";

export {
  CHAT_IMAGE_CAST_FOUR_PLUS_WARNING,
  CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP,
  castNeedsFourPlusWarning,
  normalizeCastPrimaryCap,
  resolveCastCompositionGoal,
  selectedCastIntentSubjects,
} from "@/lib/chatImageCast";
export type {
  ChatImageCastCompositionGoal,
  ChatImageCastImportance,
  ChatImageCastIntentManifest,
  ChatImageCastIntentSubject,
  ChatImageCastRole,
  ChatImageCastVisibility,
  SceneCastMention,
  SceneEventSubjectBinding,
  SelectableCastAsset,
} from "@/lib/chatImageCast";

export type ChatImageCastGroundedSubject = {
  key: string;
  role: ChatImageCastRole;
  name: string;
  gender: ImagePromptGender;
  referenceImageUrl?: string;
  savedAppearance?: string;
  appearanceMode: ChatImageAppearanceMode;
  importance: ChatImageCastImportance;
  visibility: ChatImageCastVisibility;
  sourceKind: ChatImageVisualSourceKind;
  included: boolean;
};

export type ChatImageCastGroundedManifest = {
  compositionGoal: ChatImageCastCompositionGoal;
  subjects: ChatImageCastGroundedSubject[];
  eventSubjectBindings: SceneEventSubjectBinding[];
};

export type GroundCastContext = {
  persona: {
    name: string;
    gender: ImagePromptGender;
    referenceImageUrl?: string | null;
    savedAppearance?: string | null;
    appearanceMode?: ChatImageAppearanceMode;
  };
  mainCharacter: {
    name: string;
    gender: ImagePromptGender;
    referenceImageUrl?: string | null;
    savedAppearance?: string | null;
    appearanceMode?: ChatImageAppearanceMode;
  };
  selectableAssets: readonly SelectableCastAsset[];
  simulationVisualSubjects?: readonly SimulationVisualSubject[];
  characterAssets?: readonly CharacterAsset[];
};

const CORE_CAST_KEYS = new Set(["persona", "main_character"]);

export function hasBoundIdentityEvidence(
  visual: ChatImageVisualSubject
): boolean {
  if (visual.referenceIndex != null) return true;
  if (
    visual.sourceKind !== "cast_member" &&
    String(visual.savedAppearance ?? "").trim()
  ) {
    return true;
  }
  return false;
}

export function validateUniqueCastReferenceOwnership(
  subjects: readonly ChatImageCastGroundedSubject[]
): { ok: true } | { ok: false; reason: string } {
  const urlToKey = new Map<string, string>();
  for (const subject of subjects) {
    if (!subject.included) continue;
    const url = cleanUrl(subject.referenceImageUrl);
    if (!url) continue;
    if (urlToKey.has(url)) {
      return {
        ok: false,
        reason: "같은 참고 이미지를 여러 인물에 동시에 사용할 수 없습니다.",
      };
    }
    urlToKey.set(url, subject.key);
  }
  return { ok: true };
}

export function normalizeCastIntentCore(
  intent: ChatImageCastIntentManifest,
  contentKind: ContentKind = "character"
): { ok: true; intent: ChatImageCastIntentManifest } | { ok: false; reason: string } {
  const policy = resolveChatImageCastPolicy(contentKind);
  const keys = new Set<string>();
  let personaCount = 0;
  let mainCount = 0;

  for (const subject of intent.subjects) {
    if (keys.has(subject.key)) {
      return { ok: false, reason: "duplicate cast key" };
    }
    keys.add(subject.key);
    if (
      (subject.key === "persona" && subject.role !== "persona") ||
      (subject.key === "main_character" && subject.role !== "main_character")
    ) {
      return { ok: false, reason: "cast key conflicts with core role" };
    }
    if (
      CORE_CAST_KEYS.has(subject.key) &&
      subject.role === "supporting_character"
    ) {
      return { ok: false, reason: "cast key conflicts with core role" };
    }
    if (subject.role === "persona") personaCount += 1;
    if (subject.role === "main_character") mainCount += 1;
  }

  if (contentKind === "simulation" && mainCount > 0) {
    return { ok: false, reason: "simulation cast cannot include main character" };
  }

  if (policy.requireMainCharacter) {
    if (personaCount !== 1) {
      return {
        ok: false,
        reason: personaCount === 0 ? "persona missing" : "duplicate persona role",
      };
    }
    if (mainCount !== 1) {
      return {
        ok: false,
        reason:
          mainCount === 0 ? "main character missing" : "duplicate main character role",
      };
    }
  } else if (personaCount > 1) {
    return { ok: false, reason: "duplicate persona role" };
  }

  const normalizedSubjects = intent.subjects.map((subject) => {
    if (subject.role === "persona" && !policy.personaOptional) {
      return {
        ...subject,
        key: "persona",
        included: true,
        importance: "primary" as const,
        visibility: "required_visible" as const,
      };
    }
    if (subject.role === "main_character" && policy.requireMainCharacter) {
      return {
        ...subject,
        key: "main_character",
        included: true,
        importance: "primary" as const,
        visibility: "required_visible" as const,
      };
    }
    return subject;
  });

  const selectedCount = normalizedSubjects.filter(
    (subject) => subject.included && cleanText(subject.name)
  ).length;

  if (selectedCount < policy.minSelected) {
    return { ok: false, reason: CHAT_IMAGE_CAST_MIN_SELECTED_ERROR };
  }
  if (selectedCount > policy.maxSelected) {
    return { ok: false, reason: CHAT_IMAGE_CAST_MAX_SELECTED_ERROR };
  }

  let supportingPrimaryCount = 0;
  const cappedSubjects =
    selectedCount >= 4
      ? normalizedSubjects.map((subject) => {
          if (subject.role !== "supporting_character" || !subject.included) {
            return subject;
          }
          if (subject.importance !== "primary") return subject;
          supportingPrimaryCount += 1;
          if (contentKind === "simulation" || supportingPrimaryCount <= 1) return subject;
          return { ...subject, importance: "secondary" as const };
        })
      : normalizedSubjects;

  return {
    ok: true,
    intent: {
      compositionGoal: resolveCastCompositionGoal({
        compositionGoal: "auto",
        subjects: cappedSubjects,
      }),
      subjects: cappedSubjects,
    },
  };
}

function canonicalCastSelectionOrder(
  subjects: readonly ChatImageCastGroundedSubject[],
  contentKind: ContentKind = "character"
): ChatImageCastGroundedSubject[] {
  const included = subjects.filter((subject) => subject.included && subject.name);
  if (contentKind === "simulation") {
    const persona = included.find((subject) => subject.role === "persona");
    const members = included
      .filter((subject) => subject.role === "supporting_character")
      .sort(
        (left, right) => IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]
      );
    return [persona, ...members].filter(
      (subject): subject is ChatImageCastGroundedSubject => Boolean(subject)
    );
  }
  const persona = included.find((subject) => subject.role === "persona");
  const main = included.find((subject) => subject.role === "main_character");
  const supporting = included
    .filter((subject) => subject.role === "supporting_character")
    .sort((left, right) => IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]);
  return [persona, main, ...supporting].filter(
    (subject): subject is ChatImageCastGroundedSubject => Boolean(subject)
  );
}

function resolveReferenceAttachment(
  subject: ChatImageCastGroundedSubject,
  selectedCount: number,
  identityRefsUsed: number,
  contentKind: ContentKind = "character"
): { attach: boolean; nextRefsUsed: number } {
  const url = cleanUrl(subject.referenceImageUrl);
  if (!url) return { attach: false, nextRefsUsed: identityRefsUsed };
  if (contentKind === "character") {
    const isCore = subject.role === "persona" || subject.role === "main_character";
    if (isCore) {
      return { attach: true, nextRefsUsed: identityRefsUsed + 1 };
    }
  }
  if (subject.importance === "background") {
    return { attach: false, nextRefsUsed: identityRefsUsed };
  }
  if (identityRefsUsed >= CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP) {
    return { attach: false, nextRefsUsed: identityRefsUsed };
  }
  return { attach: true, nextRefsUsed: identityRefsUsed + 1 };
}

const IMPORTANCE_RANK: Record<ChatImageCastImportance, number> = {
  primary: 0,
  secondary: 1,
  background: 2,
};

function cleanText(raw: unknown, max = 48): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanUrl(raw: unknown): string {
  return String(raw ?? "").trim();
}

function sourceKindForRole(role: ChatImageCastRole): ChatImageVisualSourceKind {
  if (role === "persona") return "persona";
  if (role === "main_character") return "main_character";
  return "cast_member";
}

function visualRole(role: ChatImageCastRole): string {
  if (role === "persona") return "user persona";
  if (role === "main_character") return "chat character";
  return "supporting character";
}

function whitelistAssetUrl(
  requested: string | undefined,
  assets: readonly SelectableCastAsset[]
): string | undefined {
  const url = cleanUrl(requested);
  if (!url) return undefined;
  return assets.some((asset) => asset.url === url) ? url : undefined;
}

export { validateCastMentions } from "@/lib/chatImageCast";

function groundedCoreSubject(
  intent: ChatImageCastIntentSubject,
  ctx: GroundCastContext,
  contentKind: ContentKind = "character"
): ChatImageCastGroundedSubject {
  if (intent.role === "persona") {
    const savedAppearance = String(ctx.persona.savedAppearance ?? "").trim() || undefined;
    return {
      key: "persona",
      role: "persona",
      name: cleanText(ctx.persona.name) || intent.name,
      gender: ctx.persona.gender,
      referenceImageUrl: cleanUrl(ctx.persona.referenceImageUrl) || undefined,
      savedAppearance,
      appearanceMode: ctx.persona.appearanceMode ?? (savedAppearance ? "image_plus_saved" : "image_only"),
      importance: "primary",
      visibility: "required_visible",
      sourceKind: "persona",
      included: contentKind === "simulation" ? intent.included : true,
    };
  }
  if (intent.role === "main_character") {
    const savedAppearance = String(ctx.mainCharacter.savedAppearance ?? "").trim() || undefined;
    return {
      key: "main_character",
      role: "main_character",
      name: cleanText(ctx.mainCharacter.name) || intent.name,
      gender: ctx.mainCharacter.gender,
      referenceImageUrl: cleanUrl(ctx.mainCharacter.referenceImageUrl) || undefined,
      savedAppearance,
      appearanceMode:
        ctx.mainCharacter.appearanceMode ?? (savedAppearance ? "image_plus_saved" : "image_only"),
      importance: "primary",
      visibility: "required_visible",
      sourceKind: "main_character",
      included: true,
    };
  }
  const trustedUrl = whitelistAssetUrl(intent.requestedReferenceAssetUrl, ctx.selectableAssets);
  const visualSubject =
    contentKind === "simulation"
      ? resolveVisualSubjectByName(ctx.simulationVisualSubjects ?? [], intent.name)
      : null;
  const visualMeta =
    contentKind === "simulation" && visualSubject
      ? resolveSimulationMemberVisualMetadata({
          memberName: intent.name,
          castSubjectKey: intent.key,
          visualSubjects: ctx.simulationVisualSubjects ?? [],
          assets: ctx.characterAssets ?? [],
        })
      : { appearanceMode: "image_only" as const, savedAppearance: undefined };
  return {
    key: intent.key,
    role: "supporting_character",
    name: intent.name,
    gender: "other",
    referenceImageUrl: trustedUrl,
    savedAppearance: visualMeta.savedAppearance,
    appearanceMode: visualMeta.appearanceMode,
    importance: intent.importance,
    visibility: intent.visibility,
    sourceKind: "cast_member",
    included: intent.included,
  };
}

export type GroundCastResult =
  | { ok: true; manifest: ChatImageCastGroundedManifest }
  | { ok: false; reason: string };

export function buildEventBindingsFromCastMentions(
  plan: ScenePlan,
  intent: ChatImageCastIntentManifest
): SceneEventSubjectBinding[] {
  const supportingByName = new Map(
    intent.subjects
      .filter((subject) => subject.role === "supporting_character" && subject.included)
      .map((subject) => [cleanText(subject.name), subject.key])
  );
  const fromMentions: SceneEventSubjectBinding[] = [];
  for (const mention of plan.castMentions ?? []) {
    const key = supportingByName.get(cleanText(mention.name));
    if (!key) continue;
    for (const eventId of mention.actorEventIds ?? []) {
      fromMentions.push({ eventId, subjectKey: key });
    }
  }
  const personaIncluded = intent.subjects.some(
    (subject) => subject.role === "persona" && subject.included
  );
  return mergeCastBindingsWithPersona(plan, fromMentions, { personaIncluded });
}

export function prepareCastIntentForGrounding(
  intent: ChatImageCastIntentManifest,
  contentKind: ContentKind = "character"
): ChatImageCastIntentManifest {
  const normalized = normalizeCastIntentCore(intent, contentKind);
  if (!normalized.ok) {
    throw new Error(normalized.reason);
  }
  return normalized.intent;
}

export function resolveCastEventBindings(
  intent: ChatImageCastIntentManifest,
  plan?: ScenePlan
): SceneEventSubjectBinding[] {
  if (!plan) return [];
  return buildEventBindingsFromCastMentions(plan, intent);
}

export function groundCastIntent(
  intent: ChatImageCastIntentManifest,
  ctx: GroundCastContext,
  plan?: ScenePlan,
  contentKind: ContentKind = "character"
): GroundCastResult {
  const core = normalizeCastIntentCore(intent, contentKind);
  if (!core.ok) return core;
  const normalized = core.intent;
  const subjects = normalized.subjects.map((subject) =>
    groundedCoreSubject(subject, ctx, contentKind)
  );

  for (const intentSubject of normalized.subjects) {
    if (!intentSubject.included || intentSubject.role !== "supporting_character") continue;
    const requested = cleanUrl(intentSubject.requestedReferenceAssetUrl);
    if (requested && !whitelistAssetUrl(requested, ctx.selectableAssets)) {
      return {
        ok: false,
        reason: "선택한 참고 에셋을 사용할 수 없습니다.",
      };
    }
    if (contentKind === "simulation" && requested) {
      const visualSubject = resolveVisualSubjectByName(
        ctx.simulationVisualSubjects ?? [],
        intentSubject.name
      );
      const asset = ctx.characterAssets?.find((row) => row.url === requested);
      const ownerKey = asset?.visualSubjectKey?.trim();
      if (ownerKey) {
        if (!visualSubject || ownerKey !== visualSubject.subjectKey) {
          return {
            ok: false,
            reason: "다른 인물에 연결된 이미지는 해당 인물 reference로 사용할 수 없습니다.",
          };
        }
      }
    }
  }

  for (const subject of subjects) {
    if (!subject.included || subject.role !== "supporting_character") continue;
    if (subject.importance !== "primary" && subject.importance !== "secondary") continue;
    const requested = normalized.subjects.find((row) => row.key === subject.key)
      ?.requestedReferenceAssetUrl;
    if (requested && !subject.referenceImageUrl) {
      return {
        ok: false,
        reason: "핵심 조연은 참고 에셋을 선택해 주세요.",
      };
    }
    if (
      subject.importance === "primary" &&
      subject.visibility === "required_visible" &&
      !subject.referenceImageUrl
    ) {
      return {
        ok: false,
        reason: "핵심 조연은 참고 에셋을 선택해 주세요.",
      };
    }
  }

  const bindings = validateEventSubjectBindings(
    resolveCastEventBindings(normalized, plan),
    plan,
    subjects
  );
  if (!bindings.ok) return bindings;

  const uniqueRefs = validateUniqueCastReferenceOwnership(subjects);
  if (!uniqueRefs.ok) return uniqueRefs;

  return {
    ok: true,
    manifest: {
      compositionGoal: normalized.compositionGoal,
      subjects,
      eventSubjectBindings: bindings.bindings,
    },
  };
}

export function validateEventSubjectBindings(
  bindings: readonly SceneEventSubjectBinding[],
  plan: ScenePlan | undefined,
  subjects: readonly ChatImageCastGroundedSubject[]
): { ok: true; bindings: SceneEventSubjectBinding[] } | { ok: false; reason: string } {
  if (!bindings.length) return { ok: true, bindings: [] };
  if (!plan) return { ok: false, reason: "event binding requires scene plan" };
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  const includedKeys = new Set(
    subjects.filter((subject) => subject.included).map((subject) => subject.key)
  );
  const personaKey =
    subjects.find((subject) => subject.role === "persona")?.key ?? "persona";
  const validated: SceneEventSubjectBinding[] = [];
  for (const binding of bindings) {
    const event = eventsById.get(binding.eventId);
    if (!event) return { ok: false, reason: "event binding invalid" };
    if (!includedKeys.has(binding.subjectKey)) {
      return { ok: false, reason: "event binding excluded subject" };
    }
    if (event.sourceRole === "user" && event.actor === "persona") {
      validated.push({ eventId: binding.eventId, subjectKey: personaKey });
      continue;
    }
    validated.push(binding);
  }
  return { ok: true, bindings: validated };
}

function castSubjectFidelityLine(
  castSubject: ChatImageCastGroundedSubject,
  visual: ChatImageVisualSubject | undefined,
  selectedCount: number
): string {
  const name = castSubject.name;
  const hasEvidence = visual ? hasBoundIdentityEvidence(visual) : false;
  if (!hasEvidence) {
    return `- ${name}: BACKGROUND / CAMEO. No bound identity evidence. Presence is allowed, but exact face/hair/eye/outfit fidelity is not guaranteed. Never borrow another subject's reference. Visibility: ${castSubject.visibility}.`;
  }
  if (visual?.referenceIndex != null) {
    if (selectedCount >= 4) {
      if (
        castSubject.role === "persona" ||
        castSubject.role === "main_character" ||
        castSubject.importance === "primary"
      ) {
        return `- ${name}: HIGH FIDELITY primary. Strongly preserve face, hair, eyes, iris/pupil, and outfit. Visibility: ${castSubject.visibility}.`;
      }
      if (castSubject.importance === "secondary") {
        return `- ${name}: SECONDARY. Recognizable but may be smaller. Do not steal another subject's traits. Visibility: ${castSubject.visibility}.`;
      }
      return `- ${name}: BACKGROUND / CAMEO. No bound identity evidence. Presence is allowed, but exact face/hair/eye/outfit fidelity is not guaranteed. Never borrow another subject's reference. Visibility: ${castSubject.visibility}.`;
    }
    return `- ${name}: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: ${castSubject.visibility}.`;
  }
  return `- ${name}: Saved appearance only; no photo attached. Preserve face, hair, eyes, and outfit from saved appearance text. Visibility: ${castSubject.visibility}.`;
}

function castSubjectImageLine(
  castSubject: ChatImageCastGroundedSubject,
  visual: ChatImageVisualSubject | undefined
): string {
  if (visual?.referenceIndex != null) {
    return `Image ${visual.referenceIndex} belongs ONLY to ${castSubject.name}`;
  }
  if (visual && hasBoundIdentityEvidence(visual)) {
    return "Saved appearance only; no photo attached. Do not borrow another subject's picture.";
  }
  return "No bound identity reference. Exact visual identity is not guaranteed. Do not borrow another subject's picture.";
}

function castSubjectToVisual(subject: ChatImageCastGroundedSubject): ChatImageVisualSubject {
  const ownAppearance = String(subject.savedAppearance ?? "").trim();
  return {
    key: subject.key,
    role: visualRole(subject.role),
    name: subject.name,
    gender: subject.gender,
    referenceIndex: null,
    referenceImageUrl: cleanUrl(subject.referenceImageUrl) || null,
    appearanceMode: subject.appearanceMode,
    savedAppearance: ownAppearance || undefined,
    sourceKind: subject.sourceKind,
  };
}

export function bindApprovedCastManifest(
  manifest: ChatImageCastGroundedManifest,
  opts?: { template?: ChatImageTemplateSlot | null; contentKind?: ContentKind }
): {
  subjects: ChatImageVisualSubject[];
  referenceUrls: string[];
  selected: ChatImageCastGroundedSubject[];
} {
  const contentKind = opts?.contentKind ?? "character";
  const selected = canonicalCastSelectionOrder(manifest.subjects, contentKind);
  const selectedCount = selected.length;

  let identityRefsUsed = 0;
  const visualInput = selected.map((subject) => {
    const { attach, nextRefsUsed } = resolveReferenceAttachment(
      subject,
      selectedCount,
      identityRefsUsed,
      contentKind
    );
    identityRefsUsed = nextRefsUsed;
    const nextSubject = attach
      ? subject
      : { ...subject, referenceImageUrl: undefined };
    return castSubjectToVisual(nextSubject);
  });

  const pack = bindChatImageReferencePack({
    template: opts?.template,
    subjectsInImageOrder: visualInput,
  });

  return {
    subjects: pack.subjects,
    referenceUrls: pack.referenceUrls,
    selected,
  };
}

export function renderCastFidelityTiers(
  selected: readonly ChatImageCastGroundedSubject[],
  visualSubjects: readonly ChatImageVisualSubject[]
): string {
  const count = selected.length;
  const visualByKey = new Map(visualSubjects.map((subject) => [subject.key, subject]));
  const lines = selected.map((subject) =>
    castSubjectFidelityLine(subject, visualByKey.get(subject.key), count)
  );
  return [
    "CAST FIDELITY TIERS — do not promise equal detail for every person.",
    count >= 4
      ? `Four or more people: guarantee exact identity for at most ${CHAT_IMAGE_CAST_HIGH_FIDELITY_CAP} subjects with bound identity evidence.`
      : "Subjects with bound identity evidence must stay visually distinct.",
    ...lines,
  ].join("\n");
}

export function renderCastCompositionGoal(
  goal: Exclude<ChatImageCastCompositionGoal, "auto">,
  count: number
): string {
  switch (goal) {
    case "solo":
      return "COMPOSITION GOAL: solo. Keep exactly one selected person centered and readable.";
    case "duo_focus":
      return "COMPOSITION GOAL: duo_focus. Keep the two selected people centered and large. Do not add unnamed extras.";
    case "trio_group":
      return "COMPOSITION GOAL: trio_group. Arrange three distinct people in a stable left / center / right or triangle group shot. Minimize face occlusion. Every listed face must stay readable.";
    case "ensemble_scene":
      return count >= 4
        ? "COMPOSITION GOAL: ensemble_scene. Keep all four selected people visible in one coherent group frame. Do not add unnamed extras."
        : "COMPOSITION GOAL: ensemble_scene. Keep the named people clearly separated in one coherent group frame.";
    default: {
      const exhaustive: never = goal;
      throw new Error(`Unhandled cast composition goal: ${String(exhaustive)}`);
    }
  }
}

export function renderEventSubjectBindings(
  bindings: readonly SceneEventSubjectBinding[],
  plan: ScenePlan,
  selected: readonly ChatImageCastGroundedSubject[]
): string {
  if (!bindings.length) return "";
  const subjectByKey = new Map(selected.map((subject) => [subject.key, subject]));
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  const lines = bindings
    .map((binding) => {
      const event = eventsById.get(binding.eventId);
      const subject = subjectByKey.get(binding.subjectKey);
      if (!event || !subject) return null;
      return `- ${binding.eventId} (${event.kind}: ${event.text}) → ${subject.name} (${subject.key})`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return ["EVENT SUBJECT BINDINGS", ...lines].join("\n");
}

export function renderApprovedCastManifest(opts: {
  manifest: ChatImageCastGroundedManifest;
  selected: readonly ChatImageCastGroundedSubject[];
  subjects: readonly ChatImageVisualSubject[];
  plan?: ScenePlan;
  contentKind?: ContentKind;
}): string {
  const goal = resolveCastCompositionGoal({
    compositionGoal: "auto",
    subjects: opts.selected.map((subject) => ({
      key: subject.key,
      role: subject.role,
      name: subject.name,
      included: subject.included,
      importance: subject.importance,
      visibility: subject.visibility,
    })),
  });
  const subjectByKey = new Map(opts.subjects.map((subject) => [subject.key, subject]));
  const countLine =
    opts.selected.length === 1
      ? "Exactly 1 recurring identity. No extra person."
      : `Exactly ${opts.selected.length} recurring identities. Do not add unnamed extras.`;
  const blocks = [
    "APPROVED CAST MANIFEST",
    countLine,
    ...opts.selected.map((castSubject, index) => {
      const visual = subjectByKey.get(castSubject.key) ?? opts.subjects[index];
      const image = castSubjectImageLine(castSubject, visual);
      return [
        `${index + 1}. ${castSubject.name} (${visualRole(castSubject.role)})`,
        `importance=${castSubject.importance}; visibility=${castSubject.visibility}`,
        image,
      ].join(" | ");
    }),
    renderCastFidelityTiers(opts.selected, opts.subjects),
    renderCastCompositionGoal(goal, opts.selected.length),
    opts.contentKind === "simulation"
      ? "Never copy one simulation member's hair, eyes, outfit, or face onto another person."
      : "Never copy the main character's hair, eyes, outfit, or face onto a supporting person.",
    "Never map a no-photo subject onto another subject's reference image.",
  ];
  if (opts.plan) {
    const bindingBlock = renderEventSubjectBindings(
      opts.manifest.eventSubjectBindings,
      opts.plan,
      opts.selected
    );
    if (bindingBlock) blocks.push(bindingBlock);
  }
  return blocks.join("\n");
}

export function renderCastGenderLock(
  subjects: readonly ChatImageVisualSubject[]
): string {
  return buildImageGenderLockPrompt(
    subjects.map((subject) => ({
      label: subject.role,
      name: subject.name,
      gender: subject.gender,
    }))
  );
}

export function buildDeterministicPersonaBindings(
  plan: ScenePlan,
  opts?: { personaIncluded?: boolean }
): SceneEventSubjectBinding[] {
  if (opts?.personaIncluded === false) return [];
  const personaKey = "persona";
  return plan.events
    .filter((event) => event.sourceRole === "user")
    .map((event) => ({ eventId: event.id, subjectKey: personaKey }));
}

export function mergeCastBindingsWithPersona(
  plan: ScenePlan,
  bindings: readonly SceneEventSubjectBinding[],
  opts?: { personaIncluded?: boolean }
): SceneEventSubjectBinding[] {
  const deterministic = buildDeterministicPersonaBindings(plan, opts);
  const byEvent = new Map<string, SceneEventSubjectBinding>();
  for (const binding of bindings) byEvent.set(binding.eventId, binding);
  for (const binding of deterministic) byEvent.set(binding.eventId, binding);
  return [...byEvent.values()];
}

export function parseChatImageCastManifest(
  raw: unknown,
  contentKind: ContentKind = "character"
): ChatImageCastIntentManifest | null {
  return parseCastIntentManifest(raw, contentKind);
}
