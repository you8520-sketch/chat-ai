export const CHAT_COMIC_TEMPLATE_ID = "comic_horizontal_2_4" as const;
export const CHAT_COMIC_TEMPLATE_NAME = "2~4컷 가로 만화";
export const CHAT_COMIC_TEMPLATE_PREVIEW_URL =
  "/image-templates/comic-horizontal-sample.webp";

export const CHAT_COMIC_DEFAULT_PLANNER_MODEL = "google/gemini-2.5-flash-lite";
export const CHAT_COMIC_MAX_INPUT_CHARS = 500;

export const CHAT_COMIC_PANEL_OPTIONS = [
  { id: 2, label: "2컷", points: 250 },
  { id: 3, label: "3컷", points: 300 },
  { id: 4, label: "4컷", points: 350 },
] as const;

export const CHAT_COMIC_MOODS = [
  {
    id: "comic",
    label: "코믹",
    prompt: "light romantic-comedy energy, exaggerated reactions and playful timing",
  },
  {
    id: "lovely",
    label: "달달",
    prompt: "soft affectionate romance, warm blushes and tender expressions",
  },
  {
    id: "daily",
    label: "일상",
    prompt: "natural slice-of-life interaction, relaxed and believable expressions",
  },
  {
    id: "serious",
    label: "진지",
    prompt: "restrained emotional tension, cinematic expressions and clear acting",
  },
] as const;

export type ChatComicPanelCount = (typeof CHAT_COMIC_PANEL_OPTIONS)[number]["id"];
export type ChatComicMood = (typeof CHAT_COMIC_MOODS)[number]["id"];
export type ChatComicSpeaker = "character" | "persona" | "narration";

export type ChatComicDialogue = {
  speaker: ChatComicSpeaker;
  text: string;
};

export type ChatComicPanel = {
  panel: number;
  scene: string;
  characterExpression: string;
  personaExpression: string;
  dialogue: ChatComicDialogue[];
  caption?: string;
};

export type ChatComicPlan = {
  title: string;
  panels: ChatComicPanel[];
};

function toPanelCount(raw: unknown): ChatComicPanelCount {
  const value = Number(raw);
  return value === 2 || value === 3 || value === 4 ? value : 4;
}

function toMood(raw: unknown): ChatComicMood {
  const value = String(raw ?? "");
  return CHAT_COMIC_MOODS.some((item) => item.id === value)
    ? (value as ChatComicMood)
    : "comic";
}

export function sanitizeChatComicOptions(raw: {
  panelCount?: unknown;
  mood?: unknown;
  sourceText?: unknown;
}) {
  const sourceText = String(raw.sourceText ?? "").trim();
  return {
    panelCount: toPanelCount(raw.panelCount),
    mood: toMood(raw.mood),
    sourceText: sourceText.slice(0, CHAT_COMIC_MAX_INPUT_CHARS),
  };
}

export function resolveChatComicPrice(
  panelCount: ChatComicPanelCount,
  env: NodeJS.ProcessEnv = process.env
): number {
  const envName = `CHAT_COMIC_${panelCount}_POINTS`;
  const override = Number(env[envName]);
  if (Number.isFinite(override) && override >= 1) return Math.ceil(override);
  return CHAT_COMIC_PANEL_OPTIONS.find((item) => item.id === panelCount)?.points ?? 350;
}

export function resolveChatComicPlannerModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.OPENROUTER_COMIC_PLANNER_MODEL?.trim() || CHAT_COMIC_DEFAULT_PLANNER_MODEL;
}

export function buildChatComicPlannerPrompt(opts: {
  characterName: string;
  personaName: string;
  panelCount: ChatComicPanelCount;
  mood: ChatComicMood;
  sourceText: string;
}): string {
  return [
    "You are a Korean comic storyboard editor.",
    `Convert the supplied Korean prose into exactly ${opts.panelCount} horizontal comic panels stacked vertically on one page.`,
    `The chat character is ${opts.characterName}; the user persona is ${opts.personaName}.`,
    "Infer who is speaking from the prose and preserve their identities throughout.",
    "Extract the most important spoken lines from the source. Preserve quoted wording and each character's speech style whenever possible. Do not invent a different plot.",
    "Dialogue must be concise enough for readable Korean speech bubbles: at most two bubbles per panel and normally no more than 32 Korean characters per bubble.",
    "Use narration only when a visual beat cannot communicate the transition. At most one short narration box per panel.",
    "Each panel needs a clear action, camera framing, and natural facial expressions. The final panel should land the emotional payoff or comedic punchline.",
    `Mood: ${CHAT_COMIC_MOODS.find((item) => item.id === opts.mood)?.prompt ?? "comic"}.`,
    "Return JSON only, without markdown fences, using this exact schema:",
    JSON.stringify({
      title: "short Korean title",
      panels: [
        {
          panel: 1,
          scene: "visual action and framing",
          characterExpression: "expression and body language",
          personaExpression: "expression and body language",
          dialogue: [
            { speaker: "character", text: "Korean bubble text" },
            { speaker: "persona", text: "Korean bubble text" },
          ],
          caption: "optional short Korean narration",
        },
      ],
    }),
    "SOURCE PROSE:",
    opts.sourceText,
  ].join("\n\n");
}

function cleanText(raw: unknown, max: number): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function sanitizeChatComicPlan(
  raw: unknown,
  panelCount: ChatComicPanelCount
): ChatComicPlan {
  if (!raw || typeof raw !== "object") throw new Error("컷 구성 응답이 올바르지 않습니다.");
  const source = raw as { title?: unknown; panels?: unknown };
  if (!Array.isArray(source.panels) || source.panels.length !== panelCount) {
    throw new Error("요청한 컷 수와 구성 결과가 일치하지 않습니다.");
  }

  const panels = source.panels.map((entry, index): ChatComicPanel => {
    if (!entry || typeof entry !== "object") {
      throw new Error("컷 구성 일부가 비어 있습니다.");
    }
    const panel = entry as Record<string, unknown>;
    const rawDialogue = Array.isArray(panel.dialogue) ? panel.dialogue : [];
    const dialogue = rawDialogue.slice(0, 2).flatMap((item): ChatComicDialogue[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const speakerRaw = String(row.speaker ?? "");
      const speaker: ChatComicSpeaker =
        speakerRaw === "character" || speakerRaw === "persona" || speakerRaw === "narration"
          ? speakerRaw
          : "narration";
      const text = cleanText(row.text, 40);
      return text ? [{ speaker, text }] : [];
    });
    return {
      panel: index + 1,
      scene: cleanText(panel.scene, 220) || `Panel ${index + 1}`,
      characterExpression: cleanText(panel.characterExpression, 100) || "natural expression",
      personaExpression: cleanText(panel.personaExpression, 100) || "natural expression",
      dialogue,
      caption: cleanText(panel.caption, 70) || undefined,
    };
  });

  return {
    title: cleanText(source.title, 40) || "우리 둘의 한 장면",
    panels,
  };
}

export function buildChatComicImagePrompt(opts: {
  characterName: string;
  personaName: string;
  panelCount: ChatComicPanelCount;
  mood: ChatComicMood;
  sourceText: string;
  plan: ChatComicPlan;
}): string {
  const panels = opts.plan.panels
    .map((panel) => {
      const dialogue = panel.dialogue.length
        ? panel.dialogue
            .map((line) => {
              const speaker =
                line.speaker === "character"
                  ? opts.characterName
                  : line.speaker === "persona"
                    ? opts.personaName
                    : "Narration";
              return `${speaker}: “${line.text}”`;
            })
            .join(" | ")
        : "No speech bubble";
      return [
        `PANEL ${panel.panel}`,
        `Scene: ${panel.scene}`,
        `${opts.characterName} expression: ${panel.characterExpression}`,
        `${opts.personaName} expression: ${panel.personaExpression}`,
        `Exact Korean text: ${dialogue}`,
        panel.caption ? `Exact caption box: “${panel.caption}”` : "No caption box",
      ].join("\n");
    })
    .join("\n\n");

  return [
    `Create one polished Korean manhwa-style page with exactly ${opts.panelCount} wide horizontal panels stacked vertically.`,
    "Reference image 1 is the comic layout and finish reference. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and romantic-comedy timing, but do not copy its exact poses.",
    `Reference image 2 is the identity reference for the chat character ${opts.characterName}.`,
    `Reference image 3 is the identity reference for the user persona ${opts.personaName}.`,
    "Identity separation is critical. Preserve each person's hair color, eye color, hairstyle, facial details, accessories, body build, and signature outfit impression. Never swap or blend them.",
    `Overall tone: ${CHAT_COMIC_MOODS.find((item) => item.id === opts.mood)?.prompt ?? "comic"}.`,
    "Render every Korean dialogue and caption EXACTLY as written below. Do not paraphrase, translate, omit, duplicate, or assign it to the wrong person.",
    "Use proper speech bubbles with tails pointing to the correct speaker. Keep text large, centered, uncropped, and easy to read. Use short sound effects only when visually helpful.",
    "Exactly two recurring human characters. No extra person, duplicate face, identity swap, malformed hands, watermark, logo, or text outside the specified bubbles/captions/sound effects.",
    "Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.",
    `Story title for internal guidance: ${opts.plan.title}`,
    panels,
    "Original prose context (visual guidance only; bubble text must still match the exact lines above):",
    opts.sourceText,
  ].join("\n\n");
}
