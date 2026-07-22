import type { GeneratedProfile } from "@/lib/generateProfile";
import type { CharacterGenre } from "@/lib/characterGenres";
import type { CharacterGender } from "@/lib/characterGender";
import type { CharacterAsset } from "@/lib/characterAssets";
import type { SpeechContextualRegister } from "@/lib/speechCreatorFields";

const STORAGE_PREFIX = "hobbyai.characterCreateDraft.v1";

export type CharacterCreateDraft = {
  savedAt: number;
  form: {
    name: string;
    tagline: string;
    description: string;
    greeting: string;
    system_prompt: string;
    world: string;
    speech_personality: string;
    speech_traits: string;
    speech_examples: string;
    speech_forbidden: string;
    speech_contextual_registers?: SpeechContextualRegister[];
    status_window_prompt: string;
    genres: CharacterGenre[];
    tags: string[];
    nsfw: boolean;
    emoji: string;
    hue: number;
    audience: string;
    gender: "" | CharacterGender;
    visibility: "public" | "link" | "private";
    recommended_writing_style: string;
    comments_enabled: boolean;
    creator_comment: string;
    /** Optional for drafts created before simulation reuse permissions. */
    simulation_reuse_allowed?: boolean;
    simulation_nsfw_allowed?: boolean;
  };
  assets: CharacterAsset[];
  selectedWorldId: number | "";
  selectedLorebookId: number | "";
  /** @deprecated legacy draft field — ignored */
  statusWindowSystemEnabled?: boolean;
  pageTab?: "create" | "preview" | "widget" | "publish";
  /** @deprecated 이전 임시저장 호환 */
  rawDraft?: string;
  /** @deprecated 이전 임시저장 호환 */
  generatedProfile?: GeneratedProfile | null;
};

export function characterCreateDraftKey(userId: number, editCharacterId: number | null): string {
  return `${STORAGE_PREFIX}:${userId}:${editCharacterId ?? "new"}`;
}

export function loadCharacterCreateDraft(
  userId: number,
  editCharacterId: number | null
): CharacterCreateDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(characterCreateDraftKey(userId, editCharacterId));
    if (!raw) return null;
    return JSON.parse(raw) as CharacterCreateDraft;
  } catch {
    return null;
  }
}

export function saveCharacterCreateDraft(
  userId: number,
  editCharacterId: number | null,
  draft: CharacterCreateDraft
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(characterCreateDraftKey(userId, editCharacterId), JSON.stringify(draft));
  } catch {
    /* ignore quota */
  }
}

export function clearCharacterCreateDraft(userId: number, editCharacterId: number | null): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(characterCreateDraftKey(userId, editCharacterId));
  } catch {
    /* ignore */
  }
}

export function formatDraftSavedAt(ms: number): string {
  return new Date(ms).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
