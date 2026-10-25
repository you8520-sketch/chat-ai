"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT = process.env.CI_CAPTURE_DIR || path.join(process.cwd(), "debug", "ci-capture");
fs.mkdirSync(OUT, { recursive: true });

let seq = 0;

function sha256(text) {
  return crypto.createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractSseText(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  let content = "";
  let reasoning = "";
  let finishReason = "";
  let usage = null;
  let model = "";
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const json = safeJsonParse(payload);
    if (!json || typeof json !== "object") continue;
    if (typeof json.model === "string" && json.model) model = json.model;
    const choice = Array.isArray(json.choices) ? json.choices[0] : null;
    const delta = choice?.delta ?? choice?.message ?? {};
    if (typeof delta.content === "string") content += delta.content;
    if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
    if (typeof delta.reasoning === "string") reasoning += delta.reasoning;
    if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
    if (json.usage && typeof json.usage === "object") usage = json.usage;
  }
  return { content, reasoning, finishReason, usage, model };
}

function captureUrl(url) {
  return /cheaperinference\.com|openrouter\.ai/i.test(String(url || ""));
}

function wrapFetch(origFetch) {
  return async function capturedFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input && typeof input === "object" && "url" in input
          ? String(input.url)
          : String(input);
    if (!captureUrl(url)) {
      return origFetch(input, init);
    }

    seq += 1;
    const id = String(seq).padStart(3, "0");
    const started = Date.now();
    const method = (init && init.method) || "POST";
    const reqBody =
      init && init.body != null
        ? typeof init.body === "string"
          ? init.body
          : Buffer.isBuffer(init.body)
            ? init.body.toString("utf8")
            : String(init.body)
        : "";
    const reqJson = safeJsonParse(reqBody);
    const model =
      reqJson && typeof reqJson.model === "string" ? reqJson.model : "";

    fs.writeFileSync(path.join(OUT, `${id}-request.json`), reqBody || "{}", "utf8");

    const res = await origFetch(input, init);
    const body = res.body;
    if (!body || typeof body.getReader !== "function") {
      const text = await res.text();
      const extracted = extractSseText(text);
      const meta = {
        id,
        url,
        method,
        status: res.status,
        model: model || extracted.model,
        requestSha: sha256(reqBody),
        rawSha: sha256(text),
        ttftMs: null,
        latencyMs: Date.now() - started,
        finishReason: extracted.finishReason || null,
        usage: extracted.usage,
        visibleChars: extracted.content.length,
        capturedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(OUT, `${id}-response.txt`), text, "utf8");
      fs.writeFileSync(
        path.join(OUT, `${id}-extracted.txt`),
        extracted.content,
        "utf8"
      );
      fs.writeFileSync(
        path.join(OUT, `${id}-meta.json`),
        JSON.stringify(meta, null, 2),
        "utf8"
      );
      return new Response(text, { status: res.status, headers: res.headers });
    }

    const reader = body.getReader();
    const chunks = [];
    let ttftMs = null;
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          const raw = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
          const extracted = extractSseText(raw);
          const meta = {
            id,
            url,
            method,
            status: res.status,
            model: model || extracted.model,
            requestSha: sha256(reqBody),
            rawSha: sha256(raw),
            ttftMs,
            latencyMs: Date.now() - started,
            finishReason: extracted.finishReason || null,
            usage: extracted.usage,
            visibleChars: extracted.content.length,
            capturedAt: new Date().toISOString(),
          };
          fs.writeFileSync(path.join(OUT, `${id}-response.txt`), raw, "utf8");
          fs.writeFileSync(
            path.join(OUT, `${id}-extracted.txt`),
            extracted.content,
            "utf8"
          );
          if (extracted.reasoning) {
            fs.writeFileSync(
              path.join(OUT, `${id}-reasoning.txt`),
              extracted.reasoning,
              "utf8"
            );
          }
          fs.writeFileSync(
            path.join(OUT, `${id}-meta.json`),
            JSON.stringify(meta, null, 2),
            "utf8"
          );
          controller.close();
          return;
        }
        if (ttftMs == null) ttftMs = Date.now() - started;
        chunks.push(value);
        controller.enqueue(value);
      },
    });

    return new Response(stream, { status: res.status, headers: res.headers });
  };
}

if (typeof globalThis.fetch === "function") {
  globalThis.fetch = wrapFetch(globalThis.fetch.bind(globalThis));
}

fs.writeFileSync(
  path.join(OUT, "preload-ready.json"),
  JSON.stringify({ readyAt: new Date().toISOString(), out: OUT }, null, 2),
  "utf8"
);
