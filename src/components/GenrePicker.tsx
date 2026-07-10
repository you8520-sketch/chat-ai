"use client";

import {
  CHARACTER_GENRES,
  type CharacterGenre,
  toggleCharacterGenre,
} from "@/lib/characterGenres";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type Props = {
  value: CharacterGenre[];
  onChange: (genres: CharacterGenre[]) => void;
  disabled?: boolean;
};

export default function GenrePicker({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={studioType.label}>장르</span>
        <span className={studioType.helper}>여러 개 선택 가능 · {value.length}개 선택</span>
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
              className={cn(
                "min-h-11 rounded-xl border px-2.5 text-xs font-semibold transition disabled:opacity-40 sm:text-sm",
                selected ? studioSurface.choiceActive : studioSurface.choiceIdle,
              )}
            >
              {genre}
            </button>
          );
        })}
      </div>
    </div>
  );
}
