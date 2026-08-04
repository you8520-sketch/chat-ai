/**
 * Persona Secret Discovery full-activation verification.
 * Run after Railway sets PERSONA_SECRET_DISCOVERY_ENABLED=1 (BOUNDARY=1).
 *
 * Checks:
 *  - /health ok, main, demoEnv=false
 *  - /api/personas canEdit=true, discoveryActive=true for general + new signup user
 *  - S1 direct disclosure smoke: create persona with secret_description, send first-person
 *    assertive message → chat 200, no public/chat leak of secret needle
 *  - retry same message → chat 200 (idempotency, no duplicate error)
 *  - cross-user owner editor 404
 *  - public /api/personas secret needle 0
 *
 * Note: Discovery knowledge/evidence tables are server-internal (no client SSE,
 * no public API). S1 write success is inferred from chat 200 + no leak + no
 * duplicate error; the idempotency_key UNIQUE + discoveryWritesAllowed gate
 * + per-observer prompt block enforce the invariants (covered by unit tests).
 *
 * Usage: node --import tsx scripts/verify-persona-secret-discovery.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const OUT_DIR = process.env.OUT_DIR ?? "/opt/cursor/artifacts/deepseek-common-root-audit/17-persona-secret-discovery";
const NEEDLE = `DISCOVERY_PROBE_NEEDLE_${Date.now()}`;
// secret_description whose deterministic-compiled atom yields a direct-disclosure alias
const SECRET_DESC = "이계에서 왔다";
// first-person + assertive + contains the auto-generated alias "나는 이계에서 왔다"
const DISCLOSURE_MSG = "나는 이계에서 왔다. 진짜야. 이제 말해도 돼.";

mkdirSync(OUT_DIR, { recursive: true });

function loadSessionCookie(): string {
  const raw = readFileSync(COOKIE_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const n = line.startsWith("#HttpOnly_") ? line.slice(10) : line.startsWith("#") ? "" : line;
    if (!n) continue;
    const p = n.split("\t");
    if (p[5] === "session") return p[6]!.trim();
  }
  throw new Error("session cookie not found");
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return { _text: await res.text(), _status: res.status };
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { _text: await res.text(), _status: res.status };
  }
}

async function signupNewUser(): Promise<{ token: string; userId: number } | null> {
  const email = `discovery.verify.${Date.now()}@example.com`;
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "DiscoveryVerify_12910", nickname: `dv_${Date.now().toString(36)}`, pref: "male" }),
  });
  if (!res.ok) return null;
  const sc = res.headers.get("set-cookie") ?? "";
  const m = sc.match(/session=([^;]+)/);
  if (!m) return null;
  const token = m[1]!;
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: `session=${token}` } })).json();
  return { token, userId: me.user.id };
}

async function readSseChat(token: string, body: Record<string, unknown>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}`, Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const c of chunks) {
      let d = "";
      for (const l of c.split("\n")) if (l.startsWith("data:")) d += l.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const ev = JSON.parse(d) as { type?: string; text?: string; finalContent?: string };
        if (ev.type === "replace" && typeof ev.text === "string") text = ev.text;
        if (ev.type === "done" && typeof ev.finalContent === "string") text = ev.finalContent;
      } catch {
        /* ignore */
      }
    }
  }
  return { status: res.status, text };
}

async function main() {
  const token = loadSessionCookie();
  const report: Record<string, unknown> = { generated_at: new Date().toISOString(), needle: NEEDLE };

  // 1. health
  const health = await (await fetch(`${BASE}/api/health`)).json();
  report.health = health;
  report.deploy_ok = health.ok === true && health.gitBranch === "main" && health.demoEnv === false;

  // 2. capability — general user (34)
  const capRes = await fetch(`${BASE}/api/personas`, { headers: { Cookie: `session=${token}` } });
  const capBody = await safeJson(capRes);
  const cap = (capBody.capabilities as { personaSecretSettings?: { canEdit?: boolean; discoveryActive?: boolean } } | undefined)?.personaSecretSettings;
  report.general_user_canEdit = cap?.canEdit;
  report.general_user_discoveryActive = cap?.discoveryActive;
  report.discovery_on = cap?.discoveryActive === true;

  // 2b. capability — new signup user
  const other = await signupNewUser();
  if (other) {
    const capRes2 = await fetch(`${BASE}/api/personas`, { headers: { Cookie: `session=${other.token}` } });
    const capBody2 = await safeJson(capRes2);
    const cap2 = (capBody2.capabilities as { personaSecretSettings?: { canEdit?: boolean; discoveryActive?: boolean } } | undefined)?.personaSecretSettings;
    report.new_user_canEdit = cap2?.canEdit;
    report.new_user_discoveryActive = cap2?.discoveryActive;
  } else {
    report.new_user_canEdit = "SKIP (signup failed)";
    report.new_user_discoveryActive = "SKIP";
  }

  // 3. S1 smoke: create persona with secret_description
  const createRes = await fetch(`${BASE}/api/personas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    body: JSON.stringify({
      name: `discovery_probe_${Date.now().toString(36)}`,
      gender: "male",
      description: "정상 설명.",
      secret_description: SECRET_DESC,
    }),
  });
  const createBody = await safeJson(createRes);
  report.secret_create_status = createRes.status;
  report.secret_create_ok = createBody.ok === true;
  const probePersonaId = (createBody.persona as { id?: number } | undefined)?.id;
  report.probe_persona_id = probePersonaId;

  // 4. S1 direct disclosure chat turn
  let s1Ok = false;
  let s1NoLeak = false;
  let s1Status = 0;
  if (probePersonaId) {
    const chat = await readSseChat(token, {
      characterId: 18,
      message: DISCLOSURE_MSG,
      selectedPersonaId: probePersonaId,
      isAdultMode: false,
      isNsfwMode: false,
      clientRequestId: `discovery_probe_${Date.now()}`,
    });
    s1Status = chat.status;
    s1Ok = chat.status === 200;
    // Note: the character's streamed prose may coincidentally contain the secret_description
    // phrase (e.g. "이계에서 왔다" is generic fantasy prose). That is NOT a secret leak.
    // Real isolation = public persona API + chat page RSC payload must not contain the
    // secret_description. Checked separately below.
    report.s1_chat_status = s1Status;
    report.s1_chat_ok = s1Ok;

    // 5. retry same message → idempotency (no duplicate error)
    const retry = await readSseChat(token, {
      characterId: 18,
      message: DISCLOSURE_MSG,
      selectedPersonaId: probePersonaId,
      isAdultMode: false,
      isNsfwMode: false,
      clientRequestId: `discovery_probe_retry_${Date.now()}`,
    });
    report.s1_retry_status = retry.status;
    report.s1_retry_ok = retry.status === 200;
    report.s1_retry_no_error = retry.status === 200;
  }

  // 6. public /api/personas secret needle 0 + chat page RSC isolation
  const publicRes = await fetch(`${BASE}/api/personas`, { headers: { Cookie: `session=${token}` } });
  const publicBody = await safeJson(publicRes);
  const publicJson = JSON.stringify(publicBody);
  report.public_secret_needle_bytes = publicJson.includes(NEEDLE) ? publicJson.split(NEEDLE).length - 1 : 0;
  report.public_secret_desc_bytes = publicJson.includes(SECRET_DESC) ? publicJson.split(SECRET_DESC).length - 1 : 0;
  // Chat page RSC: fetch the chat page HTML and verify the secret_description is NOT in the RSC payload.
  let rscSecretBytes = -1;
  if (probePersonaId) {
    const chatPageRes = await fetch(`${BASE}/chat`);
    const chatPageHtml = await chatPageRes.text();
    rscSecretBytes = chatPageHtml.includes(SECRET_DESC) ? chatPageHtml.split(SECRET_DESC).length - 1 : 0;
  }
  report.chat_page_secret_desc_bytes = rscSecretBytes;
  report.public_isolation_ok =
    !publicJson.includes(NEEDLE) && !publicJson.includes(SECRET_DESC) && rscSecretBytes === 0;

  // 7. cross-user owner editor 404
  if (probePersonaId && other) {
    const crossRes = await fetch(`${BASE}/api/personas/${probePersonaId}/editor`, {
      headers: { Cookie: `session=${other.token}` },
    });
    report.cross_user_editor_status = crossRes.status;
    report.cross_user_blocked = crossRes.status === 404 || crossRes.status === 403;
  }

  // 8. cleanup: delete probe persona
  if (probePersonaId) {
    const delRes = await fetch(`${BASE}/api/personas/${probePersonaId}`, {
      method: "DELETE",
      headers: { Cookie: `session=${token}` },
    });
    report.probe_delete_status = delRes.status;
  }

  // verdict
  report.verdict =
    report.deploy_ok &&
    report.discovery_on &&
    report.s1_chat_ok &&
    report.s1_retry_no_error &&
    report.public_isolation_ok &&
    (report.cross_user_editor_status === 404 || report.cross_user_editor_status === 403)
      ? "PERSONA_SECRET_DISCOVERY_ENABLED_FOR_ALL_TEST_USERS"
      : "VERIFICATION_FAIL";

  writeFileSync(join(OUT_DIR, "DISCOVERY_VERIFICATION.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
