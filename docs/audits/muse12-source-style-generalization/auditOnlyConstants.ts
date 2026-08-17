/**
 * AUDIT ARTIFACT ONLY.
 * Do not import this file from src/lib production resolvers.
 * V1 is the frozen Like/Ren source-specific Positive.
 * V2 is the user-supplied generic challenger. Do not retune.
 */

export const MUSE12_AUDIT_V1_OPUS_POSITIVE = `[MUSE SOURCE STYLE CONTINUITY — OPUS 5]
직전 assistant가 붙들고 있던 감각의 초점, 미세한 환경음과 거리감, 순간적인 머뭇거림과 자기인식의 결을 같은 호흡으로 이어간다.
장면이 깊어져도 캐릭터의 말투는 직전 출력의 얇은 농담, 능글맞음, 어색하게 비치는 진심이 함께 섞인 리듬을 유지하며 행동과 감정을 자연스럽게 다음 단계로 연결한다.
문장과 문단은 직전 assistant의 밀도와 호흡을 기준으로 구성하고, 작은 감각·반응·환경 변화를 장면 진행과 함께 이어간다.`;

export const MUSE12_AUDIT_V1_GEMINI_POSITIVE = `[MUSE SOURCE STYLE CONTINUITY — GEMINI 3.1]
직전 assistant의 설명 밀도와 문장 호흡을 기준으로, 행동·감각·상황 설명이 하나의 의미 흐름 안에서 자연스럽게 이어지는 서술을 유지한다.
캐릭터의 말투와 장난스러운 반응, 복장·신체·세계관 요소와 감각적 디테일을 직전 출력이 사용한 방식과 비슷한 밀도로 장면 속에 계속 연결한다.
대사와 서술은 직전 assistant의 배치와 간격을 따라가며, 장면의 행동과 감정 변화가 같은 흐름 안에서 충분히 이어진 뒤 자연스럽게 다음 초점으로 넘어간다.`;

export const MUSE12_AUDIT_V2_STYLE_MIRROR = `[MUSE SOURCE STYLE MIRROR V2]
직전 assistant의 마지막 응답을 이번 출력의 유일한 문체 기준으로 삼아, 같은 작가가 바로 다음 문장을 이어 쓰는 것처럼 작성한다. 이 지침 자체에서 특정 성격·분위기·어휘·감정 성향을 새로 부여하지 않는다.
직전 응답에서 실제로 관찰되는 문장 길이와 호흡, 서술/대사 비율, 문단의 의미 단위와 밀도, 같은 화자의 대사 묶음 방식, 감각·내면·행동의 비중, 캐릭터의 말투·호칭·어휘를 문구 자체를 복사하지 않고 출력 마지막 부분까지 같은 분포로 유지한다.
장면의 강도나 단계가 변해도 범용적인 장르 문체나 상투적인 성인 장면 문체로 바꾸지 않고, 직전 assistant에서 실제로 확인되는 캐릭터의 반응 방식과 서술 방식을 마지막 1/3까지 유지한다.
현재 user 입력에서 진행 의도와 허용 범위가 이미 명확하면 같은 허용을 반복 질문으로 다시 요구하여 장면을 정지시키지 않는다. 새로운 거부·철회·모호성 또는 새로운 경계가 생긴 경우에만 필요한 확인을 한다.
직전 assistant가 사용하지 않은 과도한 대사 분절이나 한두 문장 단위의 문단 파편화를 만들지 않으며, 한국어 문맥에 불필요한 외국 문자 조각을 섞지 않는다.`;

export const LIKE_SPECIFIC_V1_PHRASES = [
  "미세한 환경음과 거리감",
  "얇은 농담",
  "능글맞음",
  "어색하게 비치는 진심",
  "장난스러운 반응",
] as const;
