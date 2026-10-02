import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  BUILTIN_STATUS_WIDGET_TEMPLATES,
  buildBuiltinStatusWidgetTemplate,
  type BuiltinStatusWidgetTemplateId,
} from "./builtinTemplates";
import { defaultStatusWidgetJsxSource } from "./jsxAuthoring";
import type { StatusWidget } from "./types";

export type StatusWidgetAuthoringChoice = BuiltinStatusWidgetTemplateId | "html" | "jsx";

export const STATUS_WIDGET_SHARED_DESIGN_HREF = "/widgets";
export const STATUS_WIDGET_SHARED_DESIGN_LABEL = "공유 디자인 가져오기";

export const BASIC_STATUS_WIDGET_CHOICES: Array<{
  id: BuiltinStatusWidgetTemplateId;
  label: string;
  desc: string;
}> = [
  { id: "clean", label: "클린 카드", desc: "여백 있는 중립 카드" },
  { id: "compact", label: "컴팩트 패널", desc: "촘촘한 정보 패널" },
];

export const ADVANCED_STATUS_WIDGET_CHOICES: Array<{
  id: "html" | "jsx";
  label: string;
  desc: string;
}> = [
  { id: "html", label: "HTML 직접제작", desc: "HTML로 표현만 바꿉니다" },
  { id: "jsx", label: "JSX 직접제작", desc: "상태값이 props로 전달됩니다" },
];

function stripFieldInitialValues(widget: StatusWidget): StatusWidget {
  return {
    ...widget,
    fields: widget.fields.map(({ initialValue: _omit, ...field }) => field),
  };
}

function withoutJsx(widget: StatusWidget): StatusWidget {
  return {
    version: widget.version,
    name: widget.name,
    htmlTemplate: widget.htmlTemplate,
    fields: widget.fields.map((field) => ({ ...field })),
    placement: widget.placement,
  };
}

export function isAdvancedStatusWidgetChoice(choice: StatusWidgetAuthoringChoice): boolean {
  switch (choice) {
    case "html":
    case "jsx":
      return true;
    case "clean":
    case "compact":
      return false;
    default: {
      const _never: never = choice;
      return _never;
    }
  }
}

export function detectStatusWidgetAuthoringChoice(widget: StatusWidget): StatusWidgetAuthoringChoice {
  if (widget.jsxSource?.trim()) return "jsx";
  const ids: BuiltinStatusWidgetTemplateId[] = ["clean", "compact"];
  for (const id of ids) {
    const built = buildBuiltinStatusWidgetTemplate(id, widget.fields);
    if (built.htmlTemplate === widget.htmlTemplate) return id;
  }
  if (
    widget.htmlTemplate === BUILTIN_STATUS_WIDGET_TEMPLATES.clean.htmlTemplate ||
    widget.htmlTemplate === BUILTIN_STATUS_WIDGET_TEMPLATES.compact.htmlTemplate
  ) {
    return widget.htmlTemplate === BUILTIN_STATUS_WIDGET_TEMPLATES.compact.htmlTemplate
      ? "compact"
      : "clean";
  }
  return "html";
}

/** Switch presentation only. Fields stay the extraction owner. */
export function applyStatusWidgetAuthoringChoice(
  widget: StatusWidget,
  choice: StatusWidgetAuthoringChoice
): StatusWidget {
  const fields = widget.fields.map((field) => ({ ...field }));
  switch (choice) {
    case "html": {
      const htmlTemplate = widget.htmlTemplate.trim()
        ? widget.htmlTemplate
        : buildBuiltinStatusWidgetTemplate("clean", fields).htmlTemplate;
      return stripFieldInitialValues(
        withoutJsx({
          ...widget,
          htmlTemplate,
          fields,
        })
      );
    }
    case "jsx": {
      const jsxSource = widget.jsxSource?.trim()
        ? widget.jsxSource
        : defaultStatusWidgetJsxSource(fields);
      return stripFieldInitialValues({
        ...widget,
        fields,
        jsxSource,
      });
    }
    case "clean":
    case "compact": {
      const picked = buildBuiltinStatusWidgetTemplate(choice, fields);
      return stripFieldInitialValues({
        ...picked,
        placement: widget.placement,
      });
    }
    default: {
      const _never: never = choice;
      return _never;
    }
  }
}

export function resetStatusWidgetAuthoring(): StatusWidget {
  return stripFieldInitialValues({
    ...DEFAULT_STATUS_WIDGET,
    fields: DEFAULT_STATUS_WIDGET.fields.map((field) => ({ ...field })),
  });
}
