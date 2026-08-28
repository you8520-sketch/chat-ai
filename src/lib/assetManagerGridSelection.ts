/** Ephemeral bulk-selection helpers for AssetManagerGrid — single toggle owner. */

export function pruneSelectedUrls(
  selected: ReadonlySet<string>,
  assetUrls: readonly string[]
): Set<string> {
  const allowed = new Set(assetUrls);
  const next = new Set<string>();
  for (const url of selected) {
    if (allowed.has(url)) next.add(url);
  }
  return next;
}

export function toggleSelectedUrl(selected: ReadonlySet<string>, url: string): Set<string> {
  const next = new Set(selected);
  if (next.has(url)) next.delete(url);
  else next.add(url);
  return next;
}
