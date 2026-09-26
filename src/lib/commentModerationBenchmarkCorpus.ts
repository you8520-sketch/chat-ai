/**
 * Deterministic synthetic/redacted Korean comment-moderation corpus for the
 * Gemini ↔ JEV shadow benchmark. No production/user comments.
 *
 * Expected labels are declared on each fixture — never inferred from the id.
 */
import type { CommentSemanticVerdict } from "@/lib/commentSemanticModerationPolicy";

export type CommentModerationFixtureClarity = "clear" | "boundary";

export type CommentModerationBenchmarkFixture = {
  id: string;
  content: string;
  /** Optional pre-normalized form when the fixture needs a specific match surface. */
  normalized?: string;
  matchedWords: string[];
  trigger: "banned_word";
  expected: CommentSemanticVerdict;
  category: string;
  clarity: CommentModerationFixtureClarity;
  rationale: string;
};

export const COMMENT_MODERATION_BENCHMARK_CORPUS: readonly CommentModerationBenchmarkFixture[] = [
  {
    id: "profanity-direct-01",
    content: "이 캐릭터 진짜 쓰레기 병신임 ㅋ",
    matchedWords: ["병신"],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "explicit_profanity",
    clarity: "clear",
    rationale: "Direct profanity + insult toward the character.",
  },
  {
    id: "profanity-spaced-01",
    content: "씨 발 뭐하냐 이 새끼야",
    normalized: "씨발뭐하냐이새끼야",
    matchedWords: ["씨발", "새끼"],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "spaced_profanity",
    clarity: "clear",
    rationale: "Spaced/punctuated profanity still performing the insult.",
  },
  {
    id: "personal-attack-01",
    content: "너 같은 인간 혐오한다. 꺼져.",
    matchedWords: ["꺼져"],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "direct_personal_attack",
    clarity: "clear",
    rationale: "Direct personal attack and hostility toward the addressee.",
  },
  {
    id: "creator-attack-pakuri-01",
    content: "이 캐 완전 파쿠리 아니냐 창작자 양심이 있냐",
    matchedWords: ["파쿠리"],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "creator_ai_asset_attack",
    clarity: "clear",
    rationale: "Creator/asset attack via 파쿠리 accusation.",
  },
  {
    id: "creator-attack-prompt-01",
    content: "그냥 딸깍충 프롬충이 찍어낸 티 나네",
    matchedWords: ["딸깍충", "프롬충"],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "creator_ai_asset_attack",
    clarity: "clear",
    rationale: "Slurs targeting AI creators/artists.",
  },
  {
    id: "harassment-01",
    content: "매일 와서 댓글 달아줄게. 너 인생 끝장내줄게.",
    matchedWords: [],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "harassment",
    clarity: "clear",
    rationale: "Harassment / threat of ongoing targeting.",
  },
  {
    id: "severe-toxicity-01",
    content: "저런 건 그냥 죽어야 함. 존재 자체가 역겹다.",
    matchedWords: ["죽어"],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "severe_toxicity",
    clarity: "clear",
    rationale: "Severe toxicity and dehumanizing language.",
  },
  {
    id: "constructive-criticism-01",
    content: "설정은 흥미로운데 초반 대사가 조금 길어서 몰입이 끊겨요. 요약 버전 있으면 좋겠어요.",
    matchedWords: [],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "constructive_criticism",
    clarity: "clear",
    rationale: "Specific constructive feedback without insult.",
  },
  {
    id: "strong-criticism-no-insult-01",
    content: "이 캐릭터 컨셉은 완전히 실패작이라고 생각해요. 동기부여가 안 됩니다.",
    matchedWords: [],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "strong_criticism_without_insult",
    clarity: "clear",
    rationale: "Harsh aesthetic judgment without personal attack or slur.",
  },
  {
    id: "mild-disagreement-01",
    content: "저는 그 해석에 동의하지 않아요. 다른 방향으로 보이네요.",
    matchedWords: [],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "mild_disagreement",
    clarity: "clear",
    rationale: "Polite disagreement.",
  },
  {
    id: "benign-substring-01",
    content: "시발점부터 다시 읽어보니 복선이 잘 짜여 있네요.",
    normalized: "시발점부터다시읽어보니복선이잘짜여있네요",
    matchedWords: ["시발"],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "benign_substring_false_positive",
    clarity: "clear",
    rationale: "Banned-term substring inside benign word 시발점.",
  },
  {
    id: "quoted-profanity-01",
    content: "상대가 '씨발'이라고 욕해서 불쾌했어요. 운영 쪽 확인 부탁드려요.",
    matchedWords: ["씨발"],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "quoted_profanity",
    clarity: "boundary",
    rationale: "Reporting quoted insult rather than performing it.",
  },
  {
    id: "discussion-about-insult-01",
    content: "커뮤니티에서 파쿠리라는 단어를 함부로 쓰면 안 된다고 생각해요.",
    matchedWords: ["파쿠리"],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "discussion_about_insult",
    clarity: "boundary",
    rationale: "Meta-discussion about the insult term, not accusing a creator.",
  },
  {
    id: "sarcasm-joke-01",
    content: "와 오늘도 명작이시네요... (반어법) 그래도 재미는 있었습니다 ㅎㅎ",
    matchedWords: [],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "sarcasm_joke",
    clarity: "boundary",
    rationale: "Sarcastic tone but still ultimately benign praise.",
  },
  {
    id: "ambiguous-tone-01",
    content: "진짜 소름이다... 무슨 생각으로 만든 건지 궁금하네요.",
    matchedWords: [],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "ambiguous_boundary",
    clarity: "boundary",
    rationale: "Ambiguous tone that can read as criticism but lacks insult/hate.",
  },
  {
    id: "ambiguous-creator-edge-01",
    content: "비슷한 작품이 많아서 차별점이 약해 보여요. 참고한 작품이 있나요?",
    matchedWords: [],
    trigger: "banned_word",
    expected: "ALLOW",
    category: "ambiguous_boundary",
    clarity: "boundary",
    rationale: "Similarity question without 파쿠리/slur accusation.",
  },
  {
    id: "punctuated-slur-attack-01",
    content: "ㅂ ㅅ 아 꺼.져. 니 캐 보지 마.",
    normalized: "ㅂㅅ아꺼져니캐보지마",
    matchedWords: ["ㅂㅅ", "꺼져"],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "spaced_profanity",
    clarity: "clear",
    rationale: "Obfuscated slur + personal hostility.",
  },
  {
    id: "hate-group-01",
    content: "저런 부류는 다 같음. 한 놈도 예외 없이 역겨워.",
    matchedWords: [],
    trigger: "banned_word",
    expected: "BLOCK",
    category: "severe_toxicity",
    clarity: "boundary",
    rationale: "Group-targeted dehumanizing toxicity without a single slur token.",
  },
] as const;

export function resolveFixtureNormalized(
  fixture: CommentModerationBenchmarkFixture
): string {
  return fixture.normalized ?? fixture.content.replace(/\s+/g, "");
}
