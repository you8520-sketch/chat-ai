"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GENDER_LABELS, type CharacterGender } from "@/lib/characterGender";
import { PERSONA_NAME_LIMIT, PERSONA_CONTENT_MAX, personaContentLength } from "@/lib/persona";
import type { PersonaListItem } from "@/lib/userPersonas";

type Props = {
  persona: PersonaListItem;
  onUpdated: (persona: PersonaListItem) => void;
  /** false — 읽기 전용, true — 편집·자동 저장 */
  editing?: boolean;
};

const readOnlyFieldClass =
  "max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs leading-relaxed scrollbar-hide";

export default function ChatPersonaEditor({ persona, onUpdated, editing = true }: Props) {
  const [name, setName] = useState(persona.name);
  const [memo, setMemo] = useState(persona.memo ?? "");
  const [gender, setGender] = useState<CharacterGender>(persona.gender ?? "other");
  const [description, setDescription] = useState(persona.description);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const lastPersonaIdRef = useRef(persona.id);
  const savedRef = useRef({
    id: persona.id,
    name: persona.name,
    memo: persona.memo ?? "",
    gender: persona.gender ?? "other",
    description: persona.description,
  });

  useEffect(() => {
    const personaChanged = lastPersonaIdRef.current !== persona.id;
    if (!personaChanged && editing) return;
    lastPersonaIdRef.current = persona.id;
    setName(persona.name);
    setMemo(persona.memo ?? "");
    setGender(persona.gender ?? "other");
    setDescription(persona.description);
    savedRef.current = {
      id: persona.id,
      name: persona.name,
      memo: persona.memo ?? "",
      gender: persona.gender ?? "other",
      description: persona.description,
    };
  }, [persona, editing]);

  const save = useCallback(async () => {
    const payload = { name: name.trim(), memo, gender, description };
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
      const updated = data.persona as PersonaListItem;
      savedRef.current = {
        id: updated.id,
        name: updated.name,
        memo: updated.memo ?? "",
        gender: updated.gender ?? "other",
        description: updated.description,
      };
      onUpdated(updated);
      setStatus("saved");
      window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch {
      setStatus("error");
      setErrorMsg("저장 중 오류가 발생했습니다.");
    }
  }, [persona.id, name, memo, gender, description, onUpdated]);

  useEffect(() => {
    if (!editing) return;
    const s = savedRef.current;
    if (s.id !== persona.id) return;
    const dirty =
      name !== s.name ||
      memo !== s.memo ||
      gender !== s.gender ||
      description !== s.description;
    if (!dirty) return;

    const t = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(t);
  }, [name, memo, gender, description, persona.id, save, editing]);

  if (!editing) {
    return (
      <div className="mx-auto max-w-xl space-y-3 text-xs">
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
          <p className="mb-1 font-bold text-zinc-400">페르소나 설정</p>
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
        <span className="text-[11px] text-zinc-400">페르소나 설정</span>
        <span
          className={`text-[11px] font-semibold tabular-nums ${
            personaContentLength(description) >= PERSONA_CONTENT_MAX
              ? "text-rose-400"
              : personaContentLength(description) >= PERSONA_CONTENT_MAX * 0.9
                ? "text-amber-400"
                : "text-violet-300/90"
          }`}
        >
          {personaContentLength(description).toLocaleString()} / {PERSONA_CONTENT_MAX.toLocaleString()}자
        </span>
      </div>

      <label className="block space-y-1">
        <span className="font-bold text-zinc-400">페르소나 설정</span>
        <textarea
          rows={10}
          maxLength={PERSONA_CONTENT_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="나이, 외모, 성격, 배경, 말투, AI에게 알려줄 역할 설정…"
          className="max-h-56 w-full resize-none overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-violet-500/40"
        />
      </label>

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
  snapshot: PersonaListItem,
  onUpdated: (persona: PersonaListItem) => void
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
      }),
    });
    const data = await res.json();
    if (!res.ok) return false;
    onUpdated(data.persona as PersonaListItem);
    return true;
  } catch {
    return false;
  }
}
