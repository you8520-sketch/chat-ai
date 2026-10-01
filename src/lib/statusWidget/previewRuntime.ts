/** Gallery, apply, and editor previews never auto-send chat. */
export const STATUS_WIDGET_PREVIEW_CHAT_SEND_ENABLED = false as const;

export function statusWidgetPreviewSandboxProps(
  compiled: string,
  props: Record<string, unknown>
): {
  compiled: string;
  props: Record<string, unknown>;
  title: string;
  chatSendEnabled: false;
  bridge: null;
} {
  return {
    compiled,
    props,
    title: "status-widget-preview",
    chatSendEnabled: STATUS_WIDGET_PREVIEW_CHAT_SEND_ENABLED,
    bridge: null,
  };
}
