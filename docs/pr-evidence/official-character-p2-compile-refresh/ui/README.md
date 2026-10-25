# P2 compile-refresh UI evidence

## Static markup replicas (`p2-ui-*.png`)

**정적 재현 자료입니다.** live React 하이드레이션이 아니라 `AdminOfficialCharactersClient.tsx`와 동일한 Tailwind 마크업에 **실제 관리자 API** 응답 JSON을 채워 Playwright로 캡처했습니다. Next dev HMR/headless Chromium 번들 파싱 이슈를 피하기 위한 1차 증거이며, 버튼·섹션·미리보기 필드 구조는 프로덕션 클라이언트와 맞춥니다.

- 운영 DB 미사용 · 유료 호출 없음
- `api-preview-51.json`: 격리 fixture `#51` `operation=recompile` `mode=dry_run` 실측
- `api-apply-without-preflight.json`: 미리보기 없이 apply 시 거절 응답

## Live React (`p2-react-*.png`)

**실제 `AdminOfficialCharactersClient` 화면**에서 캡처했습니다 (production build + 격리 DB, 일회성 캡처 완료). `/admin/official-characters`에서 #51 **컴파일 미리보기** → API → 결과 패널. 재캡처용 수동 DB 시드 스크립트는 PR에서 제거했습니다.

## HTTP 검증 (운영 DB 없음)

- `src/app/api/admin/official-characters/sync/route.test.ts`: `installIsolatedTestDatabase()` + `NODE_ENV=development`에서 `POST` recompile dry_run → **200**
- HTTP 시드: `src/lib/test/officialSupplyCompileRefreshHttpSeed.ts` — `assertIsolatedTestDatabaseActive()` 통과 후에만 DELETE
