import type { SceneEventSubjectBinding } from "@/lib/chatImageCast";
import type { ChatImageCastGroundedSubject } from "@/lib/chatImageCastManifest";
import type { ScenePanelCount, ScenePlan, ScenePresentationVisibility, SceneDialogue } from "@/lib/chatImageScenePlan";
import {
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  projectComicPanelBeat,
  projectComicSharedContext,
  type ProjectedComicPanelBeat,
} from "@/lib/chatImageScenePlan";
import {
  buildCastFromPromptSubjects,
  buildPromptSubjectMap,
  resolveDialogueSpeakerSubject,
  resolveDialogueSpeakerSide,
  resolveLayoutFromSubjectMap,
  resolveSpeakerSubject,
  type ComicSubjectSide,
  type PromptSubjectLabel,
  type PromptSubjectMap,
} from "@/lib/chatImagePromptSubjectMap";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";
import { classifyRawVisualRisk } from "@/lib/chatImageSafeVisualProjection";
import { extractPanelSfxCue } from "@/lib/chatComicTextOverlay";

export type ComicPanelFormatId = "2panel" | "3koma" | "4panel";
export type ChatComicCompositionMode =
  | "full_provider_rendered"
  | "overlay_first"
  | "blank_balloon_hybrid";

export type ComicBalloonSlotMetadata = {
  /** Ordinal within the panel's canonical dialogue rows — non-readable structural metadata. */
  dialogueIndex: number;
  speakerLabel: PromptSubjectLabel | "other";
  lengthClass: "short" | "medium" | "long";
  preferredSide: "left" | "center" | "right";
};

export type ComicDialogueDirective = ComicBalloonSlotMetadata;

export type ComicCastRoleLabel = {
  label: PromptSubjectLabel;
  role: string;
  name: string;
};

export type ComicPanelSpecBeat = {
  index: number;
  beatRole: string;
  camera: string;
  framing: string;
  layout: string;
  situation: string;
  background: string;
  subjectActions: Array<{ label: PromptSubjectLabel; name: string; text: string }>;
  sceneAction?: string;
  speechBubbles: Array<{ speakerLabel: PromptSubjectLabel | "other"; speaker: string; text: string }>;
  dialogueDirectives: ComicDialogueDirective[];
  narrationBoxNeeded: boolean;
  sfx: readonly string[];
  mustAvoid: readonly string[];
};

export type ChatComicPanelSpec = {
  format: ComicPanelFormatId;
  panelCount: ScenePanelCount;
  layout: string;
  heroScene: string;
  heroEventIds: readonly string[];
  sharedBackground: string;
  atmosphere?: string;
  cast: readonly ComicCastRoleLabel[];
  continuityRules: readonly string[];
  globalMustAvoid: readonly string[];
  panels: readonly ComicPanelSpecBeat[];
  subjectMap: PromptSubjectMap;
};

/** Image-generation-only projection hooks — canonical ScenePlan is never mutated. */
export type ChatComicPanelSpecProjection = {
  projectSceneText?: (text: string) => string;
  omitDialogueText?: (text: string) => boolean;
};

function applyPanelSpecTextProjection(
  text: string,
  projection?: ChatComicPanelSpecProjection
): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  return projection?.projectSceneText ? projection.projectSceneText(raw) : raw;
}

function resolveGlobalMustAvoid(castCount: number): readonly string[] {
  const identityRule =
    castCount >= 3
      ? "identity swaps between A, B, C, or D"
      : castCount === 1
        ? "identity swap for the visible recurring character"
        : "identity swaps between A and B";
  return [
    "invented dialogue or narration",
    "sound effects or onomatopoeia text",
    "extra unnamed characters",
    identityRule,
    "cropped panel borders or speech bubbles",
  ];
}

export function resolveComicPanelFormat(panelCount: ScenePanelCount): ComicPanelFormatId {
  if (panelCount === 2) return "2panel";
  if (panelCount === 3) return "3koma";
  return "4panel";
}

export function resolveExpectedPanelProgression(panelCount: ScenePanelCount): string[] {
  const format = resolveComicPanelFormat(panelCount);
  return Array.from({ length: panelCount }, (_, index) =>
    resolveBeatRole(format, index + 1, panelCount)
  );
}

function resolveBeatRole(_format: ComicPanelFormatId, index: number, total: number): string {
  if (total === 2) {
    return index === 1 ? "Opening beat" : "Closing beat";
  }
  if (total === 3) {
    if (index === 1) return "Opening beat";
    if (index === 2) return "Middle beat";
    return "Closing beat";
  }
  if (total === 4) {
    if (index === 1) return "Setup";
    if (index === 2) return "Progression";
    if (index === 3) return "Turn / escalation";
    return "Payoff / aftermath";
  }
  if (index === 1) return "Opening beat";
  if (index === total) return "Closing beat";
  return `Beat ${index}`;
}

function resolveCameraFromBeat(
  beat: ProjectedComicPanelBeat,
  index: number,
  total: number
): string {
  if (total === 4) {
    if (index === 1) return "establish the setup beat with readable staging and location";
    if (index === 2) return "show progression — a new action or reaction that advances the scene";
    if (index === 3) return "frame the turn or escalation — heightened emotion or shifted dynamic";
    return "close with payoff or aftermath — a distinct final beat, not a repeat of panel 3";
  }
  if (index === 1) {
    return "establish the scripted opening beat in one readable frame";
  }
  if (index === total) {
    return "frame the closing scripted beat clearly";
  }
  return "continue the scripted beat with clear character staging";
}

function resolveFramingFromBeat(_beat: ProjectedComicPanelBeat): string {
  return "recurring characters readable in frame";
}

function resolveContinuityRules(
  format: ComicPanelFormatId,
  castCount: number,
  subjectMap: PromptSubjectMap,
  personaVisible: boolean
): string[] {
  const visibleLabels = buildCastFromPromptSubjects(subjectMap, personaVisible)
    .map((entry) => entry.label)
    .join(", ");
  const identityRule =
    castCount >= 3
      ? `Keep all ${castCount} recurring identities distinct (${visibleLabels}) — hair, outfit, and face must not swap.`
      : castCount === 1
        ? "Keep the visible recurring identity consistent throughout."
        : `Keep ${visibleLabels} as the same identities throughout — hair, outfit, and face must not swap.`;
  const shared = [
    identityRule,
    "Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.",
    "Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.",
  ];
  if (format === "3koma") {
    return [
      ...shared,
      "3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.",
    ];
  }
  if (format === "4panel") {
    return [
      ...shared,
      "4-panel rhythm: setup (panel 1) → progression (panel 2) → turn/escalation (panel 3) → payoff/aftermath (panel 4) — each panel covers a distinct scripted moment.",
    ];
  }
  return [...shared, "2-panel rhythm: opening beat in panel 1, closing beat in panel 2."];
}

function resolveSpeakerLabel(
  subjectMap: PromptSubjectMap,
  line: Pick<SceneDialogue, "speaker" | "speakerName">
): PromptSubjectLabel | "other" {
  const subject = resolveDialogueSpeakerSubject(subjectMap, line);
  if (subject) return subject.label;
  if (line.speaker === "persona" || line.speaker === "character") {
    return resolveSpeakerSubject(subjectMap, line.speaker)?.label ?? "other";
  }
  return "other";
}

function resolveDialogueLengthClass(text: string): ComicDialogueDirective["lengthClass"] {
  const length = text.trim().length;
  if (length <= 12) return "short";
  if (length <= 38) return "medium";
  return "long";
}

function resolvePreferredBalloonSide(
  side: ComicSubjectSide
): ComicDialogueDirective["preferredSide"] {
  return side === "left" || side === "right" || side === "center" ? side : "center";
}

function resolveGroundedSubjectActions(
  beat: ProjectedComicPanelBeat,
  subjectMap: PromptSubjectMap
): Array<{ label: PromptSubjectLabel; name: string; text: string }> {
  const actions: Array<{ label: PromptSubjectLabel; name: string; text: string }> = [];
  if (beat.personaAction) {
    const subject = resolveSpeakerSubject(subjectMap, "persona");
    if (subject) {
      actions.push({ label: subject.label, name: subject.name, text: beat.personaAction });
    }
  }
  if (beat.characterAction) {
    const subject = resolveSpeakerSubject(subjectMap, "character");
    if (subject) {
      actions.push({ label: subject.label, name: subject.name, text: beat.characterAction });
    }
  }
  return actions;
}

/**
 * Canonical BALLOON_LAYOUT_METADATA owner. Builds non-readable structural balloon
 * slots from the canonical approved dialogue rows AFTER speaker attribution,
 * persona visibility, provenance validity, and dialogue-row eligibility — but
 * BEFORE provider visual-risk text omission. A risky/adult dialogue line keeps
 * its blank-balloon slot even though its readable text never reaches the provider.
 */
export function resolveComicPanelBalloonSlots(opts: {
  dialogue: readonly SceneDialogue[];
  subjectMap: PromptSubjectMap;
  personaVisible: boolean;
}): ComicBalloonSlotMetadata[] {
  return opts.dialogue.map((line, index) => ({
    dialogueIndex: index,
    speakerLabel: resolveSpeakerLabel(opts.subjectMap, line),
    lengthClass: resolveDialogueLengthClass(line.text),
    preferredSide: resolvePreferredBalloonSide(
      resolveDialogueSpeakerSide(opts.subjectMap, line, opts.personaVisible)
    ),
  }));
}

/** Plan-level balloon slot metadata for the hybrid Tier-2 prompt (structural, text-free). */
export function buildComicPanelBalloonSlotMetadata(opts: {
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  subjects?: readonly ChatImageVisualSubject[];
}): Array<{ panelIndex: number; slots: ComicBalloonSlotMetadata[] }> {
  const visibility = opts.visibility ?? DEFAULT_SCENE_PRESENTATION_VISIBILITY;
  const subjectMap = buildPromptSubjectMap(opts.subjects ?? []);
  return opts.plan.panels.map((panel) => {
    const beat = projectComicPanelBeat(opts.plan, panel, visibility);
    return {
      panelIndex: panel.index,
      slots: resolveComicPanelBalloonSlots({
        dialogue: beat.dialogue,
        subjectMap,
        personaVisible: visibility.personaVisible,
      }),
    };
  });
}

/** Text-free structural slot rendering for the hybrid Tier-2 provider prompt. */
export function renderComicStrictBalloonSlotMetadata(
  metadata: readonly { panelIndex: number; slots: ComicBalloonSlotMetadata[] }[]
): string {
  if (!metadata.length) return "";
  const lines: string[] = ["Blank balloon slots — server inserts approved Korean text after generation."];
  for (const panel of metadata) {
    if (!panel.slots.length) {
      lines.push(`Panel ${panel.panelIndex}: 0 blank balloons — keep this panel visually quiet.`);
      continue;
    }
    const slots = panel.slots
      .map(
        (slot) =>
          `slot ${slot.dialogueIndex + 1} speaker=${slot.speakerLabel} length=${slot.lengthClass}`
      )
      .join("; ");
    lines.push(`Panel ${panel.panelIndex}: ${panel.slots.length} blank balloon${panel.slots.length > 1 ? "s" : ""} (${slots}).`);
  }
  lines.push(
    "No readable letters, dialogue, captions, placeholder words, or gibberish anywhere in the image."
  );
  return lines.join("\n");
}

function resolveSceneActionFallback(
  beat: ProjectedComicPanelBeat,
  subjectActions: Array<{ label: PromptSubjectLabel; name: string; text: string }>
): string | undefined {
  if (subjectActions.length > 0) return undefined;
  const situation = beat.situation.trim();
  if (!situation) return undefined;
  return situation;
}

function subjectKeyForBinding(binding: SceneEventSubjectBinding): string {
  return binding.subjectKey;
}

function resolveBindingGroundedActions(
  panelSourceEventIds: readonly string[],
  plan: ScenePlan,
  subjectMap: PromptSubjectMap,
  eventSubjectBindings?: readonly SceneEventSubjectBinding[]
): Array<{ label: PromptSubjectLabel; name: string; text: string }> {
  if (!eventSubjectBindings?.length) return [];
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  const bindingByEvent = new Map(
    eventSubjectBindings.map((binding) => [binding.eventId, binding])
  );
  const actions: Array<{ label: PromptSubjectLabel; name: string; text: string }> = [];
  for (const eventId of panelSourceEventIds) {
    const binding = bindingByEvent.get(eventId);
    const event = eventsById.get(eventId);
    if (!binding || !event || event.kind === "dialogue" || event.segmentKind !== "action") {
      continue;
    }
    const subject = subjectMap.byKey.get(subjectKeyForBinding(binding));
    if (!subject) continue;
    actions.push({ label: subject.label, name: subject.name, text: event.text });
  }
  return actions;
}

/** Canonical panel-spec compiler — downstream of ScenePlan / hero selection. */
export function compileChatComicPanelSpec(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  visibility?: ScenePresentationVisibility;
  castSelected?: readonly ChatImageCastGroundedSubject[];
  subjects: readonly ChatImageVisualSubject[];
  eventSubjectBindings?: readonly SceneEventSubjectBinding[];
  projection?: ChatComicPanelSpecProjection;
}): ChatComicPanelSpec {
  const visibility = opts.visibility ?? DEFAULT_SCENE_PRESENTATION_VISIBILITY;
  const projection = opts.projection;
  const panelCount = opts.plan.panels.length as ScenePanelCount;
  const format = resolveComicPanelFormat(panelCount);
  const { sharedBackground } = projectComicSharedContext(opts.plan, visibility);
  const subjectMap = buildPromptSubjectMap(opts.subjects);
  const cast = buildCastFromPromptSubjects(subjectMap, visibility.personaVisible);
  const castCount = cast.length;

  const panels: ComicPanelSpecBeat[] = opts.plan.panels.map((panel) => {
    const beat = projectComicPanelBeat(opts.plan, panel, visibility);
    const beatRole = resolveBeatRole(format, panel.index, panelCount);
    const bindingActions = resolveBindingGroundedActions(
      panel.sourceEventIds,
      opts.plan,
      subjectMap,
      opts.eventSubjectBindings
    );
    const subjectActions =
      bindingActions.length > 0
        ? bindingActions
        : resolveGroundedSubjectActions(beat, subjectMap);
    const sceneAction = resolveSceneActionFallback(beat, subjectActions);
    return {
      index: panel.index,
      beatRole,
      camera: resolveCameraFromBeat(beat, panel.index, panelCount),
      framing: resolveFramingFromBeat(beat),
      layout: resolveLayoutFromSubjectMap(subjectMap, visibility.personaVisible, castCount),
      situation: applyPanelSpecTextProjection(beat.situation, projection),
      background: applyPanelSpecTextProjection(beat.background, projection),
      subjectActions: subjectActions.map((action) => ({
        ...action,
        text: applyPanelSpecTextProjection(action.text, projection),
      })),
      sceneAction: sceneAction
        ? applyPanelSpecTextProjection(sceneAction, projection)
        : undefined,
      speechBubbles: beat.dialogue
        .filter((line) => !projection?.omitDialogueText?.(line.text))
        .map((line) => ({
          speakerLabel: resolveSpeakerLabel(subjectMap, line),
          speaker: line.speakerName?.trim() || line.speaker,
          text: line.text,
        })),
      dialogueDirectives: resolveComicPanelBalloonSlots({
        dialogue: beat.dialogue,
        subjectMap,
        personaVisible: visibility.personaVisible,
      }),
      narrationBoxNeeded: beat.dialogue.length === 0 || panel.index === 1,
      sfx: extractPanelSfxCue(panel) ? [extractPanelSfxCue(panel)!.text] : [],
      mustAvoid: ["invented SFX text", "speech bubble without an approved line below"],
    };
  });

  return {
    format,
    panelCount,
    layout: `${panelCount} wide horizontal panels stacked vertically (vertical comic strip / ${format})`,
    heroScene: applyPanelSpecTextProjection(opts.plan.heroScene, projection),
    heroEventIds: opts.plan.heroEventIds,
    sharedBackground: applyPanelSpecTextProjection(sharedBackground, projection),
    atmosphere: opts.plan.atmosphere
      ? applyPanelSpecTextProjection(opts.plan.atmosphere, projection)
      : undefined,
    cast,
    continuityRules: resolveContinuityRules(format, castCount, subjectMap, visibility.personaVisible),
    globalMustAvoid: resolveGlobalMustAvoid(castCount),
    panels,
    subjectMap,
  };
}

export function renderChatComicPanelSpecSection(spec: ChatComicPanelSpec): string {
  const castLines = spec.cast
    .map((entry) => `${entry.label} = ${entry.role} (${entry.name})`)
    .join("\n");
  const panelBlocks = spec.panels
    .map((panel) => {
      const actions = [
        ...panel.subjectActions.map(
          (action) => `${action.label} action (${action.name}): ${action.text}`
        ),
        panel.sceneAction ? `Scene action: ${panel.sceneAction}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const bubbles =
        panel.speechBubbles.length > 0
          ? panel.speechBubbles
              .map(
                (bubble) =>
                  `Speech bubble (${bubble.speakerLabel} / ${bubble.speaker}): “${bubble.text}”`
              )
              .join("\n")
          : "Speech bubble: (silent panel — no bubble)";
      return [
        `[Panel ${panel.index} — ${panel.beatRole}]`,
        `Camera: ${panel.camera}`,
        `Framing: ${panel.framing}`,
        `Layout: ${panel.layout}`,
        panel.situation ? `Situation: ${panel.situation}` : "",
        `Background: ${panel.background}`,
        actions,
        bubbles,
        "SFX: (none — do not render sound-effect text)",
        `Must avoid: ${panel.mustAvoid.join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    "COMIC PANEL SPEC",
    `Format: ${spec.format} (${spec.panelCount} panels)`,
    `Layout: ${spec.layout}`,
    `Hero focus: ${spec.heroScene}`,
    spec.heroEventIds.length ? `Hero event ids: ${spec.heroEventIds.join(", ")}` : "",
    `Shared background: ${spec.sharedBackground}`,
    spec.atmosphere ? `Atmosphere: ${spec.atmosphere}` : "",
    "Cast:",
    castLines,
    panelBlocks,
    "Continuity rules:",
    ...spec.continuityRules.map((rule) => `- ${rule}`),
    "Global must avoid:",
    ...spec.globalMustAvoid.map((rule) => `- ${rule}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderChatComicPanelSpecVisualSection(
  spec: ChatComicPanelSpec,
  opts: { compositionMode?: ChatComicCompositionMode } = {}
): string {
  const compositionMode = opts.compositionMode ?? "overlay_first";
  const castLines = spec.cast
    .map((entry) => `${entry.label} = ${entry.role} (${entry.name})`)
    .join("\n");
  const panelBlocks = spec.panels
    .map((panel) => {
      const actions = [
        ...panel.subjectActions.map(
          (action) => `${action.label} action (${action.name}): ${action.text}`
        ),
        panel.sceneAction ? `Scene action: ${panel.sceneAction}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (compositionMode === "blank_balloon_hybrid") {
        const balloonDirectives = panel.dialogueDirectives.length
          ? panel.dialogueDirectives
              .map(
                (directive) =>
                  `Dialogue slot ${directive.dialogueIndex + 1}: blank balloon ownership: ${directive.speakerLabel}; relative dialogue length: ${directive.lengthClass}; optional preferred side: ${directive.preferredSide}.`
              )
              .join("\n")
          : "Blank balloon ownership: none — keep this panel visually quiet.";
        return [
          `[Panel ${panel.index} — ${panel.beatRole}]`,
          "GPT COMIC DIRECTOR: choose the shot distance, camera angle, and natural staging for this beat.",
          "Vary shot distance across the page; use a reaction close-up when narratively justified.",
          panel.situation ? `Visual beat: ${panel.situation}` : "",
          `Background: ${panel.background}`,
          actions,
          balloonDirectives,
          panel.narrationBoxNeeded
            ? "Blank narration box: include only when this beat needs context; leave its interior empty."
            : "Blank narration box: not required for this beat.",
          "Draw natural white manga/manhwa speech balloons with black outlines in appropriate negative space.",
          "Aim each balloon tail naturally toward the actual speaker; do not cover faces, eyes, hands, or important actions.",
          "Add blank narration boxes and decorative manga/manhwa effects only when they support the beat.",
          "Do not use fixed pixel coordinates or repeat an identical seated composition.",
          "Render no readable letters, dialogue, captions, placeholder words, random symbols, or gibberish.",
          `Must avoid: ${panel.mustAvoid.join("; ")}`,
        ]
          .filter(Boolean)
          .join("\n");
      }
      return [
        `[Panel ${panel.index} — ${panel.beatRole}]`,
        `Camera: ${panel.camera}`,
        `Framing: ${panel.framing}`,
        `Layout: ${panel.layout}`,
        panel.situation ? `Situation: ${panel.situation}` : "",
        `Background: ${panel.background}`,
        actions,
        "Visual only: do not render speech bubbles, captions, narration boxes, SFX, or any readable letters.",
        "Composition: leave a clean upper-right negative space area for server text overlay.",
        `Must avoid: ${panel.mustAvoid.join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    compositionMode === "blank_balloon_hybrid"
      ? "COMIC PANEL SPEC — GPT-DIRECTED BLANK-BALLOON ARTWORK"
      : "COMIC PANEL SPEC — VISUAL LAYER ONLY",
    `Format: ${spec.format} (${spec.panelCount} panels)`,
    `Layout: ${spec.layout}`,
    `Hero focus: ${spec.heroScene}`,
    spec.heroEventIds.length ? `Hero event ids: ${spec.heroEventIds.join(", ")}` : "",
    `Shared background: ${spec.sharedBackground}`,
    spec.atmosphere ? `Atmosphere: ${spec.atmosphere}` : "",
    "Cast:",
    castLines,
    panelBlocks,
    "Continuity rules:",
    ...spec.continuityRules.map((rule) => `- ${rule}`),
    "Global must avoid:",
    ...spec.globalMustAvoid.map((rule) => `- ${rule}`),
    compositionMode === "blank_balloon_hybrid"
      ? "The provider owns panel composition, camera, character staging, facial reactions, blank balloon geometry, balloon tails, narration-box geometry, and decorative manga effects. The server adds glyphs only inside provider-created blank interiors."
      : "Text will be added later by server overlay — image must contain zero readable text.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildChatComicPanelSpecVisualSection(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  visibility?: ScenePresentationVisibility;
  castSelected?: readonly ChatImageCastGroundedSubject[];
  subjects: readonly ChatImageVisualSubject[];
  eventSubjectBindings?: readonly SceneEventSubjectBinding[];
  projection?: ChatComicPanelSpecProjection;
  compositionMode?: ChatComicCompositionMode;
}): string {
  const spec = compileChatComicPanelSpec(opts);
  return renderChatComicPanelSpecVisualSection(spec, {
    compositionMode: opts.compositionMode,
  });
}

/**
 * FULL PROVIDER-RENDERED manhwa section — the provider draws the complete comic
 * page including readable Korean dialogue, narration, and SFX. The planner
 * passes beat, speaker ownership, and exact approved text only; GPT owns pose,
 * camera, balloon geometry, tail geometry, and negative-space arrangement.
 */
export function renderChatComicPanelSpecFullProviderSection(spec: ChatComicPanelSpec): string {
  const castLines = spec.cast
    .map((entry) => `${entry.label} = ${entry.role} (${entry.name})`)
    .join("\n");
  const panelBlocks = spec.panels
    .map((panel) => {
      const actions = [
        ...panel.subjectActions.map(
          (action) => `${action.label} action (${action.name}): ${action.text}`
        ),
        panel.sceneAction ? `Scene action: ${panel.sceneAction}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const dialogue = panel.speechBubbles.length
        ? panel.speechBubbles
            .map((bubble) => `Speech bubble (${bubble.speakerLabel} / ${bubble.speaker}): "${bubble.text}"`)
            .join("\n")
        : "Speech bubble: (silent panel — no bubble)";
      const narration = panel.narrationBoxNeeded
        ? `Narration box (readable Korean, when this beat needs context): "${panel.situation}"`
        : "Narration box: not required for this beat.";
      const sfx = panel.sfx.length
        ? `SFX text (readable Korean, when appropriate): ${panel.sfx.join(", ")}`
        : "SFX: (none)";
      return [
        `[Panel ${panel.index} — ${panel.beatRole}]`,
        panel.situation ? `Beat: ${panel.situation}` : "",
        `Background: ${panel.background}`,
        actions,
        dialogue,
        narration,
        sfx,
        "Render this panel as readable Korean comic text integrated into the artwork.",
        `Must avoid: ${panel.mustAvoid.join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    "COMIC PANEL SPEC — FULL PROVIDER-RENDERED MANHWA PAGE",
    `Format: ${spec.format} (${spec.panelCount} panels)`,
    `Layout: ${spec.layout}`,
    `Hero focus: ${spec.heroScene}`,
    spec.heroEventIds.length ? `Hero event ids: ${spec.heroEventIds.join(", ")}` : "",
    `Shared background: ${spec.sharedBackground}`,
    spec.atmosphere ? `Atmosphere: ${spec.atmosphere}` : "",
    "Cast:",
    castLines,
    panelBlocks,
    "Continuity rules:",
    ...spec.continuityRules.map((rule) => `- ${rule}`),
    "Global must avoid:",
    ...spec.globalMustAvoid.map((rule) => `- ${rule}`),
    "The provider owns pose, camera angle, balloon position/size/tails, negative-space arrangement, and manga effects. The planner supplies only the beat and the exact approved Korean text.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Provider-readable comic text INPUT eligibility. Reuses the site's existing
 * adult text contract (resolveEffectiveAdultRp → adultGrounded). Ordinary
 * dialogue is always provider-readable; adult-grounded dialogue is provider-
 * readable only when the existing site adult eligibility allows it; self-harm
 * and graphic-violence dialogue stay excluded. This is INPUT eligibility, not
 * server image postprocessing.
 */
export function resolveComicProviderReadableTextEligibility(opts: {
  text: string;
  adultGrounded: boolean;
  realPersonRestricted?: boolean;
}): boolean {
  const categories = classifyRawVisualRisk(opts.text);
  if (categories.includes("self_harm")) return false;
  if (categories.includes("graphic_violence")) return false;
  if (categories.includes("adult_explicit")) {
    if (opts.realPersonRestricted) return false;
    if (!opts.adultGrounded) return false;
  }
  return true;
}

export function buildChatComicPanelSpecFullProviderSection(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  visibility?: ScenePresentationVisibility;
  castSelected?: readonly ChatImageCastGroundedSubject[];
  subjects: readonly ChatImageVisualSubject[];
  eventSubjectBindings?: readonly SceneEventSubjectBinding[];
  projection?: ChatComicPanelSpecProjection;
  /** Site adult text eligibility (resolveEffectiveAdultRp) for provider-readable dialogue. */
  adultGrounded?: boolean;
  realPersonRestricted?: boolean;
}): string {
  const spec = compileChatComicPanelSpec({
    ...opts,
    projection: {
      ...opts.projection,
      omitDialogueText: (text) =>
        !resolveComicProviderReadableTextEligibility({
          text,
          adultGrounded: opts.adultGrounded ?? false,
          realPersonRestricted: opts.realPersonRestricted,
        }),
    },
  });
  return renderChatComicPanelSpecFullProviderSection(spec);
}

export function buildChatComicPanelSpecPromptSection(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  visibility?: ScenePresentationVisibility;
  castSelected?: readonly ChatImageCastGroundedSubject[];
  subjects: readonly ChatImageVisualSubject[];
  eventSubjectBindings?: readonly SceneEventSubjectBinding[];
  projection?: ChatComicPanelSpecProjection;
}): string {
  const spec = compileChatComicPanelSpec(opts);
  return renderChatComicPanelSpecSection(spec);
}

export function countForcedGenreDirectives(spec: ChatComicPanelSpec): number {
  const haystack = [
    ...spec.panels.map((panel) => panel.beatRole),
    ...spec.continuityRules,
    renderChatComicPanelSpecSection(spec),
  ].join("\n");
  const forbidden = [/punchline/i, /Climax/i, /Escalation/i, /emotional progression/i];
  return forbidden.reduce(
    (count, pattern) => count + (pattern.test(haystack) ? 1 : 0),
    0
  );
}

export function countActionDirectiveDuplicates(spec: ChatComicPanelSpec): number {
  const rendered = renderChatComicPanelSpecSection(spec);
  let count = 0;
  for (const line of rendered.split("\n")) {
    const actionMatch = line.match(/^([A-D]) action \([^)]+\):\s*(.+)$/);
    if (!actionMatch) continue;
    const actionText = actionMatch[2]?.trim() ?? "";
    if (!actionText) continue;
    const duplicateCue = rendered.includes(`Acting cue: ${actionText}`);
    if (duplicateCue) count += 1;
  }
  return count;
}

export function countEmptyActingDirectives(spec: ChatComicPanelSpec): number {
  const rendered = renderChatComicPanelSpecSection(spec);
  let count = 0;
  for (const line of rendered.split("\n")) {
    if (/^(Acting:|Expressions:|Acting cue:)\s*$/u.test(line)) count += 1;
  }
  return count;
}
