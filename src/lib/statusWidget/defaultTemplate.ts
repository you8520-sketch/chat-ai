import {
  BUILTIN_STATUS_WIDGET_TEMPLATES,
  cloneStatusWidgetTemplate,
} from "./builtinTemplates";

/** 제작 페이지 기본 템플릿 — 상태창 위젯은 기본 ON, 서양 판타지풍으로 시작 */
export const DEFAULT_STATUS_WIDGET = cloneStatusWidgetTemplate(
  BUILTIN_STATUS_WIDGET_TEMPLATES.western_fantasy,
);
