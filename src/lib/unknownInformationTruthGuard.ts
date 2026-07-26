/**
 * Unknown-information truth priority — final system-tail guard block.
 *
 * Not a prose-style rule. Responsibility is limited to: when the user asks for
 * concrete facts absent from current prompt sources, do not invent them;
 * factuality outranks length / scene expansion in that case only.
 */

export const UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK =
  "[미확인 정보 — 사실성 절대 우선]\n" +
  "사용자가 구체적인 시각·일정·장소·조직·기록·수치·결과를 요구할 때, 현재 입력·최근 대화·확립된 설정·주입된 기억에 없으면 모르는 정보로 취급한다. " +
  "관련 범주나 사물이 존재한다는 사실만으로 구체값을 추론하지 않는다. 부서·안내·단말기만으로 시간·방 번호·회의명·화면을 만들지 않는다. " +
  "캐릭터는 모른다고 자연스럽게 답하거나 확인이 필요하다고 할 수 있다. 장면에 이미 존재하거나 확립된 확인 수단이 있을 때만 확인을 시작할 수 있다. " +
  "없던 단말기·서류·기록·안내판을 만들지 않으며 확인 결과도 만들지 않는다. " +
  "근거가 실제로 존재하는 정보는 그대로 답한다. 확립된 설정까지 회피하거나 무조건 모른다고 하지 않는다. " +
  "이때는 사실성이 분량과 장면 확장보다 우선한다. 모르는 구체값을 채우려 새 사건·조회 결과를 쓰지 않는다. " +
  "이 규칙을 본문에 쓰지 않는다.";

export const UNKNOWN_INFORMATION_TRUTH_GUARD_SECTION_ID =
  "rule-unknown-information-truth-absolute-tail";
