"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import GenrePicker from "@/components/GenrePicker";
import type { CharacterGenre } from "@/lib/characterGenres";
import {
  AI_LEARNING_LIMIT,
  SPEECH_EXAMPLES_LIMIT,
  SPEECH_FORBIDDEN_LIMIT,
} from "@/lib/characterFormLimits";
import { speechCreatorCharCount } from "@/lib/speechCreatorFields";

const DESC_LIMIT = 10000; // 상세 소개 (AI 미학습)
const PROMPT_LIMIT = AI_LEARNING_LIMIT; // 설정+세계관+기본 말투 합산
const MAX_IMAGES = 100;

export default function CreateClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: "", tagline: "", description: "", greeting: "",
    system_prompt: "", world: "",
    speech_personality: "", speech_traits: "", speech_examples: "", speech_forbidden: "",
    genres: [] as CharacterGenre[], tags: "", nsfw: false, emoji: "✨", hue: 260,
    audience: "all",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  const promptTotal =
    form.system_prompt.length +
    form.world.length +
    speechCreatorCharCount({
      speech_personality: form.speech_personality,
      speech_traits: form.speech_traits,
      speech_examples: form.speech_examples,
      speech_forbidden: form.speech_forbidden,
    });

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_IMAGES);
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  function removeFile(i: number) {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (promptTotal > PROMPT_LIMIT) {
      setError(`캐릭터 설정+세계관+기본 말투는 합쳐서 ${PROMPT_LIMIT.toLocaleString()}자 이하여야 합니다.`);
      return;
    }
    if (form.speech_examples.length > SPEECH_EXAMPLES_LIMIT) {
      setError(`대사 예시는 ${SPEECH_EXAMPLES_LIMIT.toLocaleString()}자 이하여야 합니다.`);
      return;
    }
    if (form.speech_forbidden.length > SPEECH_FORBIDDEN_LIMIT) {
      setError(`금지 말투는 ${SPEECH_FORBIDDEN_LIMIT.toLocaleString()}자 이하여야 합니다.`);
      return;
    }
    if (form.genres.length === 0) {
      setError("장르를 1개 이상 선택해 주세요.");
      return;
    }
    if (!form.speech_personality.trim() || !form.speech_traits.trim() || !form.speech_examples.trim()) {
      setError("말투 설정(성격·말투 특징·대사 예시)은 필수입니다.");
      return;
    }
    setLoading(true);
    setError("");

    // 1) 이미지 업로드
    let images: string[] = [];
    if (files.length > 0) {
      setProgress(`이미지 ${files.length}장 업로드 중…`);
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) {
        setLoading(false);
        setProgress("");
        setError(upData.error);
        return;
      }
      images = upData.urls;
    }

    // 2) 캐릭터 생성
    setProgress("캐릭터 생성 중…");
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, images }),
    });
    setLoading(false);
    setProgress("");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    router.push(`/character/${data.id}`);
  }

  const cls =
    "w-full rounded-xl bg-[#0e1120] px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-violet-500 placeholder:text-gray-600";

  return (
    <div className="mx-auto mt-4 max-w-2xl">
      <h1 className="text-xl font-black text-white">캐릭터 제작</h1>
      <p className="mt-1 text-sm text-gray-400">나만의 AI 캐릭터를 만들어보세요.</p>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <input required placeholder="캐릭터 이름 *" className={cls}
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="한 줄 소개" className={cls}
          value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label className="text-sm font-semibold text-gray-300">캐릭터 상세 소개</label>
            <Counter now={form.description.length} max={DESC_LIMIT} />
          </div>
          <textarea rows={6} maxLength={DESC_LIMIT} className={cls}
            placeholder="소개 페이지에 표시되는 설명입니다. AI에 학습되지 않습니다."
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <p className="mt-1 text-[11px] text-gray-600">소개 페이지용 · AI에 학습되지 않음 · 최대 {DESC_LIMIT.toLocaleString()}자</p>
        </div>

        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-sm font-bold text-violet-300">AI 학습 영역</p>
            <Counter now={promptTotal} max={PROMPT_LIMIT} />
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-300">캐릭터 설정 *</label>
              <textarea required rows={6} className={cls}
                placeholder="외모, 배경, 관계 등 (말투·대사는 아래 말투 설정에 작성)"
                value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-300">세계관</label>
              <textarea rows={5} className={cls}
                placeholder="이야기의 배경, 시대, 장소, 세력, 규칙 등"
                value={form.world} onChange={(e) => setForm({ ...form, world: e.target.value })} />
            </div>
            <div className="space-y-3 rounded-xl border border-violet-500/20 bg-black/20 p-3">
              <p className="text-xs font-bold text-violet-300">말투 설정</p>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-300">
                  <span className="text-rose-400">[필수]</span> 성격
                </label>
                <textarea required rows={2} className={cls}
                  placeholder="차갑고 무뚝뚝, 경계심 강함 등"
                  value={form.speech_personality} onChange={(e) => setForm({ ...form, speech_personality: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-300">
                  <span className="text-rose-400">[필수]</span> 말투 특징
                </label>
                <textarea required rows={2} className={cls}
                  placeholder="하십시오체, 짧은 문장, 호칭: 각하 등"
                  value={form.speech_traits} onChange={(e) => setForm({ ...form, speech_traits: e.target.value })} />
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="text-xs font-semibold text-gray-300">
                    <span className="text-rose-400">[필수]</span> 대사 예시
                  </label>
                  <Counter now={form.speech_examples.length} max={SPEECH_EXAMPLES_LIMIT} />
                </div>
                <textarea required rows={5} className={cls} maxLength={SPEECH_EXAMPLES_LIMIT}
                  placeholder={"유저: 안녕?\n캐릭터: …늦었구나. 기다린 것은 아니오."}
                  value={form.speech_examples}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      speech_examples: e.target.value.slice(0, SPEECH_EXAMPLES_LIMIT),
                    })
                  }
                />
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="text-xs font-semibold text-gray-300">
                    <span className="text-gray-500">[선택]</span> 금지 말투
                  </label>
                  <Counter now={form.speech_forbidden.length} max={SPEECH_FORBIDDEN_LIMIT} />
                </div>
                <textarea rows={2} className={cls} maxLength={SPEECH_FORBIDDEN_LIMIT}
                  placeholder="입니다요, 밈, 인터넷체 등 (쉼표·줄바꿈 구분)"
                  value={form.speech_forbidden}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      speech_forbidden: e.target.value.slice(0, SPEECH_FORBIDDEN_LIMIT),
                    })
                  }
                />
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-600">
            설정+세계관+기본 말투 합쳐서 최대 {PROMPT_LIMIT.toLocaleString()}자 · 대사
            예시/금지 말투는 각 {SPEECH_EXAMPLES_LIMIT.toLocaleString()}자(합산 제외)
          </p>
        </div>

        <textarea placeholder="첫 인사말 (캐릭터가 대화를 시작할 때 하는 말)" rows={2} className={cls}
          value={form.greeting} onChange={(e) => setForm({ ...form, greeting: e.target.value })} />
        <input placeholder="태그 (쉼표로 구분: 여성,로맨스,츤데레)" className={cls}
          value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label className="text-sm font-semibold text-gray-300">캐릭터 이미지</label>
            <span className="text-xs text-gray-500">{files.length} / {MAX_IMAGES}장</span>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
            onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()}
            disabled={files.length >= MAX_IMAGES}
            className="w-full rounded-xl border border-dashed border-white/15 bg-[#0e1120] py-6 text-sm text-gray-400 hover:border-violet-500/50 disabled:opacity-40">
            🖼️ 클릭해서 이미지 추가 (최대 {MAX_IMAGES}장 · 장당 8MB)
          </button>
          {previews.length > 0 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {previews.map((src, i) => (
                <div key={i} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-20 w-full rounded-lg object-cover object-top" />
                  {i === 0 && (
                    <span className="absolute left-1 top-1 rounded bg-violet-600 px-1 text-[9px] font-bold text-white">대표</span>
                  )}
                  <button type="button" onClick={() => removeFile(i)}
                    className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white group-hover:flex">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-400">타깃 취향:</span>
          {(
            [
              ["all", "공용"],
              ["female", "🌸 여성향"],
              ["male", "⚡ 남성향"],
            ] as const
          ).map(([value, label]) => (
            <button type="button" key={value} onClick={() => setForm({ ...form, audience: value })}
              className={`rounded-full px-3 py-1 text-sm ${form.audience === value ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400"}`}>
              {label}
            </button>
          ))}
        </div>

        <GenrePicker
          value={form.genres}
          onChange={(genres) => setForm({ ...form, genres })}
          disabled={loading}
        />

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-[#161922] p-4 transition hover:border-violet-400/25">
          <input type="checkbox" checked={form.nsfw}
            onChange={(e) => setForm({ ...form, nsfw: e.target.checked })} className="h-5 w-5 accent-violet-500" />
          <div>
            <p className="font-semibold text-zinc-100">성인용 캐릭터</p>
            <p className="text-xs text-gray-500">
              성인인증을 완료하고 ‘성인 캐릭터 표시’를 켠 사용자에게만 목록에 노출됩니다.
            </p>
          </div>
        </label>

        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button disabled={loading} className="w-full rounded-xl bg-violet-600 py-3 font-bold text-white disabled:opacity-50">
          {loading ? progress || "처리 중…" : "캐릭터 만들기"}
        </button>
      </form>
    </div>
  );
}

function Counter({ now, max }: { now: number; max: number }) {
  return (
    <span className={`text-xs ${now > max ? "font-bold text-rose-400" : "text-gray-500"}`}>
      {now.toLocaleString()} / {max.toLocaleString()}자
    </span>
  );
}
