import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSX_SANDBOX_MAX_RAF, JSX_SANDBOX_MAX_TIMERS } from "./limits";

type HostMessage =
  | { type: "hav-jsx-mount"; compiled: string; props: Record<string, unknown>; parentOrigin: string }
  | { type: "hav-jsx-unmount" };

let root: Root | null = null;
let currentCompiled = "";
let currentComponent: React.ComponentType<Record<string, unknown>> | null = null;
let parentOrigin = "";

const nativeSetTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
const nativeSetInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);
const nativeRaf = window.requestAnimationFrame.bind(window);
const nativeCancelRaf = window.cancelAnimationFrame.bind(window);
const timeoutIds = new Set<number>();
const intervalIds = new Set<number>();
const rafIds = new Set<number>();

function post(kind: string, payload: unknown): void {
  parent.postMessage({ source: "hav-jsx-sandbox", kind, payload }, parentOrigin || "*");
}

function blockedNetwork(): Promise<never> {
  return Promise.reject(new Error("jsx sandbox: network blocked"));
}

function clearRuntimeWork(): void {
  for (const id of timeoutIds) nativeClearTimeout(id);
  for (const id of intervalIds) nativeClearInterval(id);
  for (const id of rafIds) nativeCancelRaf(id);
  timeoutIds.clear();
  intervalIds.clear();
  rafIds.clear();
}

function installLimits(): void {
  const timerSlots = () => timeoutIds.size + intervalIds.size;
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (timerSlots() >= JSX_SANDBOX_MAX_TIMERS) return 0 as unknown as number;
    let id = 0;
    id = nativeSetTimeout(() => {
      timeoutIds.delete(id);
      if (typeof fn === "function") fn(...args);
    }, ms);
    timeoutIds.add(id);
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = ((id?: number) => {
    const value = Number(id ?? 0);
    timeoutIds.delete(value);
    nativeClearTimeout(value);
  }) as typeof window.clearTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (timerSlots() >= JSX_SANDBOX_MAX_TIMERS) return 0 as unknown as number;
    const id = nativeSetInterval(fn, ms, ...args);
    intervalIds.add(id);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    const value = Number(id ?? 0);
    intervalIds.delete(value);
    nativeClearInterval(value);
  }) as typeof window.clearInterval;
  window.requestAnimationFrame = ((fn: FrameRequestCallback) => {
    if (rafIds.size >= JSX_SANDBOX_MAX_RAF) return 0;
    let id = 0;
    id = nativeRaf((t) => {
      rafIds.delete(id);
      fn(t);
    });
    rafIds.add(id);
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    rafIds.delete(id);
    nativeCancelRaf(id);
  }) as typeof window.cancelAnimationFrame;

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

/** Draft-only TRPG action intent; ignored unless the host mounted a TRPG draft handler. */
function setTrpgActionDraft(actionType: unknown, text: unknown): void {
  post("setTrpgActionDraft", { actionType: String(actionType ?? ""), text: String(text ?? "") });
}

/** Viewer's own stat override. Ignored unless the host mounted a SELF handler. */
function setTrpgSelectedStat(key: unknown): void {
  post("setTrpgSelectedStat", { statKey: String(key ?? "") });
}

let heightTarget: Element | null = null;
let lastReportedHeight = -1;
const heightObserver =
  typeof ResizeObserver === "function" ? new ResizeObserver(() => reportHeight()) : null;
const childObserver =
  typeof MutationObserver === "function" ? new MutationObserver(() => trackHeightTarget()) : null;

function reportHeight(): void {
  const mountEl = document.getElementById("root");
  const target = mountEl?.firstElementChild;
  if (!(target instanceof HTMLElement)) return;
  const px = Math.ceil(target.offsetTop + target.getBoundingClientRect().height);
  if (px === lastReportedHeight) return;
  lastReportedHeight = px;
  post("height", { px });
}

function trackHeightTarget(): void {
  const next = document.getElementById("root")?.firstElementChild ?? null;
  if (next !== heightTarget) {
    if (heightTarget) heightObserver?.unobserve(heightTarget);
    heightTarget = next;
    if (heightTarget) heightObserver?.observe(heightTarget);
  }
  reportHeight();
}

function reportRenderError(error: unknown): void {
  const message = error instanceof Error ? error.message : "runtime throw";
  post("error", { message });
}

function mount(compiled: string, props: Record<string, unknown>): void {
  const mountEl = document.getElementById("root");
  if (!mountEl) return;
  if (!root) {
    root = createRoot(mountEl, { onUncaughtError: reportRenderError });
    childObserver?.observe(mountEl, { childList: true });
  }
  try {
    if (!currentComponent || currentCompiled !== compiled) {
      if (currentComponent && currentCompiled !== compiled) clearRuntimeWork();
      const factory = new Function(
        "React",
        "sendToChat",
        "setChatDraft",
        "useState",
        "useEffect",
        "useMemo",
        "useCallback",
        "useRef",
        "useReducer",
        compiled
      ) as (
        react: typeof React,
        send: typeof sendToChat,
        draft: typeof setChatDraft,
        useState: typeof React.useState,
        useEffect: typeof React.useEffect,
        useMemo: typeof React.useMemo,
        useCallback: typeof React.useCallback,
        useRef: typeof React.useRef,
        useReducer: typeof React.useReducer
      ) => React.ComponentType<Record<string, unknown>>;
      currentComponent = factory(
        React,
        sendToChat,
        setChatDraft,
        React.useState,
        React.useEffect,
        React.useMemo,
        React.useCallback,
        React.useRef,
        React.useReducer
      );
      currentCompiled = compiled;
    }
    root.render(React.createElement(currentComponent, props));
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
  setTrpgActionDraft?: typeof setTrpgActionDraft;
  setTrpgSelectedStat?: typeof setTrpgSelectedStat;
  React?: typeof React;
};
runtimeWindow.sendToChat = sendToChat;
runtimeWindow.setChatDraft = setChatDraft;
runtimeWindow.setTrpgActionDraft = setTrpgActionDraft;
runtimeWindow.setTrpgSelectedStat = setTrpgSelectedStat;
runtimeWindow.React = React;

window.addEventListener("message", (event) => {
  // This public frame must never become a generic same-origin code executor when
  // opened or embedded outside the HAV host. Only its actual parent on the same
  // URL origin may mount/unmount creator code.
  if (event.source !== parent) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data as HostMessage | undefined;
  if (!data || typeof data !== "object") return;
  if (data.type === "hav-jsx-unmount") {
    root?.unmount();
    clearRuntimeWork();
    childObserver?.disconnect();
    heightObserver?.disconnect();
    heightTarget = null;
    lastReportedHeight = -1;
    root = null;
    currentCompiled = "";
    currentComponent = null;
    return;
  }
  if (data.type !== "hav-jsx-mount") return;
  parentOrigin = typeof data.parentOrigin === "string" ? data.parentOrigin : "";
  mount(data.compiled, data.props || {});
});

post("boot", {});
