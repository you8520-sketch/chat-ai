/**
 * Probe active RP diagnostic canary variant on production (user 34 only).
 * Usage: EXPECTED_VARIANT=ds_pipeline_baseline node --import tsx scripts/probe-canary-variant.ts
 */
import { readFileSync } from "node:fs";

const BASE = process.env.PROD_BASE ?? "https://chat-ai-production-3e84.up.railway.app";
const COOKIE_FILE = process.env.PROD_COOKIE_FILE ?? "/tmp/terra_axis_cookies.txt";
const EXPECTED = process.env.EXPECTED_VARIANT ?? "ds_pipeline_baseline";

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
  const token = loadSessionCookie();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      characterId: 18,
      message: "probe",
      selectedPersonaId: 61,
      isAdultMode: false,
      isNsfwMode: false,
      clientRequestId: `variant_probe_${Date.now()}`,
    }),
  });
  if (!res.ok) {
    console.log(JSON.stringify({ pass: false, reason: `HTTP_${res.status}` }));
    process.exit(1);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let variant: string | undefined;
  let integrity: unknown;
  while (true) {
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
        const ev = JSON.parse(data) as { type?: string; variant?: string; integrity?: unknown };
        if (ev.type === "diagnostic_pipeline") {
          variant = ev.variant;
          integrity = ev.integrity;
        }
      } catch {
        /* ignore */
      }
    }
  }
  const pass = variant === EXPECTED;
  console.log(
    JSON.stringify(
      {
        pass,
        expected: EXPECTED,
        variant: variant ?? null,
        has_pipeline: Boolean(variant),
        integrity,
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
