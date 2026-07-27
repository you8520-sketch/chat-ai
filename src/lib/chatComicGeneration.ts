export const CHAT_COMIC_TEMPLATE_ID = "comic_horizontal_2_4" as const;
export const CHAT_COMIC_TEMPLATE_NAME = "2~4컷 가로 만화";
export const CHAT_COMIC_TEMPLATE_PREVIEW_URL =
  "/image-templates/comic-horizontal-sample.webp";

export const CHAT_COMIC_DEFAULT_PLANNER_MODEL = "gpt-4o-mini";
export const CHAT_COMIC_MAX_INPUT_CHARS = 800;
export const CHAT_COMIC_IMAGE_OUTPUT_SIZE = "1008x1408" as const;
export const CHAT_COMIC_GENERATION_DEFAULT_POINTS = 220;

export const CHAT_COMIC_PANEL_OPTIONS = [
  { id: 2, label: "2컷" },
  { id: 3, label: "3컷" },
  { id: 4, label: "4컷" },
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
  panelCount: ChatComicPanelCount;
  panels: ChatComicPanel[];
};

function toMood(raw: unknown): ChatComicMood {
  const value = String(raw ?? "");
  return CHAT_COMIC_MOODS.some((item) => item.id === value)
    ? (value as ChatComicMood)
    : "comic";
}

export function sanitizeChatComicOptions(raw: {
  mood?: unknown;
  sourceText?: unknown;
}) {
  const sourceText = String(raw.sourceText ?? "").trim();
  return {
    mood: toMood(raw.mood),
    sourceText: sourceText.slice(0, CHAT_COMIC_MAX_INPUT_CHARS),
  };
}

export function resolveChatComicPrice(
  _panelCount: ChatComicPanelCount,
  env: NodeJS.ProcessEnv = process.env
): number {
  const override = Number(env.CHAT_COMIC_GENERATION_POINTS);
  if (Number.isFinite(override) && override >= 1) return Math.ceil(override);
  return CHAT_COMIC_GENERATION_DEFAULT_POINTS;
}

export function resolveChatComicPlannerModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.OPENAI_COMIC_PLANNER_MODEL?.trim() || CHAT_COMIC_DEFAULT_PLANNER_MODEL;
}

export function buildChatComicPlannerPrompt(opts: {
  characterName: string;
  personaName: string;
  mood: ChatComicMood;
  sourceText: string;
}): string {
  return [
    "You are a Korean comic storyboard editor.",
    "Choose the smallest natural panel count from 2, 3, or 4, then convert the supplied Korean prose into that many horizontal comic panels stacked vertically on one page.",
    "Use 2 panels for one setup and one payoff in the same beat. Use 3 panels when a transition or reaction beat is needed. Use 4 panels only when multiple distinct actions, dialogue beats, or scene changes are necessary. Never stretch a short scene to fill extra panels.",
    `The chat character is ${opts.characterName}; the user persona is ${opts.personaName}.`,
    "Infer who is speaking from the prose and preserve their identities throughout.",
    "Dialogue is closed-book extraction. Use only verbatim contiguous excerpts from text enclosed in quotation marks in SOURCE PROSE.",
    "Never invent, paraphrase, combine, complete, or add reaction dialogue. If a panel has no suitable quoted line, return an empty dialogue array and communicate the reaction visually.",
    "Narration is also closed-book extraction. A caption may contain only one short verbatim contiguous excerpt from the unquoted descriptive prose in SOURCE PROSE. Never paraphrase or invent narration. Return an empty caption when no suitable excerpt exists.",
    "Use at most two speech bubbles and at most one rectangular narration box per panel. Never create labels or sound-effect text.",
    "Each panel needs a clear action, camera framing, and natural facial expressions. The final panel should land the emotional payoff or comedic punchline.",
    `Mood: ${CHAT_COMIC_MOODS.find((item) => item.id === opts.mood)?.prompt ?? "comic"}.`,
    "Return JSON only, without markdown fences, using this exact schema:",
    JSON.stringify({
      title: "short Korean title",
      panelCount: 2,
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
          caption: "",
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

export function extractQuotedComicDialogue(sourceText: string): string[] {
  const quoted: string[] = [];
  const pattern = /“([^”]+)”|"([^"]+)"|‘([^’]+)’|'([^']+)'/g;
  for (const match of sourceText.matchAll(pattern)) {
    const text = cleanText(match[1] ?? match[2] ?? match[3] ?? match[4], 400);
    if (text && !quoted.includes(text)) quoted.push(text);
  }
  return quoted;
}

function isVerbatimQuotedExcerpt(text: string, quotedDialogue: string[]): boolean {
  return quotedDialogue.some((quote) => quote.includes(text));
}

export function extractUnquotedComicNarration(sourceText: string): string[] {
  const segments: string[] = [];
  const quotedPattern = /“[^”]*”|"[^"]*"|‘[^’]*’|'[^']*'/g;
  let cursor = 0;
  for (const match of sourceText.matchAll(quotedPattern)) {
    const index = match.index ?? cursor;
    const segment = cleanText(sourceText.slice(cursor, index), 800);
    if (segment) segments.push(segment);
    cursor = index + match[0].length;
  }
  const tail = cleanText(sourceText.slice(cursor), 800);
  if (tail) segments.push(tail);
  return segments;
}

function isVerbatimNarrationExcerpt(text: string, unquotedNarration: string[]): boolean {
  return text.length >= 2 && unquotedNarration.some((segment) => segment.includes(text));
}

export function resolveAutoComicPanelCount(raw: unknown): ChatComicPanelCount {
  if (!raw || typeof raw !== "object") throw new Error("컷 구성 응답이 올바르지 않습니다.");
  const source = raw as { panelCount?: unknown; panels?: unknown };
  if (!Array.isArray(source.panels)) throw new Error("컷 구성 목록이 없습니다.");
  const count = source.panels.length;
  if (count !== 2 && count !== 3 && count !== 4) {
    throw new Error("AI가 선택한 컷 수가 2~4컷 범위를 벗어났습니다.");
  }
  const declared = Number(source.panelCount);
  if (Number.isFinite(declared) && declared !== count) {
    throw new Error("AI가 선택한 컷 수와 구성 결과가 일치하지 않습니다.");
  }
  return count;
}

export function sanitizeChatComicPlan(
  raw: unknown,
  sourceText: string
): ChatComicPlan {
  if (!raw || typeof raw !== "object") throw new Error("컷 구성 응답이 올바르지 않습니다.");
  const source = raw as { title?: unknown; panels?: unknown };
  const panelCount = resolveAutoComicPanelCount(raw);
  if (!Array.isArray(source.panels) || source.panels.length !== panelCount) {
    throw new Error("요청한 컷 수와 구성 결과가 일치하지 않습니다.");
  }
  const quotedDialogue = extractQuotedComicDialogue(sourceText);
  const unquotedNarration = extractUnquotedComicNarration(sourceText);

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
        speakerRaw === "character" || speakerRaw === "persona"
          ? speakerRaw
          : "persona";
      const text = cleanText(row.text, 40);
      return text && isVerbatimQuotedExcerpt(text, quotedDialogue)
        ? [{ speaker, text }]
        : [];
    });
    const caption = cleanText(panel.caption, 100);
    return {
      panel: index + 1,
      scene: cleanText(panel.scene, 220) || `Panel ${index + 1}`,
      characterExpression: cleanText(panel.characterExpression, 100) || "natural expression",
      personaExpression: cleanText(panel.personaExpression, 100) || "natural expression",
      dialogue,
      caption:
        caption && isVerbatimNarrationExcerpt(caption, unquotedNarration)
          ? caption
          : undefined,
    };
  });

  return {
    title: cleanText(source.title, 40) || "우리 둘의 한 장면",
    panelCount,
    panels,
  };
}

export function buildChatComicImagePrompt(opts: {
  characterName: string;
  personaName: string;
  mood: ChatComicMood;
  sourceText: string;
  plan: ChatComicPlan;
}): string {
  const approvedText = Array.from(
    new Set(
      opts.plan.panels.flatMap((panel) => [
        ...panel.dialogue.map((line) => line.text),
        ...(panel.caption ? [panel.caption] : []),
      ])
    )
  );
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
        panel.caption
          ? `Exact rectangular narration box: “${panel.caption}”`
          : "No narration box",
        "No label or sound-effect text",
      ].join("\n");
    })
    .join("\n\n");

  return [
    `Create one polished Korean manhwa-style page with exactly ${opts.plan.panelCount} wide horizontal panels stacked vertically.`,
    "Reference image 1 is the comic layout and finish reference. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and romantic-comedy timing, but do not copy its exact poses.",
    `Reference image 2 is the identity reference for the chat character ${opts.characterName}.`,
    `Reference image 3 is the identity reference for the user persona ${opts.personaName}.`,
    "Identity separation is critical. Preserve each person's hair color, eye color, hairstyle, facial details, accessories, body build, and signature outfit impression. Never swap or blend them.",
    `Overall tone: ${CHAT_COMIC_MOODS.find((item) => item.id === opts.mood)?.prompt ?? "comic"}.`,
    "STRICT CLOSED TEXT WHITELIST: the only text allowed anywhere in the image is listed below. Copy each used string exactly, character for character.",
    approvedText.length
      ? approvedText.map((text) => `- “${text}”`).join("\n")
      : "- NO TEXT IS ALLOWED",
    "Never invent reaction dialogue, bridge dialogue, narration, captions, labels, titles, signs, or sound effects. Only the approved narration explicitly assigned to a panel may appear in a rectangular caption box. Do not create a speech bubble or narration box for a panel marked No speech bubble or No narration box.",
    "Use proper speech bubbles with tails pointing to the correct speaker. Render approved narration only in a tail-less rectangular narration box. Keep all approved text large, centered, uncropped, and easy to read.",
    "Exactly two recurring human characters. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.",
    "Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.",
    `Story title for internal guidance: ${opts.plan.title}`,
    panels,
    "Original prose context is for visual acting only. Do not turn any other prose into visible text:",
    opts.sourceText,
  ].join("\n\n");
}
