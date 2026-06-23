export const STATUS_WIDGET_PRESET_TITLE_MAX = 40;

export type StatusWidgetPresetItem = {
  id: number;
  user_id: number;
  title: string;
  widget_json: string;
  created_at: string;
};

export function sanitizeStatusWidgetPresetTitle(raw: string): string {
  return raw.trim().slice(0, STATUS_WIDGET_PRESET_TITLE_MAX);
}
