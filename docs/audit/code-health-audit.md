# Code Health Audit — FEATURE

## Classification

`FEATURE`. Weekly job is read-only. Monthly cleanup may open a Draft PR only when every gate passes. Never auto-merges.

## BEFORE

The repo already had canonical owners for scheduled work and admin reporting:

- GitHub scheduled workflows: memory research, Main RP monthly cache audit, supply radar
- Railway durable scheduler registry: finance / payout / training / Main RP cache TTL
- Settings → 관리자 → 자동화 보고서
- `/admin/ops` incident/exception inbox
- PR CI owners (`typecheck:app`, focused validate-* workflows, production build)
- dependency security baseline (`scripts/dependency-security`)
- `.env.example` flag/env inventory
- `src/lib/db.ts` schema/migration owner
- prompt / model adapter owners (`contextBuilder`, `chatModels`, `statusWidget/promptDuplicateAudit`)

There was no periodic unused-file / unused-export / obsolete-flag / duplicate-owner discovery attached to those owners.

## OWNER MAP

| Responsibility | Canonical owner |
|---|---|
| Weekly read-only audit execution | `.github/workflows/code-health-weekly-audit.yml` + `scripts/code-health-audit.ts` |
| Monthly cleanup candidate set | `.github/workflows/code-health-monthly-cleanup.yml` + `scripts/code-health-monthly-cleanup.ts` |
| Classification / evidence | `src/lib/codeHealth/classify.ts` |
| Admin display | existing `/admin/automation-reports` + `src/lib/codeHealth/reports.ts` |
| Incident / exception | existing `/admin/ops` (unchanged) |
| In-process production schedules | `schedulerDefinitions.ts` (unchanged — code health is **not** a Railway job) |
| Ledger persist | `code-health-ledger` data branch, never merged to main |

Knip was reviewed and **not** adopted as an owner or as deletion proof. Next.js App Router entries, `import()`, scheduler-only modules, scripts, migrations, tests, and runtime provider adapters are false-positive classes.

## WEEKLY AUDIT DESIGN

- Cadence: Monday 04:17 UTC (13:17 KST)
- Read-only against `main`
- Writes artifacts + optional data-branch ledger only
- Does not patch a deterministic production bug even if found
- Critical/security hits are `REQUIRED_CLEANUP` + BUGFIX on the admin report
- Default classification is `UNCONFIRMED`
- `SAFE_TO_DELETE` requires writer/reader/import/dynamic/production/DB/rollback evidence

## MONTHLY CLEANUP DESIGN

- Cadence: 3rd 04:17 UTC (13:17 KST)
- Merges previous weekly candidate sets
- Draft PR only when all of: revalidated on current main, no production reference, no destructive migration, no auth/security/adult change, no provider pricing/routing change, no unrelated refactor, regression gate possible
- Change budget: 5 items
- Never auto-merges

## STOP CONDITIONS

Do not modify; report evidence and options:

- production usage uncertain
- destructive migration
- security / auth / adult boundary
- provider cost / pricing / routing
- unrelated large refactor
- canonical owner mismatch
- static-analyzer false positive not resolved
