import type { SceneDialogue, SceneDialogueSpeaker } from "@/lib/chatImageScenePlan";

export type DialogueSpeakerChoice = {
  value: SceneDialogueSpeaker;
  label: string;
  speakerName?: string;
};

export function dialogueSpeakerChoiceKey(
  speaker: SceneDialogueSpeaker,
  speakerName?: string
): string {
  return `${speaker}:${speakerName ?? ""}`;
}

/** Map canonical SceneDialogue to a select option key that matches buildDialogueSpeakerOptions. */
export function resolveDialogueSpeakerOptionKey(
  line: Pick<SceneDialogue, "speaker" | "speakerName">,
  personaName: string,
  characterName: string
): string {
  const persona = personaName.trim();
  const character = characterName.trim();
  if (line.speaker === "persona") {
    if (!line.speakerName || (persona && line.speakerName.trim() === persona)) {
      return dialogueSpeakerChoiceKey("persona");
    }
  }
  if (line.speaker === "character") {
    if (!line.speakerName || (character && line.speakerName.trim() === character)) {
      return dialogueSpeakerChoiceKey("character");
    }
  }
  return dialogueSpeakerChoiceKey(line.speaker, line.speakerName);
}

export function buildDialogueSpeakerOptions(opts: {
  personaName: string;
  characterName: string;
  castSpeakerNames?: readonly string[];
  canonicalSpeakerNames?: readonly string[];
  personaVisible: boolean;
  includeOther: boolean;
}): DialogueSpeakerChoice[] {
  const options: DialogueSpeakerChoice[] = [];
  const seen = new Set<string>();
  const pushPrimary = (value: "persona" | "character", label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = `${value}:`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ value, label: trimmed, speakerName: undefined });
  };
  const pushNamedOther = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = `other:${trimmed.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ value: "other", label: trimmed, speakerName: trimmed });
  };

  if (opts.personaVisible) {
    pushPrimary("persona", opts.personaName);
  }
  pushPrimary("character", opts.characterName);
  for (const name of opts.castSpeakerNames ?? []) {
    if (
      name.trim() &&
      name.trim() !== opts.personaName.trim() &&
      name.trim() !== opts.characterName.trim()
    ) {
      pushNamedOther(name);
    }
  }
  for (const name of opts.canonicalSpeakerNames ?? []) {
    if (
      name.trim() &&
      name.trim() !== opts.personaName.trim() &&
      name.trim() !== opts.characterName.trim()
    ) {
      pushNamedOther(name);
    }
  }
  if (opts.includeOther) {
    const key = "other:";
    if (!seen.has(key)) {
      seen.add(key);
      options.push({
        value: "other",
        label: "기타",
        speakerName: undefined,
      });
    }
  }
  return options;
}

export function dialogueSpeakerChoiceFromKey(
  key: string,
  choices: readonly DialogueSpeakerChoice[]
): DialogueSpeakerChoice | undefined {
  return choices.find(
    (choice) => dialogueSpeakerChoiceKey(choice.value, choice.speakerName) === key
  );
}

export function resolveDialogueSpeakerDisplayLabel(
  speaker: SceneDialogueSpeaker,
  personaName: string,
  characterName: string,
  speakerName?: string
): string {
  if (speakerName?.trim()) return speakerName.trim();
  if (speaker === "persona") return personaName.trim() || "유저캐";
  if (speaker === "character") return characterName.trim() || "캐릭터";
  return "기타";
}
