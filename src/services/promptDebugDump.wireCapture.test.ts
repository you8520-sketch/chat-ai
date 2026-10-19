import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, it } from "node:test";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import { callOpenRouterEmbeddings } from "@/lib/openRouterEmbeddings";
import {
  dumpOpenRouterRequest,
  enterVerificationWireCapture,
  resolveVerificationWireCaptureScope,
  runWithVerificationWireCapture,
} from "@/services/promptDebugDump";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function readBodies(dir: string): Array<{ file: string; body: Record<string, unknown> }> {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  return files.map((file) => ({
    file,
    body: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>,
  }));
}

describe("verification wire capture", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("keeps main, Luna, and the next turn, and skips another chat", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wire-capture-"));
    process.env.RP_WIRE_CAPTURE_DIR = dir;
    process.env.RP_WIRE_CAPTURE_RUN = "run-a";
    process.env.RP_WIRE_CAPTURE_USER_ID = "1";
    process.env.RP_WIRE_CAPTURE_CHARACTER_ID = "51";
    process.env.RP_WIRE_CAPTURE_CHAT_ID = "804";
    process.env.MOCK_MODE = "1";
    delete process.env.PROMPT_DEBUG;
    delete process.env.DEBUG_PROMPT;
    const legacyDir = path.join(process.cwd(), "debug");
    fs.rmSync(legacyDir, { recursive: true, force: true });
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("fetch should not run");
    }) as typeof fetch;

    const selected = resolveVerificationWireCaptureScope({
      userId: 1,
      characterId: 51,
      chatId: 804,
      turn: 1,
      requestId: "req-turn-1",
    });
    const nextTurn = resolveVerificationWireCaptureScope({
      userId: 1,
      characterId: 51,
      chatId: 804,
      turn: 2,
      requestId: "req-turn-2",
    });
    const other = resolveVerificationWireCaptureScope({
      userId: 1,
      characterId: 51,
      chatId: 999,
      turn: 1,
      requestId: "req-other",
    });
    assert.ok(selected);
    assert.ok(nextTurn);
    assert.equal(other, null);

    const mainBody = { model: "gpt-6.1-sol", messages: [{ role: "user", content: "main-turn-1" }] };
    const lunaBody = { model: "gpt-6-luna", max_tokens: 4096, messages: [{ role: "user", content: "luna-turn-1" }] };
    const nextBody = { model: "gpt-6.1-sol", messages: [{ role: "user", content: "main-turn-2" }] };
    const otherBody = { model: "gpt-6.1-sol", messages: [{ role: "user", content: "other-chat" }] };

    await Promise.all([
      runWithVerificationWireCapture(selected, async () => {
        dumpOpenRouterRequest(mainBody, { requestKind: "cheaperinference-primary-stream" });
        await callOpenRouterCompletion({
          system: "system",
          history: [{ role: "user", content: "luna-turn-1" }],
          model: "gpt-6-luna",
          maxTokens: 4096,
          requestKind: "background-post-turn-shared-initial",
        });
      }),
      runWithVerificationWireCapture(nextTurn, async () => {
        dumpOpenRouterRequest(nextBody, { requestKind: "cheaperinference-primary-stream" });
      }),
      Promise.resolve().then(() => {
        dumpOpenRouterRequest(otherBody, { requestKind: "cheaperinference-primary-stream" });
      }),
    ]);

    const turn1 = readBodies(path.join(dir, "run-a", "chat-804", "turn-1"));
    const turn2 = readBodies(path.join(dir, "run-a", "chat-804", "turn-2"));
    assert.deepEqual(
      turn1.map((entry) => entry.file),
      ["01-main--req-turn-1.json", "02-luna--req-turn-1.json"]
    );
    assert.equal(turn1[0]?.body.model, "gpt-6.1-sol");
    assert.equal(
      (turn1[0]?.body.messages as Array<{ content: string }>)[0]?.content,
      "main-turn-1"
    );
    assert.equal(turn1[1]?.body.model, "gpt-6-luna");
    assert.equal(turn1[1]?.body.max_tokens, 4096);
    assert.equal(
      (turn1[1]?.body.messages as Array<{ content: string }>)[1]?.content,
      "luna-turn-1"
    );
    assert.deepEqual(
      turn2.map((entry) => entry.file),
      ["01-main--req-turn-2.json"]
    );
    assert.equal(
      (turn2[0]?.body.messages as Array<{ content: string }>)[0]?.content,
      "main-turn-2"
    );
    assert.equal(fs.existsSync(path.join(dir, "run-a", "chat-999")), false);
    assert.equal(fs.existsSync(path.join(legacyDir, "prompt_dump.txt")), false);
    assert.deepEqual(calls, []);

    process.env.PROMPT_DEBUG = "1";
    try {
      dumpOpenRouterRequest(
        { model: "gpt-6.1-sol", messages: [{ role: "user", content: "legacy-first" }] },
        { requestKind: "cheaperinference-primary-stream" }
      );
      dumpOpenRouterRequest(
        { model: "gpt-6.1-sol", messages: [{ role: "user", content: "legacy-second" }] },
        { requestKind: "cheaperinference-primary-stream" }
      );
      const legacy = fs.readFileSync(path.join(legacyDir, "prompt_dump.txt"), "utf8");
      assert.match(legacy, /legacy-second/);
      assert.doesNotMatch(legacy, /legacy-first/);
      assert.equal(readBodies(path.join(dir, "run-a", "chat-804", "turn-1")).length, 2);
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
      globalThis.fetch = originalFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records an embeddings body without a provider call when mock mode is on", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wire-embed-"));
    process.env.RP_WIRE_CAPTURE_DIR = dir;
    process.env.RP_WIRE_CAPTURE_RUN = "run-embed";
    process.env.RP_WIRE_CAPTURE_USER_ID = "1";
    process.env.RP_WIRE_CAPTURE_CHARACTER_ID = "51";
    process.env.RP_WIRE_CAPTURE_CHAT_ID = "804";
    process.env.MOCK_MODE = "1";
    delete process.env.OPENROUTER_API_KEY;
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("fetch should not run");
    }) as typeof fetch;
    try {
      const scope = resolveVerificationWireCaptureScope({
        userId: 1,
        characterId: 51,
        chatId: 804,
        turn: 1,
        requestId: "req-embed",
      });
      const result = await runWithVerificationWireCapture(scope, () =>
        callOpenRouterEmbeddings({
          model: "baai/bge-m3",
          inputs: ["봉인고 기록", "인장 문서"],
          dimensions: 4,
          requestKind: "background-memory-episodic-embedding",
          timeoutMs: 1000,
          ledger: null,
        })
      );
      assert.equal(result.vectors.length, 2);
      assert.equal(result.vectors[0]?.[0], 1);
      assert.deepEqual(calls, []);
      const saved = readBodies(path.join(dir, "run-embed", "chat-804", "turn-1"));
      assert.equal(saved.length, 1);
      assert.match(saved[0]!.file, /^01-embedding--req-embed\.json$/);
      assert.deepEqual(saved[0]?.body.input, ["봉인고 기록", "인장 문서"]);
      assert.equal(saved[0]?.body.model, "baai/bge-m3");
    } finally {
      globalThis.fetch = original;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not let an excluded chat inherit the selected scope", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wire-scope-"));
    process.env.RP_WIRE_CAPTURE_DIR = dir;
    process.env.RP_WIRE_CAPTURE_RUN = "run-scope";
    process.env.RP_WIRE_CAPTURE_USER_ID = "1";
    process.env.RP_WIRE_CAPTURE_CHARACTER_ID = "51";
    process.env.RP_WIRE_CAPTURE_CHAT_ID = "804";
    process.env.MOCK_MODE = "1";
    delete process.env.OPENROUTER_API_KEY;
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("fetch should not run");
    }) as typeof fetch;
    const target = {
      userId: 1,
      characterId: 51,
      chatId: 804,
      turn: 1,
      requestId: "req-target",
    };
    const excluded = { ...target, chatId: 999, requestId: "req-excluded" };
    try {
      await enterVerificationWireCapture(target, async () => {
        dumpOpenRouterRequest(
          { model: "gpt-6.1-sol", messages: [{ role: "user", content: "target-main" }] },
          { requestKind: "cheaperinference-primary-stream" }
        );
        await callOpenRouterCompletion({
          system: "system",
          history: [{ role: "user", content: "target-luna" }],
          model: "gpt-6-luna",
          maxTokens: 4096,
          requestKind: "background-post-turn-shared-initial",
        });
        await callOpenRouterEmbeddings({
          model: "baai/bge-m3",
          inputs: ["target-embed"],
          dimensions: 4,
          requestKind: "background-memory-episodic-embedding",
          timeoutMs: 1000,
          ledger: null,
        });
      });
      await enterVerificationWireCapture(excluded, async () => {
        dumpOpenRouterRequest(
          { model: "gpt-6.1-sol", messages: [{ role: "user", content: "excluded-after" }] },
          { requestKind: "cheaperinference-primary-stream" }
        );
      });
      dumpOpenRouterRequest(
        { model: "gpt-6.1-sol", messages: [{ role: "user", content: "outside-after" }] },
        { requestKind: "cheaperinference-primary-stream" }
      );

      const saved = readBodies(path.join(dir, "run-scope", "chat-804", "turn-1"));
      assert.deepEqual(
        saved.map((entry) => entry.file),
        [
          "01-main--req-target.json",
          "02-luna--req-target.json",
          "03-embedding--req-target.json",
        ]
      );
      assert.equal(
        (saved[0]?.body.messages as Array<{ content: string }>)[0]?.content,
        "target-main"
      );
      assert.equal(
        (saved[1]?.body.messages as Array<{ content: string }>)[1]?.content,
        "target-luna"
      );
      assert.deepEqual(saved[2]?.body.input, ["target-embed"]);
      assert.equal(fs.existsSync(path.join(dir, "run-scope", "chat-999")), false);
      const allText = saved.map((entry) => JSON.stringify(entry.body)).join("\n");
      assert.equal(allText.includes("excluded-after"), false);
      assert.equal(allText.includes("outside-after"), false);
      assert.deepEqual(calls, []);
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps concurrent selected and excluded bodies apart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wire-race-"));
    process.env.RP_WIRE_CAPTURE_DIR = dir;
    process.env.RP_WIRE_CAPTURE_RUN = "run-race";
    process.env.RP_WIRE_CAPTURE_USER_ID = "1";
    process.env.RP_WIRE_CAPTURE_CHARACTER_ID = "51";
    process.env.RP_WIRE_CAPTURE_CHAT_ID = "804";
    const target = {
      userId: 1,
      characterId: 51,
      chatId: 804,
      turn: 1,
      requestId: "req-race",
    };
    const excluded = { ...target, chatId: 999, requestId: "req-race-excluded" };
    try {
      await Promise.all([
        enterVerificationWireCapture(target, async () => {
          await Promise.resolve();
          dumpOpenRouterRequest(
            { model: "gpt-6.1-sol", messages: [{ role: "user", content: "race-target" }] },
            { requestKind: "cheaperinference-primary-stream" }
          );
        }),
        enterVerificationWireCapture(excluded, async () => {
          await Promise.resolve();
          dumpOpenRouterRequest(
            { model: "gpt-6.1-sol", messages: [{ role: "user", content: "race-excluded" }] },
            { requestKind: "cheaperinference-primary-stream" }
          );
        }),
      ]);
      const saved = readBodies(path.join(dir, "run-race", "chat-804", "turn-1"));
      assert.deepEqual(saved.map((entry) => entry.file), ["01-main--req-race.json"]);
      assert.equal(
        (saved[0]?.body.messages as Array<{ content: string }>)[0]?.content,
        "race-target"
      );
      assert.equal(fs.existsSync(path.join(dir, "run-race", "chat-999")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores the outer scope after a nested exit and a thrown nested run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wire-nest-"));
    process.env.RP_WIRE_CAPTURE_DIR = dir;
    process.env.RP_WIRE_CAPTURE_RUN = "run-nest";
    process.env.RP_WIRE_CAPTURE_USER_ID = "1";
    process.env.RP_WIRE_CAPTURE_CHARACTER_ID = "51";
    process.env.RP_WIRE_CAPTURE_CHAT_ID = "804";
    const outer = {
      userId: 1,
      characterId: 51,
      chatId: 804,
      turn: 1,
      requestId: "req-outer",
    };
    const excluded = { ...outer, chatId: 999, requestId: "req-nest-excluded" };
    const inner = { ...outer, turn: 2, requestId: "req-inner" };
    try {
      await enterVerificationWireCapture(outer, async () => {
        dumpOpenRouterRequest(
          { model: "gpt-6.1-sol", messages: [{ role: "user", content: "outer-before" }] },
          { requestKind: "cheaperinference-primary-stream" }
        );
        await assert.rejects(
          enterVerificationWireCapture(excluded, async () => {
            dumpOpenRouterRequest(
              { model: "gpt-6.1-sol", messages: [{ role: "user", content: "nested-excluded" }] },
              { requestKind: "cheaperinference-primary-stream" }
            );
            throw new Error("excluded-boom");
          }),
          /excluded-boom/
        );
        dumpOpenRouterRequest(
          { model: "gpt-6.1-sol", messages: [{ role: "user", content: "outer-after-exit" }] },
          { requestKind: "cheaperinference-primary-stream" }
        );
        await assert.rejects(
          enterVerificationWireCapture(inner, async () => {
            dumpOpenRouterRequest(
              { model: "gpt-6.1-sol", messages: [{ role: "user", content: "inner-main" }] },
              { requestKind: "cheaperinference-primary-stream" }
            );
            throw new Error("inner-boom");
          }),
          /inner-boom/
        );
        dumpOpenRouterRequest(
          { model: "gpt-6.1-sol", messages: [{ role: "user", content: "outer-after-throw" }] },
          { requestKind: "cheaperinference-primary-stream" }
        );
      });
      dumpOpenRouterRequest(
        { model: "gpt-6.1-sol", messages: [{ role: "user", content: "after-outer" }] },
        { requestKind: "cheaperinference-primary-stream" }
      );

      const turn1 = readBodies(path.join(dir, "run-nest", "chat-804", "turn-1"));
      const turn2 = readBodies(path.join(dir, "run-nest", "chat-804", "turn-2"));
      assert.deepEqual(
        turn1.map((entry) => entry.file),
        [
          "01-main--req-outer.json",
          "02-main--req-outer.json",
          "03-main--req-outer.json",
        ]
      );
      assert.deepEqual(
        turn1.map((entry) => (entry.body.messages as Array<{ content: string }>)[0]?.content),
        ["outer-before", "outer-after-exit", "outer-after-throw"]
      );
      assert.deepEqual(turn2.map((entry) => entry.file), ["01-main--req-inner.json"]);
      assert.equal(
        (turn2[0]?.body.messages as Array<{ content: string }>)[0]?.content,
        "inner-main"
      );
      assert.equal(fs.existsSync(path.join(dir, "run-nest", "chat-999")), false);
      const allText = [...turn1, ...turn2].map((entry) => JSON.stringify(entry.body)).join("\n");
      assert.equal(allText.includes("nested-excluded"), false);
      assert.equal(allText.includes("after-outer"), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the route stream callback scoped and leaves the caller clear", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wire-stream-"));
    process.env.RP_WIRE_CAPTURE_DIR = dir;
    process.env.RP_WIRE_CAPTURE_RUN = "run-stream";
    process.env.RP_WIRE_CAPTURE_USER_ID = "1";
    process.env.RP_WIRE_CAPTURE_CHARACTER_ID = "51";
    process.env.RP_WIRE_CAPTURE_CHAT_ID = "804";
    process.env.MOCK_MODE = "1";
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("fetch should not run");
    }) as typeof fetch;
    const streamInput = {
      userId: 1,
      characterId: 51,
      chatId: 804,
      turn: 2,
      requestId: "req-stream",
    };
    try {
      const stream = new ReadableStream({
        async start(controller) {
          try {
            await enterVerificationWireCapture(streamInput, async () => {
              await Promise.resolve();
              dumpOpenRouterRequest(
                { model: "gpt-6.1-sol", messages: [{ role: "user", content: "stream-main" }] },
                { requestKind: "cheaperinference-primary-stream" }
              );
              await enterVerificationWireCapture(
                { ...streamInput, chatId: 999, requestId: "req-stream-excluded" },
                async () => {
                  dumpOpenRouterRequest(
                    {
                      model: "gpt-6.1-sol",
                      messages: [{ role: "user", content: "stream-excluded" }],
                    },
                    { requestKind: "cheaperinference-primary-stream" }
                  );
                }
              );
            });
          } finally {
            controller.close();
          }
        },
      });
      dumpOpenRouterRequest(
        { model: "gpt-6.1-sol", messages: [{ role: "user", content: "outside-stream" }] },
        { requestKind: "cheaperinference-primary-stream" }
      );
      const reader = stream.getReader();
      while (!(await reader.read()).done) {
        // The route start callback closes the stream after its scoped work.
      }
      dumpOpenRouterRequest(
        { model: "gpt-6.1-sol", messages: [{ role: "user", content: "after-stream" }] },
        { requestKind: "cheaperinference-primary-stream" }
      );

      const saved = readBodies(path.join(dir, "run-stream", "chat-804", "turn-2"));
      assert.deepEqual(saved.map((entry) => entry.file), ["01-main--req-stream.json"]);
      assert.equal(
        (saved[0]?.body.messages as Array<{ content: string }>)[0]?.content,
        "stream-main"
      );
      assert.equal(fs.existsSync(path.join(dir, "run-stream", "chat-999")), false);
      assert.equal(JSON.stringify(saved[0]?.body).includes("outside-stream"), false);
      assert.equal(JSON.stringify(saved[0]?.body).includes("after-stream"), false);
      assert.equal(JSON.stringify(saved[0]?.body).includes("stream-excluded"), false);
      assert.deepEqual(calls, []);
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
