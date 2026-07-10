"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = {
  isAdult: boolean;
  nsfwOn: boolean;
  pref: "female" | "male" | null;
  loggedIn?: boolean;
  variant?: "sidebar" | "header" | "homeBanner" | "homeRow";
};

const PREF_OPTIONS = [
  ["female", "여성향"],
  ["male", "남성향"],
  [null, "전체"],
] as const;

/** 홈 — 전체 · 여성향 · 남성향 순 */
const HOME_ROW_OPTIONS = [
  [null, "전체"],
  ["female", "여성향"],
  ["male", "남성향"],
] as const;

export type TastePref = "female" | "male" | null;

type TasteFilterDropdownProps = {
  pref: TastePref;
  busy?: boolean;
  loggedIn?: boolean;
  onSelect: (p: TastePref) => void;
  tone?: "home" | "settings";
};

export function TasteFilterButtonRow({
  pref,
  busy = false,
  loggedIn = true,
  onSelect,
}: {
  pref: TastePref;
  busy?: boolean;
  loggedIn?: boolean;
  onSelect: (p: TastePref) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="취향 필터">
      {HOME_ROW_OPTIONS.map(([value, label]) => {
        const key = value ?? "all";
        const selected = pref === value;
        return (
          <button
            key={key}
            type="button"
            disabled={busy}
            aria-pressed={selected}
            onClick={() => onSelect(value)}
            className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition disabled:opacity-50 ${
              selected
                ? "border-violet-500 bg-violet-600/20 text-violet-100 ring-1 ring-violet-500/40"
                : "border-white/10 bg-[#161922] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        );
      })}
      {!loggedIn && (
        <Link href="/login" className="text-xs font-medium text-zinc-400 transition hover:text-violet-300">
          로그인 후 저장
        </Link>
      )}
    </div>
  );
}

export function TasteFilterDropdown({
  pref,
  busy = false,
  loggedIn = true,
  onSelect,
  tone = "home",
}: TasteFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeLabel = PREF_OPTIONS.find(([value]) => value === pref)?.[1] ?? "전체";
  const activeKey = pref ?? "all";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const chipTone: Record<string, string> = {
    female: "border-pink-400/50 text-pink-200",
    male: "border-sky-400/50 text-sky-200",
    all: "border-violet-400/50 text-violet-200",
  };

  const chipClass =
    tone === "settings"
      ? `inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-50 ${chipTone[activeKey]}`
      : `inline-flex items-center gap-1.5 rounded-lg border bg-black/30 px-2.5 py-1.5 text-xs font-semibold backdrop-blur-sm transition hover:bg-black/40 disabled:opacity-50 ${chipTone[activeKey]}`;

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="홈 추천·목록에 표시할 취향을 선택합니다. 「공용」 캐릭터는 모든 취향에서 보입니다."
        onClick={() => setOpen((v) => !v)}
        className={chipClass}
      >
        <span
          className={`font-bold uppercase tracking-wide text-zinc-500 ${tone === "settings" ? "text-xs" : "text-[10px]"}`}
        >
          취향
        </span>
        <span>{activeLabel}</span>
        <span
          className={`text-zinc-500 transition ${open ? "rotate-180" : ""} ${tone === "settings" ? "text-xs" : "text-[10px]"}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="취향 필터"
          className="absolute left-0 top-full z-50 mt-1 min-w-[9rem] overflow-hidden rounded-lg border border-white/10 bg-[#1a1d2e] py-1 shadow-xl"
        >
          {PREF_OPTIONS.map(([value, label]) => {
            const key = value ?? "all";
            const selected = pref === value;
            return (
              <li key={key} role="option" aria-selected={selected}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onSelect(value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold transition ${
                    selected
                      ? "bg-violet-600/25 text-violet-100"
                      : "text-zinc-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {label}
                  {selected && <span className="text-[10px] text-violet-300">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!loggedIn && tone === "home" && (
        <Link href="/login" className="text-[11px] font-semibold text-amber-300/90 hover:text-amber-200">
          로그인 후 저장
        </Link>
      )}
    </div>
  );
}

export default function UserPreferenceControls({
  isAdult,
  nsfwOn: initialNsfw,
  pref: initialPref,
  loggedIn = true,
  variant = "sidebar",
}: Props) {
  const router = useRouter();
  const [nsfwOn, setNsfwOn] = useState(initialNsfw);
  const [pref, setPref] = useState(initialPref);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPref(initialPref);
  }, [initialPref]);

  useEffect(() => {
    setNsfwOn(initialNsfw);
  }, [initialNsfw]);

  async function patch(body: object) {
    setBusy(true);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    return res.ok;
  }

  async function toggleNsfw() {
    if (!isAdult) return router.push("/verify");
    const next = !nsfwOn;
    setNsfwOn(next);
    if (!(await patch({ nsfw_on: next }))) setNsfwOn(!next);
  }

  async function setPreference(p: TastePref) {
    if (!loggedIn) {
      router.push("/login");
      return;
    }
    const prev = pref;
    setPref(p);
    if (!(await patch({ pref: p }))) setPref(prev);
  }

  if (variant === "header") {
    return (
      <HeaderNsfwToggle
        isAdult={isAdult}
        nsfwOn={nsfwOn}
        busy={busy}
        onToggleNsfw={toggleNsfw}
      />
    );
  }

  if (variant === "homeBanner") {
    return (
      <TasteFilterDropdown
        pref={pref}
        busy={busy}
        loggedIn={loggedIn}
        onSelect={setPreference}
        tone="home"
      />
    );
  }

  if (variant === "homeRow") {
    return (
      <TasteFilterButtonRow
        pref={pref}
        busy={busy}
        loggedIn={loggedIn}
        onSelect={setPreference}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[#131626] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-zinc-300">성인 캐릭터 보기</span>
        <button
          type="button"
          onClick={toggleNsfw}
          disabled={busy}
          aria-pressed={nsfwOn}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            nsfwOn ? "bg-rose-600" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              nsfwOn ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
      {!isAdult && <p className="text-xs text-zinc-400">성인인증 후 켤 수 있어요.</p>}

      <div>
        <p className="mb-2 text-sm font-medium text-zinc-300">취향 필터</p>
        <TasteFilterDropdown pref={pref} busy={busy} onSelect={setPreference} tone="settings" />
      </div>
    </div>
  );
}

function HeaderNsfwToggle({
  isAdult,
  nsfwOn,
  busy,
  onToggleNsfw,
}: {
  isAdult: boolean;
  nsfwOn: boolean;
  busy: boolean;
  onToggleNsfw: () => void;
}) {
  return (
    <div
      className="flex min-h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#161922] px-2 py-1"
      title={isAdult ? "성인 캐릭터 보기" : "성인인증 후 사용 가능"}
    >
      <span className="text-[10px] font-semibold text-rose-400">19+</span>
      <button
        type="button"
        onClick={onToggleNsfw}
        disabled={busy || !isAdult}
        aria-pressed={nsfwOn}
        aria-label="성인 캐릭터 보기"
        className={`relative h-5 w-8 shrink-0 rounded-full transition-colors disabled:opacity-40 sm:w-9 ${
          nsfwOn ? "bg-rose-600" : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            nsfwOn ? "left-[14px] sm:left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
