/**
 * Production deploy integrity gate (§1) — abort before model calls on failure.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { resolveRpDiagnosticCanary } from "../src/lib/rpDiagnosticCanary";

const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const EXPECTED_SHA = process.env.EXPECTED_SHA ?? execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const OUT = process.env.OUT_DIR ?? "/opt/cursor/artifacts/deepseek-common-root-audit/00-integrity";
const EXPECTED_VARIANT = process.env.EXPECTED_VARIANT ?? "ds_pipeline_baseline";

function loadSessionCookie(): string {
  const raw = readFileSync(COOKIE_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const normalized = line.startsWith("#HttpOnly_")
      ? line.slice("#HttpOnly_".length)
      : line.startsWith("#")
        ? ""
        : line;
    if (!normalized) continue;
    const parts = normalized.split("\t");
    if (parts.length >= 7 && parts[5] === "session") return parts[6]!.trim();
  }
  throw new Error("session cookie not found");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const failures: string[] = [];
  const checks: Record<string, unknown> = { expected_sha: EXPECTED_SHA, base: BASE };

  const healthRes = await fetch(`${BASE}/api/health`);
  if (!healthRes.ok) failures.push("HEALTH_HTTP_FAIL");
  const health = (await healthRes.json()) as {
    ok?: boolean;
    status?: string;
    gitSha?: string;
    gitCommit?: string;
    gitBranch?: string;
    commit?: string;
    sha?: string;
  };
  checks.health = health;
  if (health.ok !== true && health.status !== "ok") failures.push("HEALTH_STATUS_NOT_OK");

  const deploySha =
    health.gitCommit ?? health.gitSha ?? health.gitCommit ?? health.commit ?? health.sha ?? null;
  checks.deploy_sha = deploySha;
  if (!deploySha) {
    failures.push("DEPLOY_SHA_MISSING");
  } else if (!deploySha.startsWith(EXPECTED_SHA.slice(0, 7)) && deploySha !== EXPECTED_SHA) {
    failures.push("DEPLOY_SHA_MISMATCH");
  }

  const token = loadSessionCookie();
  const me = await (
    await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: `session=${token}` } })
  ).json();
  checks.user_id = me.user?.id;
  if (me.user?.id !== 34) failures.push("USER_ID_NOT_34");

  const personas = await (
    await fetch(`${BASE}/api/personas`, { headers: { Cookie: `session=${token}` } })
  ).json();
  const renMatches = ((personas as { personas?: Array<{ id: number; name: string }> }).personas ?? []).filter(
    (p) => p.name.trim() === "렌"
  );
  const persona = renMatches.sort((a, b) => a.id - b.id)[0];
  checks.persona_id = persona?.id;
  if (persona?.id !== 61) failures.push("PERSONA_ID_NOT_61");

  await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
    body: JSON.stringify({ selectedAI: "deepseek-v4-pro-0813" }),
  });

  const charRes = await fetch(`${BASE}/api/characters/18`, {
    headers: { Cookie: `session=${token}` },
  });
  if (charRes.ok) {
    const ch = (await charRes.json()) as { character?: { greeting?: string; id?: number } };
    checks.character_18_greeting_len = ch.character?.greeting?.length ?? 0;
    checks.character_18_greeting_hash = ch.character?.greeting
      ? Buffer.from(ch.character.greeting).toString("base64").slice(0, 24)
      : null;
  } else {
    const page = await fetch(`${BASE}/character/18?embed=chat-intro`);
    checks.character_page_status = page.status;
  }

  checks.local_fail_closed = {
    user34_pro: resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    })?.variant,
    user99_pro: resolveRpDiagnosticCanary({
      userId: 99,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    }),
    user34_gemini: resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "gemini-2.5-flash",
      contentKind: "character",
    }),
    user34_sim: resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "simulation",
    }),
  };

  const probeRes = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      characterId: 18,
      message: "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)",
      selectedPersonaId: 61,
      isAdultMode: false,
      isNsfwMode: false,
      clientRequestId: `integrity_probe_${Date.now()}`,
    }),
  });

  if (!probeRes.ok) {
    failures.push(`CANARY_PROBE_HTTP_${probeRes.status}`);
  } else {
    const reader = probeRes.body?.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let pipeline: Record<string, unknown> | null = null;
    let providerRaw = "";
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      for (const chunk of chunks) {
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data || data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data) as Record<string, unknown>;
          if (ev.type === "diagnostic_pipeline") pipeline = ev;
          if (ev.type === "delta" && typeof ev.text === "string") providerRaw += ev.text;
          if (ev.type === "replace" && typeof ev.text === "string") providerRaw = ev.text;
        } catch {
          /* ignore */
        }
      }
    }
    checks.canary_probe = {
      has_pipeline: Boolean(pipeline),
      variant: (pipeline as { variant?: string } | null)?.variant,
      integrity: (pipeline as { integrity?: unknown } | null)?.integrity,
      provider_raw_len: providerRaw.length,
    };
    if (!pipeline) failures.push("CANARY_PIPELINE_MISSING");
    if ((pipeline as { variant?: string } | null)?.variant !== EXPECTED_VARIANT) {
      failures.push("CANARY_VARIANT_MISMATCH");
    }
    const integ = (pipeline as { integrity?: { valid?: boolean; userId?: number } } | null)?.integrity;
    if (integ?.valid === false) failures.push("CANARY_INTEGRITY_INVALID");
    if (integ?.userId != null && integ.userId !== 34) failures.push("CANARY_SCOPE_LEAK");
  }

  const result = {
    generated_at: new Date().toISOString(),
    pass: failures.length === 0,
    failures,
    checks,
    abort_reason: failures.length ? failures.join("; ") : null,
  };

  writeFileSync(join(OUT, "DEPLOY_INTEGRITY.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
