import type { ProviderModelDiscovery } from "@/lib/providerModelDiscovery";

function usd(value: number | null): string {
  return value == null ? "—" : `$${value}/M`;
}

export function ProviderModelDiscoverySection(props: {
  discoveries: readonly ProviderModelDiscovery[];
}) {
  return (
    <section className="mt-6 rounded border border-cyan-500/20 bg-cyan-950/10 p-4">
      <h2 className="font-semibold text-cyan-100">Provider Model Discovery — observe only</h2>
      <p className="mt-1 text-xs text-zinc-400">
        CheaperInference catalog models not currently owned by the product registry.
        Discovery does not add a model to Main RP, change routing, publish pricing, run a paid benchmark, or activate anything.
        BENCHMARK_REVIEWABLE only means the provider catalog has enough static evidence for the current streaming chat path.
      </p>
      {props.discoveries.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">No unregistered provider models observed.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 text-left text-zinc-400">
                <th className="py-1 pr-3">model</th>
                <th className="py-1 pr-3">first seen</th>
                <th className="py-1 pr-3">last seen</th>
                <th className="py-1 pr-3">triage</th>
                <th className="py-1 pr-3">type / endpoint</th>
                <th className="py-1 pr-3">capabilities</th>
                <th className="py-1 pr-3">observations</th>
                <th className="py-1 pr-3">current in/out</th>
                <th className="py-1 pr-3">reference in/out</th>
                <th className="py-1 pr-3">CI discount</th>
              </tr>
            </thead>
            <tbody>
              {props.discoveries.map((row) => (
                <tr key={`${row.provider}:${row.modelId}`} className="border-b border-white/5">
                  <td className="py-1 pr-3 font-medium text-zinc-200">{row.modelId}</td>
                  <td className="py-1 pr-3">{row.firstSeenAt}</td>
                  <td className="py-1 pr-3">{row.lastSeenAt}</td>
                  <td className="py-1 pr-3">
                    <div>{row.mainRpTriage.status}</div>
                    {row.mainRpTriage.reasons.length > 0 ? (
                      <div className="text-zinc-500">{row.mainRpTriage.reasons.join(", ")}</div>
                    ) : null}
                  </td>
                  <td className="py-1 pr-3">
                    <div>{row.modelType ?? "unknown"}</div>
                    <div className="text-zinc-500">{row.endpoint ?? "endpoint unknown"}</div>
                  </td>
                  <td className="py-1 pr-3">
                    stream {row.capabilities.streaming == null ? "?" : row.capabilities.streaming ? "yes" : "no"}
                    {" · "}reasoning {row.capabilities.reasoning == null ? "?" : row.capabilities.reasoning ? "yes" : "no"}
                    {" · "}vision {row.capabilities.vision == null ? "?" : row.capabilities.vision ? "yes" : "no"}
                  </td>
                  <td className="py-1 pr-3">{row.observationCount}</td>
                  <td className="py-1 pr-3">
                    {usd(row.inputUsdPerMillion)} / {usd(row.outputUsdPerMillion)}
                  </td>
                  <td className="py-1 pr-3">
                    {usd(row.referenceInputUsdPerMillion)} / {usd(row.referenceOutputUsdPerMillion)}
                  </td>
                  <td className="py-1 pr-3">
                    {row.discountPercent == null ? "—" : `${row.discountPercent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
