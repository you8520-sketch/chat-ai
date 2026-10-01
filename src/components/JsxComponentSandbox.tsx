"use client";

import { useEffect, useId, useRef } from "react";
import {
  decideJsxHostBridgeAction,
  type JsxHostBridgeRateState,
} from "@/lib/jsxComponent/hostBridge";
import { JSX_SANDBOX_HEIGHT_PX } from "@/lib/jsxComponent/limits";

export type JsxHostBridge = {
  setChatDraft: (text: string) => void;
  requestChatSend: (text: string) => void;
};

type Props = {
  compiled: string;
  props: Record<string, unknown>;
  title?: string;
  chatSendEnabled?: boolean;
  bridge?: JsxHostBridge | null;
};

type SandboxMessage = {
  source?: string;
  kind?: string;
  payload?: { text?: string; message?: string };
};

export default function JsxComponentSandbox({
  compiled,
  props,
  title,
  chatSendEnabled = false,
  bridge,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const loadedRef = useRef(false);
  const rateRef = useRef<JsxHostBridgeRateState>({ lastAcceptedAt: 0, burst: 0 });
  const instanceId = useId();

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const onMessage = (event: MessageEvent<SandboxMessage>) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== "hav-jsx-sandbox") return;
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
  }, [bridge, chatSendEnabled]);

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

  return (
    <iframe
      ref={frameRef}
      title={title || `jsx-sandbox-${instanceId}`}
      src="/jsx-sandbox/frame.html"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="w-full rounded-xl border border-white/10 bg-transparent"
      style={{ height: JSX_SANDBOX_HEIGHT_PX, border: "0" }}
    />
  );
}
