import { parseTrpgGmOutput } from "../gmPrompt";
import { applyStoryPhaseTransition, isAllowedStoryPhaseTransition, isTrpgStoryPhase } from "../scenarioPlan";
import { applyValidatedStateDelta } from "../sheetView";
import type { QualityFinding, QualityReport, ThinkingBenchCase } from "./types";

const NARRATION_OPEN = "<<<NARRATION>>>";
const DELTA_OPEN = "<<<DELTA>>>";

const SUCCESS_TIERS = new Set(["PARTIAL_SUCCESS", "SUCCESS", "GREAT_SUCCESS", "CRITICAL_SUCCESS"]);
const FAIL_TIERS = new Set(["CRITICAL_FAILURE", "SEVERE_FAILURE", "FAILURE"]);

const FAIL_PHRASE =
  /실패했|실패다|실패로|허사였|허사다|빗나갔|놓쳤다|통하지 않|막혀 버렸|하지 못했다|먹히지 않|소용없/;
const SUCCESS_PHRASE =
  /성공했|성공이다|해냈다|제압했|열었다|맞혔|뚫었|막아냈다|봉인했|제압에 성공/;

const AGENCY_COMMIT =
  /항복한다|죽이겠다|계약을 맺|배신한다|코어를 폭파|모두를 버린다|총으로 쏜다/;

function findings(...rows: Array<QualityFinding | null | undefined>): QualityFinding[] {
  return rows.filter((row): row is QualityFinding => Boolean(row));
}

function hasHangul(text: string): boolean {
  return /[\uAC00-\uD7A3]/.test(text);
}

function paragraphsAroundName(narration: string, name: string): string {
  const sentences = narration
    .split(/(?<=다\.|요\.|다\n|요\n|!\s|\?\s|\n)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.filter((part) => part.includes(name)).join("\n");
}

function firstIndex(text: string, name: string): number {
  return text.indexOf(name);
}

function deltaJsonLooksPresent(raw: string): boolean {
  const at = raw.indexOf(DELTA_OPEN);
  if (at < 0) return raw.trim().startsWith("{");
  const slice = raw.slice(at + DELTA_OPEN.length).trim();
  return slice.startsWith("{") || slice.startsWith("```");
}

export function evaluateThinkingBenchOutput(opts: {
  fixture: ThinkingBenchCase;
  rawText: string;
}): QualityReport {
  const raw = opts.rawText ?? "";
  const hasNar = raw.includes(NARRATION_OPEN);
  const hasDelta = deltaJsonLooksPresent(raw);
  const parsed = parseTrpgGmOutput(raw);
  const fallbackNar = parsed.narration === "장면이 잠시 멈췄다. 다음 행동을 고르라.";
  const narrationPresent = Boolean(parsed.narration.trim()) && !fallbackNar && hasHangul(parsed.narration);
  const parseSuccess = (hasNar || hasDelta) && narrationPresent && hasDelta;
  const applied = applyValidatedStateDelta(opts.fixture.sheets, parsed.delta);

  return {
    parseSuccess,
    narrationPresent,
    deltaValid: applied.ok,
    diceContradictions: measureDice(opts.fixture, parsed.narration),
    actionOmissions: measureCoverage(opts.fixture, parsed.narration),
    agencyErrors: measureAgency(opts.fixture, parsed.narration),
    stateErrors: measureState(opts.fixture, parsed, applied),
    scenarioErrors: measureScenario(opts.fixture, parsed),
    initiativeErrors: measureInitiative(opts.fixture, parsed.narration),
  };
}

function measureDice(fixture: ThinkingBenchCase, narration: string): QualityFinding[] {
  const out: QualityFinding[] = [];
  for (const action of fixture.actions) {
    if (!action.tier) continue;
    const window = paragraphsAroundName(narration, action.name);
    if (SUCCESS_TIERS.has(action.tier) && FAIL_PHRASE.test(window)) {
      out.push({
        code: "dice_success_as_failure",
        detail: `${action.name} ${action.tier} inverted toward failure`,
      });
    }
    if (FAIL_TIERS.has(action.tier) && SUCCESS_PHRASE.test(window) && !FAIL_PHRASE.test(window)) {
      out.push({
        code: "dice_failure_as_success",
        detail: `${action.name} ${action.tier} inverted toward success`,
      });
    }
  }
  return out;
}

function measureCoverage(fixture: ThinkingBenchCase, narration: string): QualityFinding[] {
  return findings(
    ...fixture.expectedNames.map((name) =>
      narration.includes(name)
        ? null
        : { code: "action_omission", detail: `${name} missing from narration` }
    )
  );
}

function measureAgency(fixture: ThinkingBenchCase, narration: string): QualityFinding[] {
  const out: QualityFinding[] = [];
  for (const action of fixture.actions) {
    if (action.kind !== "human") continue;
    const window = paragraphsAroundName(narration, action.name);
    const declared = `${action.intent ?? ""} ${action.body}`;
    if (AGENCY_COMMIT.test(window) && !AGENCY_COMMIT.test(declared)) {
      out.push({
        code: "undeclared_commitment",
        detail: `${action.name} given an undeclared major commitment`,
      });
    }
  }
  const speech = [...narration.matchAll(/^([가-힣A-Za-z0-9]+):\s*"/gm)].map((m) => m[1]);
  for (const speaker of speech) {
    if (fixture.expectedNames.includes(speaker)) continue;
    if (speaker === "GM") continue;
  }
  return out;
}

function measureState(
  fixture: ThinkingBenchCase,
  parsed: ReturnType<typeof parseTrpgGmOutput>,
  applied: ReturnType<typeof applyValidatedStateDelta>
): QualityFinding[] {
  const out: QualityFinding[] = [];
  if (!applied.ok) {
    out.push({ code: applied.error, detail: applied.detail });
  }
  for (const patch of parsed.delta.players) {
    const sheet = fixture.sheets.find((s) => s.participantId === patch.participantId);
    if (!sheet) continue;
    if (patch.location && patch.location.trim()) {
      const loc = patch.location.trim();
      const locTokens = loc.split(/\s+/).filter((t) => t.length >= 2);
      const mentioned = locTokens.some((t) => parsed.narration.includes(t) || loc.includes(sheet.location));
      if (!mentioned && !parsed.narration.includes(sheet.location)) {
        out.push({
          code: "location_scene_mismatch",
          detail: `delta location ${loc} not reflected in scene`,
        });
      }
    }
  }
  return out;
}

function measureScenario(
  fixture: ThinkingBenchCase,
  parsed: ReturnType<typeof parseTrpgGmOutput>
): QualityFinding[] {
  const out: QualityFinding[] = [];
  const haystack = `${parsed.narration}\n${JSON.stringify(parsed.delta)}`;
  for (const token of fixture.secretTokens) {
    if (token && haystack.includes(token)) {
      out.push({ code: "hidden_plan_leak", detail: token });
    }
  }
  if (parsed.campaignFinished && !fixture.allowCampaignFinished) {
    out.push({
      code: "campaign_finished_abuse",
      detail: "campaign_finished=true on a non-ending fixture",
    });
  }
  const requested = parsed.delta.storyPhase;
  if (requested && fixture.currentStoryPhase) {
    if (!isTrpgStoryPhase(requested)) {
      out.push({ code: "invalid_story_phase", detail: String(requested) });
    } else if (
      !isAllowedStoryPhaseTransition(fixture.currentStoryPhase, requested, {
        campaignFinished: parsed.campaignFinished,
      })
    ) {
      out.push({
        code: "story_phase_skip",
        detail: `${fixture.currentStoryPhase} -> ${requested}`,
      });
    }
    const appliedPhase = applyStoryPhaseTransition(fixture.currentStoryPhase, requested, {
      campaignFinished: parsed.campaignFinished,
    });
    if (appliedPhase !== requested && requested !== fixture.currentStoryPhase) {
      out.push({
        code: "story_phase_rejected",
        detail: `${requested} rejected, stays ${appliedPhase}`,
      });
    }
  }
  if (fixture.centralConflict && /중심 갈등은 이미 끝|목표가 달성되었다|캠페인은 여기서 끝/.test(parsed.narration)) {
    if (!fixture.allowCampaignFinished) {
      out.push({
        code: "conflict_resolved_early",
        detail: "narration closes the central conflict/goal too early",
      });
    }
  }
  return out;
}

function measureInitiative(fixture: ThinkingBenchCase, narration: string): QualityFinding[] {
  if (fixture.resolutionOrder.length < 2) return [];
  const out: QualityFinding[] = [];
  const first = fixture.resolutionOrder[0];
  const last = fixture.resolutionOrder[fixture.resolutionOrder.length - 1];
  const firstAt = firstIndex(narration, first.name);
  const lastAt = firstIndex(narration, last.name);
  if (firstAt >= 0 && lastAt >= 0 && lastAt < firstAt) {
    out.push({
      code: "resolution_order_ignored",
      detail: `${last.name} appears before ${first.name}`,
    });
  }
  const firstAction = fixture.actions.find((a) => a.participantId === first.participantId);
  if (firstAction?.tier && FAIL_TIERS.has(firstAction.tier)) {
    const window = paragraphsAroundName(narration, first.name);
    if (SUCCESS_PHRASE.test(window) && !FAIL_PHRASE.test(window)) {
      out.push({
        code: "first_actor_auto_success",
        detail: `${first.name} failed the roll but is narrated as succeeding`,
      });
    }
  }
  if (fixture.resolutionOrder.length >= 2 && lastAt >= 0 && firstAt >= 0) {
    const laterWindow = paragraphsAroundName(narration, last.name);
    const earlierNames = fixture.resolutionOrder.slice(0, -1).map((row) => row.name);
    const reacts = earlierNames.some((name) => laterWindow.includes(name)) || /방금|이미|그 소리|그 문|실패/.test(laterWindow);
    if (!reacts) {
      out.push({
        code: "later_action_no_reaction",
        detail: `${last.name} does not react to earlier resolved results`,
      });
    }
  }
  return out;
}

export function countQualityTotals(report: QualityReport): {
  parseFailures: number;
  actionOmissions: number;
  diceContradictions: number;
  stateErrors: number;
  agencyErrors: number;
} {
  return {
    parseFailures: report.parseSuccess ? 0 : 1,
    actionOmissions: report.actionOmissions.length,
    diceContradictions: report.diceContradictions.length,
    stateErrors: report.stateErrors.length,
    agencyErrors: report.agencyErrors.length,
  };
}
