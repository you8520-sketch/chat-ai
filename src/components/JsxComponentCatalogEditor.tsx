"use client";

import { useMemo, useState } from "react";
import JsxComponentSandbox from "@/components/JsxComponentSandbox";
import {
  hydrateJsxCatalogEditorState,
  jsxCatalogEditableFingerprint,
  removeJsxCatalogHead,
  resolveJsxCatalogDraft,
  type JsxComponentRecord,
  type JsxPropDefinition,
  type JsxPropType,
} from "@/lib/jsxComponent";
import { compileJsxComponentSource, suggestJsxPropNamesFromCompiled } from "@/lib/jsxComponent/compile";
import {
  CREATOR_JSX_EXAMPLES,
  creatorJsxExampleById,
  jsxPropPreviewValues,
  primaryJsxPropNames,
  type CreatorJsxExample,
  type CreatorJsxExampleId,
} from "@/lib/jsxComponent/creatorExample";
import { buildJsxComponentManifestBlock } from "@/lib/jsxComponent/manifest";

const PROP_TYPES: JsxPropType[] = ["string", "number", "boolean"];
const PREVIEW_HEIGHT_PX = 260;

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
  const [browsingId, setBrowsingId] = useState<CreatorJsxExampleId | null>(null);
  const [browseOverrides, setBrowseOverrides] = useState<Record<string, string>>({});
  const [previewOwner, setPreviewOwner] = useState<"example" | "saved">(saved ? "saved" : "example");
  const [pendingApply, setPendingApply] = useState(false);
  const [extraValuesOpen, setExtraValuesOpen] = useState(false);

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
      setPreviewOwner(saved ? "saved" : "example");
    }
  }

  const draft = hydration.hydrated ? hydration.draft : { name, source, props };
  const unsaved = useMemo(() => {
    const savedFingerprint = jsxCatalogEditableFingerprint(
      saved ? { name: saved.name, source: saved.source, props: saved.props } : null
    );
    return savedFingerprint !== jsxCatalogEditableFingerprint(draft);
  }, [draft, saved]);

  const browsed = browsingId ? creatorJsxExampleById(browsingId) : null;
  const browsedCompile = useMemo(() => {
    if (!browsingId) return null;
    const example = creatorJsxExampleById(browsingId);
    return compileJsxComponentSource(example.source, example.name);
  }, [browsingId]);

  const manifest = useMemo(
    () => (preview ? buildJsxComponentManifestBlock([preview]) : ""),
    [preview]
  );
  const pendingSuggestions = suggested.filter(
    (propName) => !draft.props.some((prop) => prop.name === propName)
  );
  const showingExample = previewOwner === "example" && browsed != null;
  const replacementLabel = saved
    ? unsaved
      ? `저장된 컴포넌트 ${saved.name}와 작성 중인 초안`
      : `저장된 컴포넌트 ${saved.name}`
    : unsaved
      ? "작성 중인 초안"
      : null;

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
      return false;
    }
    setError("");
    setPreview(result.preview);
    setSuggested(result.preview ? suggestJsxPropNamesFromCompiled(result.preview.compiled) : []);
    // An explicit successful editor compile returns the preview to the user's
    // component, even when an unrelated gallery example was being browsed.
    setPreviewOwner("saved");
    setBrowsingId(null);
    onChange(result.catalog);
    return true;
  }

  function removeSaved() {
    const nextCatalog = removeJsxCatalogHead(value);
    const next = nextCatalog[0] ?? null;
    setName(next?.name ?? "");
    setSource(next?.source ?? "");
    setProps(next?.props.map((prop) => ({ ...prop })) ?? []);
    setAppliedSavedFingerprint(
      jsxCatalogEditableFingerprint(
        next ? { name: next.name, source: next.source, props: next.props } : null
      )
    );
    setError("");
    setPreview(next);
    setSuggested(next ? suggestJsxPropNamesFromCompiled(next.compiled) : []);
    setPreviewOwner(next ? "saved" : "example");
    onChange(nextCatalog);
  }

  function selectExample(id: CreatorJsxExampleId) {
    setBrowsingId(id);
    setBrowseOverrides({});
    setPreviewOwner("example");
    setPendingApply(false);
    setExtraValuesOpen(false);
  }

  function commitApplyExample(example: CreatorJsxExample) {
    const nextProps = example.props.map((prop) => ({
      ...prop,
      example: browseOverrides[prop.name] ?? prop.example,
    }));
    setName(example.name);
    setSource(example.source);
    setProps(nextProps);
    setPendingApply(false);
    applyDraft(example.name, example.source, nextProps);
  }

  function requestApplyExample(example: CreatorJsxExample) {
    if (replacementLabel) {
      setPendingApply(true);
      return;
    }
    commitApplyExample(example);
  }

  const valueProps = showingExample && browsed ? browsed.props : draft.props;
  const primaryNames =
    showingExample && browsed
      ? browsed.primaryPropNames
      : primaryJsxPropNames(valueProps);
  const primaryProps = valueProps.filter((prop) => primaryNames.includes(prop.name));
  const extraProps = valueProps.filter((prop) => prop.name && !primaryNames.includes(prop.name));

  function exampleValue(prop: JsxPropDefinition): string {
    if (showingExample) return browseOverrides[prop.name] ?? prop.example ?? "";
    return prop.example ?? "";
  }

  function setExampleValue(prop: JsxPropDefinition, nextValue: string) {
    if (showingExample) {
      setBrowseOverrides((current) => ({ ...current, [prop.name]: nextValue }));
      return;
    }
    setProps(draft.props.map((item) => (item.name === prop.name ? { ...item, example: nextValue } : item)));
  }

  const sandboxCompiled =
    showingExample && browsedCompile?.ok
      ? browsedCompile.compiled
      : preview?.compiled ?? "";
  const sandboxProps =
    showingExample && browsed
      ? jsxPropPreviewValues(browsed.props, browseOverrides)
      : preview
        ? jsxPropPreviewValues(draft.props)
        : null;
  const sandboxTitle = showingExample && browsed ? browsed.name : preview?.name;

  return (
    <section className="mt-4 space-y-4">
      <div className="space-y-2 text-xs leading-relaxed text-zinc-400">
        <p className="text-sm font-semibold text-zinc-100">대화 중 눌러 보는 화면</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>만들고 싶은 화면을 선택합니다.</li>
          <li>미리보기에서 버튼을 누르거나 값을 바꿔 봅니다.</li>
          <li>예제를 적용한 뒤 원하는 디자인과 기능으로 수정합니다.</li>
          <li>저장하면 AI가 대화 상황에 맞춰 등록된 컴포넌트를 호출할 수 있습니다.</li>
        </ol>
        <p>실제 호출은 모델 출력에 따라 달라지며, 매 답변마다 열리지는 않습니다.</p>
      </div>

      {unsaved ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          미저장 초안입니다. 컴파일에 성공하기 전에는 저장된 컴포넌트가 바뀌지 않습니다.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
          {saved ? ` 저장된 컴포넌트는 유지됩니다: ${saved.name}.` : ""}
        </p>
      ) : null}

      <div role="list" aria-label="예제 갤러리" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CREATOR_JSX_EXAMPLES.map((example) => {
          const selected = browsingId === example.id && showingExample;
          return (
            <button
              key={example.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => selectExample(example.id)}
              className={`min-h-11 rounded-xl border px-3 py-2 text-left ${
                selected
                  ? "border-violet-400 bg-violet-600/20 text-violet-50"
                  : "border-white/10 bg-[#14141a] text-zinc-200 hover:border-white/20"
              }`}
            >
              <span className="block text-sm font-semibold">{example.label}</span>
              <span className="mt-0.5 block text-[11px] text-zinc-400">{example.summary}</span>
            </button>
          );
        })}
      </div>

      {sandboxProps && sandboxCompiled && sandboxTitle ? (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">
            {showingExample ? "예제 미리보기" : "내 컴포넌트 미리보기"} · 채팅 전송은 꺼져 있습니다.
            값을 바꾸면 이 미리보기에 바로 반영됩니다.
          </p>
          <div className="max-h-72 min-w-0 overflow-auto rounded-xl border border-white/10 bg-[#0a0a0c] p-2">
            <JsxComponentSandbox
              compiled={sandboxCompiled}
              props={sandboxProps}
              title={sandboxTitle}
              chatSendEnabled={false}
              heightPx={PREVIEW_HEIGHT_PX}
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">예제를 고르면 미리보기가 열립니다. 채팅 전송은 꺼져 있습니다.</p>
      )}

      {valueProps.length > 0 && (showingExample || preview) ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-200">예시 값</p>
          {primaryProps.map((prop) => (
            <ExampleValueField
              key={prop.name}
              prop={prop}
              value={exampleValue(prop)}
              disabled={disabled}
              onChange={(nextValue) => setExampleValue(prop, nextValue)}
            />
          ))}
          {extraProps.length > 0 ? (
            <div>
              <button
                type="button"
                aria-expanded={extraValuesOpen}
                onClick={() => setExtraValuesOpen((open) => !open)}
                className="min-h-11 text-xs text-violet-200"
              >
                {extraValuesOpen ? "나머지 값 접기" : "나머지 값 보기"}
              </button>
              {extraValuesOpen
                ? extraProps.map((prop) => (
                    <ExampleValueField
                      key={prop.name}
                      prop={prop}
                      value={exampleValue(prop)}
                      disabled={disabled}
                      onChange={(nextValue) => setExampleValue(prop, nextValue)}
                    />
                  ))
                : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {browsed && showingExample ? (
        <div className="space-y-2">
          {replacementLabel ? (
            <p className="text-xs text-amber-100">
              적용 시 교체 대상: {replacementLabel}. 예제를 둘러보는 동안에는 저장 내용이 바뀌지
              않습니다.
            </p>
          ) : (
            <p className="text-xs text-zinc-500">적용하기 전에는 저장 내용이 바뀌지 않습니다.</p>
          )}
          {pendingApply && replacementLabel ? (
            <div
              role="alertdialog"
              aria-label="예제 적용 확인"
              className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3"
            >
              <p className="text-xs text-amber-50">
                교체 대상: {replacementLabel}. 예제: {browsed.label}.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => commitApplyExample(browsed)}
                  className="min-h-11 rounded-xl bg-amber-500 px-3 text-xs font-semibold text-black"
                >
                  바꾸기
                </button>
                <button
                  type="button"
                  onClick={() => setPendingApply(false)}
                  className="min-h-11 rounded-xl border border-white/15 px-3 text-xs text-zinc-200"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => requestApplyExample(browsed)}
              className="min-h-11 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white"
            >
              이 예제 적용
            </button>
          )}
        </div>
      ) : null}

      <details className="rounded-xl border border-white/10 bg-[#14141a] p-3 text-xs text-zinc-300">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-100">
          고급 JSX 코드 및 Props
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-zinc-400">
            코드를 수정한 뒤 '컴파일 / 미리보기'를 눌러 반영합니다. 예제를 둘러보거나
            입력칸을 벗어날 때는 저장된 컴포넌트를 바꾸지 않습니다.
            AI에는 Manifest만 전달되고, 소스는 프롬프트에 넣지 않습니다.
          </p>
          <div className="flex flex-wrap gap-2">
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
          <label className="block text-zinc-400">
            이름 (PascalCase)
            <input
              value={draft.name}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-[#0c0c12] px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <label className="block text-zinc-400">
            JSX source
            <textarea
              value={draft.source}
              disabled={disabled}
              rows={12}
              onChange={(e) => setSource(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-[#0c0c12] px-2 py-1.5 font-mono text-[11px] text-zinc-100"
            />
          </label>
          <button
            type="button"
            disabled={disabled}
            className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100"
            onClick={() => applyDraft()}
          >
            컴파일 / 미리보기
          </button>
          <div>
            <p className="mb-1 text-zinc-400">Props</p>
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
              <div key={`${prop.name}-${index}`} className="mb-1 grid grid-cols-6 gap-1">
                <input
                  value={prop.name}
                  placeholder="name"
                  disabled={disabled}
                  onChange={(e) => {
                    const next = draft.props.slice();
                    next[index] = { ...prop, name: e.target.value };
                    setProps(next);
                  }}
                  className="col-span-2 rounded border border-white/10 bg-[#0c0c12] px-1 py-1 text-[11px] text-zinc-100"
                />
                <select
                  value={prop.type}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = draft.props.slice();
                    next[index] = { ...prop, type: e.target.value as JsxPropType };
                    setProps(next);
                  }}
                  className="rounded border border-white/10 bg-[#0c0c12] px-1 py-1 text-[11px] text-zinc-100"
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
                  className="rounded border border-white/10 bg-[#0c0c12] px-1 py-1 text-[11px] text-zinc-100"
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
                  className="rounded border border-white/10 bg-[#0c0c12] px-1 py-1 text-[11px] text-zinc-100"
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
            <p className="text-xs text-amber-200">이 컴포넌트는 채팅 전송 기능을 사용합니다.</p>
          ) : null}
          <details className="text-zinc-400">
            <summary className="cursor-pointer">AI에게 전달되는 Component Manifest</summary>
            <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-white/10 bg-[#08080c] p-2 text-[11px] text-zinc-300 whitespace-pre-wrap">
              {manifest || "(저장 후 카탈로그가 있을 때만 주입)"}
            </pre>
          </details>
        </div>
      </details>
    </section>
  );
}

function ExampleValueField({
  prop,
  value,
  disabled,
  onChange,
}: {
  prop: JsxPropDefinition;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs text-zinc-400">
      {prop.description || prop.name}
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#14141a] px-3 text-sm text-zinc-100"
      />
    </label>
  );
}
