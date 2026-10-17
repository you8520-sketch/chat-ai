// Mirrors the ai-draft route's generation step (prompts, expected fields, token/timeouts) without HTTP.
const ROOT = process.env.ROOT!;
const N = Number(process.env.N ?? 6);
(async () => {
  const draft = await import(`${ROOT}/src/lib/trpg/scenarioDraft`);
  const call = await import(`${ROOT}/src/lib/trpg/scenarioDraftCall`);
  const { emptyTrpgScenarioPlan, parseTrpgScenarioPlan } = await import(`${ROOT}/src/lib/trpg/scenarioPlan`);
  const existing: any = { title: "", summary: "", content: "", secretContent: "", startLocation: "", startInventory: [], npcs: [], plan: parseTrpgScenarioPlan(JSON.parse(JSON.stringify(emptyTrpgScenarioPlan()))), touchedFields: [] };
  const WORLD = { worldName: "[검증] 안개 항구 세계관", worldSummary: "안개가 짙은 항구 도시 하르바", worldContent: "하르바는 매일 밤 안개가 도시를 삼키는 항구 도시다. 등대지기 조합과 밀수 길드가 항구의 밤을 나눠 갖고 있으며, 안개 속에서 사라진 배들의 소문이 돈다. 마법은 드물고 해적 선단과 세관이 충돌한다.", worldSelected: true };
  const cases: Record<string, any> = {
    desc: { worldName: "", worldSummary: "", worldContent: "", worldSelected: false, existing: { ...existing, content: "비 오는 밤, 폐역에 도착한 유령 기차에서 사라진 승객들의 비밀을 추적하는 미스터리 모험" } },
    world: { ...WORLD, existing },
  };
  const complete = call.completeTrpgScenarioDraftJson ?? call.completeTrpgAuthoringJson;
  const origInfo = console.info;
  for (const [name, c] of Object.entries(cases)) {
    const rows: any[] = [];
    for (let i = 0; i < N; i += 1) {
      let calls = 0, inTok = 0, outTok = 0;
      console.info = (tag: any, payload: any) => { if (tag === "[trpg-authoring]") { calls += 1; inTok += payload.inputTokens; outTok += payload.outputTokens; } };
      const opts = { mode: "fill_empty", existing: c.existing, selectedFields: [], lockedFields: [] };
      const changing = draft.previewDraftOverwrite(opts);
      const requested = draft.scenarioDraftRequestedFields({ mode: "fill_empty", changingFields: changing });
      const user = draft.buildScenarioDraftUserPrompt({ ...c, ...opts });
      const t0 = Date.now();
      let ok = false, story = false, err = "";
      try {
        const g = await complete({ kind: "scenario_draft", system: draft.buildScenarioDraftSystemPrompt(), user, expectedFields: requested, primaryMaxTokens: draft.scenarioDraftOutputMaxTokens({ mode: "fill_empty", changingFields: changing }), primaryTimeoutMs: draft.scenarioDraftPrimaryTimeoutMs({ mode: "fill_empty", changingFields: changing }), primaryTemperature: 0.3, repairMaxTokens: 6000, repairTimeoutMs: 60000, repairTemperature: 0 });
        ok = (g.generatedFields?.length ?? 0) > 0;
        const merged = draft.mergeScenarioDraft({ mode: "fill_empty", existing: c.existing, generated: g, selectedFields: [], lockedFields: [], generatedFields: requested.filter((f: string) => g.generatedFields?.includes(f)) });
        story = Boolean(merged.title && merged.plan.startingSituation && merged.plan.goal && [...merged.plan.endingConditions, ...merged.plan.endingCandidates].length);
      } catch (e: any) { err = String(e.message).slice(0, 50); }
      console.info = origInfo;
      rows.push({ ok, story, err, calls, inTok, outTok, ms: Date.now() - t0 });
      await new Promise((r) => setTimeout(r, 1000));
    }
    const sum = (k: string) => rows.reduce((a, r) => a + r[k], 0);
    const usd = sum("inTok") / 1e6 * 0.098 + sum("outTok") / 1e6 * 0.196;
    console.log(`RESULT ${process.env.LABEL} ${name} n=${N} success=${rows.filter((r) => r.ok).length} fullStory=${rows.filter((r) => r.story).length} fail=${rows.filter((r) => !r.ok).length} avgModelCalls=${(sum("calls") / N).toFixed(2)} maxCalls=${Math.max(...rows.map((r) => r.calls))} avgSec=${(sum("ms") / N / 1000).toFixed(1)} maxSec=${(Math.max(...rows.map((r) => r.ms)) / 1000).toFixed(1)} avgCostKRW=${(usd * 1400 / N).toFixed(3)}`);
  }
})();
