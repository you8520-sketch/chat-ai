import { type ImagePromptGender } from "@/lib/chatImageGeneration";
import { CHAT_ROOM_IMAGE_GENERATION_POINTS } from "@/lib/chatImagePricing";
import { buildChatImagePairGenderLock } from "@/lib/chatImageGender";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
  renderChatImageVisualIdentity,
  type ChatImageAppearanceMode,
  type ChatImageVisualSubject,
} from "@/lib/chatImageVisualIdentity";

export const CHAT_EMOTICON_TEMPLATE_ID = "emoticon_grid_9" as const;
export const CHAT_EMOTICON_TEMPLATE_NAME = "랜덤 9종 이모티콘";
export const CHAT_EMOTICON_TEMPLATE_PREVIEW_URL =
  "/image-templates/sd-emoticon-grid-9.webp";

export const CHAT_EMOTICON_GENERATION_DEFAULT_POINTS = CHAT_ROOM_IMAGE_GENERATION_POINTS;
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
  { text: "좋아해", subject: "character", action: "holding a small heart close to the chest with a shy smile" },
  { text: "안아줘", subject: "character", action: "opening both arms for a warm hug with sparkling eyes" },
  { text: "화났어", subject: "character", action: "tiny angry pout with a comic steam puff above the head" },
  { text: "울먹", subject: "character", action: "teary eyes, trembling lips and small hands near the face" },
  { text: "잘했어", subject: "character", action: "proud smile while giving a big thumbs up" },
  { text: "기운내", subject: "character", action: "encouraging pose with a tiny cheering flag and bright smile" },
  { text: "잠깐만", subject: "character", action: "raising one hand in a cute stop gesture while looking flustered" },
  { text: "오케이", subject: "character", action: "confident OK hand sign with a wink and sparkle" },
  { text: "박수!", subject: "character", action: "clapping happily with small star sparkles around both hands" },
  { text: "고마워", subject: "persona", action: "hands clasped with a grateful sparkling smile" },
  { text: "잘 자", subject: "persona", action: "sleepy under a small blanket with a moon pillow" },
  { text: "좋은 아침!", subject: "persona", action: "stretching brightly beside a tiny sunrise" },
  { text: "미안해", subject: "persona", action: "teary apologetic face with hands together" },
  { text: "다녀올게", subject: "persona", action: "waving while carrying a small shoulder bag" },
  { text: "조심해", subject: "persona", action: "worried but caring expression, pointing gently" },
  { text: "부탁해", subject: "persona", action: "earnest pleading eyes and folded hands" },
  { text: "감동이야", subject: "persona", action: "happy tears with both hands over the heart" },
  { text: "오케이!", subject: "persona", action: "confident OK hand sign and a wink" },
  { text: "좋아요", subject: "persona", action: "big thumbs up with a clean approval sparkle" },
  { text: "사랑해", subject: "persona", action: "forming a finger heart with a warm affectionate smile" },
  { text: "힘내!", subject: "persona", action: "cheering with both fists raised and a bright determined face" },
  { text: "괜찮아", subject: "persona", action: "gentle reassuring smile with one hand over the heart" },
  { text: "대박!", subject: "persona", action: "wide-eyed amazed expression with starry eyes" },
  { text: "싫어", subject: "persona", action: "turning away with a cute firm pout and crossed arms" },
  { text: "바빠!", subject: "persona", action: "rushing with tiny motion lines while holding a phone and bag" },
  { text: "기절", subject: "persona", action: "dramatically fainting backward with spiral eyes and stars" },
  { text: "기다려줘", subject: "persona", action: "running forward while waving one hand apologetically" },
  { text: "좋아요!", subject: "duo", action: "both giving enthusiastic thumbs up" },
  { text: "안녕!", subject: "duo", action: "both waving brightly side by side" },
  { text: "화이팅!", subject: "duo", action: "both cheering with raised fists" },
  { text: "축하해!", subject: "duo", action: "celebrating together with confetti and a tiny cake" },
  { text: "최고야!", subject: "duo", action: "one praising the other while both smile proudly" },
  { text: "꼬옥", subject: "duo", action: "warm full hug with happy closed eyes" },
  { text: "뽀뽀", subject: "duo", action: "playful cheek kiss with heart sparkles" },
  { text: "수고했어", subject: "duo", action: "one gently patting the other's head" },
  { text: "ㅋㅋㅋ", subject: "duo", action: "both laughing hard with tears of joy" },
  { text: "고마워!", subject: "duo", action: "one offering a small gift while both smile warmly" },
  { text: "미안해!", subject: "duo", action: "one apologizing with bowed head while the other gently reassures" },
  { text: "사랑해!", subject: "duo", action: "both making heart signs together with floating hearts" },
  { text: "힘내자!", subject: "duo", action: "both bumping fists in encouragement with energetic sparkles" },
  { text: "같이가!", subject: "duo", action: "one pulling the other by the hand as both hurry forward" },
  { text: "쉬자", subject: "duo", action: "both resting side by side with warm tea and sleepy smiles" },
  { text: "완벽해", subject: "duo", action: "both posing proudly beside a big check mark" },
  { text: "놀랐지?", subject: "duo", action: "one surprising the other with a popper and confetti" },
  { text: "약속!", subject: "duo", action: "both linking pinkies with a tiny heart sparkle" },
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

function defaultEmoticonSubjects(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  subjects?: readonly ChatImageVisualSubject[];
}): ChatImageVisualSubject[] {
  if (opts.subjects?.length) return [...opts.subjects];
  return bindChatImageReferencePack({
    template: {
      url: CHAT_EMOTICON_TEMPLATE_PREVIEW_URL,
      role: "layout template",
    },
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      characterImageUrl: "/character-ref",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaName: opts.personaName,
      personaGender: opts.personaGender,
      personaImageUrl: "/persona-ref",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
    }),
  }).subjects;
}

export function buildChatEmoticonPrompt(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  scenes: readonly ChatEmoticonScene[];
  subjects?: readonly ChatImageVisualSubject[];
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
    renderChatImageVisualIdentity({
      subjects: defaultEmoticonSubjects(opts),
      hasTemplate: true,
    }),
    buildChatImagePairGenderLock({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
    }),
    "Use the following exact nine panels in this exact order:",
    panels,
    "Render exactly one listed Korean phrase in each panel, verbatim and fully legible. The pose, props and facial expression must clearly match that phrase.",
    "Exactly nine panels and exactly two identities overall. Solo panels contain only the named person; duo panels contain both. No third person, duplicate person, extra panel, missing panel, cropped text, extra text, signature, logo or watermark.",
  ].join("\n\n");
}

export function buildEmoticonGenerationPlan(opts: {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
  characterImageUrl: string;
  characterSavedAppearance: string;
  characterAppearanceMode: ChatImageAppearanceMode;
  personaImageUrl: string;
  personaSavedAppearance: string;
  personaAppearanceMode: ChatImageAppearanceMode;
  scenes: readonly ChatEmoticonScene[];
}) {
  const pack = bindChatImageReferencePack({
    template: {
      url: CHAT_EMOTICON_TEMPLATE_PREVIEW_URL,
      role: "layout template",
    },
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      characterImageUrl: opts.characterImageUrl,
      characterSavedAppearance: opts.characterSavedAppearance,
      characterAppearanceMode: opts.characterAppearanceMode,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
      personaImageUrl: opts.personaImageUrl,
      personaSavedAppearance: opts.personaSavedAppearance,
      personaAppearanceMode: opts.personaAppearanceMode,
    }),
  });
  return {
    subjects: pack.subjects,
    referenceUrls: pack.referenceUrls,
    prompt: buildChatEmoticonPrompt({
      characterName: opts.characterName,
      characterGender: opts.characterGender,
      personaName: opts.personaName,
      personaGender: opts.personaGender,
      scenes: opts.scenes,
      subjects: pack.subjects,
    }),
  };
}

export function resolveChatEmoticonPrice(): number {
  return CHAT_EMOTICON_GENERATION_DEFAULT_POINTS;
}
