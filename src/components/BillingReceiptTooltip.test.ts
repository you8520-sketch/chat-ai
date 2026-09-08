import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import BillingReceiptTooltip from "@/components/BillingReceiptTooltip";
import type { Usage } from "@/lib/chatUsage";

const usage: Usage = {
  input: 10,
  output: 4,
  model: "test-model",
  modelLabel: "Test model",
  route: "safe",
  cost: 3,
  exchangeRateKrwPerUsd: 1_300,
  exchangeRateDateKey: "2026-09-08",
  breakdown: [],
};

let dom: JSDOM | null = null;
let root: Root | null = null;
let originalFetch: typeof fetch;
const originalGlobalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function installDom() {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  const window = dom.window;
  for (const [name, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    PointerEvent: window.PointerEvent,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    if (!originalGlobalDescriptors.has(name)) {
      originalGlobalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return window.document.createElement("div");
}

async function renderAndOpen(showFullReceipt: boolean) {
  const container = installDom();
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(BillingReceiptTooltip, {
        usage,
        triggerVariant: "info",
        showFullReceipt,
        messageId: 123,
      })
    );
  });
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="포인트 차감 내역"]'
  );
  assert.ok(trigger, "receipt trigger should be mounted");
  await act(async () => {
    trigger!.click();
  });
  return container;
}

describe("BillingReceiptTooltip admin receipt fetch boundary", () => {
  afterEach(async () => {
    if (root) {
      await act(async () => root!.unmount());
      root = null;
    }
    dom?.window.close();
    dom = null;
    globalThis.fetch = originalFetch;
    for (const [name, descriptor] of originalGlobalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    originalGlobalDescriptors.clear();
  });

  it("does not fetch the admin endpoint for a normal receipt", async () => {
    originalFetch = globalThis.fetch;
    const adminCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/chat/admin-billing-receipt")) adminCalls.push(url);
      return { ok: false, status: 403, json: async () => ({ error: "forbidden" }) } as Response;
    }) as typeof fetch;

    await renderAndOpen(false);
    await act(async () => {
      await Promise.resolve();
    });
    assert.equal(adminCalls.length, 0);
  });

  it("fetches the admin endpoint exactly once for an open full receipt", async () => {
    originalFetch = globalThis.fetch;
    const adminCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/chat/admin-billing-receipt")) adminCalls.push(url);
      return { ok: false, status: 403, json: async () => ({ error: "forbidden" }) } as Response;
    }) as typeof fetch;

    await renderAndOpen(true);
    await act(async () => {
      await Promise.resolve();
    });
    assert.equal(adminCalls.length, 1);
    assert.equal(adminCalls[0], "/api/chat/admin-billing-receipt?messageId=123");
  });
});
