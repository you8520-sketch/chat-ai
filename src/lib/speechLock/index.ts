export type {
  SpeechProfile,
  SpeechFormality,
  VocabularyStyle,
  SocialClass,
  EraStyle,
  SpeechViolation,
  SpeechViolationType,
  SpeechValidationResult,
} from "./types";

export {
  deriveSpeechProfile,
  parseStoredSpeechProfile,
  serializeSpeechProfile,
  type DeriveSpeechProfileInput,
} from "./deriveProfile";

export { buildSpeechRewriteUserMessage } from "./prompts";

export {
  validateSpeechLock,
  interceptSpeechLock,
  extractCharacterDialogue,
} from "./validator";

export { GLOBAL_FORBIDDEN_SPEECH } from "./patterns";
