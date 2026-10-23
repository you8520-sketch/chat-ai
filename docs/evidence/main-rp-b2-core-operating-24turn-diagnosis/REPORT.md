# Main RP — 운영 24턴 관리자 채팅 기억 진단 (READ-ONLY)

Docs only. `src/` 변경 없음. Provider 호출 0. 운영 DB 쓰기·복사 0. Railway 변수 변경 0. 배포 0. 새 SSH 키·터널 0. #1591 미병합.

판정: **보이는 24턴 RAW와 4개 5턴 요약은 대조한 사건에서 대체로 맞다. 최초 확정 손상은 5턴 요약이 아니다. `chats.memory_meta`에 현재 원문에 없는 약속 9개가 남아 있다.** 이 표본을 80턴 성능의 증거로 쓰지 않는다.

## BEFORE

이 런은 `bc-4e5718cb`다. origin/main과 운영 `RAILWAY_GIT_COMMIT_SHA`는 `69ed6acc`다. 기존 `HAV_RAILWAY_SSH_KEY`를 0600 임시 파일로 복원해 `railway ssh -p 072644e5-ce50-49bb-ab2e-1f13bae6b149 -s chat-ai -e production`으로 접속했다. DB는 `/data/app.db`, `readonly` + `query_only=1`. 파일 크기 38,531,072바이트, mtime `2026-10-14T08:06:01.490Z`는 조회 전후가 같다.

대상은 이전에 확인한 관리자 본인·공식 로스터·관리자 페르소나 24턴 채팅 1건이다. 일반 사용자 채팅은 열지 않았다. 채팅 id, 사용자 id, 이메일은 적지 않는다. 원문 전체와 페르소나 비밀은 이 공개 기록에 없다.

## PROBLEM

조사한 요약 구간은 4개다. `1-5`, `6-10`, `11-15`, `16-20`. 전부 `main_canon`, `user_edited=0`, `inactive=0`. `chat_memories.recent_summary`는 이 네 요약을 이어 붙인 1,942자다. `archive_summary`는 비어 있다. 압축은 아직 없다.

`messages`는 사용자 24, assistant 25(인사 1 포함)다. 마지막 남은 메시지 시각은 `2026-09-12`다. `chat_memories.updated_at`은 `2026-10-13`이다. `message_generations.completedTurns`는 36까지 있다. 현재 메시지 턴은 24다. 25–36턴 생성 기록은 12건 남고, 그 턴의 메시지는 없다. `memory_relationship_before_json`은 남은 메시지에서 0건이다.

당시 발송 final wire는 없다. `message_generations.context_json`은 라우팅·토큰 감사만 있다. 재구성은 `RECONSTRUCTED_WIRE`로만 표시한다.

### 발견한 오류

관계 원장 `chats.memory_meta`에 약속 10개와 소지품 1개가 있다. 소지품(녹색 피어싱)은 현재 RAW에 있다. 약속 중 현재 24턴 사용자·assistant 원문에 토큰이 없는 항목이 있다. 공개 기록에는 그 문구를 적지 않는다. 빠진 고유 토큰은 인물명 1개, 표본 코드 1개, 교육·옥상·특정 달력 기한이다. 현재 RAW에 있는 내일 훈련장 계획은 후반 미봉인 턴의 assistant 대사와 맞는다. 원장에만 있는 나머지 약속은 보이는 세계선과 어긋난다.

코드 주인은 `rollbackRelationshipMetaForDeletedTurnCore` (`src/lib/memory/memory-relationship-meta.ts`)다. `memory_relationship_before_json`이 없으면 약속 문구가 남은 메시지 또는 삭제한 턴 원문의 부분 문자열일 때만 지운다. 추출문은 원문 복사가 아니다. 부분 문자열 대조는 그 약속을 남긴다. 다음 턴 주입 주인은 `formatMemoryMetaForPrompt` (`src/lib/chatMemory.ts`)다. 남은 21–24턴 RP는 원장에만 있는 고유 토큰을 아직 말하지 않았다. 저장 손상은 확인됐고, 그 손상의 소비는 이 표본에서 아직 없다.

### 인접 정상 사례

6–10턴 요약은 RAW와 맞다. 녹색 피어싱을 후드에 달아 준 일, 처음 들은 칭찬, 평생 달고 다니겠다는 캐릭터 말, 길고양이, 부지부장의 복귀 지시, 막아 줄지 사실을 말할지 고르라는 질문이 원문에 있다. 화자 바꿈과 없는 약속 추가는 이 구간에서 보이지 않는다.

1–5턴과 16–20턴 요약도 대조한 사건 기준으로는 짧은 압축이지, 연속성을 깨는 왜곡으로 보지 않았다. 11–15턴은 사용자의 편한 동거 선택을 캐릭터 쪽 ‘전속’ 프레임과 같이 적는다. 원문에 두 표현이 모두 있어 최초 손상으로 채택하지 않았다.

episodic 9행은 출처 턴 6, 8, 10, 11, 12다. 대조한 행은 해당 턴 assistant 주장과 맞다. 1–5와 13–24에는 episodic이 없다. 그것만으로 실패로 보지 않는다.

## AFTER

제품 변경 없음. 운영 상태 변경 없음. 원문 추출물을 저장소에 올리지 않았다.

## NEXT

다음 수정 대상 하나: 삭제·롤백 뒤에 관계 원장이 남은 RAW 세계선과 어긋나지 않게 하는 것. 산 주인은 `src/lib/memory/memory-relationship-meta.ts`의 `rollbackRelationshipMetaForDeletedTurnCore`와, 그 전제 스냅샷 `memory_relationship_before_json`이다. 5턴 요약 owner를 먼저 바꾸지 않는다. 새 기억 구조를 제안하지 않는다.

## REMOVED

임시 SSH 신원. 컨테이너 `/tmp` 원문 덤프. 로컬 원문 덤프는 공개 저장소 밖 작업 파일이다.

## PRESERVED

5턴 봉인, `[현재기억]`, episodic 추출, 출력 길이 정책, #1591, Railway 변수, 운영 DB 파일. 일반 사용자 채팅 본문은 없다.

## REGRESSION RISKS

제품 변경이 없으므로 회귀는 없다. 원장 잔여를 요약 실패로 고치거나, 없는 80턴 오류를 만들어 패치하면 이 경계를 넘는다.

## PROOF

- main / 운영 SHA `69ed6acc`. 요약 구간 4. episodic 9. 사용자 턴 24.
- 남은 메시지 끝 `2026-09-12`. 기억 갱신 `2026-10-13`. 생성 기록 `completedTurns` 36. before 스냅샷 0.
- 현재 RAW에 없는 관계 약속이 원장에 남아 있다. 6–10턴 요약은 RAW와 맞다.
- 저장 final wire 없음. `RECONSTRUCTED_WIRE`만 가능.
- `query_only=1`. 파일 크기·mtime 불변. Provider 0. `src/` diff 없음.

GPT 검수 후 STOP.
