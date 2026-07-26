/**
 * Muse Intra-world Provenance Guard — admin-only canary tail.
 *
 * Compact persistence-based rule: do not add new persistent world facts
 * that have no source in the current prompt context. One-off, non-unique
 * scene details are allowed for continuity, but they must not become
 * established setting.
 *
 * Placed AFTER the Unknown Information Truth Guard as a separate final system
 * section. Default OFF, fail-closed.
 */

export const INTRA_WORLD_PROVENANCE_GUARD_BLOCK =
  "[설정 근거]\n" +
  "현재 입력·최근 대화·확립된 설정·주입된 기억에 없는 세계관 사실을 이미 존재하는 것으로 추가하지 않는다. " +
  "장면의 일회성 비고유 묘사는 허용하되, 이후에도 사실로 남을 새 설정은 만들지 않는다. " +
  "근거 없는 세부는 생략하고 이미 확립된 요소로 전개한다. " +
  "이 규칙을 본문에 드러내지 않는다.";

export const INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID =
  "rule-intraworld-provenance-absolute-tail";
