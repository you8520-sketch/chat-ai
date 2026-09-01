import type { ChatImageCastGroundedSubject } from "@/lib/chatImageCastManifest";
import type { ScenePanelCount, ScenePlan, ScenePresentationVisibility } from "@/lib/chatImageScenePlan";
import {
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  projectComicPanelBeat,
  projectComicSharedContext,
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
  expressions: string;
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

const GLOBAL_MUST_AVOID = [
  "invented dialogue or narration",
  "sound effects or onomatopoeia text",
  "extra unnamed characters",
  "identity swaps between A and B",
  "cropped panel borders or speech bubbles",
] as const;

export function resolveComicPanelFormat(panelCount: ScenePanelCount): ComicPanelFormatId {
  if (panelCount === 2) return "2panel";
  if (panelCount === 3) return "3koma";
  return "4panel";
}

function resolveBeatRole(format: ComicPanelFormatId, index: number, total: number): string {
  if (format === "2panel") {
    return index === 1 ? "Setup" : "Payoff";
  }
  if (format === "3koma") {
    if (index === 1) return "Setup";
    if (index === 2) return "Development";
    return "Climax / punchline";
  }
  if (index === 1) return "Establish";
  if (index === 2) return "Escalation";
  if (index === 3) return "Turn";
  return "Resolution";
}

function resolveCamera(format: ComicPanelFormatId, index: number, total: number): string {
  if (format === "2panel") {
    return index === 1 ? "medium-wide establishing" : "medium close-up reaction";
  }
  if (format === "3koma") {
    if (index === 1) return "wide establishing";
    if (index === 2) return "medium two-shot";
    return "close-up emotional beat";
  }
  if (index === 1) return "wide establishing";
  if (index === total) return "close-up payoff";
  return index === 2 ? "medium two-shot" : "medium-close acting beat";
}

function resolveFraming(format: ComicPanelFormatId, index: number, total: number): string {
  if (index === total) return "tight on the acting faces and upper body";
  if (format === "3koma" && index === 3) return "close on the decisive reaction";
  return "both recurring characters readable in frame";
}

function castLabelsFromCount(count: number): Array<"A" | "B" | "C" | "D"> {
  return (["A", "B", "C", "D"] as const).slice(0, Math.max(1, Math.min(count, 4)));
}

function resolveLayout(
  personaVisible: boolean,
  index: number,
  total: number,
  castCount: number
): string {
  if (castCount >= 3) {
    return "stable group layout — left / center / right readable; follow cast manifest composition goal";
  }
  if (!personaVisible) return "character B centered; persona A off-camera only";
  if (index === total) return "A left, B right — preserve established orientation";
  return index % 2 === 1 ? "A left, B right" : "B right, A left — same characters, mirrored staging OK";
}

function resolveExpressions(beatRole: string): string {
  if (beatRole.includes("Setup") || beatRole.includes("Establish")) {
    return "natural baseline expressions matching the opening beat";
  }
  if (beatRole.includes("Climax") || beatRole.includes("Payoff") || beatRole.includes("Resolution")) {
    return "clear peak emotion — blush, surprise, tension, or comedy exaggeration as scripted";
  }
  return "progressive emotional shift from the previous panel";
}

function resolveContinuityRules(format: ComicPanelFormatId, castCount: number): string[] {
  const identityRule =
    castCount >= 3
      ? `Keep all ${castCount} recurring identities distinct — hair, outfit, and face must not swap.`
      : "Keep A and B as the same two identities throughout — hair, outfit, and face must not swap.";
  const shared = [
    identityRule,
    "Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.",
    "Gradual emotional progression — each panel should visibly advance the beat from the prior panel.",
  ];
  if (format === "3koma") {
    return [
      ...shared,
      "3-koma rhythm: setup → development → punchline/climax — the last panel carries the strongest reaction.",
    ];
  }
  if (format === "4panel") {
    return [
      ...shared,
      "4-panel rhythm: establish → escalate → turn → resolution — each panel must cover a distinct story beat.",
    ];
  }
  return [...shared, "2-panel rhythm: setup in panel 1, clear payoff in panel 2."];
}

function speakerLabel(speaker: string): "A" | "B" | "other" {
  if (speaker === "persona") return "A";
  if (speaker === "character") return "B";
  return "other";
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
  const cast: ComicCastRoleLabel[] =
    selectedCast.length > 0
      ? selectedCast.map((subject, index) => ({
          label: castLabelsFromCount(selectedCast.length)[index] ?? "D",
          role: subject.role,
          name: subject.name,
        }))
      : visibility.personaVisible
        ? [
            { label: "A", role: "persona", name: opts.personaName },
            { label: "B", role: "character", name: opts.characterName },
          ]
        : [{ label: "B", role: "character", name: opts.characterName }];
  const castCount = cast.length;

  const panels: ComicPanelSpecBeat[] = opts.plan.panels.map((panel) => {
    const beat = projectComicPanelBeat(opts.plan, panel, visibility);
    const beatRole = resolveBeatRole(format, panel.index, panelCount);
    return {
      index: panel.index,
      beatRole,
      camera: resolveCamera(format, panel.index, panelCount),
      framing: resolveFraming(format, panel.index, panelCount),
      layout: resolveLayout(visibility.personaVisible, panel.index, panelCount, castCount),
      situation: beat.situation,
      background: beat.background,
      personaAction: beat.personaAction,
      characterAction: beat.characterAction,
      expressions: resolveExpressions(beatRole),
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
    globalMustAvoid: GLOBAL_MUST_AVOID,
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
        !panel.personaAction && !panel.characterAction
          ? `Acting: ${panel.situation}`
          : "",
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
        `Expressions: ${panel.expressions}`,
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
