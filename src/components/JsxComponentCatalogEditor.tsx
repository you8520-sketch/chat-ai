"use client";

import { useMemo, useState } from "react";
import JsxComponentSandbox from "@/components/JsxComponentSandbox";
import {
  hydrateJsxCatalogEditorState,
  jsxCatalogEditableFingerprint,
  resolveJsxCatalogDraft,
  type JsxComponentRecord,
  type JsxPropDefinition,
  type JsxPropType,
} from "@/lib/jsxComponent";
import { suggestJsxPropNamesFromCompiled } from "@/lib/jsxComponent/compile";
import { buildJsxComponentManifestBlock } from "@/lib/jsxComponent/manifest";
import { CREATOR_JSX_EXAMPLE_NAME, CREATOR_JSX_EXAMPLE_PROPS, CREATOR_JSX_EXAMPLE_SOURCE } from "@/lib/jsxComponent/creatorExample";

const PROP_TYPES: JsxPropType[] = ["string", "number", "boolean"];

type Props = {
  value: JsxComponentRecord[];
  onChange: (next: JsxComponentRecord[]) => void;
  disabled?: boolean;
};

function emptyProp(): JsxPropDefinition {
  return { name: "", type: "string", required: false };
}

export default function JsxComponentCatalogEditor({ value, onChange, disabled }: Props) {
  const saved = value[0] ?? null;
  const [name, setName] = useState(saved?.name ?? "");
  const [source, setSource] = useState(saved?.source ?? "");
  const [props, setProps] = useState<JsxPropDefinition[]>(saved?.props ?? []);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<JsxComponentRecord | null>(saved);
  const [suggested, setSuggested] = useState<string[]>(() =>
    saved ? suggestJsxPropNamesFromCompiled(saved.compiled) : []
  );
  const [appliedSavedFingerprint, setAppliedSavedFingerprint] = useState(() =>
    jsxCatalogEditableFingerprint(
      saved ? { name: saved.name, source: saved.source, props: saved.props } : null
    )
  );

  const hydration = hydrateJsxCatalogEditorState({
    appliedSavedFingerprint,
    draft: { name, source, props },
    saved,
  });
  if (hydration.hydrated || hydration.appliedSavedFingerprint !== appliedSavedFingerprint) {
    setAppliedSavedFingerprint(hydration.appliedSavedFingerprint);
    if (hydration.hydrated) {
      setName(hydration.draft.name);
      setSource(hydration.draft.source);
      setProps(hydration.draft.props);
      setPreview(saved);
      setError("");
      setSuggested(saved ? suggestJsxPropNamesFromCompiled(saved.compiled) : []);
    }
  }

  const draft = hydration.hydrated ? hydration.draft : { name, source, props };
  const unsaved = useMemo(() => {
    const savedFingerprint = jsxCatalogEditableFingerprint(
      saved ? { name: saved.name, source: saved.source, props: saved.props } : null
    );
    return savedFingerprint !== jsxCatalogEditableFingerprint(draft);
  }, [draft, saved]);

  const manifest = useMemo(
    () => (preview ? buildJsxComponentManifestBlock([preview]) : ""),
    [preview]
  );
  const pendingSuggestions = suggested.filter((propName) => !draft.props.some((prop) => prop.name === propName));

  function applyDraft(nextName = draft.name, nextSource = draft.source, nextProps = draft.props) {
    const result = resolveJsxCatalogDraft(value, {
      name: nextName,
      source: nextSource,
      props: nextProps,
    });
    if (result.error) {
      setError(result.error);
      setPreview(null);
      setSuggested([]);
      return;
    }
    setError("");
    setPreview(result.preview);
    setSuggested(result.preview ? suggestJsxPropNamesFromCompiled(result.preview.compiled) : []);
    onChange(result.catalog);
  }

  function removeSaved() {
    setName("");
    setSource("");
    setProps([]);
    setError("");
    setPreview(null);
    setSuggested([]);
    onChange([]);
  }

  return (
    <section className="mt-4">
      <p className="mb-3 text-xs text-zinc-400">
        이름과 코드를 먼저 작성합니다. AI에는 Manifest만 전달되고, 소스는 프롬프트에 넣지 않습니다.
      </p>
      {unsaved ? (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          미저장 초안입니다. 컴파일에 성공하기 전에는 저장된 컴포넌트가 바뀌지 않습니다.
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
          {saved ? ` 저장된 컴포넌트는 유지됩니다: ${saved.name}.` : ""}
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-zinc-200"
          onClick={() => {
            setName(CREATOR_JSX_EXAMPLE_NAME);
            setSource(CREATOR_JSX_EXAMPLE_SOURCE);
            setProps(CREATOR_JSX_EXAMPLE_PROPS);
            applyDraft(CREATOR_JSX_EXAMPLE_NAME, CREATOR_JSX_EXAMPLE_SOURCE, CREATOR_JSX_EXAMPLE_PROPS);
          }}
        >
          기본 예제 불러오기
        </button>
        {saved ? (
          <button
            type="button"
            disabled={disabled}
            className="rounded-md border border-rose-500/30 px-2 py-1 text-[11px] text-rose-200"
            onClick={removeSaved}
          >
            저장된 컴포넌트 제거
          </button>
        ) : null}
      </div>
      <label className="mb-2 block text-xs text-zinc-400">
        이름 (PascalCase)
        <input
          value={draft.name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => applyDraft()}
          className="mt-1 w-full rounded-md border border-white/10 bg-[#14141a] px-2 py-1.5 text-sm text-zinc-100"
        />
      </label>
      <label className="mb-2 block text-xs text-zinc-400">
        JSX source
        <textarea
          value={draft.source}
          disabled={disabled}
          rows={12}
          onChange={(e) => setSource(e.target.value)}
          onBlur={() => applyDraft()}
          className="mt-1 w-full rounded-md border border-white/10 bg-[#14141a] px-2 py-1.5 font-mono text-[11px] text-zinc-100"
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        className="mb-3 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100"
        onClick={() => applyDraft()}
      >
        컴파일 / 미리보기
      </button>
      <div className="mb-3">
        <p className="mb-1 text-xs text-zinc-400">Props</p>
        <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
          컴파일된 코드에서 <span className="font-mono">props.name</span> 또는{" "}
          <span className="font-mono">props[&quot;name&quot;]</span>으로 읽은 값만 제안합니다.
          구조분해와 계산된 키는 직접 입력합니다.
        </p>
        {pendingSuggestions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingSuggestions.map((propName) => (
              <button
                key={propName}
                type="button"
                disabled={disabled || draft.props.length >= 50}
                className="rounded-md border border-violet-500/30 px-2 py-1 font-mono text-[11px] text-violet-100"
                onClick={() =>
                  setProps([...draft.props, { name: propName, type: "string", required: false }])
                }
              >
                + {propName}
              </button>
            ))}
          </div>
        ) : null}
        {draft.props.map((prop, index) => (
          <div key={index} className="mb-1 grid grid-cols-6 gap-1">
            <input
              value={prop.name}
              placeholder="name"
              disabled={disabled}
              onChange={(e) => {
                const next = draft.props.slice();
                next[index] = { ...prop, name: e.target.value };
                setProps(next);
              }}
              className="col-span-2 rounded border border-white/10 bg-[#14141a] px-1 py-1 text-[11px] text-zinc-100"
            />
            <select
              value={prop.type}
              disabled={disabled}
              onChange={(e) => {
                const next = draft.props.slice();
                next[index] = { ...prop, type: e.target.value as JsxPropType };
                setProps(next);
              }}
              className="rounded border border-white/10 bg-[#14141a] px-1 py-1 text-[11px] text-zinc-100"
            >
              {PROP_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              <input
                type="checkbox"
                checked={prop.required}
                disabled={disabled}
                onChange={(e) => {
                  const next = draft.props.slice();
                  next[index] = { ...prop, required: e.target.checked };
                  setProps(next);
                }}
              />
              required
            </label>
            <input
              value={prop.example ?? ""}
              placeholder="example"
              disabled={disabled}
              onChange={(e) => {
                const next = draft.props.slice();
                next[index] = { ...prop, example: e.target.value };
                setProps(next);
              }}
              className="rounded border border-white/10 bg-[#14141a] px-1 py-1 text-[11px] text-zinc-100"
            />
            <input
              value={prop.description ?? ""}
              placeholder="description → AI"
              disabled={disabled}
              onChange={(e) => {
                const next = draft.props.slice();
                next[index] = { ...prop, description: e.target.value };
                setProps(next);
              }}
              className="rounded border border-white/10 bg-[#14141a] px-1 py-1 text-[11px] text-zinc-100"
            />
          </div>
        ))}
        <button
          type="button"
          disabled={disabled || draft.props.length >= 50}
          className="mt-1 text-[11px] text-violet-200"
          onClick={() => setProps([...draft.props, emptyProp()])}
        >
          Prop 직접 추가
        </button>
      </div>
      {preview?.chatSend ? (
        <p className="mb-2 text-xs text-amber-200">이 컴포넌트는 채팅 전송 기능을 사용합니다.</p>
      ) : null}
      {preview ? (
        <div className="mb-3">
          <p className="mb-1 text-xs text-zinc-400">Preview · 채팅과 동일 sandbox owner · 전송 꺼짐</p>
          <JsxComponentSandbox
            compiled={preview.compiled}
            props={Object.fromEntries(
              preview.props.map((prop) => [
                prop.name,
                prop.type === "number"
                  ? Number(prop.example ?? 0)
                  : prop.type === "boolean"
                    ? prop.example === "true"
                    : prop.example ?? "",
              ])
            )}
            title={preview.name}
            chatSendEnabled={false}
          />
        </div>
      ) : null}
      <details className="text-xs text-zinc-400">
        <summary className="cursor-pointer">AI에게 전달되는 Component Manifest</summary>
        <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-white/10 bg-[#08080c] p-2 text-[11px] text-zinc-300 whitespace-pre-wrap">
          {manifest || "(저장 후 카탈로그가 있을 때만 주입)"}
        </pre>
      </details>
    </section>
  );
}
