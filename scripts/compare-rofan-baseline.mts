import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildWorldCoreUser } from "@/lib/officialSupply/authorPrompts";
import { OFFICIAL_ROFAN_GENRE, ROFAN_PARITY_PLAN } from "@/lib/officialSupply/genreProfile";
import { formatMarketSignalLines, selectMarketSignals } from "@/lib/officialSupply/marketFit";
import type { ResearchSnapshot } from "@/lib/officialSupply/research";

const SNAPSHOT_FILE = path.join(process.cwd(), "docs/official-supply/market-research-snapshot-2026-09.json");
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")) as ResearchSnapshot;
const POLICY = {
  targetLocale: "ko-KR",
  signalRegion: "KR" as const,
  marketPriority: "domestic_first",
  maxSupportingSignals: 4,
  marketRoleMix: { proven: { min: 0, max: 1 }, proven_twist: { min: 0, max: 1 }, experimental: { min: 0, max: 1 } },
  maxPrimaryTropeRepeat: 1,
  coreTags: { min: 4, max: 7 },
};
const selection = selectMarketSignals(snapshot, POLICY, OFFICIAL_ROFAN_GENRE, { excludeRomanceLed: false });
const market = {
  targetLocale: POLICY.targetLocale,
  marketPriority: POLICY.marketPriority,
  signalLines: formatMarketSignalLines(selection),
  namingProfile: ROFAN_PARITY_PLAN.namingProfile,
  marketRoleMix: POLICY.marketRoleMix,
  maxPrimaryTropeRepeat: POLICY.maxPrimaryTropeRepeat,
  coreTags: POLICY.coreTags,
};

const core = buildWorldCoreUser({
  genre: OFFICIAL_ROFAN_GENRE,
  worldKey: "w",
  styleKey: "k",
  market,
  slots: 1,
  adultCandidates: 0,
  genderMix: "여성 1명",
  slotGenders: ["female"],
  castIntent: "전체 이용자",
  authoring: undefined,
});

console.log(createHash("sha256").update(core).digest("hex"));
