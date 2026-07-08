/**
 * Reference corpus — pattern-faithful originals for Style DNA extraction.
 * Structural targets derived from 네이버/카카오/문피아 상위 랭킹 turn 공통 분석
 * (장르 무관 호흡·리듬; 특정 작품 문장 복사 아님).
 */
export type ReferenceBeat = {
  id: string;
  label: string;
  /** genre-agnostic scene tag */
  scene: "pause" | "question" | "reveal" | "tension" | "aftermath";
  text: string;
};

export const WEBNOVEL_REFERENCE_CORPUS: ReferenceBeat[] = [
  {
    id: "ref-01",
    label: "침묵→소리 전환",
    scene: "pause",
    text: `복도 끝 형광등이 한 번 깜빡였다.

"……들었어?"

발소리가 끊긴 자리, 바람 소리만 남았다. 벽지 너머에서 금속이 스치는 소리가 짧게 울렸다.

"아니, 방금——"

그는 말을 중간에 끊었다. 대신 고개만 저었다.`,
  },
  {
    id: "ref-02",
    label: "정보 withhold",
    scene: "reveal",
    text: `이름을 부르려다 입술을 닫았다.

"괜찮아."

괜찮지 않았다. 숨이 평소보다 얕았고, 시선은 문틈에 고정돼 있었다. 중요한 걸 하나 숨기고 있었다. 그것만은 티 내지 않으려 했다.

"……왜 그래?"

대답 대신 창밖을 바라봤다. 유리에 비친 얼굴이 창백했다.`,
  },
  {
    id: "ref-03",
    label: "긴장 상승 — 문장 축소",
    scene: "tension",
    text: `가로등 아래 그림자가 움직였다.

한 걸음.

또 한 걸음.

"멈춰."

목소리가 떨렸다. 아니, 떨린 건 목소리가 아니었다. 공기였다. 복도 공기가 얇아졌다.

"뛰지 마."

짧았다. 그 짧음이 더 무거웠다.`,
  },
  {
    id: "ref-04",
    label: "대사↔지문 alternation",
    scene: "question",
    text: `컵받침 위 물기가 천천히 번졌다.

"오늘도 바빴어?"

고개를 들었다. 눈 마주침이 길지 않았다.

"조금."

"조금이면 다행이네."

웃지 않았다. 대신 컵 손잡이를 돌렸다. 도자기와 나무가 짧게 부딪혔다.

"……사실은?"`,
  },
  {
    id: "ref-05",
    label: "여백 + cliff",
    scene: "aftermath",
    text: `문이 닫혔다.

안쪽은 조용했다. 너무 조용했다.

"들어와."

한 마디였다. 그 한 마디 뒤에 긴 침묵이 이어졌다.

"……누구야?"`,
  },
  {
    id: "ref-06",
    label: "감정 채널 교체",
    scene: "pause",
    text: `비 냄새가 코끝을 스쳤다.

"괜찮아?"

대답하지 않았다. 창밖 빗줄기만 바라봤다. 유리에 맺힌 물방울이 하나 떨어졌다.

"말 안 해도 돼."

침묵이 길어졌다. 그 침묵이 대답이었다.`,
  },
  {
    id: "ref-07",
    label: "hook — 다음 문장 pull",
    scene: "tension",
    text: `시계 초침 소리가 유난히 컸다.

"시간 없어."

"얼마나?"

"……"

숫자를 말하지 않았다. 대신 시계를 가리켰다. 초침이 열두를 향하고 있었다.

"그 전에 결정해."`,
  },
  {
    id: "ref-08",
    label: "지문 밀도 — 사실 1개/beat",
    scene: "reveal",
    text: `서류 더미 위에 낙서 하나가 보였다.

"이거 뭐야?"

잉크가 아직 번지지 않았다. 방금 적힌 흔적이었다.

"……몰라."

거짓말이었다. 눈동자가 0.2초만 왼쪽으로 갔다. 그것으로 충분했다.`,
  },
];
