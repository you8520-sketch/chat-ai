import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSX_SANDBOX_MAX_RAF, JSX_SANDBOX_MAX_TIMERS } from "./limits";

type HostMessage =
  | { type: "hav-jsx-mount"; compiled: string; props: Record<string, unknown>; parentOrigin: string }
  | { type: "hav-jsx-unmount" };

let root: Root | null = null;
let parentOrigin = "";
let timerCount = 0;
let rafCount = 0;

function post(kind: string, payload: unknown): void {
  parent.postMessage({ source: "hav-jsx-sandbox", kind, payload }, parentOrigin || "*");
}

function blockedNetwork(): Promise<never> {
  return Promise.reject(new Error("jsx sandbox: network blocked"));
}

function installLimits(): void {
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeRaf = window.requestAnimationFrame.bind(window);
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (timerCount >= JSX_SANDBOX_MAX_TIMERS) return 0 as unknown as number;
    timerCount += 1;
    return nativeSetTimeout(() => {
      timerCount = Math.max(0, timerCount - 1);
      if (typeof fn === "function") fn(...args);
    }, ms);
  }) as typeof window.setTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (timerCount >= JSX_SANDBOX_MAX_TIMERS) return 0 as unknown as number;
    timerCount += 1;
    return nativeSetInterval(fn, ms, ...args);
  }) as typeof window.setInterval;
  window.requestAnimationFrame = ((fn: FrameRequestCallback) => {
    if (rafCount >= JSX_SANDBOX_MAX_RAF) return 0;
    rafCount += 1;
    return nativeRaf((t) => {
      rafCount = Math.max(0, rafCount - 1);
      fn(t);
    });
  }) as typeof window.requestAnimationFrame;

  window.fetch = blockedNetwork as typeof window.fetch;
  window.XMLHttpRequest = function BlockedXhr() {
    throw new Error("jsx sandbox: network blocked");
  } as unknown as typeof XMLHttpRequest;
}

/**
 * Runtime-provided chat APIs (Teapot-parity globals).
 * Sync, void. Host never auto-sends to the provider from this message.
 */
function sendToChat(text: unknown): void {
  post("sendToChat", { text: String(text ?? "") });
}

function setChatDraft(text: unknown): void {
  post("setChatDraft", { text: String(text ?? "") });
}

function mount(compiled: string, props: Record<string, unknown>): void {
  const mountEl = document.getElementById("root");
  if (!mountEl) return;
  if (!root) root = createRoot(mountEl);
  try {
    const factory = new Function("React", "sendToChat", "setChatDraft", compiled) as (
      react: typeof React,
      send: typeof sendToChat,
      draft: typeof setChatDraft
    ) => React.ComponentType<Record<string, unknown>>;
    const Comp = factory(React, sendToChat, setChatDraft);
    root.render(React.createElement(Comp, props));
    post("ready", {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "runtime throw";
    mountEl.textContent = "컴포넌트를 표시할 수 없습니다.";
    post("error", { message });
  }
}

installLimits();

const runtimeWindow = window as Window & {
  sendToChat?: typeof sendToChat;
  setChatDraft?: typeof setChatDraft;
  React?: typeof React;
};
runtimeWindow.sendToChat = sendToChat;
runtimeWindow.setChatDraft = setChatDraft;
runtimeWindow.React = React;

window.addEventListener("message", (event) => {
  const data = event.data as HostMessage | undefined;
  if (!data || typeof data !== "object") return;
  if (data.type === "hav-jsx-unmount") {
    root?.unmount();
    root = null;
    return;
  }
  if (data.type !== "hav-jsx-mount") return;
  parentOrigin = typeof data.parentOrigin === "string" ? data.parentOrigin : "";
  mount(data.compiled, data.props || {});
});

post("boot", {});
