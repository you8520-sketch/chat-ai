# P2 compile-refresh UI evidence

스크린샷은 **로컬 dev 서버**(`http://localhost:3000`)에서 `seed-ui-demo.ts`로 시드한 #50/#51 fixture에 대해 **실제 관리자 API**(`/api/admin/official-characters*`) 응답을 받아, `AdminOfficialCharactersClient.tsx`와 동일한 Tailwind 마크업으로 렌더한 뒤 Playwright로 캡처했습니다.

- 운영 DB 미사용 · 유료 호출 없음
- `api-preview-51.json`: #51 `operation=recompile` dry_run 실측
- `api-apply-without-preflight.json`: 미리보기 없이 apply 시 거절 응답

Playwright headless Chromium은 Next dev HMR `layout.js` eval에서 간헐적 파싱 오류가 있어, 본문 React 하이드레이션 대신 API 기반 정적 렌더를 사용했습니다. 버튼 라벨·섹션 구조·미리보기 필드는 프로덕션 관리자 클라이언트와 동일합니다.
