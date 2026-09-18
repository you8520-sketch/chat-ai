import type { OpenRouterJsonSchemaResponseFormat } from "@/lib/openRouterCompletion";
import { buildSharedEpisodicSectionJsonSchema } from "@/lib/memory/memory-episodic-shared";
import { SUGGESTED_REPLY_KINDS } from "@/lib/suggestedReplies/types";
import { collectSharedWidgetRequiredKeys } from "./prompt";
import type { PostTurnSharedInitialInput } from "./types";

export type { OpenRouterJsonSchemaResponseFormat };

/** Canonical structural owner — dynamic JSON schema for shared post-turn Luna wire. */
export const POST_TURN_SHARED_INITIAL_SCHEMA_NAME = "post_turn_shared_initial";

export type PostTurnSharedInitialSchemaStatus =
  | "ok"
  | "missing_required_section"
  | "missing_required_key"
  | "not_reached";

function stringObjectSchema(requiredKeys: readonly string[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const key of requiredKeys) {
    properties[key] = { type: "string" };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: [...requiredKeys],
    properties,
  };
}

function buildStatusWidgetSchema(input: PostTurnSharedInitialInput): Record<string, unknown> {
  const { characterKeys, userKeys } = collectSharedWidgetRequiredKeys(input);
  const required: string[] = [];
  const properties: Record<string, unknown> = {};
  if (characterKeys.length > 0) {
    required.push("character_values");
    properties.character_values = stringObjectSchema(characterKeys);
  }
  if (userKeys.length > 0) {
    required.push("user_values");
    properties.user_values = stringObjectSchema(userKeys);
  }
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function buildSuggestedRepliesSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "text"],
          properties: {
            kind: { type: "string", enum: [...SUGGESTED_REPLY_KINDS] },
            text: { type: "string" },
          },
        },
      },
    },
  };
}

function buildRelationshipSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items", "itemsRemove", "promisesAdd", "promisesRemove"],
    properties: {
      items: { type: "array", items: { type: "string" } },
      itemsRemove: { type: "array", items: { type: "string" } },
      promisesAdd: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "deadline"],
          properties: {
            text: { type: "string" },
            deadline: { type: "string" },
          },
        },
      },
      promisesRemove: { type: "array", items: { type: "string" } },
    },
  };
}

/** Build provider-native strict JSON schema for the shared post-turn response envelope. */
export function buildPostTurnSharedInitialJsonSchema(
  input: PostTurnSharedInitialInput
): Record<string, unknown> {
  const required: string[] = [];
  const properties: Record<string, unknown> = {};

  if (input.mode !== "relationship_only") {
    required.push("statusWidget");
    properties.statusWidget = buildStatusWidgetSchema(input);
  }
  if (input.includeSuggestions) {
    required.push("suggestedReplies");
    properties.suggestedReplies = buildSuggestedRepliesSchema();
  }
  if (input.includeRelationship) {
    required.push("relationship");
    properties.relationship = buildRelationshipSchema();
  }
  if (input.includeEpisodic) {
    required.push("episodic");
    properties.episodic = buildSharedEpisodicSectionJsonSchema();
  }

  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

export function buildPostTurnSharedInitialResponseFormat(
  input: PostTurnSharedInitialInput
): OpenRouterJsonSchemaResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: POST_TURN_SHARED_INITIAL_SCHEMA_NAME,
      strict: true,
      schema: buildPostTurnSharedInitialJsonSchema(input),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasStringValue(section: Record<string, unknown>, key: string): boolean {
  const value = section[key];
  return typeof value === "string";
}

/** Client-side structural validation — mirrors wire schema without logging value bodies. */
export function validatePostTurnSharedInitialStructure(
  root: Record<string, unknown> | null,
  input: PostTurnSharedInitialInput
): PostTurnSharedInitialSchemaStatus {
  if (!root) return "not_reached";

  if (input.mode !== "relationship_only" && !("statusWidget" in root)) {
    return "missing_required_section";
  }
  if (input.includeSuggestions && !("suggestedReplies" in root)) {
    return "missing_required_section";
  }
  if (input.includeRelationship && !("relationship" in root)) {
    return "missing_required_section";
  }
  if (input.includeEpisodic && !("episodic" in root)) {
    return "missing_required_section";
  }

  const { characterKeys, userKeys } = collectSharedWidgetRequiredKeys(input);

  if (input.mode !== "relationship_only") {
    const statusWidget = asRecord(root.statusWidget);
    if (!statusWidget) return "missing_required_section";
    if (characterKeys.length > 0) {
      const characterValues = asRecord(statusWidget.character_values);
      if (!characterValues) return "missing_required_section";
      for (const key of characterKeys) {
        if (!hasStringValue(characterValues, key)) {
          return "missing_required_key";
        }
      }
    }
    if (userKeys.length > 0) {
      const userValues = asRecord(statusWidget.user_values);
      if (!userValues) return "missing_required_section";
      for (const key of userKeys) {
        if (!hasStringValue(userValues, key)) {
          return "missing_required_key";
        }
      }
    }
  }

  return "ok";
}

/** @internal tests — required dynamic keys appear in wire schema. */
export function sharedSchemaListsAllRequiredKeys(input: PostTurnSharedInitialInput): boolean {
  const schema = buildPostTurnSharedInitialJsonSchema(input);
  const schemaText = JSON.stringify(schema);
  const { characterKeys, userKeys } = collectSharedWidgetRequiredKeys(input);
  for (const key of [...characterKeys, ...userKeys]) {
    if (!schemaText.includes(JSON.stringify(key))) return false;
  }
  if (input.mode === "relationship_only") return true;
  return characterKeys.length + userKeys.length > 0;
}

type StrictSchemaIssue = { path: string; message: string };

/** @internal tests — verify strict json_schema shape (every property listed in required). */
export function collectStrictJsonSchemaIssues(
  node: unknown,
  path = "$"
): StrictSchemaIssue[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  const obj = node as Record<string, unknown>;
  const issues: StrictSchemaIssue[] = [];

  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    const properties = obj.properties as Record<string, unknown>;
    const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
    for (const key of Object.keys(properties)) {
      if (!required.includes(key)) {
        issues.push({
          path: `${path}.properties.${key}`,
          message: "strict schema requires every property in required[]",
        });
      }
    }
    for (const [key, value] of Object.entries(properties)) {
      issues.push(...collectStrictJsonSchemaIssues(value, `${path}.properties.${key}`));
    }
  }

  if (obj.type === "array" && obj.items) {
    issues.push(...collectStrictJsonSchemaIssues(obj.items, `${path}.items`));
  }

  return issues;
}

export function assertProductionStrictJsonSchemaValid(schema: Record<string, unknown>): void {
  const issues = collectStrictJsonSchemaIssues(schema);
  if (issues.length > 0) {
    throw new Error(
      `invalid strict production schema: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`
    );
  }
}
