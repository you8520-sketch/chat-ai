/** Low-level action text semantics — no localScene, stats, or adjudication policy. */

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/** Quoted dialogue only — preserves *stage/action* wrappers and unquoted action prose. */
export function stripQuotedDialogue(body: string): string {
  return normalizeBody(body)
    .replace(/「[^」]{0,400}」/g, " ")
    .replace(/『[^』]{0,400}』/g, " ")
    .replace(/["“”][^"“”]{0,400}["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const INVESTIGATION = /수색|뒤지|훔치|조사한다|살핀다|살피|훑|확인한다|기척|탐색|숨은/;
const CHALLENGE =
  /문을?\s|창문을?\s|화물|조준|석궁|때리|치며|달리|뛰어|돌진|막는다|막으려|막아|가로막|방어|집어|던지|부순|연다|민다|뽑는다|베|찌르|잠근|휘두|메고|꽂|파고들|주먹|내지르|억지로|딴다|칼을|은신|숨는|숨어서|몰래/;

const HAZARD_ENGAGEMENT =
  /무너지(?:는|는|진)?[^.]{0,24}(?:뛰|넘|밀|들)|(?:뛰(?:어)?(?:넘)?|넘(?:어)?|밀(?:어)?|들(?:어)?|밟|가로질|통과|파(?:고)?)[^.]{0,24}(?:잔해|틈|포자(?:층|낭| 구역| 지대)?)|(?:잔해|틈|포자(?:층|낭| 구역| 지대)?)[^.]{0,24}(?:뛰(?:어)?(?:넘)?|넘(?:어)?|밀(?:어)?|들(?:어)?|밟|가로질|통과|파(?:고)?)|맨(?:손|몸)[^.]{0,20}(?:집|잡|만|붙|쥐|넣|닿)|잠긴[^.]{0,20}(?:문|창)[^.]{0,20}(?:연|밀|딴|부|억)|(?:억지|강제)[^.]{0,16}(?:연|밀|딴|부)/;

const PHYSICAL_ENTRY =
  /(?:들여(?:놓|넣)|(?:한\s)?발(?:을)?[^.]{0,20}(?:들|옮|내디|디)|(?:안쪽|안으로|통로|틈|문턱)[^.]{0,20}(?:들|진입|밀|뛰)|(?:뛰|달|진)[^.]{0,16}(?:들|진입|통과))/;

const CONTESTED = /속이|거짓말|협박|위협|설득하려|통과하려|거짓말로|속이려/;

function hasHazardEngagement(text: string): boolean {
  const normalized = normalizeBody(text);
  if (!HAZARD_ENGAGEMENT.test(normalized)) return false;
  if (
    /(?:[^\s]{1,12}(?:이|가|은|는))[^.]{0,28}(?:밟|들어|넘)[^.]{0,28}(?:포자|잔해|틈)/.test(normalized) &&
    !/(?:몸을|미끼(?:를)?|손(?:을)?|발(?:을)?|맨(?:손|몸))[^.]{0,28}(?:내밀|밀|넣|들|밟|가로질|통과)[^.]{0,28}(?:포자|잔해|틈|함몰|흐름)/.test(
      normalized
    )
  ) {
    return false;
  }
  if (isNonCommittingHazardProbe(normalized)) return false;
  return true;
}

function isNonCommittingHazardProbe(text: string): boolean {
  return /(?:전원|스위치|장치|미끼|장비|진동)[^.]{0,28}(?:넣지|켜지|작동|가동)[^.]{0,12}않[^.]{0,48}(?:내밀|뻗|들|밀)/.test(
    text
  );
}

function hasActorPhysicalEntry(text: string): boolean {
  const normalized = normalizeBody(text);
  if (!PHYSICAL_ENTRY.test(normalized)) return false;
  if (
    /(?:[^\s]{1,16}(?:이|가))[^.]{0,28}(?:들어|진입)[^.]{0,12}(?:순간|모습|뒤|장면)/.test(normalized)
  ) {
    return false;
  }
  if (
    /(?:보였|보인|보이|알았|느꼈|재고|갈라|좁혔|말했다|경고(?:한|하)|알려(?:준|주))/.test(normalized) &&
    !/(?:몸을|발(?:을|뒤꿈치)?|손(?:을)?|어깨|한\s?발)[^.]{0,20}(?:들|밀|넘|진입|내디|디|놓|넣)/.test(
      normalized
    )
  ) {
    return false;
  }
  return true;
}

export function hasChallengeSignal(body: string): boolean {
  const text = normalizeBody(body);
  if (!text) return false;
  return (
    INVESTIGATION.test(text) ||
    CHALLENGE.test(text) ||
    hasHazardEngagement(text) ||
    hasActorPhysicalEntry(text) ||
    CONTESTED.test(text)
  );
}

export function classifyChallengeKind(body: string): "challenge" | "hazard" | "contested" | null {
  const text = normalizeBody(body);
  if (!text) return null;
  if (CONTESTED.test(text)) return "contested";
  if (hasHazardEngagement(text)) return "hazard";
  if (hasActorPhysicalEntry(text)) return "challenge";
  if (INVESTIGATION.test(text) || CHALLENGE.test(text)) return "challenge";
  return null;
}
