/**
 * Muse Intra-world Provenance Guard — admin-only canary tail.
 *
 * Blocks the model from spontaneously inventing concrete institutional details
 * (rules, procedures, forms, dedicated devices, agency practices) and presenting
 * them as established facts when they have no source in the current input,
 * recent conversation, established setting, or injected memory.
 *
 * Placed AFTER the Unknown Information Truth Guard as a separate final system
 * section. Default OFF, fail-closed.
 */

export const INTRA_WORLD_PROVENANCE_GUARD_BLOCK =
  "[세계 내부 구체 설정 — 출처 우선]\n" +
  "사용자가 묻지 않았더라도, 서술·대사·환경 묘사에서 현재 입력·최근 대화·확립된 설정·주입된 기억에 없는 제도·규정·절차·의무·검사·서식·기록 체계·전용 장치의 존재나 기능을 확립된 사실처럼 만들지 않는다. " +
  "관련 능력·기관·시설·사물이 이미 존재하거나 장르상 그럴듯하다는 이유만으로 구체적인 운영 방식과 세부 제도를 추론하지 않는다. " +
  "장면의 물리적 연속성을 위한 비고유 배경 디테일은 사용할 수 있다. 그러나 이를 새로운 규칙·제도·기관 관행·공식 절차·장치 체계로 확정하지 않는다. " +
  "근거가 없으면 해당 구체 설정을 쓰지 않고, 현재 인물의 행동과 이미 존재하는 장면 요소로 전개한다. 분량이나 분위기를 채우기 위해 출처 없는 세계관 사실을 만들지 않는다. " +
  "이 규칙 자체를 본문에서 설명하거나 인용하지 않는다.";

export const INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID =
  "rule-intraworld-provenance-absolute-tail";
