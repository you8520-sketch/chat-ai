"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  clampJsxSandboxHeight,
  decideJsxHostBridgeAction,
  type JsxHostBridgeRateState,
  type JsxTrpgActionDraftRequest,
} from "@/lib/jsxComponent/hostBridge";
import { JSX_SANDBOX_BOOT_TIMEOUT_MS, JSX_SANDBOX_HEIGHT_PX } from "@/lib/jsxComponent/limits";

export type JsxHostBridge = {
  setChatDraft: (text: string) => void;
  requestChatSend: (text: string) => void;
};

export type JsxSandboxStatus = "ready" | "error";

type Props = {
  compiled: string;
  props: Record<string, unknown>;
  title?: string;
  chatSendEnabled?: boolean;
  bridge?: JsxHostBridge | null;
  heightPx?: number;
  /** Grow/shrink to the child-reported content height (host-clamped). */
  autoHeight?: boolean;
  /** ready after mount; error on compile/runtime throw or boot timeout. */
  onStatus?: (status: JsxSandboxStatus) => void;
  /** Draft-only TRPG action intent. Absent → setTrpgActionDraft is ignored. */
  onTrpgActionDraft?: ((request: JsxTrpgActionDraftRequest) => void) | null;
};

type SandboxMessage = {
  source?: string;
  kind?: string;
  payload?: { text?: string; message?: string; actionType?: string; px?: number };
};

export default function JsxComponentSandbox({
  compiled,
  props,
  title,
  chatSendEnabled = false,
  bridge,
  heightPx = JSX_SANDBOX_HEIGHT_PX,
  autoHeight = false,
  onStatus,
  onTrpgActionDraft,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const loadedRef = useRef(false);
  const rateRef = useRef<JsxHostBridgeRateState>({ lastAcceptedAt: 0, burst: 0 });
  const statusRef = useRef(onStatus);
  const trpgDraftRef = useRef(onTrpgActionDraft);
  const readyRef = useRef(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const instanceId = useId();

  useEffect(() => {
    statusRef.current = onStatus;
    trpgDraftRef.current = onTrpgActionDraft;
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const onMessage = (event: MessageEvent<SandboxMessage>) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "hav-jsx-sandbox") return;
      if (data.kind === "ready") {
        readyRef.current = true;
        statusRef.current?.("ready");
        return;
      }
      if (data.kind === "error") {
        statusRef.current?.("error");
        return;
      }
      if (data.kind === "height") {
        if (!autoHeight) return;
        const next = clampJsxSandboxHeight(data.payload?.px);
        if (next !== null) setContentHeight(next);
        return;
      }
      if (data.kind === "setTrpgActionDraft") {
        const handler = trpgDraftRef.current;
        if (!handler) return;
        const { decision, rate } = decideJsxHostBridgeAction({
          kind: data.kind,
          text: data.payload?.text,
          actionType: data.payload?.actionType,
          chatSendEnabled: false,
          now: Date.now(),
          rate: rateRef.current,
        });
        rateRef.current = rate;
        if (decision.action === "setTrpgActionDraft") {
          handler({ actionType: decision.actionType, text: decision.text });
        }
        return;
      }
      if (data.kind !== "setChatDraft" && data.kind !== "sendToChat") return;
      const { decision, rate } = decideJsxHostBridgeAction({
        kind: data.kind,
        text: data.payload?.text,
        chatSendEnabled,
        now: Date.now(),
        rate: rateRef.current,
      });
      rateRef.current = rate;
      if (!bridge) return;
      if (decision.action === "setChatDraft") {
        bridge.setChatDraft(decision.text);
        return;
      }
      if (decision.action === "requestChatSend") {
        bridge.requestChatSend(decision.text);
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [autoHeight, bridge, chatSendEnabled]);

  const watchBoot = Boolean(onStatus);
  useEffect(() => {
    if (!watchBoot) return;
    readyRef.current = false;
    const timer = window.setTimeout(() => {
      if (!readyRef.current) statusRef.current?.("error");
    }, JSX_SANDBOX_BOOT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [compiled, watchBoot]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const sendMount = () => {
      frame.contentWindow?.postMessage(
        {
          type: "hav-jsx-mount",
          compiled,
          props,
          parentOrigin: window.location.origin,
        },
        "*"
      );
    };
    const onLoad = () => {
      loadedRef.current = true;
      sendMount();
    };

    frame.addEventListener("load", onLoad);
    if (loadedRef.current) sendMount();

    return () => {
      frame.removeEventListener("load", onLoad);
    };
  }, [compiled, props]);

  useEffect(() => {
    const frame = frameRef.current;
    return () => {
      loadedRef.current = false;
      frame?.contentWindow?.postMessage({ type: "hav-jsx-unmount" }, "*");
    };
  }, []);

  const height = autoHeight && contentHeight !== null ? contentHeight : heightPx;

  return (
    <iframe
      ref={frameRef}
      title={title || `jsx-sandbox-${instanceId}`}
      src="/jsx-sandbox/frame.html"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="w-full rounded-xl border border-white/10 bg-transparent"
      style={{ height, border: "0" }}
    />
  );
}
