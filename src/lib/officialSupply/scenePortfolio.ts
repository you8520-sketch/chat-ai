import type { OfficialCharacterBible, OfficialWorldBible, WorldLocation } from "@/lib/officialSupply/bible";
import type { PortfolioBriefInput } from "@/lib/officialSupply/authorPrompts";
import { qaResult, type OfficialAssetPlan, type QaIssue, type QaResult } from "@/lib/officialSupply/types";

/**
 * Canonical owner for official Special Scene planning context and
 * world-portfolio scene diversity.
 *
 * - `resolveOfficialCharacterSceneContext` ranks world locations per
 *   character (PRIMARY / SECONDARY / EXCEPTIONAL) from the character's own
 *   occupation, faction, situation, RP engine and backstory — every character
 *   no longer receives the same world locations in the same order.
 * - `evaluateScenePortfolioDiversity` checks the whole world's scene set
 *   (not just the 3 scenes of one character) for location concentration,
 *   location+incident clones, motif monoculture and off-character scenes.
 *
 * Everything here is deterministic text heuristics — no LLM judge.
 */

// ── Tokens / motifs ──────────────────────────────────────────────────────────

const PARTICLE_SUFFIX_RE = /(으로서|으로|에서|에게|까지|부터|처럼|보다|이라|이며|이고|하는|하고|했던|하던|이다|들의|들은|들이|들을|과의|와의|의|은|는|이|가|을|를|에|와|과|로|도|만)$/;

const STOPWORDS = new Set([
  "그리고", "하지만", "그러나", "위해", "대한", "통해", "모든", "자신", "자신의", "그의", "그녀", "그녀의", "플레이어", "유저",
  "사람", "상대", "때문", "이후", "이전", "현재", "과거", "직접", "함께", "다른", "여러", "가장", "정도", "경우", "하나",
  "관계", "선택", "판단", "상황", "문제", "사건", "장면", "일상", "시간", "기록", "관리", "담당",
]);

/** Korean-friendly word tokens (≥2 chars, trailing particles stripped). */
export function sceneTokens(text: string, opts: { keepStopwords?: boolean } = {}): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/[^가-힣A-Za-z0-9]+/)) {
    let word = raw.trim();
    if (word.length > 2) word = word.replace(PARTICLE_SUFFIX_RE, "");
    if (word.length < 2 || (!opts.keepStopwords && STOPWORDS.has(word))) continue;
    out.add(word);
  }
  return out;
}

function tokensOverlap(a: Set<string>, b: Set<string>): string[] {
  const hits: string[] = [];
  for (const x of a) {
    for (const y of b) {
      if (x === y || (x.length >= 2 && y.length >= 2 && (x.startsWith(y) || y.startsWith(x)))) {
        hits.push(x);
        break;
      }
    }
  }
  return hits;
}

/** Incident / stakes / relationship-setup motifs. Different wording, same motif key. */
export const SCENE_MOTIFS = {
  warmth: { label: "체온·몸 녹이기", re: /(체온|온기|몸을\s*녹|녹이|껴안|품에\s*안|맞대)/ },
  betrayal: { label: "배신·반역·공모", re: /(배신|반역|모반|내통|밀고|공모|음모)/ },
  supply_cut: { label: "보급 단절·고립", re: /(보급|배급|고립|봉쇄|끊긴|끊겨)/ },
  arranged_marriage: { label: "정략·혼담", re: /(정략|혼담|약혼|결혼\s*제안|청혼)/ },
  forbidden_text: { label: "금서·금지 기록", re: /(금서|금지된\s*기록|금기\s*문헌|봉인된\s*문서)/ },
  collapse: { label: "붕괴·역류·폭주", re: /(붕괴|역류|폭주|폭발|차폐막|균열)/ },
  secret_meeting: { label: "밀담·독대", re: /(밀담|독대|밀회|비밀\s*접견|은밀한\s*만남)/ },
  interrogation: { label: "심문·연행·검문", re: /(심문|취조|연행|체포|검문|포위|압송)/ },
  deal: { label: "거래·경매·흥정", re: /(경매|밀거래|흥정|거래|채권|장부)/ },
  heist_escape: { label: "탈취·도주·추격", re: /(탈취|도주|탈출|추격|잠입|금고)/ },
  // 의식 also means "consciousness" (의식을 잃다); 예배실/예배당 name a place, not an incident.
  ritual: { label: "의례·기도", re: /(의식(?!\s*(을|이|은)?\s*(잃|흐려|흐릿|불명|되찾|없|돌아|차리))|의례|기도|예배(?!실|당)|축복|성가|제단)/ },
  repair: { label: "정비·수리", re: /(정비|수리|분해|조립|코어|부품)/ },
  duel_training: { label: "결투·훈련", re: /(결투|대련|훈련|연무|사격|검술)/ },
  healing: { label: "치료·간호", re: /(치료|치유|간호|응급|약초|상처)/ },
  banquet: { label: "연회·무도회", re: /(무도회|연회|살롱|가면|만찬)/ },
  investigation: { label: "수사·증거 추적", re: /(수사|조사|잠복|증거|단서|대조|추적)/ },
  study: { label: "연구·관측", re: /(연구|관측|실험|분석|해독)/ },
} as const;

export type SceneMotif = keyof typeof SCENE_MOTIFS;

/**
 * Motifs that run through this genre's whole premise (investigating the
 * aether collapse, studying it). They carry no incident identity, so they are
 * extracted for review but never count toward portfolio clone/monoculture.
 */
export const GENERIC_SCENE_MOTIFS: ReadonlySet<SceneMotif> = new Set<SceneMotif>(["investigation", "study"]);

/** "거래나 추격이 아니라 …" names what the scene is NOT — drop that clause before matching. */
const NEGATED_CLAUSE_RE = /[^.,;!?\n]{0,24}(?:이|가)\s*아니(?:라|다|고|며)/g;

export function extractSceneMotifs(text: string): SceneMotif[] {
  const affirmed = text.replace(NEGATED_CLAUSE_RE, " ");
  return (Object.keys(SCENE_MOTIFS) as SceneMotif[]).filter((key) => SCENE_MOTIFS[key].re.test(affirmed));
}

function specificMotifs(motifs: readonly SceneMotif[]): SceneMotif[] {
  return motifs.filter((m) => !GENERIC_SCENE_MOTIFS.has(m));
}

// ── Location relevance ───────────────────────────────────────────────────────

export type SceneLocationTier = "primary" | "secondary" | "exceptional";

export type RankedSceneLocation = {
  name: string;
  tier: SceneLocationTier;
  score: number;
  /** Character anchor words that tie this location to the character (review evidence). */
  why: string[];
  rpEvents: string;
};

export type OfficialCharacterSceneContext = {
  name: string;
  occupation: string;
  faction: string;
  socialPosition: string;
  ranked: RankedSceneLocation[];
  /** Character-owned hooks the scenes must come from. */
  hooks: {
    immediateHook: string;
    repeatable: string[];
    mediumConflict: string;
    longTermChange: string;
    personalSituation: string;
    backstoryResidue: string[];
    userInitialView: string;
    relationshipCues: string[];
  };
  /** Anchor tokens used by the relevance QA (occupation/faction/own places). */
  anchors: string[];
};

function locationText(location: WorldLocation): string {
  return [location.name, location.purpose, location.users, location.rpEvents, location.mood].join(" ");
}

/**
 * Per-character location relevance. Identity words (occupation, faction,
 * social position, world role) weigh 3, situation/hook words 2, the rest 1.
 * PRIMARY: best-scoring location(s) carrying an identity hit. SECONDARY: any
 * other positive score. EXCEPTIONAL: no link at all.
 */
export function resolveOfficialCharacterSceneContext(input: {
  world: Pick<OfficialWorldBible, "locations">;
  bible: OfficialCharacterBible;
  brief: Pick<PortfolioBriefInput, "faction" | "occupation" | "socialPosition" | "rpHook">;
}): OfficialCharacterSceneContext {
  const { world, bible, brief } = input;
  const identityText = [
    bible.identity.occupation,
    bible.identity.socialPosition,
    bible.identity.affiliation,
    bible.identity.worldRole,
    brief.faction,
    brief.occupation,
  ].join(" ");
  const hookText = [
    brief.rpHook,
    bible.situation.personalSituation,
    bible.rpEngine.immediateHook,
    bible.rpEngine.mediumConflict,
  ].join(" ");
  const restText = [
    ...bible.rpEngine.repeatable,
    bible.rpEngine.longTermChange,
    bible.dailyLife,
    ...bible.backstory.events.map((e) => `${e.event} ${e.residue}`),
    bible.userRelationship.initialView,
  ].join(" ");
  const identity = sceneTokens(identityText);
  const hook = sceneTokens(hookText);
  const rest = sceneTokens(restText);

  const scored = world.locations.map((location) => {
    const loc = sceneTokens(locationText(location));
    const idHits = tokensOverlap(identity, loc);
    const hookHits = tokensOverlap(hook, loc);
    const restHits = tokensOverlap(rest, loc);
    return {
      location,
      idHits,
      score: idHits.length * 3 + hookHits.length * 2 + restHits.length,
      why: [...new Set([...idHits, ...hookHits, ...restHits])].slice(0, 6),
    };
  });
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;
  const ranked: RankedSceneLocation[] = sorted.map((entry, index) => {
    let tier: SceneLocationTier = "exceptional";
    // Incidental word overlap (e.g. one shared common noun) is not a reason to be there.
    if (entry.score >= Math.max(6, top * 0.3)) tier = "secondary";
    if (entry.idHits.length > 0 && (index === 0 || entry.score >= top * 0.75)) tier = "primary";
    return {
      name: entry.location.name,
      tier,
      score: entry.score,
      why: entry.why,
      rpEvents: entry.location.rpEvents,
    };
  });
  // Every character keeps at least one PRIMARY anchor (its best location).
  if (!ranked.some((r) => r.tier === "primary") && ranked[0] && ranked[0].score > 0) ranked[0].tier = "primary";

  const anchors = [...identity].filter((t) => t.length >= 2);
  return {
    name: bible.identity.name,
    occupation: bible.identity.occupation,
    faction: brief.faction,
    socialPosition: bible.identity.socialPosition,
    ranked,
    hooks: {
      immediateHook: bible.rpEngine.immediateHook,
      repeatable: bible.rpEngine.repeatable,
      mediumConflict: bible.rpEngine.mediumConflict,
      longTermChange: bible.rpEngine.longTermChange,
      personalSituation: bible.situation.personalSituation.slice(0, 400),
      backstoryResidue: bible.backstory.events.map((e) => e.residue).filter(Boolean),
      userInitialView: bible.userRelationship.initialView,
      relationshipCues: bible.otherRelationships
        .filter((r) => r.target.trim() && r.public.trim())
        .map((r) => `${r.target}: ${r.public}`)
        .slice(0, 3),
    },
    anchors,
  };
}

/**
 * Map a scene's free-text location onto a world location (or null = character-specific place).
 * The parenthetical part of a world location name is its parent building
 * ("유리온실 (태양궁 최상층)"): another room of that building is a different
 * place, so a scene maps only when it names the location itself; parent hits
 * just break ties.
 */
export function mapSceneLocation(sceneLocation: string, worldLocations: readonly WorldLocation[]): string | null {
  const sceneWords = sceneTokens(sceneLocation);
  // Names need a near-exact word: generic 에테르 must not land on proper 에테르노스.
  const hits = (names: Set<string>) =>
    [...names].filter((x) =>
      [...sceneWords].some((y) => {
        const [short, long] = x.length <= y.length ? [x, y] : [y, x];
        return short === long || (short.length >= 2 && long.startsWith(short) && long.length - short.length <= 1);
      })
    ).length;
  let best: { name: string; head: number; parent: number } | null = null;
  for (const location of worldLocations) {
    const head = location.name.replace(/\([^)]*\)/g, " ");
    const parent = (location.name.match(/\(([^)]*)\)/g) ?? []).join(" ");
    const headHits = hits(sceneTokens(head));
    if (headHits === 0) continue;
    const parentHits = hits(sceneTokens(parent));
    if (!best || headHits > best.head || (headHits === best.head && parentHits > best.parent)) {
      best = { name: location.name, head: headHits, parent: parentHits };
    }
  }
  return best?.name ?? null;
}

// ── Portfolio QA ─────────────────────────────────────────────────────────────

export type ScenePortfolioEntry = {
  draftKey: string;
  name: string;
  plan: OfficialAssetPlan;
  context: OfficialCharacterSceneContext;
};

export type PortfolioScene = {
  draftKey: string;
  name: string;
  slotKey: string;
  rawLocation: string;
  worldLocation: string | null;
  motifs: SceneMotif[];
  text: string;
  anchored: boolean;
};

export const SCENE_PORTFOLIO_THRESHOLDS = {
  /** Share of characters with any scene at one world location. */
  locationShareWarn: 0.6,
  locationShareError: 0.8,
  /** Share of characters sharing one (world location + motif) combo. */
  comboShareError: 0.4,
  /** Share of characters whose scenes carry one motif. */
  motifShareWarn: 0.5,
  motifShareError: 0.7,
  /** Same location + motif Jaccard ≥ this → clone pair. */
  clonePairMotifJaccard: 0.5,
  /**
   * Inside one character a profession motif (e.g. 거래 for a broker) runs
   * through every scene, so only near-identical incident sets count as clones.
   */
  intraCloneMotifJaccard: 0.67,
  /** Share of all scenes that are part of a cross-character clone pair. */
  cloneRateError: 0.25,
  /** Scenes per character allowed without any character anchor. */
  maxUnanchoredScenes: 1,
  /** A shared PRIMARY location belongs to the character with ≥1.5× the relevance score. */
  homeGroundScoreRatio: 1.5,
} as const;

export function collectPortfolioScenes(
  entries: readonly ScenePortfolioEntry[],
  worldLocations: readonly WorldLocation[]
): PortfolioScene[] {
  const out: PortfolioScene[] = [];
  for (const entry of entries) {
    const tierOf = new Map(entry.context.ranked.map((r) => [r.name, r.tier] as const));
    const anchors = new Set(entry.context.anchors);
    for (const slot of entry.plan.slots) {
      if (slot.kind !== "scene") continue;
      const rawLocation = slot.location ?? "";
      const text = `${rawLocation} ${slot.situation ?? ""} ${slot.tag}`;
      const worldLocation = mapSceneLocation(rawLocation, worldLocations);
      const tier = worldLocation ? tierOf.get(worldLocation) : undefined;
      const anchorHit = tokensOverlap(sceneTokens(text), anchors).length > 0;
      out.push({
        draftKey: entry.draftKey,
        name: entry.name,
        slotKey: slot.slotKey,
        rawLocation,
        worldLocation,
        motifs: extractSceneMotifs(text),
        text,
        // A scene is on-character when it sits at a PRIMARY/SECONDARY world
        // location, at a character-specific place, or names a character anchor.
        anchored: worldLocation === null || tier === "primary" || tier === "secondary" || anchorHit,
      });
    }
  }
  return out;
}

function jaccard<T>(a: readonly T[], b: readonly T[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared += 1;
  return shared / (A.size + B.size - shared);
}

export type ScenePortfolioStats = {
  characters: number;
  scenes: number;
  locationShare: Record<string, number>;
  motifShare: Record<string, number>;
  topCombos: Array<{ location: string; motif: SceneMotif; characters: number }>;
  clonePairs: Array<[string, string]>;
  cloneRate: number;
  unanchored: Array<{ draftKey: string; slotKey: string }>;
};

export function computeScenePortfolioStats(scenes: readonly PortfolioScene[]): ScenePortfolioStats {
  const characters = new Set(scenes.map((s) => s.draftKey)).size || 1;
  const byLocation = new Map<string, Set<string>>();
  const byMotif = new Map<string, Set<string>>();
  const byCombo = new Map<string, Set<string>>();
  for (const scene of scenes) {
    if (scene.worldLocation) {
      if (!byLocation.has(scene.worldLocation)) byLocation.set(scene.worldLocation, new Set());
      byLocation.get(scene.worldLocation)!.add(scene.draftKey);
    }
    for (const motif of specificMotifs(scene.motifs)) {
      if (!byMotif.has(motif)) byMotif.set(motif, new Set());
      byMotif.get(motif)!.add(scene.draftKey);
      if (scene.worldLocation) {
        const key = `${scene.worldLocation}\u0000${motif}`;
        if (!byCombo.has(key)) byCombo.set(key, new Set());
        byCombo.get(key)!.add(scene.draftKey);
      }
    }
  }
  const clonePairs: Array<[string, string]> = [];
  const inClone = new Set<string>();
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 1; j < scenes.length; j++) {
      const a = scenes[i]!;
      const b = scenes[j]!;
      if (a.draftKey === b.draftKey || !a.worldLocation || a.worldLocation !== b.worldLocation) continue;
      if (jaccard(specificMotifs(a.motifs), specificMotifs(b.motifs)) >= SCENE_PORTFOLIO_THRESHOLDS.clonePairMotifJaccard) {
        clonePairs.push([`${a.draftKey}/${a.slotKey}`, `${b.draftKey}/${b.slotKey}`]);
        inClone.add(`${a.draftKey}/${a.slotKey}`);
        inClone.add(`${b.draftKey}/${b.slotKey}`);
      }
    }
  }
  const share = (map: Map<string, Set<string>>): Record<string, number> =>
    Object.fromEntries([...map].map(([k, v]) => [k, v.size / characters]));
  return {
    characters,
    scenes: scenes.length,
    locationShare: share(byLocation),
    motifShare: share(byMotif),
    topCombos: [...byCombo]
      .map(([key, v]) => {
        const [location, motif] = key.split("\u0000") as [string, SceneMotif];
        return { location, motif, characters: v.size };
      })
      .sort((a, b) => b.characters - a.characters)
      .slice(0, 8),
    clonePairs,
    cloneRate: scenes.length ? inClone.size / scenes.length : 0,
    unanchored: scenes.filter((s) => !s.anchored).map((s) => ({ draftKey: s.draftKey, slotKey: s.slotKey })),
  };
}

export function evaluateScenePortfolioDiversity(
  entries: readonly ScenePortfolioEntry[],
  worldLocations: readonly WorldLocation[]
): QaResult & { stats: ScenePortfolioStats } {
  const t = SCENE_PORTFOLIO_THRESHOLDS;
  const scenes = collectPortfolioScenes(entries, worldLocations);
  const stats = computeScenePortfolioStats(scenes);
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  for (const [location, value] of Object.entries(stats.locationShare)) {
    if (value >= t.locationShareError) {
      errors.push({ code: "scene_location_concentration", message: `${location}: ${pct(value)} of characters` });
    } else if (value >= t.locationShareWarn) {
      warnings.push({ code: "scene_location_concentration", message: `${location}: ${pct(value)} of characters` });
    }
  }
  for (const combo of stats.topCombos) {
    const value = combo.characters / stats.characters;
    if (value >= t.comboShareError && combo.characters >= 3) {
      errors.push({
        code: "scene_location_motif_clone",
        message: `${combo.location} × ${SCENE_MOTIFS[combo.motif].label}: ${combo.characters}/${stats.characters} characters`,
      });
    }
  }
  for (const [motif, value] of Object.entries(stats.motifShare)) {
    const label = SCENE_MOTIFS[motif as SceneMotif].label;
    if (value >= t.motifShareError) {
      errors.push({ code: "scene_motif_monoculture", message: `${label}: ${pct(value)} of characters` });
    } else if (value >= t.motifShareWarn) {
      warnings.push({ code: "scene_motif_repeated", message: `${label}: ${pct(value)} of characters` });
    }
  }
  if (stats.cloneRate > t.cloneRateError) {
    errors.push({
      code: "scene_portfolio_clone_rate",
      message: `${pct(stats.cloneRate)} of scenes are cross-character clones (${stats.clonePairs.length} pairs)`,
    });
  }
  const unanchoredBy = new Map<string, number>();
  for (const u of stats.unanchored) unanchoredBy.set(u.draftKey, (unanchoredBy.get(u.draftKey) ?? 0) + 1);
  for (const [draftKey, count] of unanchoredBy) {
    if (count > t.maxUnanchoredScenes) {
      errors.push({ code: "scene_off_character", message: `${draftKey}: ${count} scenes unrelated to occupation/faction/own places` });
    } else {
      warnings.push({ code: "scene_off_character", message: `${draftKey}: ${count} scene unrelated to occupation/faction` });
    }
  }
  return { ...qaResult(errors, warnings), stats };
}

/**
 * Candidate gate for sequential planning: one character's new scenes against
 * the siblings already planned. Rejects cross-character clones, reuse of a
 * (location × motif) combo already held by 2+ siblings, a location already
 * carrying 5+ siblings, near-identical scenes inside the candidate, and more
 * than one off-character scene.
 */
export function evaluateSceneCandidateAgainstPortfolio(
  candidate: ScenePortfolioEntry,
  planned: readonly ScenePortfolioEntry[],
  worldLocations: readonly WorldLocation[]
): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const mine = collectPortfolioScenes([candidate], worldLocations);
  const theirs = collectPortfolioScenes(planned, worldLocations);
  const t = SCENE_PORTFOLIO_THRESHOLDS;
  const rankIn = (context: OfficialCharacterSceneContext | undefined, location: string) =>
    context?.ranked.find((r) => r.name === location);
  const contextOf = new Map(planned.map((p) => [p.draftKey, p.context] as const));
  const labels = (motifs: readonly SceneMotif[]) => specificMotifs(motifs).map((m) => SCENE_MOTIFS[m].label).join("·") || "-";
  for (const scene of mine) {
    const specific = specificMotifs(scene.motifs);
    for (const other of theirs) {
      if (!scene.worldLocation || scene.worldLocation !== other.worldLocation) continue;
      if (jaccard(specific, specificMotifs(other.motifs)) >= t.clonePairMotifJaccard) {
        // Home-ground rule: at the candidate's own PRIMARY location a sibling
        // with a clearly weaker claim is the visitor — the final portfolio QA
        // arbitrates, not this gate.
        const mineRank = rankIn(candidate.context, scene.worldLocation);
        const theirRank = rankIn(contextOf.get(other.draftKey), scene.worldLocation);
        const home =
          mineRank?.tier === "primary" &&
          (theirRank?.tier !== "primary" || mineRank.score >= t.homeGroundScoreRatio * theirRank.score);
        const siblingOwns =
          theirRank?.tier === "primary" && (mineRank?.tier !== "primary" || theirRank.score >= t.homeGroundScoreRatio * mineRank.score);
        const fix = siblingOwns
          ? `이곳은 ${other.name}의 주 무대 — 이 장면은 다른 장소(캐릭터 고유 공간 포함)로 옮길 것`
          : `이 장소를 쓰려면 [${labels(other.motifs)}]가 아닌 사건으로 바꿀 것`;
        const message = `${scene.slotKey} clones ${other.name}/${other.slotKey} at ${scene.worldLocation} [${labels(other.motifs)}] → ${fix}`;
        if (home) warnings.push({ code: "scene_clone_of_sibling", message });
        else errors.push({ code: "scene_clone_of_sibling", message });
      }
    }
    if (scene.worldLocation) {
      for (const motif of specific) {
        const holders = new Set(
          theirs.filter((o) => o.worldLocation === scene.worldLocation && o.motifs.includes(motif)).map((o) => o.draftKey)
        );
        if (holders.size >= 2) {
          errors.push({
            code: "scene_combo_saturated",
            message: `${scene.slotKey}: ${scene.worldLocation} × ${SCENE_MOTIFS[motif].label} already used by ${holders.size} characters`,
          });
        }
      }
      const atLocation = new Set(theirs.filter((o) => o.worldLocation === scene.worldLocation).map((o) => o.draftKey));
      if (atLocation.size >= 5) {
        errors.push({ code: "scene_location_saturated", message: `${scene.slotKey}: ${scene.worldLocation} already hosts ${atLocation.size} characters` });
      }
    }
  }
  // A profession motif present in every one of the candidate's scenes (거래 for
  // a broker, 의례 for a priestess) is backdrop, not the incident.
  const perScene = mine.map((s) => specificMotifs(s.motifs));
  const backdrop = new Set(
    perScene.length >= 2 ? perScene[0]!.filter((m) => perScene.every((set) => set.includes(m))) : []
  );
  const usedMotifs = new Set(perScene.flat());
  const unusedExamples = (Object.keys(SCENE_MOTIFS) as SceneMotif[])
    .filter((m) => !GENERIC_SCENE_MOTIFS.has(m) && !usedMotifs.has(m))
    .map((m) => SCENE_MOTIFS[m].label)
    .join(", ");
  for (let i = 0; i < mine.length; i++) {
    for (let j = i + 1; j < mine.length; j++) {
      const a = perScene[i]!.filter((m) => !backdrop.has(m));
      const b = perScene[j]!.filter((m) => !backdrop.has(m));
      const monotone = a.length === 0 && b.length === 0 && perScene[i]!.length > 0;
      if (monotone || (a.length && jaccard(a, b) >= t.intraCloneMotifJaccard)) {
        errors.push({
          code: "scene_intra_clone",
          message: `${mine[i]!.slotKey} ~ ${mine[j]!.slotKey}: same incident type [${labels(mine[i]!.motifs)}] → 직업 배경은 유지하되 장면마다 다른 사건을 중심에 둘 것 (아직 안 쓴 사건 예: ${unusedExamples})`,
        });
      }
    }
  }
  const unanchored = mine.filter((s) => !s.anchored);
  if (unanchored.length > t.maxUnanchoredScenes) {
    errors.push({ code: "scene_off_character", message: `${unanchored.map((s) => s.slotKey).join(",")} unrelated to occupation/faction/own places` });
  }
  return qaResult(errors, warnings);
}

/**
 * Portfolio-aware avoid list for sequential planning: (location × motif)
 * combos and motifs already used by previously planned siblings.
 */
export function buildSceneAvoidList(
  planned: readonly ScenePortfolioEntry[],
  worldLocations: readonly WorldLocation[],
  forContext?: OfficialCharacterSceneContext
): { combos: string[]; overusedMotifs: string[]; siblingScenesHere: string[] } {
  const scenes = collectPortfolioScenes(planned, worldLocations);
  // Concrete sibling incidents at the locations this character is most likely to use.
  const relevant = new Set(
    (forContext?.ranked ?? []).filter((r) => r.tier !== "exceptional").map((r) => r.name)
  );
  const siblingScenesHere = scenes
    .filter((s) => s.worldLocation && relevant.has(s.worldLocation))
    .map((s) => {
      const labels = specificMotifs(s.motifs).map((m) => SCENE_MOTIFS[m].label);
      const situation = s.text.replace(/\s+/g, " ").slice(0, 90);
      return `${s.worldLocation} — ${s.name}: ${situation}${labels.length ? ` [${labels.join("·")}]` : ""}`;
    });
  const combos = new Set<string>();
  const motifCount = new Map<SceneMotif, Set<string>>();
  for (const scene of scenes) {
    for (const motif of specificMotifs(scene.motifs)) {
      if (scene.worldLocation) combos.add(`${scene.worldLocation} × ${SCENE_MOTIFS[motif].label}`);
      if (!motifCount.has(motif)) motifCount.set(motif, new Set());
      motifCount.get(motif)!.add(scene.draftKey);
    }
  }
  const overusedMotifs = [...motifCount]
    .filter(([, who]) => who.size >= 3)
    .map(([motif]) => SCENE_MOTIFS[motif].label);
  return { combos: [...combos], overusedMotifs, siblingScenesHere };
}
