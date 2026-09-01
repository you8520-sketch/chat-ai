import type { ChatImageCastGroundedSubject } from "@/lib/chatImageCastManifest";
import type { ChatImageCastImportance } from "@/lib/chatImageCast";
import type { ScenePanelCount, ScenePlan, ScenePresentationVisibility } from "@/lib/chatImageScenePlan";
import {
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  projectComicPanelBeat,
  projectComicSharedContext,
  type ProjectedComicPanelBeat,
} from "@/lib/chatImageScenePlan";

export type ComicPanelFormatId = "2panel" | "3koma" | "4panel";

export type ComicCastRoleLabel = {
  label: "A" | "B" | "C" | "D";
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
  personaAction?: string;
  characterAction?: string;
  actingCue?: string;
  speechBubbles: Array<{ speakerLabel: "A" | "B" | "other"; speaker: string; text: string }>;
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
};

const IMPORTANCE_RANK: Record<ChatImageCastImportance, number> = {
  primary: 0,
  secondary: 1,
  background: 2,
};

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

function resolveBeatRole(_format: ComicPanelFormatId, index: number, total: number): string {
  if (total === 2) {
    return index === 1 ? "Opening beat" : "Closing beat";
  }
  if (total === 3) {
    if (index === 1) return "Opening beat";
    if (index === 2) return "Middle beat";
    return "Closing beat";
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

function resolveLayout(personaVisible: boolean, castCount: number): string {
  if (castCount >= 3) {
    return "stable group layout — left / center / right readable; follow cast manifest composition goal";
  }
  if (!personaVisible) return "character B centered; persona A off-camera only";
  return "A left, B right — maintain stable orientation across panels";
}

function resolveActingCueFromBeat(beat: ProjectedComicPanelBeat): string | undefined {
  const acting = [beat.personaAction, beat.characterAction].filter(Boolean).join("; ");
  return acting || undefined;
}

function resolveContinuityRules(format: ComicPanelFormatId, castCount: number): string[] {
  const identityRule =
    castCount >= 3
      ? `Keep all ${castCount} recurring identities distinct — hair, outfit, and face must not swap.`
      : castCount === 1
        ? "Keep the visible recurring identity consistent throughout."
        : "Keep A and B as the same two identities throughout — hair, outfit, and face must not swap.";
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
      "4-panel rhythm: opening → beat 2 → beat 3 → closing beat — each panel covers a distinct scripted moment.",
    ];
  }
  return [...shared, "2-panel rhythm: opening beat in panel 1, closing beat in panel 2."];
}

function speakerLabel(speaker: string): "A" | "B" | "other" {
  if (speaker === "persona") return "A";
  if (speaker === "character") return "B";
  return "other";
}

export function buildStableCastLabels(opts: {
  selectedCast: readonly ChatImageCastGroundedSubject[];
  visibility: ScenePresentationVisibility;
  personaName: string;
  characterName: string;
}): ComicCastRoleLabel[] {
  if (!opts.selectedCast.length) {
    return opts.visibility.personaVisible
      ? [
          { label: "A", role: "persona", name: opts.personaName },
          { label: "B", role: "character", name: opts.characterName },
        ]
      : [{ label: "B", role: "character", name: opts.characterName }];
  }

  const included = opts.selectedCast.filter((subject) => subject.included && subject.name);
  const persona = included.find((subject) => subject.role === "persona");
  const main = included.find((subject) => subject.role === "main_character");
  const supporting = included
    .filter((subject) => subject.role === "supporting_character")
    .sort((left, right) => IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]);

  const cast: ComicCastRoleLabel[] = [];
  if (opts.visibility.personaVisible && persona) {
    cast.push({ label: "A", role: persona.role, name: persona.name });
  }
  if (main) {
    cast.push({ label: "B", role: main.role, name: main.name });
  }
  supporting.slice(0, 2).forEach((subject, index) => {
    cast.push({
      label: index === 0 ? "C" : "D",
      role: subject.role,
      name: subject.name,
    });
  });
  return cast;
}

/** Canonical panel-spec compiler — downstream of ScenePlan / hero selection. */
export function compileChatComicPanelSpec(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  visibility?: ScenePresentationVisibility;
  castSelected?: readonly ChatImageCastGroundedSubject[];
}): ChatComicPanelSpec {
  const visibility = opts.visibility ?? DEFAULT_SCENE_PRESENTATION_VISIBILITY;
  const panelCount = opts.plan.panels.length as ScenePanelCount;
  const format = resolveComicPanelFormat(panelCount);
  const { sharedBackground } = projectComicSharedContext(opts.plan, visibility);
  const selectedCast = opts.castSelected?.filter((subject) => subject.included) ?? [];
  const cast = buildStableCastLabels({
    selectedCast,
    visibility,
    personaName: opts.personaName,
    characterName: opts.characterName,
  });
  const castCount = cast.length;

  const panels: ComicPanelSpecBeat[] = opts.plan.panels.map((panel) => {
    const beat = projectComicPanelBeat(opts.plan, panel, visibility);
    const beatRole = resolveBeatRole(format, panel.index, panelCount);
    const actingCue = resolveActingCueFromBeat(beat);
    return {
      index: panel.index,
      beatRole,
      camera: resolveCameraFromBeat(beat, panel.index, panelCount),
      framing: resolveFramingFromBeat(beat),
      layout: resolveLayout(visibility.personaVisible, castCount),
      situation: beat.situation,
      background: beat.background,
      personaAction: beat.personaAction,
      characterAction: beat.characterAction,
      actingCue,
      speechBubbles: beat.dialogue.map((line) => ({
        speakerLabel: speakerLabel(line.speaker),
        speaker: line.speaker,
        text: line.text,
      })),
      sfx: [],
      mustAvoid: ["invented SFX text", "speech bubble without an approved line below"],
    };
  });

  return {
    format,
    panelCount,
    layout: `${panelCount} wide horizontal panels stacked vertically (vertical comic strip / ${format})`,
    heroScene: opts.plan.heroScene,
    heroEventIds: opts.plan.heroEventIds,
    sharedBackground,
    atmosphere: opts.plan.atmosphere,
    cast,
    continuityRules: resolveContinuityRules(format, castCount),
    globalMustAvoid: resolveGlobalMustAvoid(castCount),
    panels,
  };
}

export function renderChatComicPanelSpecSection(spec: ChatComicPanelSpec): string {
  const castLines = spec.cast
    .map((entry) => `${entry.label} = ${entry.role} (${entry.name})`)
    .join("\n");
  const panelBlocks = spec.panels
    .map((panel) => {
      const actions = [
        panel.personaAction ? `A action: ${panel.personaAction}` : "",
        panel.characterAction ? `B action: ${panel.characterAction}` : "",
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
        `Background: ${panel.background}`,
        actions,
        panel.actingCue ? `Acting cue: ${panel.actingCue}` : "",
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

export function buildChatComicPanelSpecPromptSection(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  visibility?: ScenePresentationVisibility;
  castSelected?: readonly ChatImageCastGroundedSubject[];
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

export function countEmptyActingDirectives(spec: ChatComicPanelSpec): number {
  const rendered = renderChatComicPanelSpecSection(spec);
  let count = 0;
  for (const line of rendered.split("\n")) {
    if (/^(Acting:|Expressions:|Acting cue:)\s*$/u.test(line)) count += 1;
  }
  return count;
}
