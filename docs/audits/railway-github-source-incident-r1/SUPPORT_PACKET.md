# Railway GitHub source incident R1 — support packet

Infrastructure diagnosis only. `MODEL_CALLS=0`. No application code change.

## Identity

| Field | Value |
| --- | --- |
| Project | `enchanting-ambition` (`072644e5-ce50-49bb-ab2e-1f13bae6b149`) |
| Service | `chat-ai` (`5e36bd2b-5557-4765-949f-5569a8a79628`) — existing only |
| Environment | `production` (`9ed4cc65-609e-4dde-96fb-2397a6a12885`) |
| Workspace | `you8520-sketch's Projects` (`022558f5-9a59-428b-bc6b-3dbd089c9c90`) plan `HOBBY` |
| Region | `sfo` (US West) via `serviceManifest.deploy.multiRegionConfig.sfo` |
| `instance.region` | `null` (region comes from multi-region config) |

## Railway Express

`Service.featureFlags` = `[]`  
`Project.featureFlags` = `[]`  
`ActiveServiceFeatureFlag.USE_EXPRESS_PACKSTORE` is **not** present.

`RAILWAY_EXPRESS_ENABLED=false`

Express was not turned off in this incident (already off). Region is US West, so the Express-outside-supported-region bug is not this case.

## Source (not disconnected)

```text
SOURCE_PROVIDER=GitHub
SOURCE_REPOSITORY=you8520-sketch/chat-ai
SOURCE_BRANCH=main
AUTO_DEPLOY_ENABLED=true
WAIT_FOR_CI_ENABLED=true
  repoTrigger 14841cff-327d-4574-aab0-35dc669f3539
  checkSuites=true
  validCheckSuites=0
SOURCE_CONNECTION_WARNING=none (API shows source.repo set; no "Repo not found" / "not authorized")
GITHUB_SOURCE_RECONNECTED=false
```

GitHub App: Railway has been deploying this public repo the same calendar day (`907a5401`). `railway-app` check suite exists on `213d92e`. Cursor token cannot list GitHub App installations (`403`/`401`). No Railway UI/API string of `Repo not found`, `No project member has access`, or `repository not authorized`.

## Last live SUCCESS (still serving)

```text
id: 907a5401-a848-47d1-b6e1-a369106131f7
status: SUCCESS
commit: b06037dd5c572bd02abec311f4148f57d9362551
createdAt: 2026-08-18T12:36:06.698Z
builder: NIXPACKS
configFile: /railway.toml
volume: /data
```

`GET /api/health` still: `"gitCommit":"b06037d"`.

## Expected main (#501)

```text
PR #501 MERGED
reviewed head: 184a36019504312aa8eda1974e2b1a5a67c3514b
merge: 213d92e03fb1aa84565e3c95df64e8d10306e3a8
```

`origin/main` later fast-forwarded to `b83c9e2` (docs-only P3 hold packet). Feature code remains `213d92e` plus that doc. Production has neither.

## Deployment 3321ea50

```text
id: 3321ea50-25bf-4fab-aa55-0037034217a0
createdAt: 2026-08-19T00:00:18.576Z
statusUpdatedAt: 2026-08-19T00:12:07.365Z
status: FAILED (was INITIALIZING ~12 min)
reason: deploy
cliMessage: PR501 213d92e railway-only
commitHash: (absent — archive /up, not GitHub SHA)
imageDigest: (absent)
builder shown: RAILPACK
diagnosis: null
```

Exact `meta.configErrors[0]`:

```text
Repository snapshot operation timed out. This may be due to a large repository size or network issues. Please try again in a few minutes.
```

Exact `buildLogs` GraphQL error:

```text
Deployment does not have an associated build
```

`deploymentLogs` = `[]`.

Git pack size of this repo is ~15MB. Same repo built successfully at `907a5401`. Application `npm run build` did not run.

## Deploy Latest Commit probe

Express already OFF. Source settings valid. No reconnect.

```text
mutation serviceInstanceDeployV2
serviceId=5e36bd2b-5557-4765-949f-5569a8a79628
environmentId=9ed4cc65-609e-4dde-96fb-2397a6a12885
commitSha=213d92e03fb1aa84565e3c95df64e8d10306e3a8
NEW_DEPLOYMENT_ID=d0e86081-2e9c-44d6-8d93-a0bf30384944
createdAt=2026-08-19T00:42:12.047Z
```

Exact queued reason:

```text
Deployment queued due to upstream GitHub issues
```

`buildLogs` on `d0e86081`:

```text
Deployment does not have an associated build
```

Still `QUEUED` at 00:44Z. No Build.

Prior GitHub-SHA deploys of `213d92e` had the same queued reason (`f543ebb9`, `0fc20c27`, `384a73b2`, `12b118e3`, `dfc580b0`) and were cancelled/removed.

## Classification

```text
3321ea50: SOURCE_FETCH_BLOCKED + NO_BUILD_ASSIGNED
Deploy Latest (d0e86081): SOURCE_FETCH_BLOCKED / QUEUED (no build)
RAILWAY_EXPRESS_BUG: false
GITHUB_APP_ACCESS: no explicit failure string
APPLICATION_CODE_CHANGED: false
CLI railway up: not used as the classified fix (3321ea50 was an earlier archive attempt; same snapshot timeout)
```

Repo-side Next.js/`SESSION_SECRET`/Vercel Preview is a separate GitHub check (`Vercel – chat-ai` failure on `213d92e`). Combined commit status is `failure`. `WAIT_FOR_CI` is on. `#496` (`b06037d`) also had Vercel failure and still reached SUCCESS, so CI-wait alone does not explain today’s no-build stall.

## Not changed

Volume `/data`, database, domains, env vars, build/start commands, Railway Express (already off), GitHub source connection.

## Ask for Railway

GitHub source pipeline for `chat-ai` / `production` is not assigning a build to `213d92e`. Snapshot times out or deploys stay queued on `Deployment queued due to upstream GitHub issues`. Need the GitHub-connected Deploy Latest path to start a NIXPACKS build of `213d92e` (or current `main` that contains it) without changing env/volume.
