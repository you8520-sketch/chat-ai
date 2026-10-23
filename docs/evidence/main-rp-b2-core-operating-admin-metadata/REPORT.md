# Main RP — 운영 관리자 테스트 채팅 메타데이터 (READ-ONLY)

Docs only. `src/` 변경 없음. Provider 호출 0. 운영 DB 쓰기·복사·마이그레이션 0. Railway 변수 변경 0. 배포 0. 새 SSH 키·터널·서비스 0. 원문 추출 0. #1591 미병합.

판정: **기존 SSH 신원으로 운영 `chat-ai`에 접속했다. 앱이 연 DB는 마운트된 `/data/app.db`다. 관리자 본인 채팅은 4건이고, 등록 캐릭터와 관리자 페르소나가 모두 맞다. 30/50/80턴 이상은 0건이다.**

## BEFORE

이 런은 `bc-4e5718cb-2063-42de-bd2d-dc63e4d2c504`다. 장기 실행 에이전트 `bc-9126af5e`가 아니다. Personal 환경 `chat-ai` (`02f835c4-7866-11f1-ba66-0e7d0216e441`)이고, 부트 빌드는 `bld-20261015-a08213f0`이다.

로컬 `main`은 `69ed6acc`다. 운영 프로세스의 `RAILWAY_GIT_COMMIT_SHA`도 `69ed6acce8983f20a4a7e4c82cdd251a4e5e5328`이다.

`HAV_RAILWAY_SSH_KEY`는 이 프로세스에 주입되어 있다. 길이 410. `CLOUD_AGENT_INJECTED_SECRET_NAMES` 14개 안에 있다. 값, 첫 글자, 본문은 출력하지 않았다. stub `RAILWAY_SSH_PRIVATE_KEY` / `RAILWAY_SSH_PUBLIC_KEY`는 길이 11이라 쓰지 않았다.

## PROBLEM

30/50/80턴 운영 원문이 없어 장기기억 품질의 최초 손상 지점을 아직 확정할 수 없다. 접속 장애는 이번 런에서 풀렸다. 남은 장애는 데이터다.

관리자 범위는 코드 owner `isAdminUser`와 같다. `is_admin=1` 또는 프로세스 `ADMIN_EMAILS`이고, `account_kind=portone_reviewer`는 제외했다. fixture 도메인과 `site_managed=1`은 집계에서 갈랐다. 해당하는 계정은 operator 1개다. 이메일, 사용자 id, 채팅 id는 적지 않는다.

턴은 `messages.role='user'` 개수다. `chat_memories.message_count`가 같은 수였다.

| 항목 | 값 |
|---|---|
| 관리자 본인 채팅 | 4 |
| 등록 캐릭터 있음 | 4 |
| 같은 관리자 소유의 `selected_persona_id` | 4 |
| 캐릭터·페르소나 둘 다 일치 | 4 |
| 페르소나 없음 / 타인 페르소나 / 끊긴 페르소나 | 0 / 0 / 0 |
| 공식 로스터 채팅 | 2. 라이크 1, 권태현 1 |
| 로스터 밖 등록 캐릭터 | 2 |
| 없는 캐릭터 | 0 |
| 강이현 비공개 복제 id 31·32 | 0 |
| 30턴 이상 | 0 |
| 50턴 이상 | 0 |
| 80턴 이상 | 0 |
| 사용자 턴 분포 | 24, 3, 0, 0 |
| 24턴 채팅 | 로스터 캐릭터, 관리자 페르소나, assistant 25개 중 23개가 2,700자 이상, `summarized_turn_count` 20, `chat_turn_summaries`와 `episodic_memory_facts` 있음 |
| 3턴 채팅 | 로스터 캐릭터, 관리자 페르소나, 2,700자 이상 assistant 3개, 요약 턴 0 |
| 0턴 채팅 2개 | 로스터 밖 등록 캐릭터, 관리자 페르소나, assistant 1개 |

공식 로스터 8명(라이크, 플러드, 솔, 권태현, 로코, 강이현, 이혁, 에녹)은 모두 행이 있고 이름이 일치한다. 모드 값은 `safe` 2, `nsfw` 2다. 본문은 읽지 않았다.

## ACCESS

- 운영 컨테이너 접근: **성공**. 공식 Railway CLI `5.68.0`. 기존 Secret을 권한 0600 임시 파일로 복원했고 OpenSSH 파싱만 확인했다. `railway ssh -p 072644e5-ce50-49bb-ab2e-1f13bae6b149 -s chat-ai -e production -i <임시 신원>`이 `ssh.railway.com`에서 `CONNECTED_OK`였다. 조회 후 임시 신원 파일은 삭제했다.
- 운영 DB 경로: **확정**. 서버 프로세스가 `/data/app.db`, `/data/app.db-wal`, `/data/app.db-shm`을 열고 있다. 프로세스 `DATA_DIR=/data`, `NODE_ENV=production`, Turso URL·토큰은 없다. `/data`는 마운트다. 코드 owner는 `src/lib/db.ts`가 `getRemoteDatabaseConfig()`가 없을 때 `getDatabasePath()`로 `{DATA_DIR}/app.db`를 여는 경로다.
- 읽기 방식: `better-sqlite3` `readonly: true`, `query_only=1`. 파일 크기 38,531,072바이트와 mtime `2026-10-14T08:06:01.490Z`가 조회 전후 같다.

## AFTER

제품 변경 없음. 운영 상태 변경 없음. 30/50/80턴 원문 검수는 시작하지 않았다.

## NEXT

30/50/80턴에 해당하는 채팅은 없다. 원문 추출은 하지 않는다.

나중에 24턴 로스터 채팅 1건을 제한적으로 보려면 새 터널이나 API를 만들지 않는다. 같은 `railway ssh`와 0600으로 복원한 기존 신원, 그리고 `query_only` SQLite로 그 한 건의 `messages`, `chat_turn_summaries`, `episodic_memory_facts`, `chat_memories`만 읽으면 된다. 조건은 관리자 본인, 공식 로스터 캐릭터, 본인 페르소나, 사용자 턴 20 이상이다. 이번 조회에서 그 조건의 채팅은 1건이다. DB 파일은 복사하지 않는다. 다른 사용자 채팅은 열지 않는다.

그 한 건도 30턴이 아니다. GPT가 30턴 미만 표본을 받아들이기 전에는 원문을 열지 않는다.

## REMOVED

임시 신원 파일. 키 본문은 기록하지 않았다.

## PRESERVED

기억 owner, 출력 길이 정책, #1591, Railway 변수, 운영 배포, 운영 DB 파일. 일반 사용자 채팅 본문과 식별자는 이 기록에 없다.

## REGRESSION RISKS

제품 변경이 없으므로 회귀는 없다. stub 키로 SSH를 다시 시도하거나 DB를 복사하면 이 경계 밖으로 나간다. 하지 않았다.

## PROOF

- 새 런 `bc-4e5718cb`. 환경 `02f835c4`. 부트 `bld-20261015-a08213f0`. `HAV_RAILWAY_SSH_KEY` 주입됨, 길이 410. 본문 미출력.
- SSH `CONNECTED_OK`. 배포 SHA `69ed6acc`. DB fd `/data/app.db`. Turso unset. `query_only=1`. 파일 크기·mtime 불변.
- 관리자 채팅 4. 캐릭터·페르소나 일치 4. 30/50/80턴은 0/0/0. 사용자 턴 24·3·0·0.
- 24턴 로스터·관리자 페르소나 채팅 1건에 요약 행과 episodic 행이 있다.
- 신규 Provider 호출 0. 운영 DB 쓰기 0. `src/` diff 없음. #1591 `1389e04f` 미병합.

GPT 검수 후 STOP.
