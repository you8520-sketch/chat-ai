import type {
  EffectiveRuntimeSettingsProjection,
  RuntimeReasoningProjection,
} from "@/lib/adminEffectiveRuntimeSettings";

function formatReasoning(reasoning: RuntimeReasoningProjection): string {
  const parts: string[] = [];
  if (reasoning.reasoning != null) parts.push(`reasoning ${JSON.stringify(reasoning.reasoning)}`);
  if (reasoning.reasoningEffort != null) parts.push(`effort ${String(reasoning.reasoningEffort)}`);
  if (reasoning.thinking != null) parts.push(`thinking ${JSON.stringify(reasoning.thinking)}`);
  if (reasoning.outputConfig != null) parts.push(`output_config ${JSON.stringify(reasoning.outputConfig)}`);
  return parts.join(" · ") || "provider default";
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function onOff(value: boolean): string {
  return value ? "ON" : "OFF";
}

export function EffectiveRuntimeSettingsSection({
  projection,
}: {
  projection: EffectiveRuntimeSettingsProjection;
}) {
  const { mainRp, trpg, length, historical, featureFlags, credentials } = projection;
  return (
    <section className="mt-6 rounded-2xl border border-sky-500/20 bg-sky-950/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-sky-200">Effective Runtime Settings</h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-zinc-500">
            현재 production 코드의 canonical owner를 직접 호출해 만든 read-only projection입니다.
            이 화면은 설정을 바꾸지 않으며, 같은 모델 id라도 workload별 provider를 따로 표시합니다.
            JSON: /api/admin/runtime-settings
          </p>
        </div>
        <span className="rounded bg-sky-500/15 px-2 py-1 text-xs font-bold text-sky-300">READ-ONLY</span>
      </div>

      <h3 className="mt-4 text-sm font-bold text-zinc-200">Main RP</h3>
      <p className="mt-1 font-mono text-[11px] text-zinc-600">{mainRp.owner}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-xs text-zinc-300">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3">model</th>
              <th className="py-1 pr-3">provider</th>
              <th className="py-1 pr-3">wire model</th>
              <th className="py-1 pr-3">routing</th>
              <th className="py-1 pr-3">reasoning</th>
              <th className="py-1 pr-3">max_tokens</th>
              <th className="py-1 pr-3">cache</th>
              <th className="py-1">pricing</th>
            </tr>
          </thead>
          <tbody>
            {mainRp.models.map((row) => (
              <tr key={row.canonicalModelId} className="border-t border-white/5 align-top">
                <td className="py-1.5 pr-3">
                  <p className="font-semibold text-zinc-100">
                    {row.label}
                    {row.isDefault ? " · default" : ""}
                  </p>
                  <p className="font-mono text-[11px] text-zinc-500">{row.canonicalModelId}</p>
                </td>
                <td className="py-1.5 pr-3">
                  {row.transportProvider}
                  <p className="text-[11px] text-zinc-500">{row.endpointHost}</p>
                </td>
                <td className="py-1.5 pr-3 font-mono">{row.wireModelId}</td>
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  {row.providerRouting ? JSON.stringify(row.providerRouting) : "—"}
                  {row.serviceTier ? ` · tier ${String(row.serviceTier)}` : ""}
                </td>
                <td className="py-1.5 pr-3 font-mono text-[11px]">{formatReasoning(row.reasoning)}</td>
                <td className="py-1.5 pr-3">{row.wireMaxTokens ?? "not sent"}</td>
                <td className="py-1.5 pr-3 text-[11px]">{row.promptCacheAffinity}</td>
                <td className="py-1.5 text-[11px]">
                  {row.publishedPricing
                    ? `v${row.publishedPricing.pricingVersion} · target ${formatPercent(row.publishedPricing.targetMargin)} · floor ${formatPercent(row.publishedPricing.minimumMarginFloor)}`
                    : "unpublished"}
                  <p className="text-zinc-500">billing {row.billingPhase}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        provider 요청 시도 {mainRp.maxExternalProviderAttempts}회 (자동 재시도 없음)
      </p>

      <h3 className="mt-5 text-sm font-bold text-zinc-200">TRPG</h3>
      <p className="mt-1 font-mono text-[11px] text-zinc-600">{trpg.owner}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs text-zinc-300">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3">role</th>
              <th className="py-1 pr-3">provider</th>
              <th className="py-1 pr-3">wire model</th>
              <th className="py-1 pr-3">reasoning</th>
              <th className="py-1 pr-3">transport max_tokens</th>
              <th className="py-1">attempts</th>
            </tr>
          </thead>
          <tbody>
            {trpg.roles.map((row) => (
              <tr key={row.workload} className="border-t border-white/5">
                <td className="py-1.5 pr-3">{row.workload}</td>
                <td className="py-1.5 pr-3">
                  {row.transportProvider}
                  <p className="text-[11px] text-zinc-500">{row.endpointHost}</p>
                </td>
                <td className="py-1.5 pr-3 font-mono">{row.wireModelId}</td>
                <td className="py-1.5 pr-3 font-mono text-[11px]">{formatReasoning(row.reasoning)}</td>
                <td className="py-1.5 pr-3">
                  {row.transportMaxTokens?.toLocaleString() ?? "not sent"}
                  <p className="text-[11px] text-zinc-500">model capability, not a prose cap</p>
                </td>
                <td className="py-1.5">{row.maxProviderAttempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-5 text-sm font-bold text-zinc-200">Workload-specific routing</h3>
      <ul className="mt-2 space-y-1 text-xs text-zinc-300">
        {Object.entries(projection.workloadRoutingByModelId)
          .filter(([, entries]) => entries.length > 1)
          .map(([modelId, entries]) => (
            <li key={modelId} className="font-mono">
              {modelId}:{" "}
              {entries
                .map((entry) => `${entry.workload} → ${entry.transportProvider} (${entry.wireModelId})`)
                .join(" · ")}
            </li>
          ))}
      </ul>

      <h3 className="mt-5 text-sm font-bold text-zinc-200">Length</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">soft aim</dt>
          <dd className="mt-1">{length.softAimChars.toLocaleString()}+ ({length.aimKind})</dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">application prose ceiling</dt>
          <dd className="mt-1">{length.applicationProseCeilingChars?.toLocaleString() ?? "NONE"}</dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">longer output preserved</dt>
          <dd className="mt-1">{String(length.longerOutputPreserved)}</dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">charging</dt>
          <dd className="mt-1">{length.chargingBasis}</dd>
        </div>
      </dl>
      <p className="mt-1 text-[11px] text-zinc-500">{length.uiLabel}</p>

      <h3 className="mt-5 text-sm font-bold text-zinc-200">Feature flags · credentials</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">payments</dt>
          <dd className="mt-1">{onOff(featureFlags.paymentsEnabled)}</dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">mock API mode</dt>
          <dd className="mt-1">{onOff(featureFlags.mockApiMode)}</dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">published billing phase1 / phase2</dt>
          <dd className="mt-1">
            {onOff(featureFlags.phase1PublishedBillingEnabled)} /{" "}
            {onOff(featureFlags.phase2DeepSeekPublishedBillingEnabled)}
          </dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">adult routing · handoff canary/general</dt>
          <dd className="mt-1">
            {onOff(featureFlags.adultSceneRoutingEnabled)} ·{" "}
            {onOff(featureFlags.adultHandoffAdminCanaryEnabled)}/
            {onOff(featureFlags.adultHandoffGeneralEnabled)}
          </dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">adult refusal fallback</dt>
          <dd className="mt-1 font-mono">{featureFlags.adultRefusalFallbackModelId}</dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">memory · episodic recall</dt>
          <dd className="mt-1">
            {onOff(featureFlags.memory.memoryFeatureEnabled)} ·{" "}
            {onOff(featureFlags.memory.episodicRecallEnabled)}
          </dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">OpenRouter key</dt>
          <dd className="mt-1">{credentials.openRouterApiKeyConfigured ? "configured" : "missing"}</dd>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <dt className="text-[11px] text-zinc-500">CheaperInference key</dt>
          <dd className="mt-1">
            {credentials.cheaperInferenceApiKeyConfigured ? "configured" : "missing"}
          </dd>
        </div>
      </dl>

      <h3 className="mt-5 text-sm font-bold text-zinc-200">Historical (not selectable)</h3>
      <ul className="mt-2 space-y-1 text-xs text-zinc-400">
        {historical.retiredObservableModelIds.map((row) => (
          <li key={row.modelId} className="font-mono">
            {row.modelId} ({row.label}) → {row.resolvesToCurrent}
          </li>
        ))}
      </ul>
    </section>
  );
}
