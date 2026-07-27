import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { isPersonaSecretBoundaryEnabled } from "@/lib/personaSecretBoundaryPolicy";
import { compilePersonaSecretsDeterministic } from "@/lib/personaSecretCompilerDeterministic";
import {
  applyPersonaSecretCompilation,
  findSuccessfulCompilationRun,
  listExistingPersonaSecrets,
  recordFailedCompilationRun,
} from "@/lib/personaSecretCompilerApply";
import { PERSONA_SECRET_COMPILER_VERSION } from "@/lib/personaSecretCompilerCatalog";
import { diffCompiledPersonaSecrets } from "@/lib/personaSecretCompilerDiff";
import type {
  PersonaSecretCompileApplyResult,
  PersonaSecretCompilerResult,
} from "@/lib/personaSecretCompilerTypes";
import { validatePersonaSecretCompilerResult } from "@/lib/personaSecretCompilerValidate";
import { PERSONA_SECRET_CONTENT_MAX } from "@/lib/persona";

export function hashPersonaSecretSource(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export type CompilePersonaSecretsOptions = {
  personaId: number;
  source: string;
  /** Force recompile even if cache hit. */
  force?: boolean;
  db?: Database.Database;
  userId?: number | null;
};

/**
 * Owner-side Secret Compiler orchestration (PR-S1.5).
 * Never throws secret source into logs — callers must not log `source`.
 *
 * Failure: records failed run, leaves prior persona_secrets/knowledge untouched.
 */
export function compileAndApplyPersonaSecrets(
  opts: CompilePersonaSecretsOptions
): PersonaSecretCompileApplyResult {
  if (!isPersonaSecretBoundaryEnabled({ userId: opts.userId })) {
    return {
      ok: false,
      errorCode: "BOUNDARY_OFF",
      preservedPrior: true,
    };
  }

  const source = typeof opts.source === "string" ? opts.source : "";
  const trimmed = source.trim();
  const sourceHash = hashPersonaSecretSource(source);

  // Empty source: do not invent; leave prior compilation intact.
  if (!trimmed) {
    return {
      ok: false,
      errorCode: "EMPTY_SOURCE",
      preservedPrior: true,
    };
  }

  if (trimmed.length > PERSONA_SECRET_CONTENT_MAX) {
    recordFailedCompilationRun({
      personaId: opts.personaId,
      sourceHash,
      errorCode: "SOURCE_TOO_LONG",
      db: opts.db,
    });
    return {
      ok: false,
      errorCode: "SOURCE_TOO_LONG",
      preservedPrior: true,
    };
  }

  if (!opts.force) {
    const cached = findSuccessfulCompilationRun({
      personaId: opts.personaId,
      sourceHash,
      compilerVersion: PERSONA_SECRET_COMPILER_VERSION,
      db: opts.db,
    });
    if (cached?.result_json) {
      try {
        const parsed = JSON.parse(cached.result_json) as PersonaSecretCompilerResult;
        const schema = validatePersonaSecretCompilerResult(parsed, source);
        if (schema.ok) {
          return {
            ok: true,
            reused: true,
            secretCount: schema.result.secrets.length,
            titles: schema.result.secrets.map((s) => s.title),
            needsReview: schema.result.secrets.some((s) => s.needsReview),
            warnings: [...schema.result.warnings, "reused_compilation_run"],
            runId: cached.id,
            diffWarnings: [],
          };
        }
      } catch {
        // fall through to recompile
      }
    }
  }

  let result: PersonaSecretCompilerResult;
  try {
    result = compilePersonaSecretsDeterministic(source);
  } catch {
    recordFailedCompilationRun({
      personaId: opts.personaId,
      sourceHash,
      errorCode: "COMPILER_THROW",
      db: opts.db,
    });
    return {
      ok: false,
      errorCode: "COMPILER_THROW",
      preservedPrior: true,
    };
  }

  const validated = validatePersonaSecretCompilerResult(result, source);
  if (!validated.ok) {
    recordFailedCompilationRun({
      personaId: opts.personaId,
      sourceHash,
      errorCode: validated.errorCode,
      db: opts.db,
    });
    return {
      ok: false,
      errorCode: validated.errorCode,
      preservedPrior: true,
    };
  }

  const existing = listExistingPersonaSecrets(opts.personaId, opts.db);
  const diff = diffCompiledPersonaSecrets(existing, validated.result.secrets);

  try {
    const { runId } = applyPersonaSecretCompilation({
      personaId: opts.personaId,
      sourceHash,
      resultJson: JSON.stringify(validated.result),
      diff,
      db: opts.db,
    });
    return {
      ok: true,
      reused: false,
      secretCount: validated.result.secrets.length,
      titles: validated.result.secrets.map((s) => s.title),
      needsReview: validated.result.secrets.some((s) => s.needsReview),
      warnings: [...validated.result.warnings, ...diff.warnings],
      runId,
      diffWarnings: diff.warnings,
    };
  } catch {
    recordFailedCompilationRun({
      personaId: opts.personaId,
      sourceHash,
      errorCode: "APPLY_TX_FAIL",
      db: opts.db,
    });
    return {
      ok: false,
      errorCode: "APPLY_TX_FAIL",
      preservedPrior: true,
    };
  }
}

/** Public DTO fragment for persona save responses (no secret source). */
export type PersonaSecretCompileSummaryDto = {
  compiledSecretCount: number;
  titles: string[];
  needsReview: boolean;
  reused: boolean;
  warnings: string[];
};

export function toCompileSummaryDto(
  result: PersonaSecretCompileApplyResult
): PersonaSecretCompileSummaryDto | null {
  if (!result.ok) return null;
  return {
    compiledSecretCount: result.secretCount,
    titles: result.titles,
    needsReview: result.needsReview,
    reused: result.reused,
    warnings: result.warnings.filter((w) => !w.startsWith("key_remap")),
  };
}
