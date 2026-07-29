import { buildImageGenderLockPrompt, type ImagePromptGender } from "@/lib/chatImageGeneration";

export const CHAT_EMOTICON_TEMPLATE_ID = "emoticon_grid_9" as const;
export const CHAT_EMOTICON_TEMPLATE_NAME = "랜덤 9종 이모티콘";
export const CHAT_EMOTICON_TEMPLATE_PREVIEW_URL =
  "/image-templates/sd-emoticon-grid-9.webp";

export const CHAT_EMOTICON_GENERATION_DEFAULT_POINTS = 230;
export const CHAT_EMOTICON_API_OUTPUT_WIDTH = 1024;
export const CHAT_EMOTICON_API_OUTPUT_HEIGHT = 1024;
export const CHAT_EMOTICON_API_OUTPUT_SIZE =
  `${CHAT_EMOTICON_API_OUTPUT_WIDTH}x${CHAT_EMOTICON_API_OUTPUT_HEIGHT}` as const;
export const CHAT_EMOTICON_OUTPUT_WIDTH = 1024;
export const CHAT_EMOTICON_OUTPUT_HEIGHT = 1024;
export const CHAT_EMOTICON_QUALITY = "medium" as const;

export type ChatEmoticonSubject = "character" | "persona" | "duo";

export type ChatEmoticonScene = {
  text: string;
  subject: ChatEmoticonSubject;
  action: string;
};

export const CHAT_EMOTICON_SCENE_POOL: readonly ChatEmoticonScene[] = [
  { text: "사랑해", subject: "character", action: "holding a big heart, affectionate smile" },
  { text: "보고 싶어", subject: "character", action: "pouting and hugging a pillow" },
  { text: "뭐 해?", subject: "character", action: "curious head tilt while checking a phone" },
  { text: "배고파", subject: "character", action: "holding an empty bowl with hungry eyes" },
  { text: "심심해", subject: "character", action: "lying down listlessly with puffed cheeks" },
  { text: "헉!", subject: "character", action: "wide-eyed surprise with hands on cheeks" },
  { text: "기다려", subject: "character", action: "reaching one hand forward urgently" },
  { text: "삐졌어", subject: "character", action: "arms crossed, cheeks puffed in a cute sulk" },
  { text: "몰라", subject: "character", action: "turning away shyly with a tiny pout" },
  { text: "고마워", subject: "persona", action: "hands clasped with a grateful sparkling smile" },
  { text: "잘 자", subject: "persona", action: "sleepy under a small blanket with a moon pillow" },
  { text: "좋은 아침!", subject: "persona", action: "stretching brightly beside a tiny sunrise" },
  { text: "미안해", subject: "persona", action: "teary apologetic face with hands together" },
  { text: "다녀올게", subject: "persona", action: "waving while carrying a small shoulder bag" },
  { text: "조심해", subject: "persona", action: "worried but caring expression, pointing gently" },
  { text: "부탁해", subject: "persona", action: "earnest pleading eyes and folded hands" },
  { text: "감동이야", subject: "persona", action: "happy tears with both hands over the heart" },
  { text: "오케이!", subject: "persona", action: "confident OK hand sign and a wink" },
  { text: "좋아요!", subject: "duo", action: "both giving enthusiastic thumbs up" },
  { text: "안녕!", subject: "duo", action: "both waving brightly side by side" },
  { text: "화이팅!", subject: "duo", action: "both cheering with raised fists" },
  { text: "축하해!", subject: "duo", action: "celebrating together with confetti and a tiny cake" },
  { text: "최고야!", subject: "duo", action: "one praising the other while both smile proudly" },
  { text: "꼬옥", subject: "duo", action: "warm full hug with happy closed eyes" },
  { text: "뽀뽀", subject: "duo", action: "playful cheek kiss with heart sparkles" },
  { text: "수고했어", subject: "duo", action: "one gently patting the other's head" },
  { text: "ㅋㅋㅋ", subject: "duo", action: "both laughing hard with tears of joy" },
] as const;

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

export function selectRandomChatEmoticonScenes(
  random: () => number = Math.random
): ChatEmoticonScene[] {
  const selected = (["character", "persona", "duo"] as const).flatMap((subject) =>
    shuffled(
      CHAT_EMOTICON_SCENE_POOL.filter((scene) => scene.subject === subject),
      random
    ).slice(0, 3)
  );
  return shuffled(selected, random);
}

export function buildChatEmoticonPrompt(opts: {
  characterName: string;
  characterGender?: ImagePromptGender;
  personaName: string;
  personaGender?: ImagePromptGender;
  scenes: readonly ChatEmoticonScene[];
}): string {
  const panels = opts.scenes
    .map((scene, index) => {
      const subject =
        scene.subject === "character"
          ? `chat character ${opts.characterName} only`
          : scene.subject === "persona"
            ? `user persona ${opts.personaName} only`
            : `both ${opts.characterName} and ${opts.personaName}`;
      return `${index + 1}. Exact Korean text: “${scene.text}” | Subject: ${subject} | Acting: ${scene.action}.`;
    })
    .join("\n");

  return [
    "Create one polished square 3-by-3 Korean SD/chibi emoticon sheet with exactly nine equal panels.",
    "Reference image 1 is the layout and finish reference. Keep only its clean 3x3 grid, rounded panel borders, safe text margins, pastel sticker finish and expressive merchandise quality. Do not copy its people.",
    `Reference image 2 is the identity reference for chat character ${opts.characterName}. Reference image 3 is the identity reference for user persona ${opts.personaName}.`,
    buildImageGenderLockPrompt([
      {
        label: "chat character",
        name: opts.characterName,
        gender: opts.characterGender ?? "other",
      },
      {
        label: "user persona",
        name: opts.personaName,
        gender: opts.personaGender ?? "other",
      },
    ]),
    "Identity separation is critical. Preserve each person's hair color, eye color, hairstyle, facial details, accessories and signature outfit impression. Never blend or swap the two identities.",
    "Use the following exact nine panels in this exact order:",
    panels,
    "Render exactly one listed Korean phrase in each panel, verbatim and fully legible. The pose, props and facial expression must clearly match that phrase.",
    "Exactly nine panels and exactly two identities overall. Solo panels contain only the named person; duo panels contain both. No third person, duplicate person, extra panel, missing panel, merged face, cropped text, extra text, signature, logo or watermark.",
  ].join("\n\n");
}

export function resolveChatEmoticonPrice(): number {
  return CHAT_EMOTICON_GENERATION_DEFAULT_POINTS;
}
