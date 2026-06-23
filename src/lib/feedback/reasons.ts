export type ReasonVote = "like" | "dislike";

export type FeedbackReason = {
  id: string;
  vote: ReasonVote;
  labelKo: string;
};

export const FEEDBACK_REASONS: FeedbackReason[] = [
  { id: "speech_inconsistency", vote: "dislike", labelKo: "말투 불일치" },
  { id: "character_break", vote: "dislike", labelKo: "캐릭터 붕괴" },
  { id: "lore_break", vote: "dislike", labelKo: "설정 오류" },
  { id: "forced_romance", vote: "dislike", labelKo: "억지 로맨스" },
  { id: "pacing_issue", vote: "dislike", labelKo: "전개 속도 문제" },
  { id: "overdramatic_prose", vote: "dislike", labelKo: "과한 수식" },
  { id: "user_over_control", vote: "dislike", labelKo: "유저 통제 과다" },
  { id: "unnatural_dialogue", vote: "dislike", labelKo: "부자연스러운 대사" },
  { id: "repetition", vote: "dislike", labelKo: "반복" },
  { id: "bad_narration", vote: "dislike", labelKo: "서술 품질 낮음" },
  { id: "good_speech", vote: "like", labelKo: "말투 좋음" },
  { id: "immersive_writing", vote: "like", labelKo: "몰입감 있는 서술" },
  { id: "strong_characterization", vote: "like", labelKo: "캐릭터 묘사 우수" },
  { id: "emotional_quality", vote: "like", labelKo: "감정 표현 좋음" },
  { id: "good_pacing", vote: "like", labelKo: "전개 속도 좋음" },
  { id: "atmosphere", vote: "like", labelKo: "분위기 좋음" },
  { id: "world_consistency", vote: "like", labelKo: "세계관 일관성" },
];

const REASON_MAP = new Map(FEEDBACK_REASONS.map((r) => [r.id, r]));

export function getReasonById(id: string): FeedbackReason | undefined {
  return REASON_MAP.get(id);
}

export function reasonsForVote(vote: 1 | -1): FeedbackReason[] {
  const kind: ReasonVote = vote === 1 ? "like" : "dislike";
  return FEEDBACK_REASONS.filter((r) => r.vote === kind);
}

export function validateReasonIds(vote: 1 | -1, reasonIds: string[]): string | null {
  const kind: ReasonVote = vote === 1 ? "like" : "dislike";
  for (const id of reasonIds) {
    const reason = REASON_MAP.get(id);
    if (!reason) return `알 수 없는 사유: ${id}`;
    if (reason.vote !== kind) return `사유 '${id}'는 ${vote === 1 ? "좋아요" : "싫어요"}에 사용할 수 없습니다.`;
  }
  return null;
}
