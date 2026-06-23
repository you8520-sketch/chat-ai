"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GENDER_LABELS, type CharacterGender } from "@/lib/characterGender";
import {
  PERSONA_NAME_LIMIT,
  PERSONA_CONTENT_MAX,
  USER_NOTE_MAX,
  USER_NOTE_FOCUS_MAX,
  capPersonaDescription,
  personaContentLength,
} from "@/lib/persona";
import type { PersonaListItem } from "@/lib/userPersonas";
import type { UserNotePresetItem } from "@/lib/userNotePresetTypes";
import { USER_NOTE_PRESET_TITLE_MAX } from "@/lib/userNotePresetTypes";
import UserNoteSplitEditor from "@/components/UserNoteSplitEditor";
import StatusWidgetEditor from "@/components/StatusWidgetEditor";
import ShareLinkBox from "@/components/ShareLinkBox";
import { validateUserNoteCombined, userNoteCombinedCharCount, parseUserNoteCombined, extractFocusZoneNote, validateUserNoteFocusPreset } from "@/lib/userNoteStatusWindow";
import type { StatusWidgetPresetItem } from "@/lib/statusWidgetPresetTypes";
import { STATUS_WIDGET_PRESET_TITLE_MAX } from "@/lib/statusWidgetPresetTypes";
import {
  characterStatusWidgetOrDefault,
  parseStatusWidgetJson,
  serializeStatusWidget,
  type StatusWidget,
} from "@/lib/statusWidget";
import { estimateStatusWidgetContextChars, formatWidgetBudgetHint } from "@/lib/statusWidget/contextBudget";

export default function PersonaClient({
  initialPersonas,
  initialNotePresets,
  initialStatusWidgetPresets,
  nickname,
}: {
  initialPersonas: PersonaListItem[];
  initialNotePresets: UserNotePresetItem[];
  initialStatusWidgetPresets: StatusWidgetPresetItem[];
  nickname: string;
}) {
  const router = useRouter();
  const [personas, setPersonas] = useState(initialPersonas);
  const [notePresets, setNotePresets] = useState(initialNotePresets);
  const [statusWidgetPresets, setStatusWidgetPresets] = useState(initialStatusWidgetPresets);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftMemo, setDraftMemo] = useState("");
  const [draftGender, setDraftGender] = useState<CharacterGender | "">("");
  const [draftDesc, setDraftDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [noteCreating, setNoteCreating] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState<number | null>(null);
  const [noteDraftTitle, setNoteDraftTitle] = useState("");
  const [noteDraftContent, setNoteDraftContent] = useState("");
  const [widgetCreating, setWidgetCreating] = useState(false);
  const [widgetEditingId, setWidgetEditingId] = useState<number | null>(null);
  const [widgetDraftTitle, setWidgetDraftTitle] = useState("");
  const [widgetDraft, setWidgetDraft] = useState<StatusWidget>(() =>
    characterStatusWidgetOrDefault(null)
  );
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [widgetSharePath, setWidgetSharePath] = useState<string | null>(null);

  function startEdit(p: PersonaListItem) {
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftMemo(p.memo ?? "");
    setDraftGender(p.gender ?? "other");
    setDraftDesc(p.description);
    setCreating(false);
    setError("");
    setMsg("");
  }

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setDraftName("");
    setDraftMemo("");
    setDraftGender("");
    setDraftDesc("");
    setError("");
    setMsg("");
  }

  function cancelForm() {
    setCreating(false);
    setEditingId(null);
    setDraftName("");
    setDraftMemo("");
    setDraftGender("");
    setDraftDesc("");
  }

  async function refreshList() {
    const res = await fetch("/api/personas");
    const data = await res.json();
    if (res.ok) setPersonas(data.personas ?? []);
  }

  async function savePersona() {
    setBusy(true);
    setError("");
    setMsg("");
    if (!draftGender) {
      setBusy(false);
      setError("페르소나 성별을 선택하세요.");
      return;
    }
    const payload = {
      name: draftName,
      memo: draftMemo,
      gender: draftGender,
      description: draftDesc,
    };

    const res = editingId
      ? await fetch(`/api/personas/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/personas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "저장에 실패했습니다.");
      return;
    }
    setMsg(editingId ? "페르소나가 수정되었습니다." : "페르소나가 생성되었습니다.");
    cancelForm();
    await refreshList();
    router.refresh();
  }

  async function deletePersona(id: number) {
    if (!confirm("이 페르소나를 삭제할까요?")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/personas/${id}`, { method: "DELETE" });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "삭제에 실패했습니다.");
      return;
    }
    setMsg("페르소나가 삭제되었습니다.");
    if (editingId === id) cancelForm();
    await refreshList();
    router.refresh();
  }

  async function refreshNotePresets() {
    const res = await fetch("/api/user-note-presets");
    const data = await res.json();
    if (res.ok) setNotePresets(data.presets ?? []);
  }

  function startNoteCreate() {
    setNoteCreating(true);
    setNoteEditingId(null);
    setNoteDraftTitle("");
    setNoteDraftContent("");
    setError("");
    setMsg("");
  }

  function startNoteEdit(preset: UserNotePresetItem) {
    setNoteEditingId(preset.id);
    setNoteCreating(false);
    setNoteDraftTitle(preset.title);
    setNoteDraftContent(preset.content);
    setError("");
    setMsg("");
  }

  function cancelNoteForm() {
    setNoteCreating(false);
    setNoteEditingId(null);
    setNoteDraftTitle("");
    setNoteDraftContent("");
  }

  async function refreshStatusWidgetPresets() {
    const res = await fetch("/api/status-widget-presets");
    const data = await res.json();
    if (res.ok) setStatusWidgetPresets(data.presets ?? []);
  }

  function startWidgetCreate() {
    setWidgetCreating(true);
    setWidgetEditingId(null);
    setWidgetDraftTitle("");
    setWidgetDraft(characterStatusWidgetOrDefault(null));
    setWidgetSharePath(null);
    setError("");
    setMsg("");
  }

  function startWidgetEdit(preset: StatusWidgetPresetItem) {
    setWidgetEditingId(preset.id);
    setWidgetCreating(false);
    setWidgetDraftTitle(preset.title);
    setWidgetDraft(
      parseStatusWidgetJson(preset.widget_json) ?? characterStatusWidgetOrDefault(null)
    );
    setWidgetSharePath(null);
    setError("");
    setMsg("");
  }

  function cancelWidgetForm() {
    setWidgetCreating(false);
    setWidgetEditingId(null);
    setWidgetDraftTitle("");
    setWidgetDraft(characterStatusWidgetOrDefault(null));
    setWidgetSharePath(null);
  }

  async function createWidgetShareLink(body: { presetId?: number; title?: string; widget_json?: string }) {
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch("/api/status-widget-shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "공유 링크 생성에 실패했습니다.");
      return;
    }
    setWidgetSharePath(data.applyPath);
    setMsg("공유 링크가 생성되었습니다. 링크를 복사해 공유하세요.");
  }

  async function saveWidgetPreset() {
    if (!widgetDraftTitle.trim()) {
      setError("상태창 제목을 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    const payload = {
      title: widgetDraftTitle,
      widget_json: serializeStatusWidget(widgetDraft),
    };
    const res = widgetEditingId
      ? await fetch(`/api/status-widget-presets/${widgetEditingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/status-widget-presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "저장에 실패했습니다.");
      return;
    }
    setMsg(widgetEditingId ? "상태창이 수정되었습니다." : "상태창이 저장되었습니다.");
    cancelWidgetForm();
    await refreshStatusWidgetPresets();
    router.refresh();
  }

  async function deleteWidgetPreset(id: number) {
    if (!confirm("이 상태창을 삭제할까요?")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/status-widget-presets/${id}`, { method: "DELETE" });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "삭제에 실패했습니다.");
      return;
    }
    setMsg("상태창이 삭제되었습니다.");
    if (widgetEditingId === id) cancelWidgetForm();
    await refreshStatusWidgetPresets();
    router.refresh();
  }

  async function saveNotePreset() {
    const focusContent = extractFocusZoneNote(noteDraftContent);
    const noteCheck = validateUserNoteFocusPreset(focusContent);
    if (!noteCheck.ok) {
      setError(noteCheck.error);
      return;
    }
    if (!noteDraftTitle.trim()) {
      setError("유저 노트 제목을 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    const res = noteEditingId
      ? await fetch(`/api/user-note-presets/${noteEditingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: noteDraftTitle, content: focusContent }),
        })
        : await fetch("/api/user-note-presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: noteDraftTitle, content: focusContent }),
        });
    setBusy(false);
    let data: { error?: string } = {};
    try {
      const text = await res.text();
      if (text) data = JSON.parse(text) as { error?: string };
    } catch {
      setError("저장에 실패했습니다.");
      return;
    }
    if (!res.ok) {
      setError(data.error || "저장에 실패했습니다.");
      return;
    }
    setMsg(noteEditingId ? "유저 노트가 수정되었습니다." : "유저 노트가 추가되었습니다.");
    cancelNoteForm();
    await refreshNotePresets();
    router.refresh();
  }

  async function deleteNotePreset(id: number) {
    if (!confirm("이 유저 노트를 삭제할까요?")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/user-note-presets/${id}`, { method: "DELETE" });
    setBusy(false);
    let data: { error?: string } = {};
    try {
      const text = await res.text();
      if (text) data = JSON.parse(text) as { error?: string };
    } catch {
      setError("삭제에 실패했습니다.");
      return;
    }
    if (!res.ok) {
      setError(data.error || "삭제에 실패했습니다.");
      return;
    }
    setMsg("유저 노트가 삭제되었습니다.");
    if (noteEditingId === id) cancelNoteForm();
    await refreshNotePresets();
    router.refresh();
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-black text-white">페르소나·노트 제작</h1>
        <p className="mt-1 text-sm text-gray-400">
          원하는 만큼 페르소나를 만들고 채팅방 상단에서 선택해 사용합니다.
        </p>
      </div>

      <section id="personas" className="space-y-3 rounded-2xl border border-violet-500/20 bg-[#131626] p-5 scroll-mt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-violet-300">내 페르소나 ({personas.length})</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              설명 최대 {PERSONA_CONTENT_MAX.toLocaleString()}자
            </p>
          </div>
          <button
            type="button"
            onClick={startCreate}
            disabled={busy || creating}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            + 새 페르소나
          </button>
        </div>

        <ul className="space-y-2">
          {personas.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-white/10 bg-[#0e1120] px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-white">
                    {p.name}
                    <span className="text-[10px] font-normal text-zinc-500">
                      · {GENDER_LABELS[p.gender ?? "other"]}
                    </span>
                  </p>
                  {p.memo?.trim() && (
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {p.memo}
                    </p>
                  )}
                  <p className="mt-1 line-clamp-2 text-xs text-gray-400">
                    {p.description.trim() || "(설명 없음)"}
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-600">
                    {p.description.length.toLocaleString()} / {PERSONA_CONTENT_MAX.toLocaleString()}자
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(p)}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/5"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={busy || personas.length <= 1}
                    onClick={() => deletePersona(p.id)}
                    className="rounded-lg border border-rose-500/20 px-2.5 py-1 text-[11px] text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
                  >
                    삭제
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {(creating || editingId != null) && (
          <div className="space-y-3 rounded-xl border border-violet-500/30 bg-[#0a0d18] p-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2">
              <p className="text-xs font-bold text-violet-300">{creating ? "새 페르소나" : "페르소나 수정"}</p>
              <span
                className={`text-xs font-semibold tabular-nums ${
                  personaContentLength(draftDesc) >= PERSONA_CONTENT_MAX
                    ? "text-rose-400"
                    : personaContentLength(draftDesc) >= PERSONA_CONTENT_MAX * 0.9
                      ? "text-amber-400"
                      : "text-violet-200/80"
                }`}
              >
                {personaContentLength(draftDesc).toLocaleString()} / {PERSONA_CONTENT_MAX.toLocaleString()}자
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              설명은 {PERSONA_CONTENT_MAX.toLocaleString()}자까지 입력할 수 있습니다.
            </p>
            <div>
              <label className="mb-1 block text-xs text-gray-400">이름</label>
              <input
                className="w-full rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                maxLength={PERSONA_NAME_LIMIT}
                placeholder={`비우면 안 됨 · 닉네임: ${nickname}`}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value.slice(0, PERSONA_NAME_LIMIT))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">성별</label>
              <p className="mb-2 text-[11px] text-gray-600">
                AI가 이 페르소나를 지칭·묘사할 때 반드시 따릅니다 · 필수
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(["male", "female", "other"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setDraftGender(value)}
                    className={`rounded-xl border py-2.5 text-sm font-bold transition ${
                      draftGender === value
                        ? "border-violet-500 bg-violet-600/25 text-violet-200 ring-1 ring-violet-500/50"
                        : "border-white/10 bg-[#0e1120] text-gray-400 hover:border-white/20 hover:text-gray-200"
                    }`}
                  >
                    {GENDER_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-gray-400">
                <label>메모 (참고용 · AI 미전달)</label>
                <span>{draftMemo.length.toLocaleString()}자</span>
              </div>
              <input
                className="w-full rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                placeholder="예: 메인 RP용"
                value={draftMemo}
                onChange={(e) => setDraftMemo(e.target.value)}
              />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-gray-400">
                <label>설명</label>
                <span>
                  {personaContentLength(draftDesc).toLocaleString()} / {PERSONA_CONTENT_MAX.toLocaleString()}자
                </span>
              </div>
              <textarea
                rows={8}
                className="w-full rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-violet-500"
                value={draftDesc}
                onChange={(e) => setDraftDesc(capPersonaDescription(draftDesc, e.target.value))}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !draftName.trim() || !draftGender}
                onClick={savePersona}
                className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                {busy ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-400"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </section>

      <section id="user-note-presets" className="space-y-3 rounded-2xl border border-amber-500/20 bg-[#131626] p-5 scroll-mt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-amber-300">유저 노트 보관함 ({notePresets.length})</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              고집중(중요 기억) 구간만 저장 · 채팅에서 불러와 사용
            </p>
          </div>
          <button
            type="button"
            onClick={startNoteCreate}
            disabled={busy || noteCreating}
            className="rounded-lg bg-amber-600/90 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            + 새 노트
          </button>
        </div>

        <ul className="space-y-2">
          {notePresets.map((preset) => {
            const parsed = parseUserNoteCombined(preset.content);
            const chars = userNoteCombinedCharCount(parsed.body, parsed.statusTemplate);
            return (
              <li key={preset.id} className="rounded-xl border border-white/10 bg-[#0e1120] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">{preset.title}</p>
                    <p className="mt-0.5 text-[10px] text-amber-400/70">고집중 구간</p>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-400">
                      {parsed.body.trim() || "(내용 없음)"}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-600">
                      {chars.toLocaleString()} / {USER_NOTE_FOCUS_MAX.toLocaleString()}자
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startNoteEdit(preset)}
                      className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/5"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteNotePreset(preset.id)}
                      className="rounded-lg border border-rose-500/20 px-2.5 py-1 text-[11px] text-rose-400 hover:bg-rose-500/10"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          {notePresets.length === 0 && (
            <li className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
              저장된 유저 노트가 없습니다. 채팅 설정에서 작성·저장하거나 여기서 추가하세요.
            </li>
          )}
        </ul>

        {(noteCreating || noteEditingId != null) && (
          <div className="space-y-3 rounded-xl border border-amber-500/30 bg-[#0a0d18] p-4">
            <p className="text-xs font-bold text-amber-300">
              {noteCreating ? "새 유저 노트" : "유저 노트 수정"}
            </p>
            <div>
              <label className="mb-1 block text-xs text-gray-400">제목</label>
              <input
                className="w-full rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                maxLength={USER_NOTE_PRESET_TITLE_MAX}
                placeholder="예: 본편 설정, 로맨스 루트"
                value={noteDraftTitle}
                onChange={(e) => setNoteDraftTitle(e.target.value.slice(0, USER_NOTE_PRESET_TITLE_MAX))}
              />
            </div>
            <UserNoteSplitEditor
              userNote={noteDraftContent}
              onUserNoteChange={setNoteDraftContent}
              focusOnly
              focusRows={5}
              textareaClassName="w-full rounded-xl border border-white/10 bg-[#0e1120] px-4 py-3 text-sm leading-relaxed text-white outline-none focus:border-amber-500/50"
            />
            <p className="text-[11px] text-gray-500">
              {(() => {
                const parsed = parseUserNoteCombined(extractFocusZoneNote(noteDraftContent));
                return userNoteCombinedCharCount(parsed.body, parsed.statusTemplate).toLocaleString();
              })()}{" "}
              / {USER_NOTE_FOCUS_MAX.toLocaleString()}자 (고집중)
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !noteDraftTitle.trim()}
                onClick={() => void saveNotePreset()}
                className="rounded-lg bg-amber-600/90 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                {busy ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                onClick={cancelNoteForm}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-400"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </section>

      <section
        id="status-widget-presets"
        className="space-y-3 rounded-2xl border border-violet-500/20 bg-[#131626] p-5 scroll-mt-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-violet-300">
              상태창 보관함 ({statusWidgetPresets.length})
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              HTML·필드 제작 · 채팅 상태창 메뉴에서 불러와 사용
            </p>
          </div>
          <button
            type="button"
            onClick={startWidgetCreate}
            disabled={busy || widgetCreating}
            className="rounded-lg bg-violet-600/90 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            + 새 상태창
          </button>
        </div>

        <ul className="space-y-2">
          {statusWidgetPresets.map((preset) => {
            const reserved = estimateStatusWidgetContextChars(
              parseStatusWidgetJson(preset.widget_json)
            );
            return (
              <li key={preset.id} className="rounded-xl border border-white/10 bg-[#0e1120] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">{preset.title}</p>
                    <p className="mt-0.5 text-[10px] text-violet-400/70">
                      {formatWidgetBudgetHint(reserved)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void createWidgetShareLink({ presetId: preset.id })
                      }
                      className="rounded-lg border border-cyan-500/25 px-2.5 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/10"
                    >
                      공유
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startWidgetEdit(preset)}
                      className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/5"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteWidgetPreset(preset.id)}
                      className="rounded-lg border border-rose-500/20 px-2.5 py-1 text-[11px] text-rose-400 hover:bg-rose-500/10"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          {statusWidgetPresets.length === 0 && (
            <li className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
              저장된 상태창이 없습니다. 아래에서 새로 만들 수 있습니다.
            </li>
          )}
        </ul>

        {(widgetCreating || widgetEditingId != null) && (
          <div className="space-y-3 rounded-xl border border-violet-500/30 bg-[#0a0d18] p-4">
            <p className="text-xs font-bold text-violet-300">
              {widgetCreating ? "새 상태창" : "상태창 수정"}
            </p>
            <div>
              <label className="mb-1 block text-xs text-gray-400">제목</label>
              <input
                className="w-full rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                maxLength={STATUS_WIDGET_PRESET_TITLE_MAX}
                placeholder="예: 다크 카드, 미니멀 HUD"
                value={widgetDraftTitle}
                onChange={(e) =>
                  setWidgetDraftTitle(e.target.value.slice(0, STATUS_WIDGET_PRESET_TITLE_MAX))
                }
              />
            </div>
            <StatusWidgetEditor value={widgetDraft} onChange={setWidgetDraft} disabled={busy} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !widgetDraftTitle.trim()}
                onClick={() => void saveWidgetPreset()}
                className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                {busy ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                disabled={busy || !widgetDraftTitle.trim()}
                onClick={() =>
                  void createWidgetShareLink({
                    title: widgetDraftTitle,
                    widget_json: serializeStatusWidget(widgetDraft),
                  })
                }
                className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-bold text-cyan-200 disabled:opacity-40"
              >
                공유 링크
              </button>
              <button
                type="button"
                onClick={cancelWidgetForm}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-400"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {widgetSharePath && (
          <ShareLinkBox path={widgetSharePath} label="위젯 적용 링크 (열어서 내 위젯에 추가)" />
        )}
      </section>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}

      <p className="text-center text-sm text-gray-500">
        <Link href="/" className="text-violet-400 hover:underline">
          홈으로
        </Link>
      </p>
    </div>
  );
}
