export const USER_AUTHORING_LEVELS = ["LIMITED", "NORMAL", "ALLOW"] as const;
export type UserAuthoringLevel = (typeof USER_AUTHORING_LEVELS)[number];

export const DEFAULT_USER_AUTHORING_LEVEL: UserAuthoringLevel = "LIMITED";
export const USER_AUTHORING_LEVEL_COLUMN = "user_authoring_level";

export type UserAuthoringCapabilities = {
  allowDialogue: boolean;
  allowMajorActions: boolean;
  allowInnerPov: boolean;
  allowIrreversibleFate: boolean;
};

export const LIMITED_USER_AUTHORING_CAPABILITIES: UserAuthoringCapabilities = {
  allowDialogue: false,
  allowMajorActions: false,
  allowInnerPov: false,
  allowIrreversibleFate: false,
};

export function parseUserAuthoringLevel(raw: unknown): UserAuthoringLevel {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "NORMAL" || value === "ALLOW") return value;
  return "LIMITED";
}

export function capabilitiesFromUserAuthoringLevel(
  level: UserAuthoringLevel
): UserAuthoringCapabilities {
  switch (parseUserAuthoringLevel(level)) {
    case "LIMITED":
      return { ...LIMITED_USER_AUTHORING_CAPABILITIES };
    case "NORMAL":
      return {
        allowDialogue: true,
        allowMajorActions: true,
        allowInnerPov: false,
        allowIrreversibleFate: false,
      };
    case "ALLOW":
      return {
        allowDialogue: true,
        allowMajorActions: true,
        allowInnerPov: true,
        allowIrreversibleFate: false,
      };
  }
}
