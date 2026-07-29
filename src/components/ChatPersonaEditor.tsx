"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GENDER_LABELS, type CharacterGender } from "@/lib/characterGender";
import {
  PERSONA_NAME_LIMIT,
  PERSONA_CONTENT_MAX,
  personaContentLength,
  personaCombinedContentLength,
  capPersonaFieldToSharedBudget,
} from "@/lib/persona";
import {
  PERSONA_IMAGE_FOCUS_DEFAULT,
  type OwnerPersonaEditorItem,
  type PublicPersonaListItem,
} from "@/lib/userPersonasClient";
import type { PersonaSecretCompileSummaryDto } from "@/lib/personaSecretCompiler";
import type { PersonaSecretSettingsCapability } from "@/lib/personaSecretCapabilities";
import {
  buildExplicitSecretSavePayload,
  buildPublicPersonaUpdatePayload,
} from "@/lib/personaEditorPayload";
import PersonaAvatar from "@/components/PersonaAvatar";
import PersonaImageEditor from "@/components/PersonaImageEditor";

type Props = {
  persona: PublicPersonaListItem;
  onUpdated: (persona: PublicPersonaListItem) => void;
  /** false — 읽기 전용, true — 편집·자동 저장 */
  editing?: boolean;
  personaSecretSettings?: PersonaSecretSettingsCapability;
  onSecretDraftStateChange?: (dirty: boolean) => void;
};

const readOnlyFieldClass =
  "max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs leading-relaxed scrollbar-hide";

export default function ChatPersonaEditor({
  persona,
  onUpdated,
  editing = true,
  personaSecretSettings = { canEdit: false, discoveryActive: false },
  onSecretDraftStateChange,
}: Props) {
  const [name, setName] = useState(persona.name);
  const [memo, setMemo] = useState(persona.memo ?? "");
  const [gender, setGender] = useState<CharacterGender>(persona.gender ?? "other");
  const [description, setDescription] = useState(persona.description);
  const [secretDescription, setSecretDescription] = useState("");
  const [secretDescriptionLoaded, setSecretDescriptionLoaded] = useState(false);
  const [secretDescriptionDirty, setSecretDescriptionDirty] = useState(false);
  const [secretDescriptionSaving, setSecretDescriptionSaving] = useState(false);
  const [secretLoadError, setSecretLoadError] = useState("");
  const [secretSaveError, setSecretSaveError] = useState("");
  const [compileSummary, setCompileSummary] = useState<PersonaSecretCompileSummaryDto | null>(null);
  const [compilePreservedPrior, setCompilePreservedPrior] = useState(false);
  const [imageUrl, setImageUrl] = useState(persona.image_url ?? "");
  const [imageFocusX, setImageFocusX] = useState(
    persona.image_focus_x ?? PERSONA_IMAGE_FOCUS_DEFAULT.x
  );
  const [imageFocusY, setImageFocusY] = useState(
    persona.image_focus_y ?? PERSONA_IMAGE_FOCUS_DEFAULT.y
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const lastPersonaIdRef = useRef(persona.id);
  const savedRef = useRef({
    id: persona.id,
    name: persona.name,
    memo: persona.memo ?? "",
    gender: persona.gender ?? "other",
    description: persona.description,
    image_url: persona.image_url ?? "",
    image_focus_x: persona.image_focus_x ?? PERSONA_IMAGE_FOCUS_DEFAULT.x,
    image_focus_y: persona.image_focus_y ?? PERSONA_IMAGE_FOCUS_DEFAULT.y,
  });

  useEffect(() => {
    const personaChanged = lastPersonaIdRef.current !== persona.id;
    if (!personaChanged && editing) return;
    lastPersonaIdRef.current = persona.id;
    setName(persona.name);
    setMemo(persona.memo ?? "");
    setGender(persona.gender ?? "other");
    setDescription(persona.description);
    setSecretDescription("");
    setSecretDescriptionLoaded(false);
    setSecretDescriptionDirty(false);
    setSecretDescriptionSaving(false);
    setSecretLoadError("");
    setSecretSaveError("");
    setCompileSummary(null);
    setCompilePreservedPrior(false);
    setImageUrl(persona.image_url ?? "");
    setImageFocusX(persona.image_focus_x ?? PERSONA_IMAGE_FOCUS_DEFAULT.x);
    setImageFocusY(persona.image_focus_y ?? PERSONA_IMAGE_FOCUS_DEFAULT.y);
    savedRef.current = {
      id: persona.id,
      name: persona.name,
      memo: persona.memo ?? "",
      gender: persona.gender ?? "other",
      description: persona.description,
      image_url: persona.image_url ?? "",
      image_focus_x: persona.image_focus_x ?? PERSONA_IMAGE_FOCUS_DEFAULT.x,
      image_focus_y: persona.image_focus_y ?? PERSONA_IMAGE_FOCUS_DEFAULT.y,
    };
  }, [persona, editing]);

  useEffect(() => {
    if (!editing || !personaSecretSettings.canEdit) return;
    let cancelled = false;
    setSecretDescriptionLoaded(false);
    setSecretLoadError("");

    void fetch(`/api/personas/${persona.id}/editor`, { cache: "no-store" })
      .then(async (res) => ({ res, data: await res.json() }))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) {
          setSecretLoadError(data.error || "비밀 설정을 불러오지 못했습니다.");
          return;
        }
        const editor = data.persona as OwnerPersonaEditorItem;
        setSecretDescription(editor.secret_description);
        setSecretDescriptionLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSecretLoadError("비밀 설정을 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [editing, persona.id, personaSecretSettings.canEdit]);

  useEffect(() => {
    onSecretDraftStateChange?.(secretDescriptionDirty);
  }, [onSecretDraftStateChange, secretDescriptionDirty]);

  const save = useCallback(async () => {
    const payload = buildPublicPersonaUpdatePayload({
      name: name.trim(),
      memo,
      gender,
      description,
      image_url: imageUrl,
      image_focus_x: imageFocusX,
      image_focus_y: imageFocusY,
    });
    if (!payload.name) {
      setStatus("error");
      setErrorMsg("페르소나 이름을 입력하세요.");
      return;
    }

    setStatus("saving");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/personas/${persona.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error || "저장에 실패했습니다.");
        return;
      }
      const updated = data.persona as PublicPersonaListItem;
      savedRef.current = {
        id: updated.id,
        name: updated.name,
        memo: updated.memo ?? "",
        gender: updated.gender ?? "other",
        description: updated.description,
        image_url: updated.image_url ?? "",
        image_focus_x: updated.image_focus_x ?? PERSONA_IMAGE_FOCUS_DEFAULT.x,
        image_focus_y: updated.image_focus_y ?? PERSONA_IMAGE_FOCUS_DEFAULT.y,
      };
      onUpdated(updated);
      setStatus("saved");
      window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch {
      setStatus("error");
      setErrorMsg("저장 중 오류가 발생했습니다.");
    }
  }, [
    persona.id,
    name,
    memo,
    gender,
    description,
    imageUrl,
    imageFocusX,
    imageFocusY,
    onUpdated,
  ]);

  const saveSecretDescription = useCallback(async () => {
    if (
      !personaSecretSettings.canEdit ||
      !secretDescriptionLoaded ||
      !secretDescriptionDirty ||
      secretDescriptionSaving
    ) {
      return;
    }

    setSecretDescriptionSaving(true);
    setSecretSaveError("");
    setCompileSummary(null);
    setCompilePreservedPrior(false);
    try {
      const res = await fetch(`/api/personas/${persona.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildExplicitSecretSavePayload(secretDescription)),
      });
      const data = await res.json();
      if (!res.ok) {
        setSecretSaveError(data.error || "비밀 설정 저장에 실패했습니다.");
        return;
      }
      if (data.persona) onUpdated(data.persona as PublicPersonaListItem);
      setSecretDescriptionDirty(false);
      setCompileSummary((data.compile as PersonaSecretCompileSummaryDto | undefined) ?? null);
      setCompilePreservedPrior(Boolean(data.compilePreservedPrior));
    } catch {
      setSecretSaveError("비밀 설정 저장 중 오류가 발생했습니다.");
    } finally {
      setSecretDescriptionSaving(false);
    }
  }, [
    onUpdated,
    persona.id,
    personaSecretSettings.canEdit,
    secretDescription,
    secretDescriptionDirty,
    secretDescriptionLoaded,
    secretDescriptionSaving,
  ]);

  useEffect(() => {
    if (!editing) return;
    const s = savedRef.current;
    if (s.id !== persona.id) return;
    const dirty =
      name !== s.name ||
      memo !== s.memo ||
      gender !== s.gender ||
      description !== s.description ||
      imageUrl !== s.image_url ||
      imageFocusX !== s.image_focus_x ||
      imageFocusY !== s.image_focus_y;
    if (!dirty) return;

    const t = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(t);
  }, [
    name,
    memo,
    gender,
    description,
    imageUrl,
    imageFocusX,
    imageFocusY,
    persona.id,
    save,
    editing,
  ]);

  if (!editing) {
    return (
      <div className="mx-auto max-w-xl space-y-3 text-xs">
        <div className="flex items-center gap-3">
          <PersonaAvatar
            name={name}
            imageUrl={imageUrl}
            focusX={imageFocusX}
            focusY={imageFocusY}
            sizeClassName="h-14 w-14"
          />
          <div className="min-w-0">
            <p className="font-semibold text-zinc-200">{name.trim() || "—"}</p>
            <p className="text-[10px] text-zinc-500">{GENDER_LABELS[gender]}</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-bold text-zinc-400">이름 / 호칭</p>
            <p className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-zinc-200">
              {name.trim() || "—"}
            </p>
          </div>
          <div>
            <p className="mb-1 font-bold text-zinc-400">성별</p>
            <p className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-zinc-200">
              {GENDER_LABELS[gender]}
            </p>
          </div>
        </div>
        {memo.trim() && (
          <div>
            <p className="mb-1 font-bold text-zinc-400">메모 (목록용)</p>
            <p className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-zinc-200">
              {memo}
            </p>
          </div>
        )}
        <div>
          <p className="mb-1 font-bold text-zinc-400">기본 페르소나 설정</p>
          <div
            className={`${readOnlyFieldClass} ${
              description.trim() ? "text-zinc-200" : "text-zinc-600"
            }`}
          >
            {description.trim() || "설정 없음"}
          </div>
        </div>
        <p className="text-[10px] text-zinc-600">
          {personaContentLength(description).toLocaleString()} / {PERSONA_CONTENT_MAX.toLocaleString()}자
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 text-xs">
      <p className="text-zinc-500">
        AI가 인식하는 유저 페르소나입니다. 수정하면 <strong className="text-zinc-400">다음 메시지부터</strong>{" "}
        반영됩니다. AI 캐릭터·세계가 장면을 이어 가고 유저의 짧은 행동·대사만 보조하게 하려면 채팅창 하단의{" "}
        <strong className="text-zinc-400">자동진행</strong>을 사용하세요.
      </p>

      <PersonaImageEditor
        compact
        value={{
          image_url: imageUrl,
          image_focus_x: imageFocusX,
          image_focus_y: imageFocusY,
        }}
        onChange={(next) => {
          setImageUrl(next.image_url);
          setImageFocusX(next.image_focus_x);
          setImageFocusY(next.image_focus_y);
        }}
      />

      <label className="block space-y-1">
        <span className="font-bold text-zinc-400">이름 / 호칭</span>
        <input
          type="text"
          maxLength={PERSONA_NAME_LIMIT}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, PERSONA_NAME_LIMIT))}
          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
        />
        <span className="text-[10px] text-zinc-600">
          {name.length}/{PERSONA_NAME_LIMIT}자 · 대화의 {"{{user}}"} 자리에 표시
        </span>
      </label>

      <label className="block space-y-1">
        <span className="font-bold text-zinc-400">성별</span>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value as CharacterGender)}
          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
        >
          {(Object.entries(GENDER_LABELS) as [CharacterGender, string][]).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="font-bold text-zinc-400">메모 (목록용)</span>
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="예: 학생, 오빠"
          className="w-full rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-zinc-200 outline-none focus:border-violet-500/40"
        />
        <span className="text-[10px] text-zinc-600">{memo.length.toLocaleString()}자</span>
      </label>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2">
        <span className="text-[11px] text-zinc-400">기본+비밀 합계</span>
        <span
          className={`text-[11px] font-semibold tabular-nums ${
            personaCombinedContentLength(description, secretDescription) >= PERSONA_CONTENT_MAX
              ? "text-rose-400"
              : personaCombinedContentLength(description, secretDescription) >=
                  PERSONA_CONTENT_MAX * 0.9
                ? "text-amber-400"
                : "text-violet-300/90"
          }`}
        >
          {personaCombinedContentLength(description, secretDescription).toLocaleString()} /{" "}
          {PERSONA_CONTENT_MAX.toLocaleString()}자
        </span>
      </div>

      <label className="block space-y-1">
        <span className="font-bold text-zinc-400">기본 페르소나 설정</span>
        <textarea
          rows={10}
          maxLength={Math.max(
            description.length,
            PERSONA_CONTENT_MAX - personaContentLength(secretDescription)
          )}
          value={description}
          onChange={(e) =>
            setDescription(capPersonaFieldToSharedBudget(secretDescription, e.target.value))
          }
          placeholder="나이, 외모, 성격, 배경, 말투, AI에게 알려줄 공개 역할 설정…"
          className="max-h-56 w-full resize-none overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-violet-500/40"
        />
        <span className="text-[10px] text-zinc-600">
          {personaContentLength(description).toLocaleString()}자
        </span>
      </label>

      {personaSecretSettings.canEdit ? (
        <div className="space-y-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <label className="block space-y-1">
            <span className="font-bold text-zinc-300">비밀 설정 (선택)</span>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              캐릭터가 대화 시작 시점에는 모르는 설정입니다. 외형, 성격, 직업, 평소 말투처럼 처음부터
              알아야 하는 내용은 일반 설정에 작성하세요.
            </p>
            {personaSecretSettings.discoveryActive ? (
              <p className="text-[10px] leading-relaxed text-zinc-500">
                직접 공개하거나, 목격·조사·전달을 통해 알게 될 수 있습니다.
              </p>
            ) : null}
            <textarea
              rows={6}
              maxLength={Math.max(
                secretDescription.length,
                PERSONA_CONTENT_MAX - personaContentLength(description)
              )}
              value={secretDescription}
              disabled={!secretDescriptionLoaded || secretDescriptionSaving}
              onChange={(e) => {
                setSecretDescription(
                  capPersonaFieldToSharedBudget(description, e.target.value)
                );
                setSecretDescriptionDirty(true);
              }}
              placeholder="예: 과거 포드 감염 실험에 자원했으며, 오른팔의 감염 흔적을 긴 장갑으로 숨기고 있다."
              className="max-h-40 w-full resize-none overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-violet-500/40 disabled:opacity-50"
            />
            <span className="text-[10px] text-zinc-600">
              {personaContentLength(secretDescription).toLocaleString()}자
            </span>
          </label>
          {!secretDescriptionLoaded && !secretLoadError && (
            <p className="text-[10px] text-zinc-500">비밀 설정을 불러오는 중…</p>
          )}
          {secretLoadError && <p className="text-[10px] text-rose-400">{secretLoadError}</p>}
          <button
            type="button"
            disabled={
              !secretDescriptionLoaded ||
              !secretDescriptionDirty ||
              secretDescriptionSaving ||
              !!secretLoadError
            }
            onClick={() => void saveSecretDescription()}
            className="rounded-lg border border-violet-500/40 px-3 py-1.5 text-[11px] text-violet-100 disabled:opacity-40"
          >
            {secretDescriptionSaving ? "비밀 설정 저장 중…" : "비밀 설정 저장"}
          </button>
          {secretSaveError && <p className="text-[10px] text-rose-400">{secretSaveError}</p>}
          {compileSummary && (
            <details className="text-[10px] text-zinc-400">
              <summary>
                비밀 설정이 저장되었습니다. 발견 가능한 비밀 {compileSummary.compiledSecretCount}개가
                정리되었습니다.
              </summary>
              <p className="mt-1">
                {compileSummary.titles.join(" · ") || "정리된 비밀 없음"}
                {compileSummary.needsReview ? " · 검토 필요" : ""}
                {compileSummary.reused ? " · 기존 분석 재사용" : ""}
              </p>
              {compileSummary.warnings.length > 0 && (
                <p className="mt-1">{compileSummary.warnings.join(" · ")}</p>
              )}
            </details>
          )}
          {compilePreservedPrior && (
            <p className="text-[10px] leading-relaxed text-amber-300">
              페르소나 설정은 저장됐지만 비밀 설정 분석에 실패했습니다. 기존 분석 결과는 보존되었으며,
              같은 내용을 다시 저장하면 분석을 재시도합니다.
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-[10px] leading-relaxed text-zinc-500">
          비밀 설정은 현재 일부 사용자에게 순차 공개 중입니다.
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        {status === "saving" && <span className="text-violet-300">저장 중…</span>}
        {status === "saved" && <span className="text-emerald-400">저장됨</span>}
        {status === "error" && errorMsg && <span className="text-rose-400">{errorMsg}</span>}
        {status === "idle" && <span className="text-zinc-600">입력 시 자동 저장</span>}
      </div>
    </div>
  );
}

/** 편집 시작 전 스냅샷으로 서버·UI 복원 */
export async function restorePersonaSnapshot(
  snapshot: PublicPersonaListItem,
  onUpdated: (persona: PublicPersonaListItem) => void
): Promise<boolean> {
  try {
    const res = await fetch(`/api/personas/${snapshot.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: snapshot.name,
        memo: snapshot.memo ?? "",
        gender: snapshot.gender ?? "other",
        description: snapshot.description,
        image_url: snapshot.image_url ?? "",
        image_focus_x: snapshot.image_focus_x ?? PERSONA_IMAGE_FOCUS_DEFAULT.x,
        image_focus_y: snapshot.image_focus_y ?? PERSONA_IMAGE_FOCUS_DEFAULT.y,
      }),
    });
    const data = await res.json();
    if (!res.ok) return false;
    onUpdated(data.persona as PublicPersonaListItem);
    return true;
  } catch {
    return false;
  }
}
