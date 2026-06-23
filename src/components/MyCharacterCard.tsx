import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import MyCharacterCardActions from "@/components/MyCharacterCardActions";
import { moderationLabel, visibilityLabel } from "@/lib/characterVisibility";
import type { CharacterVisibility, ModerationStatus } from "@/lib/characterVisibility";

export type MyCharacterRow = CharacterRow & {
  visibility: CharacterVisibility;
  moderation_status: ModerationStatus;
  moderation_note: string;
};

type Props = {
  c: MyCharacterRow;
  blurNsfw: boolean;
};

export default function MyCharacterCard({ c, blurNsfw }: Props) {
  return (
    <div className="relative">
      <CharacterCard c={c} blurNsfw={blurNsfw} loggedIn />
      <MyCharacterCardActions
        characterId={c.id}
        characterName={c.name}
        official={c.official}
      />
      <div className="pointer-events-none absolute bottom-[3.5rem] left-2 flex flex-wrap gap-1">
        <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200">
          {visibilityLabel(c.visibility)}
        </span>
        {c.moderation_status !== "approved" && (
          <span className="rounded bg-amber-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
            {moderationLabel(c.moderation_status)}
          </span>
        )}
      </div>
      {c.moderation_status === "rejected" && c.moderation_note?.trim() && (
        <p className="mt-1 line-clamp-2 px-0.5 text-[10px] leading-snug text-amber-200/80">
          {c.moderation_note}
        </p>
      )}
    </div>
  );
}
