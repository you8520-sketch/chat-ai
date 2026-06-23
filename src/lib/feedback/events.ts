export const PREFERENCE_EVENT = {
  REGENERATE: "regenerate",
  VARIANT_SWITCH: "variant_switch",
  FEEDBACK_LIKE: "feedback_like",
  FEEDBACK_DISLIKE: "feedback_dislike",
  FEEDBACK_CLEAR: "feedback_clear",
  BOOKMARK_ADD: "bookmark_add",
  BOOKMARK_REMOVE: "bookmark_remove",
  MESSAGE_EDIT: "message_edit",
} as const;

export type PreferenceEventType = (typeof PREFERENCE_EVENT)[keyof typeof PREFERENCE_EVENT];
