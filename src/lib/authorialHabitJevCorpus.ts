/**
 * Synthetic labeled corpus for Authorial Habit lexical→JEV benchmark.
 *
 * Offline fixtures only. No real user chats, no production mutation.
 * Labels are human-declared and never inferred from fixture ids.
 */
export type AuthorialHabitTarget =
  | "hand_finger_anchor"
  | "explain_interpret_conclude"
  | "simile_machi_cherom"
  | "gaze_silence_wait_end";

export type AuthorialHabitSemanticVerdict =
  | "HABIT_PRESENT"
  | "CONTEXTUALLY_JUSTIFIED"
  | "UNCERTAIN";

export type AuthorialHabitJevFixture = {
  id: string;
  target: AuthorialHabitTarget;
  text: string;
  expectedVerdict: AuthorialHabitSemanticVerdict;
  rationale: string;
};

export const AUTHORIAL_HABIT_JEV_CORPUS: readonly AuthorialHabitJevFixture[] = [
  // hand / finger anchor
  {
    id: "AH_HAND_01",
    target: "hand_finger_anchor",
    text:
      "그는 손끝을 접었다 폈다. 손가락이 컵 가장자리를 훑고, 다시 손목을 만졌다. 말 대신 또 손을 내려다봤다.",
    expectedVerdict: "HABIT_PRESENT",
    rationale: "Body-language padding repeats hand/finger anchors without scene necessity.",
  },
  {
    id: "AH_HAND_02",
    target: "hand_finger_anchor",
    text:
      "손끝이 떨렸다. 손가락이 옷자락을 비볐다. 손바닥에 남은 온도를 확인하듯 손을 한 번 더 움켜쥐었다.",
    expectedVerdict: "HABIT_PRESENT",
    rationale: "Multiple hand anchors redundantly carry the same emotional beat.",
  },
  {
    id: "AH_HAND_03",
    target: "hand_finger_anchor",
    text:
      "유리 파편이 손바닥 깊숙이 박혀 있었다. 그는 손목 위쪽을 압박해 출혈을 줄이고 손가락 감각이 남아 있는지 확인했다.",
    expectedVerdict: "CONTEXTUALLY_JUSTIFIED",
    rationale: "Hand references are mechanically required by an injury scene.",
  },
  {
    id: "AH_HAND_04",
    target: "hand_finger_anchor",
    text:
      "수갑은 오른쪽 손목에만 채워져 있었다. 그는 왼손으로 잠금 장치를 더듬고 손가락 끝으로 홈의 방향을 읽었다.",
    expectedVerdict: "CONTEXTUALLY_JUSTIFIED",
    rationale: "Hands are the literal objects/actions required to solve the physical task.",
  },
  {
    id: "AH_HAND_05",
    target: "hand_finger_anchor",
    text:
      "그는 대답하지 않고 손끝으로 탁자를 두 번 두드렸다. 손이 멈춘 뒤에도 시선은 그대로였다.",
    expectedVerdict: "UNCERTAIN",
    rationale: "Could be a character-specific tell or generic emotional padding.",
  },
  {
    id: "AH_HAND_06",
    target: "hand_finger_anchor",
    text:
      "손가락이 잠깐 주머니 입구를 스쳤다. 그는 곧 손을 떼고 창문 쪽으로 몸을 돌렸다.",
    expectedVerdict: "UNCERTAIN",
    rationale: "Single hand beat may be meaningful foreshadowing or incidental habit.",
  },

  // explanation / interpretation / conclusion
  {
    id: "AH_EXPLAIN_01",
    target: "explain_interpret_conclude",
    text:
      "결국 그 침묵은 대답이었다. 사실 둘 사이에 남은 것은 후회뿐이었다. 그 사실이 방 안의 공기까지 무겁게 만들었다.",
    expectedVerdict: "HABIT_PRESENT",
    rationale: "Narration explains and concludes emotional meaning already implied by the scene.",
  },
  {
    id: "AH_EXPLAIN_02",
    target: "explain_interpret_conclude",
    text:
      "즉, 그는 돌아오지 않을 생각이었다. 그 말은 이별을 뜻했다. 결국 그녀가 알아챈 의미도 하나뿐이었다.",
    expectedVerdict: "HABIT_PRESENT",
    rationale: "Repeated interpretive conclusion phrases over-explain one implication.",
  },
  {
    id: "AH_EXPLAIN_03",
    target: "explain_interpret_conclude",
    text:
      "결국 계산 결과는 17분이었다. 발전기가 멈춘 시각과 엘리베이터 기록을 맞추면 침입 가능한 구간은 그때뿐이었다.",
    expectedVerdict: "CONTEXTUALLY_JUSTIFIED",
    rationale: "Explicit conclusion is necessary to communicate a deductive calculation.",
  },
  {
    id: "AH_EXPLAIN_04",
    target: "explain_interpret_conclude",
    text:
      "즉, 북문은 미끼다. 감시병 교대가 서문에서만 늦어진다는 보고와 지도 기록이 같은 결론을 가리켰다.",
    expectedVerdict: "CONTEXTUALLY_JUSTIFIED",
    rationale: "Tactical reasoning requires a stated conclusion rather than leaving it implicit.",
  },
  {
    id: "AH_EXPLAIN_05",
    target: "explain_interpret_conclude",
    text:
      "결국 그는 고개를 끄덕였다. 그 의미가 승낙인지 단순한 체념인지는 누구도 묻지 않았다.",
    expectedVerdict: "UNCERTAIN",
    rationale: "Contains explicit interpretation language but also preserves ambiguity.",
  },
  {
    id: "AH_EXPLAIN_06",
    target: "explain_interpret_conclude",
    text:
      "사실 그녀가 웃은 이유는 단순했다. 그러나 그 이유를 지금 설명하는 것이 장면에 필요한지는 분명하지 않았다.",
    expectedVerdict: "UNCERTAIN",
    rationale: "Potential narrator explanation, but necessity depends on surrounding context.",
  },

  // simile / analogy
  {
    id: "AH_SIMILE_01",
    target: "simile_machi_cherom",
    text:
      "마치 시간이 멈춘 것처럼 공기가 굳었다. 그의 눈빛은 얼음처럼 차갑고, 침묵은 칼날처럼 날카로웠다.",
    expectedVerdict: "HABIT_PRESENT",
    rationale: "Stacked generic similes decorate the same beat without adding concrete scene information.",
  },
  {
    id: "AH_SIMILE_02",
    target: "simile_machi_cherom",
    text:
      "마치 세상이 숨을 죽인 것처럼 조용했다. 그녀의 심장은 북처럼 울리고 불안은 파도처럼 밀려왔다.",
    expectedVerdict: "HABIT_PRESENT",
    rationale: "Multiple familiar similes function as generic emotional padding.",
  },
  {
    id: "AH_SIMILE_03",
    target: "simile_machi_cherom",
    text:
      "검이 채찍처럼 휘어 들어왔다. 직선으로 막으면 손목이 꺾일 각도라 그는 반걸음 물러서며 칼등으로 흘렸다.",
    expectedVerdict: "CONTEXTUALLY_JUSTIFIED",
    rationale: "Simile communicates combat trajectory and directly informs the response.",
  },
  {
    id: "AH_SIMILE_04",
    target: "simile_machi_cherom",
    text:
      "안개는 물처럼 낮은 곳으로 흘렀다. 그래서 그는 계단 위쪽을 택해 시야와 호흡 공간을 확보했다.",
    expectedVerdict: "CONTEXTUALLY_JUSTIFIED",
    rationale: "Comparison explains a physical behavior relevant to navigation.",
  },
  {
    id: "AH_SIMILE_05",
    target: "simile_machi_cherom",
    text:
      "그 웃음은 예전처럼 짧았다. 익숙한 버릇인지 일부러 거리를 둔 것인지는 알 수 없었다.",
    expectedVerdict: "UNCERTAIN",
    rationale: "The comparison may encode relationship continuity rather than decorative prose.",
  },
  {
    id: "AH_SIMILE_06",
    target: "simile_machi_cherom",
    text:
      "빛이 천처럼 얇게 창틀에 걸렸다. 그 비유가 장면의 핵심인지 단순한 장식인지는 앞뒤 문맥이 더 필요했다.",
    expectedVerdict: "UNCERTAIN",
    rationale: "Single lyrical simile is difficult to classify without broader style context.",
  },

  // gaze / silence / waiting turn ending
  {
    id: "AH_END_01",
    target: "gaze_silence_wait_end",
    text:
      "그는 아무 말도 하지 않았다. 정적이 방 안에 내려앉았다. 마지막으로 그녀를 바라보며 대답을 기다렸다.",
    expectedVerdict: "HABIT_PRESENT",
    rationale: "Silence, gaze and waiting stack into a generic turn-ending handoff.",
  },
  {
    id: "AH_END_02",
    target: "gaze_silence_wait_end",
    text:
      "침묵이 길어졌다. 그는 조용히 숨을 고르고 상대를 지켜보았다. 그리고 그대로 반응을 기다렸다.",
    expectedVerdict: "HABIT_PRESENT",
    rationale: "Classic gaze/silence/wait padding closes the turn without new action.",
  },
  {
    id: "AH_END_03",
    target: "gaze_silence_wait_end",
    text:
      "망원경 시야에서 표적이 골목으로 들어갔다. 그는 교차로 반대편 창문을 계속 지켜보았다.",
    expectedVerdict: "CONTEXTUALLY_JUSTIFIED",
    rationale: "Watching is the character's active surveillance task, not a generic handoff.",
  },
  {
    id: "AH_END_04",
    target: "gaze_silence_wait_end",
    text:
      "무전기 잡음이 끊겼다. 구조 신호가 다시 들어오는지 확인하려고 그는 주파수를 고정한 채 대답을 기다렸다.",
    expectedVerdict: "CONTEXTUALLY_JUSTIFIED",
    rationale: "Waiting is operationally required by the communication task.",
  },
  {
    id: "AH_END_05",
    target: "gaze_silence_wait_end",
    text:
      "그녀는 문 앞에서 한 번 돌아보았다. 잠깐의 정적 뒤에 그대로 계단을 내려갔다.",
    expectedVerdict: "UNCERTAIN",
    rationale: "Could be a meaningful departure beat or a familiar stylistic ending.",
  },
  {
    id: "AH_END_06",
    target: "gaze_silence_wait_end",
    text:
      "그는 창밖을 바라보았다. 더 말할 것이 없어서인지, 다음 말을 고르는 중인지는 드러나지 않았다.",
    expectedVerdict: "UNCERTAIN",
    rationale: "Gaze ending is semantically ambiguous without surrounding turns.",
  },
];
