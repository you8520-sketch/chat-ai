"use client";

import InlineTaggedAssetImage from "@/components/InlineTaggedAssetImage";
import TaggedNovelText from "@/components/TaggedNovelText";
import TrpgCharacterSceneAsset from "@/components/TrpgCharacterSceneAsset";
import TrpgTaggedNovelText from "@/app/trpg/TrpgTaggedNovelText";
import { withAssetSize, type CharacterAsset } from "@/lib/characterAssets";

function svgUrl(width: number, height: number, fill: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const landscape = withAssetSize(
  { url: svgUrl(1600, 900, "#335577"), tag: "대합실", chat: true },
  1600,
  900
);
const square = withAssetSize(
  { url: svgUrl(1000, 1000, "#557755"), tag: "광장", chat: true },
  1000,
  1000
);
const portrait = withAssetSize(
  { url: svgUrl(800, 1200, "#775533"), tag: "표지", chat: true },
  800,
  1200
);
const tall = withAssetSize(
  { url: svgUrl(900, 1600, "#553377"), tag: "포스터", chat: true },
  900,
  1600
);
const extreme = withAssetSize(
  { url: svgUrl(300, 2400, "#773355"), tag: "좁은길", chat: true },
  300,
  2400
);
const unknown: CharacterAsset = {
  url: svgUrl(900, 1600, "#333333"),
  tag: "미상",
  chat: true,
};
const slow = withAssetSize(
  { url: "/lab/slow-portrait.png", tag: "지연", chat: true },
  900,
  1600
);
const missing = withAssetSize(
  { url: "/lab/missing-portrait.png", tag: "실패", chat: true },
  900,
  1600
);
const blurred = withAssetSize(
  { url: svgUrl(800, 1200, "#222222"), tag: "가림", chat: true, viewerBlur: true },
  800,
  1200
);
const characterPortrait = withAssetSize(
  { url: svgUrl(800, 1200, "#884444"), tag: "분노", chat: true },
  800,
  1200
);
const characterLandscape = withAssetSize(
  { url: svgUrl(1600, 900, "#448844"), tag: "전투", chat: true },
  1600,
  900
);
const lockedCharacter = withAssetSize(
  { url: svgUrl(800, 1200, "#111111"), tag: "비밀", chat: true, viewerBlur: true },
  800,
  1200
);

function ScenarioRow({ id, asset }: { id: string; asset: CharacterAsset }) {
  return (
    <section data-fixture={id} className="mx-auto w-full max-w-3xl">
      <p data-role="before">앞 서술입니다.</p>
      <TrpgTaggedNovelText
        content={`장면.\n[태그: ${asset.tag}]\n오영감: "대사가 남는다."`}
        scenarioAssets={[asset]}
        campaignId={9}
        roundNumber={4}
      />
      <p data-role="after">뒤 대사입니다.</p>
    </section>
  );
}

export default function TrpgInlineAssetFrameLabClient() {
  return (
    <main className="bg-[#07080c] text-zinc-100">
      <ScenarioRow id="landscape-16-9" asset={landscape} />
      <ScenarioRow id="square-1-1" asset={square} />
      <ScenarioRow id="portrait-2-3" asset={portrait} />
      <ScenarioRow id="portrait-9-16" asset={tall} />
      <ScenarioRow id="extreme-1-8" asset={extreme} />
      <ScenarioRow id="unknown" asset={unknown} />
      <ScenarioRow id="slow" asset={slow} />
      <ScenarioRow id="missing" asset={missing} />
      <section data-fixture="blurred-portrait" className="mx-auto w-full max-w-3xl">
        <InlineTaggedAssetImage asset={blurred} presentation="trpg" />
      </section>
      <section data-fixture="character-portrait" className="mx-auto w-full max-w-3xl">
        <TrpgCharacterSceneAsset asset={characterPortrait} />
      </section>
      <section data-fixture="character-landscape" className="mx-auto w-full max-w-3xl">
        <TrpgCharacterSceneAsset asset={characterLandscape} />
      </section>
      <section data-fixture="locked-character" className="mx-auto w-full max-w-3xl">
        <p data-role="before">잠긴 초상 앞.</p>
        <TrpgTaggedNovelText
          content={"[캐릭터에셋: 12|비밀]\n잠긴 초상 뒤."}
          scenarioAssets={[]}
          characterCatalog={[
            {
              participantId: 12,
              characterId: 15,
              viewerIsCreator: false,
              name: "권태현",
              assets: [lockedCharacter],
            },
          ]}
          campaignId={9}
          roundNumber={4}
          unlockedUrlsByCharacterId={new Map([[15, new Set<string>()]])}
        />
      </section>
      <section data-fixture="chat-inline" className="mx-auto w-full max-w-3xl">
        <TaggedNovelText
          content={"본문\n[태그: 분노]\n[태그: 전투]"}
          assets={[characterPortrait, characterLandscape]}
        />
      </section>
    </main>
  );
}
