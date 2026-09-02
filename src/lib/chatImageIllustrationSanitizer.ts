/**
 * Illustration prompt sanitizer — shared by LD/TRPG prompts and safe visual projection.
 */

export function sanitizeChatTurnForIllustrationPrompt(raw: string): string {
  let text = String(raw ?? "");
  text = text
    .replace(/<<<STATUS_VALUES[\s\S]*?>>>/gi, " ")
    .replace(/<<<STATUS[\s\S]*?>>>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");

  const replacements: Array<[RegExp, string]> = [
    [/자해/g, "괴로움"],
    [/자살/g, "절망"],
    [/목을\s*조/g, "목을 감싸"],
    [/목을\s*졸/g, "목을 감싸"],
    [/손목을\s*긋/g, "손을 움켜쥐"],
    [/손목을\s*그어/g, "손을 움켜쥐"],
    [/손목에\s*칼/g, "손에"],
    [/손목/g, "손"],
    [/피를\s*흘리/g, "눈물을 흘리"],
    [/피범벅/g, "땀범벅"],
    [/피투성이/g, "땀투성이"],
    [/칼날/g, "날카로운 시선"],
    [/흉터/g, "흔적"],
    [/상처\s*입은/g, "마음 아픈"],
    [/마음의\s*상처/g, "마음의 아픔"],
    [/죽을\s*것\s*같/g, "너무 벅찬 것 같"],
    [/죽을\s*만큼/g, "미칠 만큼"],
    [/심장이\s*멎/g, "심장이 두근"],
    [/self[-\s]?harm/gi, "distress"],
    [/\bsuicide\b/gi, "despair"],
    [/\bblood(?:y)?\b/gi, "blush"],
    [/\bscar(?:s)?\b/gi, "mark"],
    [/\bslit\b/gi, "line"],
    [/\bwrist(?:s)?\b/gi, "hand"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text.replace(/\s+/g, " ").trim().slice(0, 2_500);
}

export const ILLUSTRATION_SAFE_DEPICTION =
  "SAFETY — depict a non-explicit, non-graphic, provider-safe visual scene. Preserve cast, location, relationship, emotion, and natural adult intimacy (embrace, kiss, closeness, shirtless adult male torso, bare shoulders) when appropriate. Do not depict explicit sexual acts, exposed genitals, active injury, blood, weapons in use, self-harm, suicide, or medical trauma. A healed, non-graphic scar from saved identity may remain. Do not force a generic business meeting if the scene is romantic or intimate but still non-explicit.";
