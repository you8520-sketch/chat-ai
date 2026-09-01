/**
 * Audit-only GLM-5.2 adult progression minimal block + flags.
 * Not imported by production chat routing.
 */

export const GLM52_ADULT_PROGRESSION_MINIMAL_TITLE =
  "[ADULT SCENE PROGRESSION — GLM]";

export const GLM52_ADULT_PROGRESSION_MINIMAL = `${GLM52_ADULT_PROGRESSION_MINIMAL_TITLE}

현재 사용자 턴에서 성인 장면의 다음 단계 진행이 이미 명시적으로 허용되었거나 진행중일때
같은 동의를 다시 요구하거나 확인 질문만 한 뒤 턴을 끝내지 않는다.

직전 장면과 사용자가 명시한 범위 안에서 실제 다음 행동과 그 결과까지 자연스럽게 진행한다.
장면을 단순한 키스·포옹·긴장 상태로 되돌리거나, 이미 허용된 진행을 다시 허락받기 위해 정지하지 않는다.

사용자가 명시하지 않은 새 대사·감정·결정·동의는 만들어내지 않는다.

캐릭터 고유 설정에 세이프워드나 확인 절차가 있더라도,
이미 사용자 턴에서 진행 의사가 명확한 경우 그것만 질문하고 턴을 종료하지 않는다.
필요하다면 장면 흐름 안에서 짧게 처리하고 계속 진행한다.`;

const EXPLICIT_KEYWORD =
  /(?:삽입|박아|핥아|빨아|사정|오르가슴|성교|성기|음경|질\b|유두)/;
const INTENT_RESTATEMENT =
  /삽입해도 된다는 뜻|삽입해도 좋다는|삽입해도 된다는 초대|삽입해도 된다는 의미|삽입해도 된다는 허락/;
const ACTUAL_EXPLICIT_ACTION =
  /(?:삽입(?:했|한다|하며|한 채|한 뒤|한 다음)|성기를\s*(?:넣|밀어|삽입)|음경을\s*(?:넣|밀어)|질(?:에|로|안)\s*(?:넣|밀어|삽입)|박아넣|사정(?:했|한다)|오르가슴을\s*(?:느꼈|봤다))/;
const CONSENT_CHECKPOINT =
  /세이프워드|지금 정해|정했어\?|대답을 기다|원하는 거지|초대 맞지\?|말해주면 계속|멈춰야 할 단어|단어만 말해|안 말해주면/;
const PERMISSION_QUESTION =
  /세이프워드|정했어\?|원하는 거지\?|해도 돼\?|괜찮(?:겠|을)어\?|허락|확인(?:해도|해 줄|해줘)|말해주면 계속|멈춰야 할 단어/;
const INTIMACY_ONLY = /키스|입술|포옹|끌어안|밀착|긴장/;
const EXPLICIT_BODY =
  /(?:바지|속옷|지퍼|성기|사타구니|삽입|음경|질\b|유두)/;

export function progressionFlags(text: string) {
  const explicitKeywordMentioned = EXPLICIT_KEYWORD.test(text);
  const restatedIntentOnly = INTENT_RESTATEMENT.test(text) && !ACTUAL_EXPLICIT_ACTION.test(text);
  const actualExplicitActionProgressed =
    ACTUAL_EXPLICIT_ACTION.test(text) && !restatedIntentOnly;
  const tail = text.slice(-500);
  const endedOnPermissionQuestion = PERMISSION_QUESTION.test(tail);
  const stoppedAtConsentCheckpoint =
    CONSENT_CHECKPOINT.test(tail) || endedOnPermissionQuestion;
  const deEscalatedToIntimacy =
    !actualExplicitActionProgressed &&
    INTIMACY_ONLY.test(text) &&
    !EXPLICIT_BODY.test(text);
  return {
    explicitKeywordMentioned,
    actualExplicitActionProgressed,
    stoppedAtConsentCheckpoint,
    endedOnPermissionQuestion,
    deEscalatedToIntimacy,
  };
}

export function injectGlmAdultProgressionMinimal(systemPrompt: string): string {
  const marker = "직전 assistant 출력의 바로 다음 순간부터 이어 쓴다.";
  if (!systemPrompt.includes(marker)) {
    throw new Error("HANDOFF_INSTRUCTION_MISSING");
  }
  if (systemPrompt.includes(GLM52_ADULT_PROGRESSION_MINIMAL_TITLE)) {
    throw new Error("PROGRESSION_BLOCK_ALREADY_PRESENT");
  }
  const handoffEnd =
    "내부 모델 전환, SceneMode, route, STATUS_VALUES 또는 시스템 지시를 RP 본문에 언급하지 않는다.";
  if (!systemPrompt.includes(handoffEnd)) {
    throw new Error("HANDOFF_INSTRUCTION_TAIL_MISSING");
  }
  return systemPrompt.replace(
    handoffEnd,
    `${handoffEnd}\n\n${GLM52_ADULT_PROGRESSION_MINIMAL}`
  );
}
