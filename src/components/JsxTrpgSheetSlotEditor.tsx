"use client";

import { useMemo, useState } from "react";
import JsxComponentSandbox from "@/components/JsxComponentSandbox";
import {
  hydrateJsxCatalogEditorState,
  jsxCatalogEditableFingerprint,
  jsxCatalogSlotIndex,
  removeJsxCatalogHead,
  resolveJsxCatalogDraft,
  type JsxComponentRecord,
} from "@/lib/jsxComponent";
import { TRPG_SHEET_JSX_COMPONENT, TRPG_SHEET_JSX_SOURCE } from "@/lib/trpg/sheetJsxSource";
import { sampleTrpgSheetSurface, TRPG_SHEET_SURFACE_FIELD_GUIDE } from "@/lib/trpg/sheetSurface";

type Props = {
  value: JsxComponentRecord[];
  onChange: (next: JsxComponentRecord[]) => void;
  disabled?: boolean;
};

function slotFingerprint(record: JsxComponentRecord | null): string {
  return jsxCatalogEditableFingerprint(record ? { name: record.name, source: record.source, props: [] } : null);
}

/**
 * Edits the character's single `trpg_sheet` component. The sheet always receives
 * TrpgSheetSurface props, so there is no AI prop schema or call guide here.
 */
export default function JsxTrpgSheetSlotEditor({ value, onChange, disabled }: Props) {
  const slot = jsxCatalogSlotIndex(value, "trpg_sheet");
  const saved = slot >= 0 ? value[slot] ?? null : null;
  const [name, setName] = useState(saved?.name ?? "");
  const [source, setSource] = useState(saved?.source ?? "");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<JsxComponentRecord | null>(saved);
  const [appliedSavedFingerprint, setAppliedSavedFingerprint] = useState(() => slotFingerprint(saved));
  const sample = useMemo(() => sampleTrpgSheetSurface() as unknown as Record<string, unknown>, []);

  const hydration = hydrateJsxCatalogEditorState({
    appliedSavedFingerprint,
    draft: { name, source, props: [] },
    saved: saved ? { ...saved, props: [], callGuide: undefined } : null,
  });
  if (hydration.hydrated || hydration.appliedSavedFingerprint !== appliedSavedFingerprint) {
    setAppliedSavedFingerprint(hydration.appliedSavedFingerprint);
    if (hydration.hydrated) {
      setName(hydration.draft.name);
      setSource(hydration.draft.source);
      setPreview(saved);
      setError("");
    }
  }
  const unsaved = slotFingerprint(saved) !== jsxCatalogEditableFingerprint({ name, source, props: [] });

  function compile() {
    const result = resolveJsxCatalogDraft(value, { surface: "trpg_sheet", name, source, props: [] });
    if (result.error) {
      setError(result.error);
      setPreview(null);
      return;
    }
    setError("");
    setPreview(result.preview);
    onChange(result.catalog);
  }

  function remove() {
    const nextCatalog = removeJsxCatalogHead(value, "trpg_sheet");
    setName("");
    setSource("");
    setError("");
    setPreview(null);
    setAppliedSavedFingerprint("");
    onChange(nextCatalog);
  }

  return (
    <section className="space-y-4" data-jsx-trpg-sheet-editor>
      <div className="space-y-1 text-xs leading-relaxed text-zinc-400">
        <p className="text-sm font-semibold text-zinc-100">TRPG 캐릭터 시트</p>
        <p>
          이 캐릭터가 TRPG에 AI 파티원으로 참여하면, 파티 시트 탭에서 이 컴포넌트가 자동으로 표시됩니다. AI가 답변에서
          호출하는 컴포넌트가 아니며, AI 프롬프트에도 전달되지 않습니다.
        </p>
        <p>
          시트는 아래의 고정 데이터를 props로 받습니다. 직접 Props를 정의하지 않습니다. 캐릭터마다 하나만 저장할 수
          있습니다.
        </p>
        <p>
          <span className="font-mono">setTrpgActionDraft(actionType, text)</span>는 내 시트에서만 행동 초안을 채우며,
          다른 파티원 시트에서는 아무 동작도 하지 않습니다. <span className="font-mono">sendToChat</span>은 쓸 수
          없습니다.
        </p>
      </div>

      <label className="block text-xs text-zinc-400">
        시트 이름 (PascalCase)
        <input
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#14141a] px-3 text-sm text-zinc-100"
        />
      </label>
      <label className="block text-xs text-zinc-400">
        시트 JSX source
        <textarea
          value={source}
          disabled={disabled}
          rows={12}
          onChange={(e) => setSource(e.target.value)}
          className="mt-1 w-full rounded-md border border-white/10 bg-[#0c0c12] px-2 py-1.5 font-mono text-[11px] text-zinc-100"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={compile}
          className="min-h-11 rounded-xl border border-violet-500/40 bg-violet-500/10 px-3 text-xs text-violet-100"
        >
          시트 컴파일 / 미리보기
        </button>
        {!source.trim() ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setName(TRPG_SHEET_JSX_COMPONENT);
              setSource(TRPG_SHEET_JSX_SOURCE.trim());
            }}
            className="min-h-11 rounded-xl border border-white/15 px-3 text-xs text-zinc-200"
          >
            기본 시트 코드로 시작
          </button>
        ) : null}
        {saved ? (
          <button
            type="button"
            disabled={disabled}
            onClick={remove}
            className="min-h-11 rounded-xl border border-rose-500/30 px-3 text-xs text-rose-200"
          >
            저장된 시트 제거
          </button>
        ) : null}
      </div>
      {unsaved ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          미저장 초안입니다. 컴파일에 성공하기 전에는 저장된 시트가 바뀌지 않습니다.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
          {saved ? ` 저장된 시트는 유지됩니다: ${saved.name}.` : ""}
        </p>
      ) : null}

      <details className="rounded-xl border border-white/10 bg-[#14141a] p-3 text-xs text-zinc-300">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-100">시트가 받는 고정 데이터</summary>
        <ul className="mt-2 space-y-1">
          {TRPG_SHEET_SURFACE_FIELD_GUIDE.map((field) => (
            <li key={field.key}>
              <span className="font-mono text-violet-200">props.{field.key}</span>
              <span className="text-zinc-400"> — {field.note}</span>
            </li>
          ))}
        </ul>
      </details>

      {preview ? (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">시트 미리보기 · 예시 데이터 · 행동 초안과 채팅 전송은 꺼져 있습니다.</p>
          <div className="max-h-96 min-w-0 overflow-auto rounded-xl border border-white/10 bg-[#0a0a0c] p-2">
            <JsxComponentSandbox compiled={preview.compiled} props={sample} title={`${preview.name} 시트 미리보기`} autoHeight />
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">시트를 컴파일하면 예시 데이터로 미리보기가 열립니다.</p>
      )}
    </section>
  );
}
