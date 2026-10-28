import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import MyCharacterCardActions from "@/components/MyCharacterCardActions";
import { StudioWorkNotice, StudioWorkStatus } from "@/components/studio/StudioWorkMeta";
import type { CharacterVisibility, ModerationStatus } from "@/lib/characterVisibility";

export type MyCharacterRow = CharacterRow & {
  visibility: CharacterVisibility;
  moderation_status: ModerationStatus;
  moderation_note: string;
};

type Props = {
  c: MyCharacterRow;
  blurNsfw: boolean;
  editHref?: string;
  contentLabel?: string;
  /** Viewer is the card owner; when admin, image-less private drafts get a non-misleading chip. */
  ownerIsAdmin?: boolean;
};

export default function MyCharacterCard({ c, blurNsfw, editHref, contentLabel, ownerIsAdmin = false }: Props) {
  return (
    <div
      className="row-span-3 grid grid-rows-subgrid gap-y-2.5"
      data-testid="studio-work-card"
      data-work-kind={c.content_kind === "simulation" ? "simulation" : "character"}
      data-visibility={c.visibility}
      data-moderation={c.moderation_status}
    >
      <div className="min-w-0">
        <CharacterCard c={c} blurNsfw={blurNsfw} loggedIn />
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <StudioWorkStatus
          isSimulation={c.content_kind === "simulation"}
          visibility={c.visibility}
          moderation={c.moderation_status}
          ownerIsAdmin={ownerIsAdmin}
          official={c.official}
          assets={c.assets}
          images={c.images}
        />
        <StudioWorkNotice moderation={c.moderation_status} note={c.moderation_note ?? ""} />
      </div>
      <div className="min-w-0 pb-6">
        <MyCharacterCardActions
          characterId={c.id}
          characterName={c.name}
          official={c.official}
          editHref={editHref}
          contentLabel={contentLabel}
        />
      </div>
    </div>
  );
}
