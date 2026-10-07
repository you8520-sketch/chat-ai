/** Client-safe token estimate (한글 기준 대략 글자수 ≈ 토큰) */
export function estimateTokensFromCharCount(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars * 0.9));
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}
