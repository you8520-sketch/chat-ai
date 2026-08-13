import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("TRPG party illustration album", () => {
  it("lets each party member pick a reference image", () => {
    const panel = read("src/components/ChatImageGeneratorPanel.tsx");
    assert.match(panel, /\/api\/trpg\/campaigns\/\$\{campaignId\}\/illustration-cast/);
    assert.match(panel, /castImagePicks/);
    assert.match(panel, /partyCast\.map/);
    assert.match(panel, /캠페인 앨범/);
    const route = read("src/app/api/chat/comic-generation/route.ts");
    assert.match(route, /applyTrpgCastImagePicks/);
    assert.match(route, /campaignTitle: campaignTitle \|\| null/);
  });

  it("keeps character albums separate from campaign-titled TRPG albums", () => {
    const album = read("src/lib/chatImageAlbum.ts");
    assert.match(album, /COALESCE\(campaign_id, 0\)=0/);
    assert.match(album, /listCampaignAlbum/);
    assert.match(album, /listImageAlbumCatalog/);
    const settings = read("src/app/settings/SettingsClient.tsx");
    assert.match(settings, /href="\/albums"/);
    const page = read("src/app/albums/page.tsx");
    assert.match(page, /생성 이미지 앨범/);
    const client = read("src/app/albums/AlbumsClient.tsx");
    assert.match(client, /일반 캐릭터/);
    assert.match(client, /TRPG/);
    const room = read("src/app/trpg/TrpgCampaignRoom.tsx");
    assert.match(room, /\/albums\?campaignId=/);
    assert.match(room, /campaignTitle: snap.title/);
  });
});
