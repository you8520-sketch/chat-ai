/**
 * Canonical User Note mandatory-rules constraint policy (dependency-neutral).
 * Semantic text owned once — consumed by corePrompt, noGodmodding, autoProgressionRules.
 */

/** Full persistent-constraint semantics — injected once under focus [MANDATORY_RULES]. */
export const MANDATORY_RULES_PERSISTENT_CONSTRAINT_SEMANTIC =
  "위 조건 중 명시적으로 고정·지속·금지된 항목은 User Note를 수정하기 전까지 현재 장면의 지속 제약으로 유지한다. history, memory, current scene, model inference는 그 제약 안에서 해석한다.";

/** Compact cross-reference for mode-specific authoring owners — subject is 권한. */
export const MANDATORY_RULES_BOUNDED_AUTHORITY_SHORT_REF =
  "이 집필/공동서술 권한은 [MANDATORY_RULES]가 있는 경우, 그 안에 명시된 고정·지속·금지 조건 안에서 행사하며, 그 조건을 변경하지 않는다.";

/** Standard interactive role/direction update bounded by explicit mandatory rules when present. */
export const MANDATORY_RULES_BOUNDED_ROLE_DIRECTION_PRECEDENCE =
  "현재 입력이 역할·대상·방향을 갱신할 때는 [MANDATORY_RULES]가 있는 경우 그 안의 명시적 고정·지속·금지 조건 안에서만, 가장 최신 입력의 관계를 기준으로 반영한다.";
