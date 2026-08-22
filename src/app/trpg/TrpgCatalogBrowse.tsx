"use client";

import { useMemo, useState, type ReactNode } from "react";
import HorizontalScrollRow from "@/components/HorizontalScrollRow";
import type { TrpgCatalog, TrpgCatalogWorld } from "@/lib/trpg/catalog";
import {
  catalogItemMatches,
  catalogNewReleases,
  catalogScenarioById,
  catalogWorldById,
  genresInCatalog,
  type TrpgCatalogNewItem,
  type TrpgCatalogPick,
} from "@/lib/trpg/catalogBrowse";
import { CHARACTER_GENRES, type CharacterGenre } from "@/lib/characterGenres";
import type { TrpgScenarioTemplate } from "@/lib/trpg/scenarioTypes";
import TrpgCatalogCard from "./TrpgCatalogCard";
import TrpgCatalogPreview from "./TrpgCatalogPreview";

const SCROLL_CARD_WIDTH = "w-[168px] sm:w-[196px] xl:w-[216px]";
const RECOMMEND_COUNT = 16;

function isPicked(pick: TrpgCatalogPick | null, kind: TrpgCatalogPick["kind"], id: number): boolean {
  return pick?.kind === kind && pick.id === id;
}

function WorldCardRow({
  world,
  selected,
  onSelect,
}: {
  world: TrpgCatalogWorld;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <TrpgCatalogCard
      kind="world"
      id={world.id}
      title={world.name}
      summary={world.summary}
      creatorName={world.mine ? undefined : world.creatorName}
      genres={world.genres}
      badge={world.mine ? (world.trpgEnabled ? "내 것" : "내 것 · 목록 숨김") : undefined}
      emoji="🌍"
      coverUrl={world.coverUrl}
      selected={selected}
      onSelect={onSelect}
      editHref={world.mine ? `/world/${world.id}/edit` : undefined}
    />
  );
}

function ScenarioCardRow({
  scenario,
  mine,
  selected,
  onSelect,
}: {
  scenario: TrpgScenarioTemplate;
  mine?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <TrpgCatalogCard
      kind="scenario"
      id={scenario.id}
      title={scenario.title}
      summary={scenario.summary || scenario.content}
      genres={scenario.genres}
      badge={mine ? (scenario.visibility === "public" ? "내 것" : "내 것 · 비공개") : undefined}
      emoji="📜"
      coverUrl={scenario.assets[0]?.url}
      selected={selected}
      onSelect={onSelect}
      editHref={mine ? `/trpg/scenarios/${scenario.id}` : undefined}
    />
  );
}

function ScrollSection({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-violet-300/80">{eyebrow}</p>
        ) : null}
        <h2 className="text-xl font-semibold tracking-[-0.025em] text-zinc-50">{title}</h2>
      </div>
      <HorizontalScrollRow className="home-card-row gap-3.5 pb-2 sm:gap-4">{children}</HorizontalScrollRow>
    </section>
  );
}

function NewReleaseCard({
  catalog,
  item,
  pick,
  onOpenWorld,
  onOpenScenario,
}: {
  catalog: TrpgCatalog;
  item: TrpgCatalogNewItem;
  pick: TrpgCatalogPick | null;
  onOpenWorld: (id: number) => void;
  onOpenScenario: (id: number) => void;
}) {
  switch (item.kind) {
    case "world": {
      const world = catalogWorldById(catalog, item.id);
      if (!world) return null;
      return (
        <div className={`${SCROLL_CARD_WIDTH} shrink-0`}>
          <WorldCardRow
            world={world}
            selected={isPicked(pick, "world", world.id)}
            onSelect={() => onOpenWorld(world.id)}
          />
        </div>
      );
    }
    case "scenario": {
      const found = catalogScenarioById(catalog, item.id);
      if (!found) return null;
      return (
        <div className={`${SCROLL_CARD_WIDTH} shrink-0`}>
          <ScenarioCardRow
            scenario={found.scenario}
            mine={found.viewerIsCreator}
            selected={isPicked(pick, "scenario", found.scenario.id)}
            onSelect={() => onOpenScenario(found.scenario.id)}
          />
        </div>
      );
    }
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

export default function TrpgCatalogBrowse({
  catalog,
  busy,
  pick,
  onPickWorld,
  onPickScenario,
  onStartWorld,
  onStartScenario,
  initialPreview = null,
}: {
  catalog: TrpgCatalog;
  busy: boolean;
  pick: TrpgCatalogPick | null;
  onPickWorld: (id: number) => void;
  onPickScenario: (id: number) => void;
  onStartWorld: (id: number) => void;
  onStartScenario: (id: number) => void;
  initialPreview?: TrpgCatalogPick | null;
}) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<CharacterGenre | null>(null);
  const [preview, setPreview] = useState<TrpgCatalogPick | null>(initialPreview);
  const filtering = Boolean(query.trim() || genre);

  function openWorld(id: number) {
    onPickWorld(id);
    setPreview({ kind: "world", id });
  }
  function openScenario(id: number) {
    onPickScenario(id);
    setPreview({ kind: "scenario", id });
  }

  const publicScenarios = catalog.publicScenarios.filter(
    (s) => !catalog.myScenarios.some((mine) => mine.id === s.id)
  );
  const allItems = useMemo(
    () => [
      ...catalog.publicWorlds.map((w) => ({ kind: "world" as const, genres: w.genres })),
      ...catalog.myWorlds.map((w) => ({ kind: "world" as const, genres: w.genres })),
      ...catalog.publicScenarios.map((s) => ({ kind: "scenario" as const, genres: s.genres })),
      ...catalog.myScenarios.map((s) => ({ kind: "scenario" as const, genres: s.genres })),
    ],
    [catalog]
  );
  const availableGenres = genresInCatalog(allItems);
  const genreChips = availableGenres.length > 0 ? availableGenres : CHARACTER_GENRES;
  const newReleases = useMemo(() => catalogNewReleases(catalog, RECOMMEND_COUNT), [catalog]);

  const matchWorld = (world: TrpgCatalogWorld) =>
    catalogItemMatches({
      title: world.name,
      summary: world.summary,
      creatorName: world.creatorName,
      genres: world.genres,
      query,
      genre,
    });
  const matchScenario = (scenario: TrpgScenarioTemplate) =>
    catalogItemMatches({
      title: scenario.title,
      summary: `${scenario.summary} ${scenario.content}`,
      genres: scenario.genres,
      query,
      genre,
    });

  const filteredWorlds = catalog.publicWorlds.filter(matchWorld);
  const filteredMyWorlds = catalog.myWorlds.filter(matchWorld);
  const filteredPublicScenarios = publicScenarios.filter(matchScenario);
  const filteredMyScenarios = catalog.myScenarios.filter(matchScenario);
  const hasAny =
    catalog.publicWorlds.length +
      catalog.myWorlds.length +
      catalog.publicScenarios.length +
      catalog.myScenarios.length >
    0;
  if (!hasAny) return null;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="세계관·시나리오 이름, 소개, 장르로 찾기"
          className="min-h-11 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/40"
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setGenre(null)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              genre == null ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
            }`}
          >
            전체
          </button>
          {genreChips.map((g) => (
            <button
              type="button"
              key={g}
              onClick={() => setGenre((prev) => (prev === g ? null : g))}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                genre === g ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-300"
              }`}
            >
              #{g}
            </button>
          ))}
        </div>
      </div>

      {filtering ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-zinc-50">검색 결과</h2>
          {filteredWorlds.length +
            filteredMyWorlds.length +
            filteredPublicScenarios.length +
            filteredMyScenarios.length ===
          0 ? (
            <p className="text-sm text-zinc-500">맞는 세계관이나 시나리오가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
              {filteredWorlds.map((world) => (
                <WorldCardRow
                  key={`pub-w-${world.id}`}
                  world={world}
                  selected={isPicked(pick, "world", world.id)}
                  onSelect={() => openWorld(world.id)}
                />
              ))}
              {filteredMyWorlds
                .filter((w) => !filteredWorlds.some((pub) => pub.id === w.id))
                .map((world) => (
                  <WorldCardRow
                    key={`my-w-${world.id}`}
                    world={world}
                    selected={isPicked(pick, "world", world.id)}
                    onSelect={() => openWorld(world.id)}
                  />
                ))}
              {filteredPublicScenarios.map((scenario) => (
                <ScenarioCardRow
                  key={`pub-s-${scenario.id}`}
                  scenario={scenario}
                  selected={isPicked(pick, "scenario", scenario.id)}
                  onSelect={() => openScenario(scenario.id)}
                />
              ))}
              {filteredMyScenarios.map((scenario) => (
                <ScenarioCardRow
                  key={`my-s-${scenario.id}`}
                  scenario={scenario}
                  mine
                  selected={isPicked(pick, "scenario", scenario.id)}
                  onSelect={() => openScenario(scenario.id)}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {catalog.publicWorlds.length > 0 ? (
            <ScrollSection eyebrow="FOR YOU" title="추천 세계관">
              {catalog.publicWorlds.slice(0, RECOMMEND_COUNT).map((world) => (
                <div key={world.id} className={`${SCROLL_CARD_WIDTH} shrink-0`}>
                  <WorldCardRow
                    world={world}
                    selected={isPicked(pick, "world", world.id)}
                    onSelect={() => openWorld(world.id)}
                  />
                </div>
              ))}
            </ScrollSection>
          ) : null}
          {newReleases.length > 0 ? (
            <ScrollSection eyebrow="NEW" title="세계관/시나리오 신작">
              {newReleases.map((item) => (
                <NewReleaseCard
                  key={`${item.kind}-${item.id}`}
                  catalog={catalog}
                  item={item}
                  pick={pick}
                  onOpenWorld={openWorld}
                  onOpenScenario={openScenario}
                />
              ))}
            </ScrollSection>
          ) : null}
          {catalog.myWorlds.length > 0 ? (
            <ScrollSection title="내 세계관">
              {catalog.myWorlds.map((world) => (
                <div key={world.id} className={`${SCROLL_CARD_WIDTH} shrink-0`}>
                  <WorldCardRow
                    world={world}
                    selected={isPicked(pick, "world", world.id)}
                    onSelect={() => openWorld(world.id)}
                  />
                </div>
              ))}
            </ScrollSection>
          ) : null}
          {catalog.myScenarios.length > 0 ? (
            <ScrollSection title="내 시나리오">
              {catalog.myScenarios.map((scenario) => (
                <div key={scenario.id} className={`${SCROLL_CARD_WIDTH} shrink-0`}>
                  <ScenarioCardRow
                    scenario={scenario}
                    mine
                    selected={isPicked(pick, "scenario", scenario.id)}
                    onSelect={() => openScenario(scenario.id)}
                  />
                </div>
              ))}
            </ScrollSection>
          ) : null}
        </>
      )}
      <TrpgCatalogPreview
        catalog={catalog}
        pick={preview}
        busy={busy}
        onClose={() => setPreview(null)}
        onStart={() => {
          if (!preview) return;
          switch (preview.kind) {
            case "world":
              onStartWorld(preview.id);
              return;
            case "scenario":
              onStartScenario(preview.id);
              return;
            default: {
              const _exhaustive: never = preview;
              return _exhaustive;
            }
          }
        }}
      />
    </div>
  );
}
