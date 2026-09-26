import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const TERMS = [
  "resolveUserImpersonationAllowance",
  "resolveUserImpersonationFromNote",
  "buildOocCoNarrationHint",
  "userImpersonation",
] as const;

type Hit = { path: string; terms: string[] };

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        visit(full);
        continue;
      }
      if (!CODE_EXTENSIONS.has(path.extname(name))) continue;
      out.push(full.replaceAll("\\", "/"));
    }
  };
  visit(root);
  return out.sort();
}

function scan(files: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const terms = TERMS.filter((term) => {
      if (term === "userImpersonation") {
        return /\buserImpersonation\b/.test(source);
      }
      return source.includes(term);
    });
    if (terms.length > 0) hits.push({ path: file, terms: [...terms] });
  }
  return hits;
}

describe("legacy user-impersonation compatibility boundary", () => {
  it("keeps production compatibility references constrained to the canonical fallback owner", () => {
    const actual = scan(walk("src"));
    assert.deepEqual(actual, [
      {
        path: "src/lib/userImpersonationPolicy.ts",
        terms: [
          "resolveUserImpersonationAllowance",
          "resolveUserImpersonationFromNote",
          "buildOocCoNarrationHint",
        ],
      },
      {
        path: "src/services/contextBuilder.ts",
        terms: ["buildOocCoNarrationHint", "userImpersonation"],
      },
      {
        path: "src/types.ts",
        terms: ["userImpersonation"],
      },
    ]);
  });

  it("does not let dev scripts silently depend on the retired production compatibility API", () => {
    assert.deepEqual(scan(walk("scripts")), []);
  });
});
