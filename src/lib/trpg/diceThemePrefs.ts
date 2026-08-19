import {
  PRODUCTION_D20_THEME,
  isTrpgD20ThemeId,
  normalizeTrpgD20ThemeId,
  type TrpgD20ThemeId,
} from "./diceVisual";

export const TRPG_DICE_THEME_KEY = "habi:trpg-d20-theme";

export function loadTrpgDiceTheme(): TrpgD20ThemeId {
  if (typeof window === "undefined") return PRODUCTION_D20_THEME;
  try {
    const raw = window.localStorage.getItem(TRPG_DICE_THEME_KEY);
    if (!raw) return PRODUCTION_D20_THEME;
    return normalizeTrpgD20ThemeId(raw) ?? PRODUCTION_D20_THEME;
  } catch {
    return PRODUCTION_D20_THEME;
  }
}

export function saveTrpgDiceTheme(theme: TrpgD20ThemeId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TRPG_DICE_THEME_KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolveTrpgDiceTheme(opts: {
  previewEnabled: boolean;
  queryTheme?: string | null;
  savedTheme?: TrpgD20ThemeId | null;
}): TrpgD20ThemeId {
  if (opts.previewEnabled) {
    const fromQuery = normalizeTrpgD20ThemeId(opts.queryTheme ?? undefined);
    if (fromQuery && isTrpgD20ThemeId(fromQuery)) return fromQuery;
  }
  return opts.savedTheme && isTrpgD20ThemeId(opts.savedTheme) ? opts.savedTheme : PRODUCTION_D20_THEME;
}

export const TRPG_D20_THEME_OPTIONS: ReadonlyArray<{
  id: TrpgD20ThemeId;
  label: string;
  hint: string;
  productionReady: boolean;
}> = [
  {
    id: "obsidian-royal",
    label: "Obsidian Royal",
    hint: "흑요석 · 샴페인 골드 · 에메랄드",
    productionReady: true,
  },
  {
    id: "ancient-reliquary",
    label: "Ancient Reliquary",
    hint: "청록 에namel · 앤틱 금속",
    productionReady: false,
  },
  {
    id: "gemstone-arcane",
    label: "Gemstone Arcane",
    hint: "수정체 · 아케인 보라",
    productionReady: false,
  },
];
