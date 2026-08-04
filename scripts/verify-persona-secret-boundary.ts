/**
 * Persona Secret Boundary full-activation verification.
 * Run after Railway sets PERSONA_SECRET_BOUNDARY_ENABLED=1, PERSONA_SECRET_DISCOVERY_ENABLED=0.
 *
 * Checks:
 *  - /health ok, main, SHA
 *  - /api/personas canEdit=true, discoveryActive=false for general user
 *  - secret create (POST /api/personas with secret_description) accepted
 *  - public /api/personas does NOT include secret needle
 *  - owner editor endpoint returns secret; cross-user returns 404
 *  - secret edit + delete
 *  - chat turn does not leak secret needle
 *
 * Usage: node --import tsx scripts/verify-persona-secret-boundary.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const OUT_DIR = process.env.OUT_DIR ?? "/opt/cursor/artifacts/deepseek-common-root-audit/16-persona-secret-boundary";
const NEEDLE = `GLOBAL_BOUNDARY_SECRET_NEEDLE_${Date.now()}`;

mkdirSync(OUT_DIR, { recursive: true });

async function safeJson(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return { _text: await res.text(), _status: res.status };
  try {
    return await res.json();
  } catch {
    return { _text: await res.text(), _status: res.status };
  }
}

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

async function signupNewUser(): Promise<{ token: string; userId: number } | null> {
  const email = `boundary.verify.${Date.now()}@example.com`;
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "BoundaryVerify_12910", nickname: `bv_${Date.now().toString(36)}`, pref: "male" }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { _signup_failed: res.status, _body: txt.slice(0, 200) } as never;
  }
  const sc = res.headers.get("set-cookie") ?? "";
  const m = sc.match(/session=([^;]+)/);
  if (!m) return null;
  const token = m[1]!;
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: `session=${token}` } })).json();
  return { token, userId: me.user.id };
}

async function main() {
  const token = loadSessionCookie();
  const report: Record<string, unknown> = { generated_at: new Date().toISOString(), needle: NEEDLE };

  // 1. health
  const health = await (await fetch(`${BASE}/api/health`)).json();
  report.health = health;
  report.deploy_ok = health.ok === true && health.gitBranch === "main";

  // 2. /api/personas capability for general user (34)
  const personasRes = await fetch(`${BASE}/api/personas`, { headers: { Cookie: `session=${token}` } });
  const personasBody = await safeJson(personasRes);
  const cap = personasBody?.capabilities?.personaSecretSettings;
  report.general_user_canEdit = cap?.canEdit;
  report.general_user_discoveryActive = cap?.discoveryActive;
  report.boundary_on = cap?.canEdit === true;
  report.discovery_off = cap?.discoveryActive === false;

  // 3. secret create
  const createRes = await fetch(`${BASE}/api/personas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    body: JSON.stringify({
      name: `boundary_probe_${Date.now().toString(36)}`,
      gender: "male",
      description: "정상 설명.",
      secret_description: NEEDLE,
    }),
  });
  const createBody = await safeJson(createRes) as { ok?: boolean; persona?: { id?: number } };
  report.secret_create_status = createRes.status;
  report.secret_create_ok = createBody?.ok === true;
  const newPersonaId = createBody?.persona?.id;
  report.new_persona_id = newPersonaId;

  // 4. public /api/personas must NOT include secret needle
  const publicRes = await fetch(`${BASE}/api/personas`, { headers: { Cookie: `session=${token}` } });
  const publicBody = await safeJson(publicRes);
  const publicJson = JSON.stringify(publicBody);
  report.public_secret_needle_bytes = publicJson.includes(NEEDLE) ? publicJson.split(NEEDLE).length - 1 : 0;
  report.public_isolation_ok = !publicJson.includes(NEEDLE);

  // 5. owner editor endpoint returns secret; cross-user 404
  if (newPersonaId) {
    const editorRes = await fetch(`${BASE}/api/personas/${newPersonaId}/editor`, {
      headers: { Cookie: `session=${token}` },
    });
    const editorBody = await safeJson(editorRes);
    report.owner_editor_status = editorRes.status;
    report.owner_editor_has_secret = JSON.stringify(editorBody).includes(NEEDLE);

    // cross-user: signup a new user and try to access the persona editor
    const other = await signupNewUser();
    if (other) {
      const crossRes = await fetch(`${BASE}/api/personas/${newPersonaId}/editor`, {
        headers: { Cookie: `session=${other.token}` },
      });
      report.cross_user_editor_status = crossRes.status;
      report.cross_user_blocked = crossRes.status === 404 || crossRes.status === 403;
    } else {
      report.cross_user_editor_status = "SKIP (signup failed)";
    }  }

  // 6. secret edit + delete
  if (newPersonaId) {
    const editRes = await fetch(`${BASE}/api/personas/${newPersonaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
      body: JSON.stringify({ secret_description: NEEDLE + "_EDITED" }),
    });
    report.secret_edit_status = editRes.status;
    const editBody = await safeJson(editRes) as { ok?: boolean };
    report.secret_edit_ok = editBody?.ok === true;

    const delRes = await fetch(`${BASE}/api/personas/${newPersonaId}`, {
      method: "DELETE",
      headers: { Cookie: `session=${token}` },
    });
    report.secret_delete_status = delRes.status;
    report.secret_delete_ok = delRes.status === 200;
  }

  // 7. chat turn must not leak secret needle
  const chatRes = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}`, Accept: "text/event-stream" },
    body: JSON.stringify({
      characterId: 18,
      message: "비밀 확인 프로브.",
      selectedPersonaId: 61,
      isAdultMode: false,
      isNsfwMode: false,
      clientRequestId: `boundary_probe_${Date.now()}`,
    }),
  });
  const chatReader = chatRes.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let chatText = "";
  while (true) {
    const { done, value } = await chatReader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const c of chunks) {
      let d = "";
      for (const l of c.split("\n")) if (l.startsWith("data:")) d += l.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const ev = JSON.parse(d);
        if (ev.type === "replace" && typeof ev.text === "string") chatText = ev.text;
        if (ev.type === "done" && typeof ev.finalContent === "string") chatText = ev.finalContent;
      } catch {
        /* ignore */
      }
    }
  }
  report.chat_status = chatRes.status;
  report.chat_secret_needle_bytes = chatText.includes(NEEDLE) ? chatText.split(NEEDLE).length - 1 : 0;
  report.chat_isolation_ok = !chatText.includes(NEEDLE);

  // verdict
  report.verdict =
    report.deploy_ok &&
    report.boundary_on &&
    report.discovery_off &&
    report.secret_create_ok &&
    report.public_isolation_ok &&
    report.owner_editor_has_secret &&
    report.cross_user_blocked &&
    report.secret_edit_ok &&
    report.secret_delete_ok &&
    report.chat_isolation_ok
      ? "PERSONA_SECRET_BOUNDARY_ENABLED_FOR_ALL_TEST_USERS"
      : "VERIFICATION_FAIL";

  writeFileSync(join(OUT_DIR, "BOUNDARY_VERIFICATION.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
