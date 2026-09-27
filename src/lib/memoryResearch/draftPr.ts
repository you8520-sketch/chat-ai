/**
 * Draft PR creation for ACCEPTED packets only. Creates a branch off the exact
 * cycle main SHA, commits the evidence packet under docs/memory-research/,
 * and opens a DRAFT PR via `gh pr create --draft`. Never merges, never enables
 * auto-merge, never touches production memory owners.
 */
import { HEAD_PLACEHOLDER, missingPacketSections, type DraftPrPacket } from "@/lib/memoryResearch/prPacket";
import type { DraftPrResult } from "@/lib/memoryResearch/ledger";

export type CommandRunner = (command: string, args: readonly string[]) => string;

export type FileWriter = (path: string, contents: string) => void;

const FORBIDDEN_ARGS = ["merge", "--auto", "--admin", "ready", "--force", "-f"];

export function packetPath(packet: DraftPrPacket): string {
  return `docs/memory-research/accepted/${packet.branch.replace(/^memory-research\/accepted-/, "")}.md`;
}

export function assertDraftOnlyCommand(command: string, args: readonly string[]): void {
  if (command !== "git" && command !== "gh") throw new Error(`unexpected command ${command}`);
  for (const arg of args) {
    if (FORBIDDEN_ARGS.includes(arg)) throw new Error(`forbidden argument in Draft PR path: ${command} ${args.join(" ")}`);
  }
  if (command === "gh" && args[0] === "pr" && args[1] === "create" && !args.includes("--draft")) {
    throw new Error("gh pr create must always pass --draft");
  }
  if (command === "gh" && args[0] === "pr" && !["create", "list"].includes(args[1] ?? "")) {
    throw new Error(`only gh pr create/list are allowed (got gh pr ${args[1]})`);
  }
}

export function validatePacketForDraftPr(packet: DraftPrPacket): void {
  if (packet.decision !== "ACCEPTED_QUALITY_GAIN") throw new Error(`packet ${packet.candidateKey} is not ACCEPTED`);
  if (!/^[0-9a-f]{40}$/.test(packet.mainSha)) throw new Error(`packet ${packet.candidateKey} lacks an exact main SHA`);
  const missing = missingPacketSections(packet.body);
  if (missing.length > 0) throw new Error(`packet ${packet.candidateKey} incomplete: ${missing.join(", ")}`);
}

export function openDraftPrs(
  packets: readonly DraftPrPacket[],
  run: CommandRunner,
  writeFile: FileWriter,
  opts: { tempDir: string; baseBranch?: string }
): DraftPrResult[] {
  const baseBranch = opts.baseBranch ?? "main";
  const exec = (command: string, args: readonly string[]) => {
    assertDraftOnlyCommand(command, args);
    return run(command, args).trim();
  };
  const results: DraftPrResult[] = [];
  for (const packet of packets) {
    try {
      validatePacketForDraftPr(packet);
      const existing = exec("gh", ["pr", "list", "--head", packet.branch, "--state", "open", "--json", "url", "--jq", ".[0].url // \"\""]);
      if (existing) {
        results.push({ candidateKey: packet.candidateKey, url: existing, error: null });
        continue;
      }
      exec("git", ["checkout", "--detach", packet.mainSha]);
      exec("git", ["checkout", "-B", packet.branch]);
      const file = packetPath(packet);
      writeFile(file, packet.body.replace(HEAD_PLACEHOLDER, "(this PR's head commit — see PR body)"));
      exec("git", ["add", file]);
      exec("git", ["commit", "-m", `docs(memory-research): ACCEPTED evidence packet for ${packet.candidateKey}`]);
      const head = exec("git", ["rev-parse", "HEAD"]);
      exec("git", ["push", "origin", `HEAD:refs/heads/${packet.branch}`]);
      const bodyFile = `${opts.tempDir}/${packet.branch.replace(/[^a-z0-9-]+/gi, "_")}.pr-body.md`;
      writeFile(bodyFile, packet.body.replace(HEAD_PLACEHOLDER, head));
      const url = exec("gh", [
        "pr",
        "create",
        "--draft",
        "--base",
        baseBranch,
        "--head",
        packet.branch,
        "--title",
        packet.title,
        "--body-file",
        bodyFile,
      ]);
      results.push({ candidateKey: packet.candidateKey, url, error: null });
    } catch (error) {
      results.push({
        candidateKey: packet.candidateKey,
        url: null,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
    }
  }
  return results;
}
