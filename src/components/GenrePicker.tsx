"use client";

import {
  CHARACTER_GENRES,
  type CharacterGenre,
  toggleCharacterGenre,
} from "@/lib/characterGenres";

type Props = {
  value: CharacterGenre[];
  onChange: (genres: CharacterGenre[]) => void;
  disabled?: boolean;
};

export default function GenrePicker({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-400">장르</span>
        <span className="text-[11px] text-gray-600">여러 개 선택 가능 · {value.length}개 선택</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {CHARACTER_GENRES.map((genre) => {
          const selected = value.includes(genre);
          return (
            <button
              type="button"
              key={genre}
              disabled={disabled}
              onClick={() => onChange(toggleCharacterGenre(value, genre))}
              className={`rounded-xl border px-2.5 py-2.5 text-xs font-semibold transition disabled:opacity-40 sm:text-sm ${
                selected
                  ? "border-violet-500 bg-violet-600/25 text-violet-200 ring-1 ring-violet-500/50"
                  : "border-white/10 bg-[#0e1120] text-gray-400 hover:border-white/20 hover:text-gray-200"
              }`}
            >
              {genre}
            </button>
          );
        })}
      </div>
    </div>
  );
}
