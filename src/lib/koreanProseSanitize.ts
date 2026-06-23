/** DeepSeek 등이 한국어 본문에 끼워 넣는 흔한 일본어 표현 → 한국어 */
export function fixCommonJapaneseLeaksInKoreanProse(text: string): string {
  return text
    .replace(/([\uAC00-\uD7A3])どころか/g, "$1은커녕")
    .replace(/どころか([\uAC00-\uD7A3\s])/g, "은커녕$1");
}
