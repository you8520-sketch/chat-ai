# Main RP — HAV_RAILWAY_SSH_KEY 전달 범위 (READ-ONLY, STOP)

Docs only. `src/` 변경 없음. Provider 호출 0. 운영 DB 읽기·쓰기 0. Railway 변수 변경 0. 배포 0. 새 키 생성·등록 0. 제품 패치 없음. #1591 미변경.

판정: **이 에이전트에는 `HAV_RAILWAY_SSH_KEY`가 주입되지 않았다. 기존 개인키를 복원할 수 없다. 사용자를 다른 PC로 옮겼다고 단정하지 않는다. 키 원문은 요청하지 않는다.**

## BEFORE

이번 런은 Cursor Cloud `bc-9126af5e-89fa-4e14-9480-0861fff53499`다. 환경은 Personal `chat-ai`, `environmentPublicId` `02f835c4-7866-11f1-ba66-0e7d0216e441`. 부트 스냅샷은 `bld-20261011-eee9bc7e-573a-4a53-b82d-fab68839c01e`다. 생성 시각은 2026-10-12 오전(같은 날 Railway SSH 작업보다 앞)이고, 이후 같은 VM이 계속 실행 중이다.

2026-10-12에 같은 환경에서 Railway SSH를 시도한 런은 다음이다. 환경 id는 이번과 같다.

- `bc-b0f73a92` Railway ssh 환경 변수: `RAILWAY_SSH_PRIVATE_KEY` 길이 11. `railway ssh`는 host key 검증 실패. `HAV_RAILWAY_SSH_KEY` 없음.
- `bc-6caf50e8` Railway 프로덕션 git sha: 같은 stub. `railway ssh` 실패. SHA는 토큰 API로만 확인.
- `bc-179076bd` Railway SSH 커밋 SHA: CLI 없음, 키 검증 실패, SSH 미실행.
- `bc-af563f4a` Railway ssh 키 설정: 대시보드에 `HAV_RAILWAY_SSH_KEY`를 등록한 뒤에도 **그 런에서는 길이 0**. Cloud Secret은 VM 부트 시에만 들어온다. 사용자가 다른 새 런의 성공 보고를 붙여 넣었다. 그 보고의 명령은 `railway ssh -p 072644e5-ce50-49bb-ab2e-1f13bae6b149 -s chat-ai -e production -i ~/.ssh/hav_cursor_cloud2`이고, `HAV_RAILWAY_SSH_KEY`를 0600 파일로 쓴 뒤 `ssh.railway.com` known_hosts를 채운 다음 exit 0이었다.

성공 경로의 저장소 범위는 `you8520-sketch/chat-ai`다. 환경도 이번과 같은 Personal `chat-ai`다. PC 이동이 원인이라고 적은 기록은 없다.

## PROBLEM

이번 에이전트 환경변수 이름만 확인했다. 값은 출력하지 않았다.

| 이름 | 이번 런 |
|---|---|
| `HAV_RAILWAY_SSH_KEY` | 환경변수 없음. `CLOUD_AGENT_ALL_SECRET_NAMES`에도 없음. `CLOUD_AGENT_INJECTED_SECRET_NAMES`에도 없음 |
| `RAILWAY_SSH_PRIVATE_KEY` | 주입됨. 길이 11. OpenSSH PEM 아님 |
| `RAILWAY_SSH_PUBLIC_KEY` | 주입됨. 길이 11. OpenSSH 공개키 아님 |
| `RAILWAY_TOKEN` | 주입됨. GraphQL은 403 |
| `railway` CLI | 없음 |
| `~/.ssh` 신원 파일 | 없음 |

`CLOUD_AGENT_ALL_SECRET_NAMES`와 `CLOUD_AGENT_INJECTED_SECRET_NAMES`는 같다. 빠진 것은 주입 실패가 아니라 **이 런의 Secret 목록 자체에 `HAV_RAILWAY_SSH_KEY`가 없는 것**이다.

원인은 두 겹이다.

1. **실행 범위:** 이 VM은 `HAV_RAILWAY_SSH_KEY` 등록 전에 부팅된 장기 실행 에이전트다. 2026-10-12 기록도 Secret은 부트 시에만 들어온다고 적는다. 같은 환경에 나중에 등록된 Secret은 이 프로세스에 나타나지 않는다.
2. **Secret 카탈로그:** 지금 이 런이 아는 이름 목록에도 `HAV_RAILWAY_SSH_KEY`가 없다. 있는 Railway SSH 이름은 stub인 `RAILWAY_SSH_PRIVATE_KEY` / `RAILWAY_SSH_PUBLIC_KEY`뿐이다.

공식 CLI 설치는 허용되지만, 복원할 개인키가 없어 설치하지 않았다. stub로 `railway ssh`를 시도하지 않았다. 새 키를 만들지 않았다.

## ACCESS

- 운영 컨테이너 접근: **실패** (기존 Secret 미전달. SSH 미실행)
- 운영 DB 경로 확인: **실패**

## ADMIN TEST DATA

조회하지 않음. 관리자 테스트 채팅 수·30/50/80턴 여부·등록 캐릭터 일치는 모두 미확인.

## NEXT

원문 추출 준비: **불가**.

다음 작업 하나: **새 Cloud Agent 런을 연다.** 그 런의 부트 시 `printenv HAV_RAILWAY_SSH_KEY`가 비어 있지 않은지(길이만) 확인한 뒤, 기존처럼 0600 임시 파일과 `PRECALL_SSH_IDENTITY`로 `enchanting-ambition / production / chat-ai`에 접속한다. 키 원문을 채팅에 붙이지 않는다.

확인할 설정은 Cursor Dashboard → Cloud Agents → Secrets의 `HAV_RAILWAY_SSH_KEY`가 `you8520-sketch/chat-ai`(또는 All Repositories)와 Personal 환경 `chat-ai` (`02f835c4-7866-11f1-ba66-0e7d0216e441`)에 연결되어 있는지다. 이 장기 실행 VM에서는 그 설정을 고친 뒤에도 다시 주입되지 않는다.

## AFTER

제품 변경 없음. 운영 상태 변경 없음. CLI 미설치.

## REMOVED

없음.

## PRESERVED

기억 owner, 출력 길이 정책, #1591, Railway 변수, 운영 배포. 키 원문과 일반 사용자 채팅은 이 기록에 없다.

## REGRESSION RISKS

제품 변경이 없으므로 회귀는 없다. stub `RAILWAY_SSH_*`로 SSH를 시도하면 실패한 2026-10-12 경로를 반복한다. 하지 않았다.

## PROOF

- `HAV_RAILWAY_SSH_KEY in env: False`. Secret 이름 목록 13개에 해당 이름 없음.
- 같은 환경 `02f835c4`의 2026-10-12 런 `bc-af563f4a`가 부트 전용 주입과 새 런 성공 보고를 기록함.
- 이 런 생성 시각이 그 SSH 작업보다 앞선다. 부트 스냅샷은 `bld-20261011-eee9bc7e`.
- 신규 Provider 호출 0. 운영 DB 쓰기 0. `src/` diff 없음.

GPT 검수 후 STOP.
