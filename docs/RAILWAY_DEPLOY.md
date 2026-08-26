# Railway closed-beta deployment

Manual steps in Railway dashboard and Google Console, plus env vars for closed beta (open signup, payments off).

---

## Part A — Manual steps (do these first)

### 1. Railway project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** (connect this repo).
2. Wait for the first build (may fail until env vars are set — that's OK).

### 2. Persistent volume for SQLite

1. In your Railway service → **Volumes** → **Add Volume**.
2. Mount path: `/data` (must match `DATA_DIR` below).
3. Size: 1 GB is enough for beta.
4. **Redeploy** after attaching the volume.

**Optional — copy local DB to volume (characters + lore seeded):**

```bash
# Install Railway CLI, link project, then from your machine:
railway run --service <your-service> sh -c "ls -la /data"

# Copy local DB into the running container (one-time):
railway ssh
# inside container, if empty:
# exit and use railway volume upload or scp via CLI docs

# Simpler: let init() seed on first boot (official characters only).
# To import your local data/app.db, use Railway's volume snapshot/upload when available,
# or railway ssh + base64 copy for small DBs.
```

On first deploy with empty volume, the app creates `/data/app.db` and runs migrations + official character seed automatically.

### 3. Environment variables (Railway → Service → Variables)

Set these before going live (values you provide separately):

| Variable | Value / notes |
|----------|----------------|
| `NODE_ENV` | `production` (Railway may set automatically) |
| `DATA_DIR` | `/data` |
| `OPENROUTER_API_KEY` | Your OpenRouter key |
| `OPENROUTER_HTTP_REFERER` | `https://<your-railway-domain>` (no trailing slash) |
| `OPENROUTER_APP_TITLE` | `PlayAI` (optional) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `PORTONE_CHARGE_ENABLED` | `0` — hides shop / blocks charge APIs during closed beta |
| `NEXT_PUBLIC_PAYMENTS_ENABLED` | `0` — client UI (header shop icon, charge buttons) |
| `DISABLE_PAYOUT_SCHEDULER` | 비워 두세요. `1`이면 매월 15일 자동 지급이 멈춥니다. |
| `HOSTNAME` | `0.0.0.0` (optional; server defaults to this in production) |
| `EPISODIC_MEMORY_RECALL_DISABLED` | Optional emergency kill switch. Unset = recall ON whenever `MEMORY_FEATURE_ENABLED` is on. Legacy `EPISODIC_MEMORY_RECALL_ENABLED=0` still disables recall. |
| `WEB_PUSH_VAPID_*` / `WEB_PUSH_SUBJECT` | Optional. Empty values auto-provision a stable VAPID pair into `app_meta` on first boot (uses `OPENROUTER_HTTP_REFERER` / `NEXTAUTH_URL` / `ADMIN_EMAILS` for the subject). Set `DISABLE_WEB_PUSH=1` only if you want the settings toggle to stay off. |

CLOSED_ADULT_TEST_MODE (closed adult cohort — not open-public legal verification):

| Variable | Value / notes |
|----------|----------------|
| `ADULT_SCENE_ROUTING_ENABLED` | `true` |
| `ADULT_SCENE_HANDOFF_GENERAL_ENABLED` | `true` — general test accounts; eligibility = 「성인 캐릭터 보기」 (`users.nsfw_on`) |
| `ADULT_SCENE_AION_PRIMARY_ENABLED` | `false` |
| `ADULT_MODEL_ID` | `deepseek-v4-pro` |
| `ADULT_SCENE_GLM_HARD_FAILURE_FALLBACK_ENABLED` | `true` |
| `SKIP_ADULT_VERIFICATION` | `1` while no separate verification product is running |

**Do NOT set** `DEMO_MODE=1` in production.

Optional for admin:

| Variable | Notes |
|----------|--------|
| `ADMIN_EMAILS` | Your email for admin pages |

### 4. Google Cloud Console — OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **Credentials**.
2. Edit your OAuth 2.0 Client ID.
3. **Authorized redirect URIs** — add:

   `https://<your-railway-domain>/api/auth/google/callback`

   Examples:
   - `https://playai-production.up.railway.app/api/auth/google/callback`
   - Or your custom domain: `https://beta.yourdomain.com/api/auth/google/callback`

4. **Authorized JavaScript origins** (if prompted):

   `https://<your-railway-domain>`

5. Save. Changes can take a few minutes.

### 5. Custom domain (optional)

Railway → Service → **Settings** → **Networking** → **Generate Domain** (free `*.up.railway.app`) or add custom domain + DNS CNAME as Railway instructs.

After domain is final, update:

- `OPENROUTER_HTTP_REFERER`
- Google redirect URI / origins

### 6. DNS

Only if using a **custom domain** — point CNAME to Railway. Default `*.up.railway.app` needs no DNS setup.

---

## Part B — What the deploy runs

| Step | Command |
|------|---------|
| Build | `npm run build` |
| Start | `npm run start` → `tsx server.js` (custom Next server + exchange-rate warm-up) |
| Health | `GET /api/health` |

Creator payouts are **automatic** on the 15th at 03:00 Asia/Seoul. Do **not** set `DISABLE_PAYOUT_SCHEDULER=1` in production if you want that batch to run. The admin page `/admin/payout` is view + tax CSV only (no approve/reject).

---

## Part C — Closed beta (no payments)

- **Signup:** anyone can register (email or Google). No invite code.
- **Points:** testers apply via main banner → **무료 포인트 신청** → admin approves with custom amount.
- **Payments:** with `PORTONE_CHARGE_ENABLED=0` and `NEXT_PUBLIC_PAYMENTS_ENABLED=0`, point purchase UI and APIs are disabled (no PortOne checkout, no mock charge).
- **Re-enable payments after business registration:** set both to `1` (and configure `PORTONE_API_SECRET` for live checkout).

---

## Part D — Chat streaming / timeouts

This app uses a **long-running Node `server.js`**, not Vercel serverless functions.

- Railway does **not** apply Vercel Hobby's 10s limit.
- Streaming `/api/chat` runs on the same process; typical RP streams work without `maxDuration`.
- Railway proxy idle timeout is generally generous; very long idle gaps in a stream are rare for chat.
- If you see disconnects on 10+ minute streams, upgrade plan or contact Railway support.

---

## Part E — Limitations for beta

| Item | Notes |
|------|--------|
| `data/app.db` on volume | Persists across restarts/redeploys |
| `public/uploads` | **Not** on volume — character image uploads may not survive redeploys |
| `data/secure-uploads` | Under `DATA_DIR` if you use withdrawal docs later |

---

## Part F — Verify after deploy

1. `https://<domain>/api/health` → `{"ok":true,"service":"playai"}`
2. Signup (email or Google) → success without invite code
3. `/points` → no charge packages; link to 무료 포인트 신청
4. Send a chat message → streaming works
5. Restart service in Railway → data still present (volume)

---

## Part G — Troubleshooting

| Issue | Fix |
|-------|-----|
| Build fails on `better-sqlite3` | `nixpacks.toml` installs Python/gcc; Node 22.12 via `.node-version` |
| App won't bind | `HOSTNAME=0.0.0.0`, `PORT` from Railway (automatic) |
| Google redirect mismatch | Redirect URI must match exactly (https, no trailing slash on path) |
| OpenRouter 401/403 | Check `OPENROUTER_API_KEY` and `OPENROUTER_HTTP_REFERER` |
| Empty site / no characters | Fresh DB — wait for seed or copy `app.db` to volume |
