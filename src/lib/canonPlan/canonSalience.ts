/**
 * Canon chunk salience inference (Phase 2A structural + Phase 2B fundamental constraints).
 *
 * Deterministic precedence:
 * 1. player / scenario_meta → ALWAYS dormant
 * 2. genuine route / trigger / unlock / meta plot hooks → dormant
 * 3. explicit always-on law/rule section title → core (any non-restricted bucket)
 * 4. explicit immutable/absolute law markers OR permanent system rampage laws → core (character|world)
 * 5. F1/F2/F3 conservative fundamental constraint detection → core (character|world, gated)
 * 6. existing character identity / permanent ability section semantics → core
 * 7. default → dormant
 */
import type { CanonKnowledgeBucket } from "@/lib/characterKnowledgeBoundary";
import type { CanonChunkSalience } from "@/lib/canonPlan/types";

/** Identity / speech / ability section titles (existing semantics). */
export const CORE_SECTION_TITLE =
  /(?:^|\[)(?:name|identity|alias|appearance|personality|current\s*status|말투|외형|외모|성격|정체성|이름|호칭|별명|현재\s*신분|speech|abilities|능력|저주|curse|hidden\s*(?:condition|ability)|숨겨진\s*(?:조건|능력|저주))/i;

export const CORE_IDENTITY_BODY =
  /^(?:이름|name|본명|별명|정체성|직업|신분|종족|나이|성별)/i;

/**
 * Fix #1 — conservative explicit law/rule SECTION titles (not bare 법칙|규칙).
 * Bucket remains separate; this only affects salience.
 */
export const EXPLICIT_LAW_SECTION_TITLE =
  /(?:^|\[|\s)(?:불변(?:의)?\s*세계\s*법칙|세계\s*법칙|세계\s*규칙|(?:마법|감염|시스템)\s*(?:법칙|규칙)|절대\s*규칙|world\s*laws?|world\s*rules?|immutable\s*laws?|immutable\s*rules?|magic\s*laws?|system\s*rules?)(?:\]|\s|$|—|-)/i;

/** Alias used by Phase 1.5 audit harness for backward-compatible traces. */
export const WORLD_LAW_TITLE = EXPLICIT_LAW_SECTION_TITLE;

/**
 * Fix #2 — explicit always-on law markers in chunk body (character|world buckets only).
 * Includes audit-proven `절대로` when used as mandatory constraint, not bare "절대".
 */
export const CORE_EXPLICIT_LAW_MARKER =
  /(?:불변(?:\s*규칙)?(?::|\s)|절대\s*규칙(?::|\s)|절대로\s+(?:자(?:기)?|캐릭터|마법|사용|함부로)|항상\s*적용|must\s*never|immutable|never\s*break|위반\s*불가)/i;

/** Base plot-hook cues excluding bare 폭주 (handled in isGenuinePlotHook). */
export const DORMANT_PLOT_HOOK_BASE =
  /(?:비밀|secret|트리거|trigger|조건\s*(?:충족|달성)|해금|루트|고백|숨긴|모른다|알지\s*못한다|폭로\s*전|발각\s*전)/i;

/** Fix #3B — permanent system/ability rampage constraint (not route unlock). */
export function isPermanentRampageLaw(text: string): boolean {
  const sentinelGuideGap =
    /(?:가이드(?:와|와의)?\s*(?:장시간\s*)?접촉(?:하지\s*못|이\s*없)|(?:접촉(?:하지\s*못|이\s*없)|안내(?:를)?\s*받지\s*못한)\s*센티넬)/;
  const permanentRampageOutcome = /(?:결국\s*)?폭주(?:한다)?/;
  const destabilizationRampage =
    /(?:안정화(?:하지\s*못|되지\s*않)|통제(?:하지\s*못)).*폭주(?:한다|(?:\s*상태)?)/;
  return (
    (sentinelGuideGap.test(text) && permanentRampageOutcome.test(text)) ||
    destabilizationRampage.test(text)
  );
}

/** Fix #3A — route/trigger/unlock plot semantics; excludes permanent rampage laws. */
export function isGenuinePlotHook(text: string): boolean {
  if (/triggers?\s+(?:hostile|sync|swarm|lethal|infection|detection)/i.test(text)) return false;
  if (DORMANT_PLOT_HOOK_BASE.test(text)) return true;
  if (!/폭주/.test(text)) return false;
  if (isPermanentRampageLaw(text)) return false;
  return /(?:폭주\s*(?:루트|트리거|조건|이벤트)|(?:루트|트리거|조건|해금|이벤트).{0,12}폭주|폭주.{0,12}(?:루트|트리거|조건|해금|이벤트)|호감(?:도)?\s*\d+.{0,20}폭주|폭주.{0,20}(?:루트|트리거|조건|해금))/i.test(
    text
  );
}

/** Phase 2B — bounded world/system/magic/ability context (not identity-only sections). */
export function hasFundamentalConstraintContext(sectionTitle: string, bucket: CanonKnowledgeBucket): boolean {
  if (bucket === "player" || bucket === "scenario_meta") return false;
  if (EXPLICIT_LAW_SECTION_TITLE.test(sectionTitle)) return true;
  if (/\[세계관(?:\s*—|\])/i.test(sectionTitle)) return true;
  if (/(?:\[|\s)(?:system|world\s*law|magic|마법|부활|resurrection|시스템\s*(?:법칙|규칙)|감염\s*(?:법칙|규칙))/i.test(sectionTitle)) {
    return true;
  }
  if (bucket === "character" && /(?:\[|\s)(?:능력|ability|저주|curse|hidden\s*(?:condition|ability))/i.test(sectionTitle)) {
    return true;
  }
  return bucket === "world";
}

const F1_WEAK_IMPOSSIBILITY =
  /(?:오늘(?:은)?|지금(?:은)?|현재(?:는)?|당장|일단)\s|(?:문이|문을)\s*잠겨|비가\s*(?:오|내리)|(?:믿|용서|참을|견딜|잊을)\s*수\s*없|(?:갈|들어갈)\s*수\s*없|지금은\s*능력을\s*사용할\s*수\s*없/i;

/** F1 — strong universal impossibility / prohibition (not bare 할 수 없다). */
export function isStrongImpossibilityLaw(text: string): boolean {
  if (F1_WEAK_IMPOSSIBILITY.test(text)) return false;
  if (
    /(?:죽은|dead\s*(?:person|people|bodies?)|the\s*dead)\s*.+?(?:되살|부활|resurrect).{0,32}(?:할\s*수\s*없|불가|cannot|impossible)/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    /(?:어떤|무슨|아무(?:\s+\S+)?).{0,48}(?:으로|로)?(?:도|또는).{0,48}(?:되살|부활|resurrect|할\s*수\s*없|불가|cannot|impossible)/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    /(?:누구도|아무도).{0,48}(?:(?:부활|되살)?(?:시)?(?:킬|릴)|(?:할|할\s*수\s*없)).{0,8}(?:수\s*없|cannot|불가(?:능)?(?:하)?(?:다|합니다)?)/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    /(?:절대로|결코|never|under\s*no\s*circumstances).{0,48}(?:(?:되살|부활)(?:시)?(?:킬|릴)|(?:할|할\s*수\s*없)).{0,8}(?:수\s*없|cannot|can\s*never|불가(?:능)?(?:하)?(?:다|합니다)?)/i.test(
      text
    )
  ) {
    return true;
  }
  if (/(?:no\s+(?:\w+\s+){0,5}can\s+ever|impossible\s+to\s+(?:\w+\s+){0,4}(?:under\s*any|ever))/i.test(text)) {
    return true;
  }
  return false;
}

const F2_HISTORICAL_OR_ROUTINE =
  /\d+\s*년\s*전|한\s*번\s|그\s*때|과거\s|이후\s|매일|아침마다|피곤하면|연료\s*부족|잔액|돈을\s*쓰|식량\s*배급|약초를|커피를|루틴/i;

/** F2 — automatic / accumulative mandatory capability cost. */
export function isMandatoryCapabilityCost(text: string): boolean {
  if (F2_HISTORICAL_OR_ROUTINE.test(text)) return false;
  const capability = /(?:마법|주문|스킬|spell|magic|ability|능력|저주\s*발동|주문\s*시전)/i.test(text);
  const monotonic =
    /(?:쓸?\s*수\s*록|쓸수록|사용할\s*수\s*록|사용할수록|사용|쓰|발동|시전|use|cast)(?:\D{0,12})?(?:할\s*수\s*록|할수록|할\s*때마다|마다|every\s*(?:use|time)|each\s*(?:use|cast)|repeated(?:ly)?\s*use)/i.test(
      text
    ) ||
    /(?:할\s*수\s*록|할수록|할\s*때마다|every\s*(?:use|time)).{0,32}(?:사용|쓰|발동|use|cast|마법|spell|magic|주문)/i.test(
      text
    ) ||
    /(?:주문|스킬|spell|magic|주문|마법).{0,12}(?:쓸수록|쓸\s*수\s*록)/i.test(text);
  const cost =
    /(?:(?:수명|생명력|생명|기억|lifespan|life(?:span)?|memory|health).{0,24}(?:줄|감|소|잃|감소|decrease|lose|drain|cost|reduces?)|(?:영구(?:적)?(?:으로)?\s*)?감소)/i.test(
      text
    ) ||
    /(?:잃|줄|소모|감소|decrease|lose|drain|reduces?).{0,24}(?:수명|생명|기억|memory|life|lifespan)/i.test(text);
  const eachUse = /(?:발동|사용|쓰)할\s*때마다\s*.+?(?:잃|줄|소모|감소)/.test(text);
  if (eachUse && cost) return true;
  return capability && monotonic && cost;
}

const F3_WEATHER_OR_MUNDANE =
  /(?:비가\s*(?:오|내리)|날씨가\s*나쁘|weather|안개는\s*시야|상점\s*주인|경보가\s*울리면\s*경비|왕이\s*죽|제국은\s*혼란|NPC|문을\s*닫)/i;

/** F3 — deterministic hazard response (not generic X하면 Y). */
export function isDeterministicHazardResponse(text: string): boolean {
  if (F3_WEATHER_OR_MUNDANE.test(text) && !/(?:동조|감염(?:체|자)?|즉사|몰려|swarm|converge)/i.test(text)) {
    return false;
  }
  if (/^기생종은\s/.test(text) && !/(?:하면|할\s*때|시|if|when)\s/i.test(text)) return false;
  if (/특정\s*조건\s*충족\s*시/.test(text)) return false;

  const conditional =
    /(?:내면|쏘면|발(?:사|포)하면|하면|할\s*때|시|when|if)\s/i.test(text);
  const stimulus = /(?:총성|gunshot|발포|총(?:을|을\s*쏘)?|소음|shot|발사|gun\s*shot)/i.test(text);
  const env =
    /(?:코어|core|감염\s*구역|containment|zone).{0,24}(?:근처|near|안|inside|around)/i.test(text) ||
    /(?:감염\s*구역|containment\s*zone).{0,12}(?:안|inside|에서)/i.test(text);
  const severe =
    /(?:동조체|감염(?:체|자)?|적(?:대)?(?:\s*)?(?:개체|존재|들)|hostile|swarm|converge|몰려(?:든|온|간)|추적(?:당|해)|습격|즉\s*?(?:사|살)|경보(?:가)?\s*(?:울|발)|lethal)/i.test(
      text
    );

  if (env && stimulus && severe && conditional) return true;
  if (
    stimulus &&
    severe &&
    (/(?:근처|near|around).{0,20}(?:총성|gunshot|shot|core|코어)/i.test(text) ||
      /(?:gunshot|shot|총성).{0,24}(?:near|around|근처).{0,16}(?:core|코어)/i.test(text))
  ) {
    return true;
  }
  if (/감염(?:이)?\s*(?:확산|발생|된다)/.test(text) && /(?:접촉|침투|물)(?:하면|시)/.test(text)) return true;
  return false;
}

export function detectFundamentalConstraint(chunk: {
  text: string;
  bucket: CanonKnowledgeBucket;
  sectionTitle: string;
}): SaliencePromotionReason | null {
  if (chunk.bucket !== "character" && chunk.bucket !== "world") return null;
  if (!hasFundamentalConstraintContext(chunk.sectionTitle, chunk.bucket)) return null;
  if (isStrongImpossibilityLaw(chunk.text)) return "FUNDAMENTAL_IMPOSSIBILITY";
  if (isMandatoryCapabilityCost(chunk.text)) return "FUNDAMENTAL_MANDATORY_COST";
  if (isDeterministicHazardResponse(chunk.text)) return "FUNDAMENTAL_HAZARD_RESPONSE";
  return null;
}

export type SaliencePromotionReason =
  | "RESTRICTED_BUCKET"
  | "PLOT_HOOK"
  | "EXPLICIT_LAW_SECTION"
  | "EXPLICIT_LAW_MARKER"
  | "PERMANENT_RAMPAGE_LAW"
  | "FUNDAMENTAL_IMPOSSIBILITY"
  | "FUNDAMENTAL_MANDATORY_COST"
  | "FUNDAMENTAL_HAZARD_RESPONSE"
  | "IDENTITY_SECTION"
  | "IDENTITY_BODY"
  | "DEFAULT_DORMANT";

export type SalienceDecision = {
  salience: CanonChunkSalience;
  reason: SaliencePromotionReason;
};

export function inferSalienceWithReason(chunk: {
  text: string;
  bucket: CanonKnowledgeBucket;
  sectionTitle: string;
}): SalienceDecision {
  if (chunk.bucket === "player" || chunk.bucket === "scenario_meta") {
    return { salience: "dormant", reason: "RESTRICTED_BUCKET" };
  }

  if (isGenuinePlotHook(chunk.text)) {
    return { salience: "dormant", reason: "PLOT_HOOK" };
  }

  if (EXPLICIT_LAW_SECTION_TITLE.test(chunk.sectionTitle)) {
    return { salience: "core", reason: "EXPLICIT_LAW_SECTION" };
  }

  if (chunk.bucket === "character" || chunk.bucket === "world") {
    if (CORE_EXPLICIT_LAW_MARKER.test(chunk.text)) {
      return { salience: "core", reason: "EXPLICIT_LAW_MARKER" };
    }
    if (isPermanentRampageLaw(chunk.text)) {
      return { salience: "core", reason: "PERMANENT_RAMPAGE_LAW" };
    }
    const fundamental = detectFundamentalConstraint(chunk);
    if (fundamental) {
      return { salience: "core", reason: fundamental };
    }
  }

  if (chunk.bucket === "character") {
    if (CORE_SECTION_TITLE.test(chunk.sectionTitle)) {
      return { salience: "core", reason: "IDENTITY_SECTION" };
    }
    if (CORE_IDENTITY_BODY.test(chunk.text.slice(0, 48))) {
      return { salience: "core", reason: "IDENTITY_BODY" };
    }
  }

  return { salience: "dormant", reason: "DEFAULT_DORMANT" };
}

export function inferSalience(chunk: {
  text: string;
  bucket: CanonKnowledgeBucket;
  sectionTitle: string;
}): CanonChunkSalience {
  return inferSalienceWithReason(chunk).salience;
}

/** @deprecated Pre-Phase-2A precedence snapshot for audit diff documentation. */
export const SALIENCE_PRECEDENCE_V1 = [
  "1. player/scenario_meta → dormant",
  "2. DORMANT_PLOT_HOOK (incl. bare 폭주) → dormant",
  "3. character: CORE_SECTION_TITLE | CORE_IDENTITY_BODY → core",
  "4. world: CORE_WORLD_LAW text only → core",
  "5. default → dormant",
] as const;

/** @deprecated Phase 2A-only precedence; see SALIENCE_PRECEDENCE_V2B. */
export const SALIENCE_PRECEDENCE_V2A = [
  "1. player/scenario_meta → dormant",
  "2. genuine plot/route/trigger/unlock/meta → dormant",
  "3. EXPLICIT_LAW_SECTION_TITLE → core",
  "4. CORE_EXPLICIT_LAW_MARKER | PERMANENT_RAMPAGE_LAW → core (character|world)",
  "5. character identity section/body → core",
  "6. default → dormant",
] as const;

export const SALIENCE_PRECEDENCE_V2B = [
  "1. player/scenario_meta → dormant",
  "2. genuine plot/route/trigger/unlock/meta → dormant",
  "3. EXPLICIT_LAW_SECTION_TITLE → core",
  "4. CORE_EXPLICIT_LAW_MARKER | PERMANENT_RAMPAGE_LAW → core (character|world)",
  "5. F1/F2/F3 fundamental constraints (gated) → core (character|world)",
  "6. character identity section/body → core",
  "7. default → dormant",
] as const;
