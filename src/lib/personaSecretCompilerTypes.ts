import type {
  CompilerCategory,
  CompilerDiscoveryMethod,
  CompilerEvidenceKind,
  CompilerImportance,
} from "@/lib/personaSecretCompilerCatalog";

export type CompiledDiscoveryRule = {
  method: CompilerDiscoveryMethod;
  ruleKey: string;
  resultState: "SUSPECTED" | "CONFIRMED";
  revealedFactText: string;
  evidenceKinds: CompilerEvidenceKind[];
  /** Dormant until S2/S3 runtime enables the method. */
  dormant: boolean;
  conditions: Record<string, unknown>;
};

export type CompiledPersonaSecret = {
  sourceQuotes: string[];
  semanticKey: string;
  title: string;
  category: CompilerCategory;
  canonicalSecretText: string;
  suspectedFactText: string;
  confirmedFactText: string;
  importance: CompilerImportance;
  directDisclosureAliases: string[];
  discoveryRules: CompiledDiscoveryRule[];
  dependencies: string[];
  confidence: number;
  needsReview: boolean;
  warnings: string[];
};

export type PersonaSecretCompilerResult = {
  schemaVersion: number;
  compilerVersion: number;
  secrets: CompiledPersonaSecret[];
  unresolvedFragments: string[];
  warnings: string[];
};

export type CompilerValidationFailure = {
  ok: false;
  errorCode: string;
  message: string;
};

export type CompilerValidationSuccess = {
  ok: true;
  result: PersonaSecretCompilerResult;
};

export type CompilerValidationResult =
  | CompilerValidationSuccess
  | CompilerValidationFailure;

export type SecretDiffAction =
  | { kind: "keep"; existingId: string; compiled: CompiledPersonaSecret }
  | { kind: "update"; existingId: string; compiled: CompiledPersonaSecret }
  | { kind: "create"; compiled: CompiledPersonaSecret }
  | { kind: "inactivate"; existingId: string; reason: string };

export type SecretStableDiff = {
  actions: SecretDiffAction[];
  warnings: string[];
};

export type PersonaSecretCompileApplyResult =
  | {
      ok: true;
      reused: boolean;
      secretCount: number;
      needsReview: boolean;
      titles: string[];
      warnings: string[];
      runId: string;
      diffWarnings: string[];
    }
  | {
      ok: false;
      errorCode: string;
      preservedPrior: true;
    };

/** @deprecated Prefer PersonaSecretCompileApplyResult */
export type CompileAndApplyOutcome = PersonaSecretCompileApplyResult;
