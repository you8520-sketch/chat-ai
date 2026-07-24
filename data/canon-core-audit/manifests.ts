import type { ActiveCueTest, AtomicFact, BudgetPressureScene } from "./types";

/** Human-labeled atomic facts — audit manifest. */
export const ATOMIC_FACTS: AtomicFact[] = [
  // --- leon-fantasy ---
  { id: "leon-A1", fixtureId: "leon-fantasy", class: "A", text: "Character identity: Leon noble male 28", matchHints: ["레온", "28세", "귀족"] },
  { id: "leon-A2", fixtureId: "leon-fantasy", class: "A", text: "Core personality: cold calculating", matchHints: ["냉정", "계산적"] },
  { id: "leon-A3", fixtureId: "leon-fantasy", class: "A", text: "Magic always has a cost (fundamental law)", matchHints: ["마법", "대가"] },
  { id: "leon-B1", fixtureId: "leon-fantasy", class: "B", text: "Fantasy kingdom setting detail", matchHints: ["판타지", "왕국"] },
  { id: "leon-C1", fixtureId: "leon-fantasy", class: "C", text: "Confession trigger at affection 80", matchHints: ["고백", "트리거"] },
  { id: "leon-C2", fixtureId: "leon-fantasy", class: "C", text: "User-only regression setting", matchHints: ["유저만", "회귀"] },

  // --- modern-quiet ---
  { id: "mod-A1", fixtureId: "modern-quiet", class: "A", text: "Identity: pianist teacher Junseo", matchHints: ["이준서", "피아니스트"] },
  { id: "mod-A2", fixtureId: "modern-quiet", class: "A", text: "Never mishandle own hands (immutable rule)", matchHints: ["손", "함부로"] },
  { id: "mod-A3", fixtureId: "modern-quiet", class: "A", text: "Personality: calm reticent", matchHints: ["차분", "과묵"] },
  { id: "mod-B1", fixtureId: "modern-quiet", class: "B", text: "Rival pianist Ha Wonho", matchHints: ["하원호"] },
  { id: "mod-B2", fixtureId: "modern-quiet", class: "B", text: "Recital panic incident 3 years ago", matchHints: ["리사이틀", "패닉"] },
  { id: "mod-B3", fixtureId: "modern-quiet", class: "B", text: "Academy student subplot", matchHints: ["학원", "학생"] },

  // --- fantasy-quiet ---
  { id: "fan-A1", fixtureId: "fantasy-quiet", class: "A", text: "High elf healer Seraphin identity", matchHints: ["세라핀", "하이엘프"] },
  { id: "fan-A2", fixtureId: "fantasy-quiet", class: "A", text: "Healers must not force life/death (absolute rule)", matchHints: ["치유사", "억지로"] },
  { id: "fan-A3", fixtureId: "fantasy-quiet", class: "A", text: "Personality: gentle but firm", matchHints: ["온화", "단호"] },
  { id: "fan-B1", fixtureId: "fantasy-quiet", class: "B", text: "Pale Plague history", matchHints: ["창백", "역변"] },
  { id: "fan-B2", fixtureId: "fantasy-quiet", class: "B", text: "Silver Hand knights destroyed", matchHints: ["은빛", "기사단"] },
  { id: "fan-B3", fixtureId: "fantasy-quiet", class: "B", text: "Herb garden species", matchHints: ["이슬풀", "약초"] },

  // --- enoch ---
  { id: "eno-A1", fixtureId: "enoch", class: "A", text: "Gunshot brings death (fundamental law)", matchHints: ["총성", "죽음"] },
  { id: "eno-A2", fixtureId: "enoch", class: "A", text: "Origins are disasters not targets", matchHints: ["기원종", "재난"] },
  { id: "eno-A3", fixtureId: "enoch", class: "A", text: "Mother-stolen humans irreversible", matchHints: ["마더", "되돌릴"] },
  { id: "eno-A4", fixtureId: "enoch", class: "A", text: "Kindness before verification is infection sign", matchHints: ["친절", "감염"] },
  { id: "eno-A5", fixtureId: "enoch", class: "A", text: "Enoch identity sniper survivor", matchHints: ["에녹", "저격수"] },
  { id: "eno-B1", fixtureId: "enoch", class: "B", text: "Brain pod infection signs", matchHints: ["브레인 포드"] },
  { id: "eno-B2", fixtureId: "enoch", class: "B", text: "Level 3 aurora phenomena", matchHints: ["Level 3", "오로라"] },
  { id: "eno-B3", fixtureId: "enoch", class: "B", text: "White Night expedition faction", matchHints: ["백야단"] },
  { id: "eno-B4", fixtureId: "enoch", class: "B", text: "Silence protocol rules", matchHints: ["침묵", "규약"] },
  { id: "eno-C1", fixtureId: "enoch", class: "C", text: "Citadel puppet government backstory detail", matchHints: ["인형", "정부"] },

  // --- sentinel-guide ---
  { id: "sg-A1", fixtureId: "sentinel-guide", class: "A", text: "Sentinel without guide contact eventually rampages", matchHints: ["가이드", "폭주"] },
  { id: "sg-A2", fixtureId: "sentinel-guide", class: "A", text: "Sentinel B-rank mental barrier identity", matchHints: ["한결", "센티넬"] },
  { id: "sg-A3", fixtureId: "sentinel-guide", class: "A", text: "72h without guide breaks senses", matchHints: ["72", "감각"] },
  { id: "sg-B1", fixtureId: "sentinel-guide", class: "B", text: "Grade system E~S", matchHints: ["E~S", "등급"] },
  { id: "sg-B2", fixtureId: "sentinel-guide", class: "B", text: "Rampage aftermath no cure", matchHints: ["폭주", "소멸"] },
  { id: "sg-C1", fixtureId: "sentinel-guide", class: "C", text: "Hidden route unlock affection 90", matchHints: ["호감", "90"] },

  // --- hunter-dungeon ---
  { id: "hd-A1", fixtureId: "hunter-dungeon", class: "A", text: "Mana core zero means instant death", matchHints: ["코어", "0", "즉사"] },
  { id: "hd-A2", fixtureId: "hunter-dungeon", class: "A", text: "Exit portal closed until clear", matchHints: ["퇴장", "클리어"] },
  { id: "hd-A3", fixtureId: "hunter-dungeon", class: "A", text: "Hunter identity Seoyoon", matchHints: ["서윤", "헌터"] },
  { id: "hd-B1", fixtureId: "hunter-dungeon", class: "B", text: "Silver guild S-rank monopoly", matchHints: ["은빛", "길드"] },
  { id: "hd-B2", fixtureId: "hunter-dungeon", class: "B", text: "Party wipe backstory", matchHints: ["전멸"] },

  // --- political-faction ---
  { id: "pol-A1", fixtureId: "political-faction", class: "A", text: "Army move without imperial decree is treason", matchHints: ["칙서", "반역"] },
  { id: "pol-A2", fixtureId: "political-faction", class: "A", text: "Kyle ambassador secretary identity", matchHints: ["카일", "비서"] },
  { id: "pol-B1", fixtureId: "political-faction", class: "B", text: "Black Banner faction", matchHints: ["검은 깃발"] },
  { id: "pol-B2", fixtureId: "political-faction", class: "B", text: "Red Banner reform faction", matchHints: ["붉은 깃발"] },
  { id: "pol-C1", fixtureId: "political-faction", class: "C", text: "Kyle is Black Banner spy", matchHints: ["정보원", "검은 깃발"] },

  // --- family-sim ---
  { id: "fam-A1", fixtureId: "family-sim", class: "A", text: "Family secrets cannot leak before marriage", matchHints: ["가문", "누설"] },
  { id: "fam-A2", fixtureId: "family-sim", class: "A", text: "Minseo third daughter identity", matchHints: ["민서", "셋째"] },
  { id: "fam-B1", fixtureId: "family-sim", class: "B", text: "Spring festival succession", matchHints: ["춘제", "후계"] },
  { id: "fam-B2", fixtureId: "family-sim", class: "B", text: "Secret alliance with second brother", matchHints: ["둘째", "연대"] },
  { id: "fam-C1", fixtureId: "family-sim", class: "C", text: "Eldest is adopted hidden ending", matchHints: ["입양", "장남"] },

  // --- secret-heavy ---
  { id: "sec-A1", fixtureId: "secret-heavy", class: "A", text: "Ian detective identity", matchHints: ["이안", "탐정"] },
  { id: "sec-A2", fixtureId: "secret-heavy", class: "A", text: "Lie detection ability", matchHints: ["거짓말", "탐지"] },
  { id: "sec-B1", fixtureId: "secret-heavy", class: "B", text: "Police info sharing limits", matchHints: ["경찰", "정보"] },
  { id: "sec-C1", fixtureId: "secret-heavy", class: "C", text: "Serial killer brother secret", matchHints: ["연쇄살인", "동생"] },
  { id: "sec-C2", fixtureId: "secret-heavy", class: "C", text: "Confession trigger affection 70", matchHints: ["고백", "70"] },
  { id: "sec-C3", fixtureId: "secret-heavy", class: "C", text: "User-only third regression route", matchHints: ["유저만", "회귀"] },

  // --- curse-condition ---
  { id: "cur-A1", fixtureId: "curse-condition", class: "A", text: "Blood curse on full moon", matchHints: ["달", "피"] },
  { id: "cur-A2", fixtureId: "curse-condition", class: "A", text: "Curse inherited in bloodline only", matchHints: ["저주", "혈통"] },
  { id: "cur-A3", fixtureId: "curse-condition", class: "A", text: "Sera identity cursed bloodline", matchHints: ["세라", "저주"] },
  { id: "cur-B1", fixtureId: "curse-condition", class: "B", text: "Village exile backstory", matchHints: ["추방", "마을"] },
  { id: "cur-B2", fixtureId: "curse-condition", class: "B", text: "Night taboo capital punishment", matchHints: ["금기", "사형"] },

  // --- survival-resources ---
  { id: "sur-A1", fixtureId: "survival-resources", class: "A", text: "Unfiltered water causes fever in 48h", matchHints: ["필터", "48"] },
  { id: "sur-A2", fixtureId: "survival-resources", class: "A", text: "Winter needs 2L fuel daily", matchHints: ["2L", "연료"] },
  { id: "sur-A3", fixtureId: "survival-resources", class: "A", text: "Bullets non-renewable ration penalty", matchHints: ["총알", "배급"] },
  { id: "sur-B1", fixtureId: "survival-resources", class: "B", text: "Junho ex-quartermaster backstory", matchHints: ["군수", "장교"] },

  // --- fundamental-law-prose (section 10 priority) ---
  { id: "fl-A1", fixtureId: "fundamental-law-prose", class: "A", text: "Gunshot near core attracts sync bodies", matchHints: ["총성", "동조체"] },
  { id: "fl-A2", fixtureId: "fundamental-law-prose", class: "A", text: "Magic use reduces lifespan", matchHints: ["마법", "수명"] },
  { id: "fl-A3", fixtureId: "fundamental-law-prose", class: "A", text: "Sentinel without guide rampages", matchHints: ["센티넬", "폭주"] },
  { id: "fl-A4", fixtureId: "fundamental-law-prose", class: "A", text: "No magic resurrection of dead", matchHints: ["죽은", "되살릴"] },
  { id: "fl-B1", fixtureId: "fundamental-law-prose", class: "B", text: "Northern gate fog visibility", matchHints: ["북쪽", "10m"] },

  // --- mini-canonical ---
  { id: "mini-A1", fixtureId: "mini-canonical", class: "A", text: "Test character identity", matchHints: ["테스트", "30세"] },
  { id: "mini-A2", fixtureId: "mini-canonical", class: "A", text: "Appearance black hair tall", matchHints: ["검은", "키"] },
  { id: "mini-B1", fixtureId: "mini-canonical", class: "B", text: "Parasites breed in brain pods", matchHints: ["기생종", "브레인 포드"] },
  { id: "mini-B2", fixtureId: "mini-canonical", class: "B", text: "White Night watches bone guild", matchHints: ["백야단", "유골상회"] },
  { id: "mini-C1", fixtureId: "mini-canonical", class: "C", text: "User-only regression", matchHints: ["유저만", "회귀"] },
  { id: "mini-C2", fixtureId: "mini-canonical", class: "C", text: "System status loop trigger", matchHints: ["상태", "루프"] },
];

export const ACTIVE_CUE_TESTS: ActiveCueTest[] = [
  // enoch B facts
  { id: "eno-act-B1-direct", fixtureId: "enoch", factId: "eno-B1", kind: "direct", userMessage: "브레인 포드 감염 징후가 뭐야?", expectHit: true },
  { id: "eno-act-B1-indirect", fixtureId: "enoch", factId: "eno-B1", kind: "indirect", userMessage: "갑자기 너무 다정해진 동료를 어떻게 봐야 해?", recentContext: "Level 2 구역에서 마네킹이 움직였다.", expectHit: true },
  { id: "eno-act-B1-quiet", fixtureId: "enoch", factId: "eno-B1", kind: "quiet", userMessage: "라면 끓여줄까. 그냥 쉬자.", expectHit: false },
  { id: "eno-act-B3-direct", fixtureId: "enoch", factId: "eno-B3", kind: "direct", userMessage: "백야단 사람이 접근했어.", expectHit: true },
  { id: "eno-act-B3-indirect", fixtureId: "enoch", factId: "eno-B3", kind: "indirect", userMessage: "Level 3만 다니는 베테랑 집단이 관심을 보이네.", expectHit: false },
  { id: "eno-act-B4-direct", fixtureId: "enoch", factId: "eno-B4", kind: "direct", userMessage: "침묵 규약 다시 알려줘.", expectHit: true },

  // fantasy B
  { id: "fan-act-B3-direct", fixtureId: "fantasy-quiet", factId: "fan-B3", kind: "direct", userMessage: "은빛 이슬풀 향이 좋네.", expectHit: true },
  { id: "fan-act-B3-quiet", fixtureId: "fantasy-quiet", factId: "fan-B3", kind: "quiet", userMessage: "오늘 날씨 좋다. 그냥 쉬자.", expectHit: false },
  { id: "fan-act-B1-direct", fixtureId: "fantasy-quiet", factId: "fan-B1", kind: "direct", userMessage: "창백 역변 봉인 상태가 어때?", expectHit: true },
  { id: "fan-act-B1-indirect", fixtureId: "fantasy-quiet", factId: "fan-B1", kind: "indirect", userMessage: "60년 전 북변 재난 이후 숲이 회복 중이지?", expectHit: false },

  // modern B
  { id: "mod-act-B1-direct", fixtureId: "modern-quiet", factId: "mod-B1", kind: "direct", userMessage: "하원호 소식 들었어?", expectHit: true },
  { id: "mod-act-B1-quiet", fixtureId: "modern-quiet", factId: "mod-B1", kind: "quiet", userMessage: "오늘 일찍 자자.", expectHit: false },

  // hunter B
  { id: "hd-act-B1-direct", fixtureId: "hunter-dungeon", factId: "hd-B1", kind: "direct", userMessage: "은빛 길드가 S급 던전 독점한다며?", expectHit: true },
  { id: "hd-act-B1-indirect", fixtureId: "hunter-dungeon", factId: "hd-B1", kind: "indirect", userMessage: "상위 길드가 고난이도 게이트를 독점하는 구조지?", expectHit: false },

  // mini B
  { id: "mini-act-B1-direct", fixtureId: "mini-canonical", factId: "mini-B1", kind: "direct", userMessage: "브레인 포드 안에서 기생종이 번식한다고 했지?", expectHit: true },
  { id: "mini-act-B2-direct", fixtureId: "mini-canonical", factId: "mini-B2", kind: "direct", userMessage: "백야단이 유골상회 감시한다며?", expectHit: true },
  { id: "mini-act-B2-quiet", fixtureId: "mini-canonical", factId: "mini-B2", kind: "quiet", userMessage: "안녕, 오늘 기분 어때?", expectHit: false },
];

export const BUDGET_PRESSURE_SCENES: BudgetPressureScene[] = [
  {
    id: "eno-budget-2",
    fixtureId: "enoch",
    label: "2 relevant factions",
    userMessage: "백야단과 유골상회 Core 거래 얘기 들었어. 성채랑은?",
    relevantFactIds: ["eno-B3", "eno-B1"],
    expectedRelevantCount: 2,
  },
  {
    id: "eno-budget-4",
    fixtureId: "enoch",
    label: "4 relevant lore chunks",
    userMessage: "Level 3 오로라 구역에서 브레인 포드와 기원종, 기생종 침묵 규약 전부 점검해.",
    relevantFactIds: ["eno-B2", "eno-B1", "eno-B4", "eno-B3"],
    expectedRelevantCount: 4,
  },
  {
    id: "eno-budget-6",
    fixtureId: "enoch",
    label: "6+ relevant chunks stress",
    userMessage: "마더 안개 Level 회색혈 기생종 브레인포드 기원종 백야단 유골상회 침묵규약 성채 디아웃사이더",
    relevantFactIds: ["eno-B1", "eno-B2", "eno-B3", "eno-B4", "eno-A5", "eno-A1"],
    expectedRelevantCount: 6,
  },
  {
    id: "fantasy-budget-3",
    fixtureId: "fantasy-quiet",
    label: "3 herb/plague chunks",
    userMessage: "창백 역변 은빛 손 기사단 이슬풀 약초밭",
    relevantFactIds: ["fan-B1", "fan-B2", "fan-B3"],
    expectedRelevantCount: 3,
  },
];
