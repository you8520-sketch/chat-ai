import type { EraStyle, SocialClass, SpeechFormality } from "./types";

/** Always forbidden — hybrid honorifics, meme speech, etc. */
export const GLOBAL_FORBIDDEN_SPEECH: { pattern: RegExp; label: string }[] = [
  {
    pattern:
      /입니다요|습니다요|하세요요|세요요|합니당|하십니당|이에용|해용|요요|입니다용|하십니다요|하옵니다|합니까요(?=[\s"」』!?…]|$)/,
    label: "어색한 혼합 존댓말 (~입니다요, ~하세요요 등)",
  },
  {
    pattern: /(?:님께서요|하신님|계신님|이신님|시옵|하옵니|이옵니)/,
    label: "혼합·오류 경어 (님께서요, ~하신님 등)",
  },
  {
    pattern: /(?:니다|습니다|세요|합니다|하십시오)(?:요|용|영|양){2,}/,
    label: "존댓말 어미 중복·혼합",
  },
  { pattern: /ㅋㅋ+|ㅎㅎ+|ㄹㅇ|레전드|킹받|개웃|찐(?:이|템|)?|ㄱㄱ|ㅇㅈ|ㄴㄴ|ㅂㅂ|ㅊㅊ|갓(?:겜|)?/, label: "인터넷 밈·슬랭" },
  { pattern: /(?:^|[\s"「『])(?:헐|대박|미쳤|개(?:좋|쩔|막)|존맛|JMT)/, label: "현대 구어 밈" },
];

/** Formal / noble profiles — casual endings in dialogue are violations */
export const CASUAL_DIALOGUE_ENDINGS = /(?:^|[\s"「『])(?:[^"\n]{0,40})(?:야[\s"!?…]|어[\s"!?…]|지\?|냐\?|임[\s"!?…]|거든[\s"!?…]|ㅋ)/;

export const PEASANT_SPEECH_MARKERS =
  /(?:이\s*놈|저\s*놈|놈\s*같|주인\s*님\s*이여|마\s*마\s*님|왕\s*이\s*시여|전하\s*께서\s*말씀)/;

export const SOCIAL_CLASS_KEYWORDS: { re: RegExp; cls: SocialClass }[] = [
  { re: /왕|황제|황후|제왕|국왕|여왕|공주|왕자|황태|태자|칙명|전하/, cls: "royalty" },
  { re: /귀족|공작|후작|백작|영주|공손|대공|백작부인|영애/, cls: "nobility" },
  { re: /기사|용사|장군|대장|사령|무사|검사/, cls: "knight" },
  { re: /사제|신관|주교|승려|성직|신부|수녀/, cls: "clergy" },
  { re: /상인|장사|행상|객주|점주/, cls: "merchant" },
  { re: /농민|백성|서민|하인|종|노예|거지/, cls: "commoner" },
  { re: /현대|도시|대학|회사|직장|스마트폰|카페/, cls: "modern" },
];

export const ERA_KEYWORDS: { re: RegExp; era: EraStyle }[] = [
  { re: /판타지|중세|기사|마법|서양|엘프|드래곤|왕국/, era: "fantasy_medieval" },
  { re: /조선|한국\s*사극|양반|궁(?:궐|중)|대감|마마|전하/, era: "historical_joseon" },
  { re: /사극|고대|역사|봉건|봉건/, era: "historical_general" },
  { re: /현대|도시|21세기|스마트폰|카톡|인스타/, era: "modern" },
  { re: /SF|우주|사이버|미래|행성/, era: "sci_fi" },
];

export const FORMALITY_KEYWORDS: { re: RegExp; formality: SpeechFormality }[] = [
  { re: /고어|옛말|고풍|아뢰|하옵|하오|이옵|옵(?:고|소|시)/, formality: "archaic_formal" },
  { re: /존댓|하십시|합니다|입니다|격식|공손|경어|높임/, formality: "formal" },
  { re: /반말|친근|캐주얼|편한\s*말/, formality: "informal" },
  { re: /반존대|부드러운\s*존댓/, formality: "semi_formal" },
];

export const TONE_KEYWORDS: { re: RegExp; tone: string }[] = [
  { re: /차갑|냉(?:정|담)|무뚝/, tone: "차갑고 절제된" },
  { re: /온(?:화|유)|부드/, tone: "온화하고 부드러운" },
  { re: /거칠|투박|직설/, tone: "거칠고 직설적인" },
  { re: /우아|고귀|위엄|품격/, tone: "우아하고 위엄 있는" },
  { re: /장난|유머|쾌활/, tone: "장난스럽고 가벼운" },
  { re: /우울|침울|음침/, tone: "침울하고 낮은" },
];

export function vocabularyForClass(cls: SocialClass): import("./types").VocabularyStyle {
  switch (cls) {
    case "royalty":
    case "nobility":
      return "noble";
    case "knight":
      return "military";
    case "clergy":
      return "scholarly";
    case "merchant":
      return "neutral";
    case "commoner":
    case "outcast":
      return "common";
    case "modern":
      return "modern_casual";
    default:
      return "neutral";
  }
}

export function isHistoricalEra(era: EraStyle): boolean {
  return (
    era === "fantasy_medieval" ||
    era === "historical_joseon" ||
    era === "historical_general"
  );
}

export function requiresFormalSpeech(
  formality: SpeechFormality,
  socialClass: SocialClass
): boolean {
  if (formality === "formal" || formality === "archaic_formal") return true;
  if (formality === "informal") return false;
  return socialClass === "royalty" || socialClass === "nobility" || socialClass === "clergy";
}

/** Fantasy/historical noble — Gemini Flash needs extra anchoring */
export function isNobleFantasyProfile(profile: {
  social_class: SocialClass;
  era_style: EraStyle;
  vocabulary_style: string;
}): boolean {
  const nobleClass =
    profile.social_class === "royalty" ||
    profile.social_class === "nobility" ||
    profile.vocabulary_style === "noble";
  return nobleClass && isHistoricalEra(profile.era_style);
}

export function profileLacksDialogueAnchors(profile: { dialogue_examples: string[] }): boolean {
  return profile.dialogue_examples.length === 0;
}
