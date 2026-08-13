import { resolveCharacterGender, type CharacterGender } from "@/lib/characterGender";
import {
  ensureDefaultPublicPersona,
  formatSelectedPersonaForPrompt,
  validatePersonaSelection,
} from "@/lib/userPersonas";
import { parseJson } from "./store";

export type TrpgHumanPersona = {
  personaId: number;
  name: string;
  description: string;
  gender: CharacterGender;
  speechExamples: string;
};

export function parseHumanPersona(raw: string | null | undefined): TrpgHumanPersona | null {
  const parsed = parseJson(raw, null as Record<string, unknown> | null);
  if (!parsed || typeof parsed !== "object") return null;
  const personaId = Number(parsed.personaId);
  if (!Number.isInteger(personaId) || personaId <= 0) return null;
  return {
    personaId,
    name: String(parsed.name ?? "").trim(),
    description: String(parsed.description ?? ""),
    gender: resolveCharacterGender(parsed.gender),
    speechExamples: String(parsed.speechExamples ?? parsed.speech_examples ?? ""),
  };
}

export function resolveTrpgHumanPersona(
  userId: number,
  nickname: string,
  personaId?: number | null
): TrpgHumanPersona {
  const personas = ensureDefaultPublicPersona(userId, nickname);
  const requested = personaId != null && Number.isInteger(personaId) && personaId > 0 ? personaId : null;
  const picked =
    requested != null
      ? validatePersonaSelection(personas, requested)
      : { ok: true as const, persona: personas[0] };
  const persona = picked.ok ? picked.persona : picked.fallbackPersona ?? personas[0];
  if (!persona) {
    return {
      personaId: 0,
      name: nickname.trim().slice(0, 40) || "플레이어",
      description: "",
      gender: "other",
      speechExamples: "",
    };
  }
  return {
    personaId: persona.id,
    name: persona.name.trim().slice(0, 40) || nickname.trim().slice(0, 40) || "플레이어",
    description: persona.description ?? "",
    gender: persona.gender ?? "other",
    speechExamples: persona.speech_examples ?? "",
  };
}

export function formatTrpgPlayerPersonaBlock(p: TrpgHumanPersona, participantId: number): string {
  const identity =
    formatSelectedPersonaForPrompt(p.name, p.gender, p.description) ??
    (p.name.trim() ? `이름/호칭: ${p.name.trim()}` : "");
  const speech = p.speechExamples.trim();
  return [
    `[PLAYER PERSONA participantId=${participantId} name=${p.name || "플레이어"}]`,
    identity,
    speech ? `[말투 예시]\n${speech}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
