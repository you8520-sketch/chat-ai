export type TrpgCatalogPlayScore = {
  recent: number;
  all: number;
};

export type TrpgCatalogPlayScores = {
  worlds: Record<number, TrpgCatalogPlayScore>;
  scenarios: Record<number, TrpgCatalogPlayScore>;
};

export const EMPTY_TRPG_CATALOG_PLAY_SCORES: TrpgCatalogPlayScores = {
  worlds: {},
  scenarios: {},
};
