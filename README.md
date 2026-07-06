#  AI 캐릭터 채팅 플랫폼

 AI 캐릭터 채팅 사이트입니다.

## 주요 기능

- **메뉴 구성**: 홈 / 공식 / 신작 / 랭킹 / 장르 / 팔로잉 / 좋아요 + 문의·자유·정보공유·공지·FAQ 게시판 + AI 이미지 생성
- **NSFW 지원**: 성인인증(만 19세 이상) 완료 시 NSFW 캐릭터 노출·19+ 대화 모드 이용 가능
- **캐릭터 제작**: 성인인증 완료 회원만 제작 가능
- **포인트 종량제**: 일반 대화 5P / NSFW 대화 10P, 충전 패키지 4종 (가입 시 1,000P 지급)
- **월 구독**: 월 9,900원 멤버십 — 구독 기간 동안 대화 무제한 (포인트 차감 없음)
- **AI 모델 라우팅**
  - 일반 모드 → **Gemini** (3.1 Pro / 3 Flash 등 선택)
  - 19+ 성인 모드 → **Llama** (OpenRouter, 검열 없음 + 앵무새 방지 파라미터)
- **기억력 강화**: 대화가 길어지면 오래된 메시지를 장기 기억으로 자동 요약해 시스템 프롬프트에 주입 → 캐릭터가 설정·사건·관계를 잊지 않음
- **파티챗**: 여러 사용자가 한 방에서 하나의 AI 캐릭터와 함께 대화 (2.5초 폴링 동기화, AI 호출 on/off 가능)

## 실행 방법

```bash
npm install
npm run dev
```

http://localhost:3000 접속

## API 키 설정

`.env.local` 파일에 키를 입력하세요. (키가 없으면 데모 응답으로 동작)

```
GEMINI_API_KEY=발급받은_키        # https://aistudio.google.com/apikey
OPENROUTER_API_KEY=발급받은_키    # https://openrouter.ai/keys (19+ Llama)
```

## 기술 스택

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- SQLite (better-sqlite3) — `data/app.db` 자동 생성, 시드 캐릭터 12종 포함

## 실서비스 전환 시 연동 지점

| 기능 | 현재 (데모) | 실서비스 |
|---|---|---|
| 성인인증 | 모의 생년월일 검증 (`/api/verify`) | PASS / 포트원 본인인증 |
| 포인트 충전 | 즉시 지급 모의 결제 (`/api/points/charge`) | 토스페이먼츠 / 포트원 |
| 월 구독 | 즉시 활성화 (`/api/points/subscribe`) | 빌링키 정기결제 |

## Production auth/session deployment checklist

Production authentication uses an opaque `session` cookie whose token is looked up in the SQLite `sessions` table. To keep users logged in across git pushes, deploys, and process restarts, production must keep both the database storage and server-side secrets stable.

### Required production environment variables

- `DATA_DIR=/data` (or another mounted persistent volume path)
  - This directory contains `app.db`, including the `sessions` table.
  - `DATA_DIR` must point to a persistent volume. Do not use an ephemeral filesystem for production auth storage.
  - If production starts without `DATA_DIR` and without a mounted `/data` volume, startup failure is intentional. It prevents the app from silently creating a fresh SQLite database and logging users out after the next deploy/restart.
- `SESSION_SECRET=<fixed 32+ character random value>`
  - Generate once per production environment and keep it fixed across deploys/restarts.
  - Do not generate this value in code with `randomUUID`, `Math.random`, or a deploy-time default.
- `WITHDRAWAL_ENCRYPTION_KEY=<fixed 32+ character random value>`
  - Generate once per production environment and keep it fixed across deploys/restarts.
  - This key protects sensitive withdrawal fields. If omitted, production requires `SESSION_SECRET` as the fallback encryption secret, but a dedicated key is recommended.

### Post-deploy login persistence check

1. Deploy with a persistent `DATA_DIR` volume and fixed `SESSION_SECRET` / `WITHDRAWAL_ENCRYPTION_KEY` values.
2. Log in from a normal browser window and verify authenticated pages load.
3. Redeploy or restart the server without clearing the persistent volume.
4. Refresh the same browser session.
5. Confirm the user is still logged in. If the user is logged out, verify that the deployed app is using the same persistent `DATA_DIR` and that the `sessions` table still contains the session row.

### Current lint known issue

`npm run lint` is configured for the standard Next.js lint command, but this repository currently does not have `eslint` installed in `devDependencies`. Installing `eslint` / `eslint-config-next` in this environment is blocked by the current registry policy (`403 Forbidden`). Treat this as a known environment/dependency issue until the registry policy is updated or the dependencies are vendored/allowed; keep it separate from auth-session changes.
