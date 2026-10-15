# Main RP — 운영 관리자 장기대화 확보 장애 (READ-ONLY, STOP)

Docs only. `src/` 변경 없음. Provider 호출 0. 운영 DB 읽기·쓰기 0. Railway 변수 변경 0. 배포·재시작 0. 제품 패치 없음. 구현 Draft 없음. #1591 미변경.

판정: **기존 `railway ssh` 경로로 운영 `chat-ai` 컨테이너에 들어가지 못했다. 운영 DB 경로는 미확정이다. 관리자 테스트 채팅 메타데이터는 읽지 않았다. 새 접속 인프라는 만들지 않는다.**

## BEFORE

시작 시 origin/main은 `69ed6acce8983f20a4a7e4c82cdd251a4e5e5328`이다. 공개 `https://hav.chat/api/health`의 `gitCommit`은 `69ed6ac`이고, GitHub deployments의 가장 최근 Railway `enchanting-ambition / production` 항목 SHA는 같은 `69ed6acc`다. GitHub main과 운영 배포 SHA는 일치한다.

#1571은 이 기록을 올리기 전 `92395311`이다. #1591은 `1389e04f`다.

코드의 DB owner는 `src/lib/dataDir.ts`다. `TURSO_DATABASE_URL`과 Turso 토큰이 같이 있으면 원격 libSQL이다. 없으면 `getDataDir()`이 `DATA_DIR`을 쓰고, 운영에서 `DATA_DIR`이 비어 있으면 `/data`가 있을 때 그 경로를 쓴다. 파일 경로는 `getDatabasePath()`가 `{dataDir}/app.db`다. `src/lib/db.ts`가 그 경로를 연다. 이것은 코드 계약이다. 운영 프로세스가 지금 그 파일을 열고 있는지는 컨테이너에 들어가지 못해 확인하지 않았다. `/data/app.db`를 추측해서 읽지 않았다.

이미 검증된 컨테이너 접속은 `scripts/railway-precall-final-wire.sh`의 `railway ssh -p 072644e5-ce50-49bb-ab2e-1f13bae6b149 -s chat-ai -e production -i $HOME/.ssh/id_ed25519`다. 다른 스크립트는 `$HOME/.ssh/railway_cursor_trpg`를 쓴다. 둘 다 이 VM에 없다.

이전 Cloud 감사도 같은 종류로 멈춘 적이 있다. `RAILWAY_SSH_*`는 OpenSSH 키가 아닌 11바이트 stub이고, 주입된 토큰으로는 GraphQL이 거부된다. 이번에도 그 상태가 그대로다.

## PROBLEM

기존 경로를 재사용하려고 아래만 확인했다. Railway CLI를 설치하지 않았다. SSH 키를 생성하지 않았다. 토큰·환경변수 값을 출력하지 않았다. 새 SSH 서버, 터널, 공개 DB 포트, 임시 API, 디버그 엔드포인트는 만들지 않았다.

| 확인 | 결과 |
|---|---|
| `railway` 바이너리 | 없음. `~/.railway`는 CLI `5.64.2`를 `not_installed`로 기록 |
| `~/.ssh/id_ed25519`, `railway_cursor_trpg` | 없음 |
| `RAILWAY_SSH_PRIVATE_KEY` / `RAILWAY_SSH_PUBLIC_KEY` | 설정됨. 길이 11. OpenSSH 형식이 아님 |
| Railway GraphQL `me` / project | `backboard.railway.app`과 `backboard.railway.com` 모두 HTTP 403 |
| 운영 컨테이너 SSH | 실행하지 않음. CLI와 사용 가능한 신원이 없음 |
| 운영 `DATA_DIR` / 볼륨 / 실제 DB 파일 | 미확정 |
| 관리자 채팅 메타데이터 | 조회하지 않음 |

로컬 `data/app.db`는 이전 티켓에서 개발 스냅샷으로 확인됐다. 이번에도 운영 DB로 쓰지 않았다.

일반 사용자 채팅 본문은 열지 않았다. 채팅 ID와 사용자 ID를 이 문서에 적지 않는다.

## ACCESS

- 운영 컨테이너 접근: **실패**
- 운영 DB 경로 확인: **실패**

실패 원인: 이 Cloud VM에는 기존 `railway ssh`를 실행할 CLI와 사용 가능한 SSH 신원이 없다. 주입된 Railway 토큰은 GraphQL 403이다. 권한 우회와 신규 인프라 설치는 티켓이 금지한다.

## ADMIN TEST DATA

운영 DB를 열지 않았으므로 아래는 모두 미확인이다.

- 관리자 테스트 채팅 수: 미확인
- 30턴 이상: 미확인
- 50턴 이상: 미확인
- 80턴 이상: 미확인
- 실제 등록 캐릭터·관리자 페르소나 일치: 미확인

성공 판정(운영 DB에서 관리자 테스트 채팅 메타데이터를 읽기 전용으로 확인)은 성립하지 않는다.

## NEXT

원문 추출 준비: **불가**. 컨테이너와 DB 경로가 없다.

다음 작업 하나: 이미 성공한 운영자 머신에서, 사용 가능한 Railway SSH 신원과 권한이 있는 토큰으로 기존 `railway ssh -p 072644e5-ce50-49bb-ab2e-1f13bae6b149 -s chat-ai -e production`을 이 Cloud 환경에 다시 연결한 뒤 이 티켓을 재실행한다. 새 터널이나 디버그 API를 만들지 않는다. 장작 fixture, 합성 80턴, 유료 RP 자동 생성, 일반 사용자 채팅 대체는 하지 않는다.

관리자 장기 대화가 운영에 있는지는 그 접속이 열린 뒤에만 말할 수 있다.

## AFTER

제품 변경 없음. 운영 상태 변경 없음.

## REMOVED

없음.

## PRESERVED

기억 owner, 출력 길이 정책, #1591, Railway 변수, 운영 배포. 개인정보와 일반 사용자 채팅 본문은 이 기록에 없다.

## REGRESSION RISKS

제품 변경이 없으므로 회귀는 없다. CLI를 설치하거나 stub 키를 진짜 키로 바꿔 등록하면 티켓의 보안 경계를 넘는다. 하지 않았다.

## PROOF

- origin/main `69ed6acc`. `hav.chat/api/health` `gitCommit=69ed6ac`. GitHub deployment environment `enchanting-ambition / production` SHA `69ed6acc`.
- `command -v railway` 없음. SSH 신원 파일 없음. GraphQL 403. `railway ssh` 미실행.
- 코드 owner: `getDataDir` / `getDatabasePath` / `src/lib/db.ts`. 운영 실제 연결 경로는 미확정.
- 신규 Provider 호출 0. 운영 DB 쓰기 0. `src/` diff 없음.

GPT 검수 후 STOP.
