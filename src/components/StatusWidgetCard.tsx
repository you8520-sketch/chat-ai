"use client";

import JsxComponentSandbox from "@/components/JsxComponentSandbox";
import { useJsxHostBridge } from "@/components/JsxHostBridge";
import type { StatusWidgetValues } from "@/lib/statusWidget/types";

type Props = {
  html: string;
  jsxCompiled?: string;
  values?: StatusWidgetValues;
};

export default function StatusWidgetCard({ html, jsxCompiled, values }: Props) {
  const bridge = useJsxHostBridge();
  if (jsxCompiled?.trim()) {
    return (
      <div className="status-widget-card my-4 w-full min-w-0 max-w-full overflow-hidden">
        <JsxComponentSandbox
          compiled={jsxCompiled}
          props={values ?? {}}
          title="status-widget-jsx"
          chatSendEnabled
          bridge={bridge}
        />
      </div>
    );
  }
  if (!html.trim()) return null;
  return (
    <div className="status-widget-card my-4 w-full min-w-0 max-w-full overflow-hidden">
      <div
        className="status-widget-card__inner w-full min-w-0 max-w-full overflow-hidden"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
