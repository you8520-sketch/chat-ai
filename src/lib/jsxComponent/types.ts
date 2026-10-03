export const JSX_COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]{0,47}$/;

export type JsxPropType = "string" | "number" | "boolean";

export type JsxPropDefinition = {
  name: string;
  type: JsxPropType;
  required: boolean;
  example?: string;
  description?: string;
};

export type JsxCapability =
  | "local_state"
  | "animation"
  | "canvas"
  | "chat_send"
  | "external_network"
  | "storage"
  | "navigation";

export type JsxComponentRecord = {
  name: string;
  source: string;
  compiled: string;
  props: JsxPropDefinition[];
  capabilities: JsxCapability[];
  chatSend: boolean;
  /** Optional creator note for when the model should call this component. */
  callGuide?: string;
};

export type JsxComponentManifestRecord = {
  name: string;
  props: JsxPropDefinition[];
  chatSend: boolean;
  /** Component-level call guide. Distinct from each prop's description. */
  callGuide?: string;
};

export type JsxRuntimeComponentRecord = Omit<JsxComponentRecord, "source">;

export type JsxInvocation = {
  name: string;
  props: Record<string, string | number | boolean>;
  raw: string;
};

export type JsxCompileResult =
  | { ok: true; compiled: string; capabilities: JsxCapability[]; chatSend: boolean }
  | { ok: false; error: string };
