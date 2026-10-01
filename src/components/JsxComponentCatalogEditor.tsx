"use client";

import { useMemo, useState } from "react";
import JsxComponentSandbox from "@/components/JsxComponentSandbox";
import {
  compileJsxComponentDraft,
  type JsxComponentRecord,
  type JsxPropDefinition,
  type JsxPropType,
} from "@/lib/jsxComponent";
import { buildJsxComponentManifestBlock } from "@/lib/jsxComponent/manifest";
import { PIT_WALL_FIXTURE_NAME, PIT_WALL_FIXTURE_PROPS, PIT_WALL_FIXTURE_SOURCE } from "@/lib/jsxComponent/pitWallFixture";

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
  const selected = value[0] ?? null;
  const [name, setName] = useState(selected?.name ?? "");
  const [source, setSource] = useState(selected?.source ?? "");
  const [props, setProps] = useState<JsxPropDefinition[]>(selected?.props ?? []);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<JsxComponentRecord | null>(selected);

  const manifest = useMemo(
    () => (preview ? buildJsxComponentManifestBlock([preview]) : ""),
    [preview]
  );

  function applyDraft(nextName = name, nextSource = source, nextProps = props) {
    const result = compileJsxComponentDraft({
      name: nextName,
      source: nextSource,
      props: nextProps,
    });
    if (!result.ok) {
      setError(result.error);
      setPreview(null);
      onChange([]);
      return;
    }
    setError("");
    setPreview(result.record);
    onChange([result.record]);
  }

  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-[#0c0c10] p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-zinc-100">채팅 중 호출 컴포넌트 · 고급</h2>
        <p className="mt-0.5 text-xs text-zinc-400">
          상태창과 별개로 AI가 대화 중 필요할 때 &lt;Component /&gt; 형태로 호출하는 인터랙티브 UI입니다.
          AI에는 아래 Manifest만 전달됩니다. 소스·스타일은 프롬프트에 넣지 않습니다.
        </p>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-zinc-200"
          onClick={() => {
            setName(PIT_WALL_FIXTURE_NAME);
            setSource(PIT_WALL_FIXTURE_SOURCE.trim());
            setProps(PIT_WALL_FIXTURE_PROPS);
            applyDraft(PIT_WALL_FIXTURE_NAME, PIT_WALL_FIXTURE_SOURCE, PIT_WALL_FIXTURE_PROPS);
          }}
        >
          PitWall fixture 불러오기
        </button>
      </div>
      <label className="mb-2 block text-xs text-zinc-400">
        이름 (PascalCase)
        <input
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => applyDraft()}
          className="mt-1 w-full rounded-md border border-white/10 bg-[#14141a] px-2 py-1.5 text-sm text-zinc-100"
        />
      </label>
      <div className="mb-3">
        <p className="mb-1 text-xs text-zinc-400">Props (최대 50 · camelCase)</p>
        {props.map((prop, index) => (
          <div key={index} className="mb-1 grid grid-cols-6 gap-1">
            <input
              value={prop.name}
              placeholder="name"
              disabled={disabled}
              onChange={(e) => {
                const next = props.slice();
                next[index] = { ...prop, name: e.target.value };
                setProps(next);
              }}
              className="col-span-2 rounded border border-white/10 bg-[#14141a] px-1 py-1 text-[11px] text-zinc-100"
            />
            <select
              value={prop.type}
              disabled={disabled}
              onChange={(e) => {
                const next = props.slice();
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
                  const next = props.slice();
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
                const next = props.slice();
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
                const next = props.slice();
                next[index] = { ...prop, description: e.target.value };
                setProps(next);
              }}
              className="rounded border border-white/10 bg-[#14141a] px-1 py-1 text-[11px] text-zinc-100"
            />
          </div>
        ))}
        <button
          type="button"
          disabled={disabled || props.length >= 50}
          className="mt-1 text-[11px] text-violet-200"
          onClick={() => setProps([...props, emptyProp()])}
        >
          Prop 추가
        </button>
      </div>
      <label className="mb-2 block text-xs text-zinc-400">
        JSX source
        <textarea
          value={source}
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
      {error ? <p className="mb-2 text-xs text-rose-300">{error}</p> : null}
      {preview?.chatSend ? (
        <p className="mb-2 text-xs text-amber-200">이 컴포넌트는 채팅 전송 기능을 사용합니다.</p>
      ) : null}
      {preview ? (
        <div className="mb-3">
          <p className="mb-1 text-xs text-zinc-400">Preview · 채팅과 동일 sandbox owner</p>
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
      <label className="block text-xs text-zinc-400">
        AI에게 실제 전달되는 Component Manifest
        <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-white/10 bg-[#08080c] p-2 text-[11px] text-zinc-300 whitespace-pre-wrap">
          {manifest || "(저장 후 카탈로그가 있을 때만 주입)"}
        </pre>
      </label>
    </section>
  );
}
