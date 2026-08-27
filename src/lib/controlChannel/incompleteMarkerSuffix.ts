/**
 * Prefix-safe incomplete control-marker detection for streaming buffers.
 * Raw provider buffers are never mutated — callers project visible text only.
 */

export type ControlBlockMarker = {
  start: string;
  end: string;
};

/** ASCII-only case fold for control syntax comparison; original text is never rewritten. */
function foldControlAscii(value: string): string {
  return value.replace(/[A-Z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 32)
  );
}

/** Deterministic proper-prefix set for a control start marker. */
export function properPrefixesOfControlMarker(marker: string): string[] {
  const out: string[] = [];
  for (let i = 1; i < marker.length; i++) {
    out.push(marker.slice(0, i));
  }
  return out;
}

function uniqueStartMarkerPrefixes(markers: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const marker of markers) {
    for (const prefix of properPrefixesOfControlMarker(marker)) {
      seen.add(prefix);
    }
  }
  return [...seen].sort((a, b) => b.length - a.length);
}

/**
 * Strip trailing suffix that is a proper prefix of any control start marker.
 */
export function stripIncompleteControlMarkerSuffix(
  raw: string,
  startMarkers: readonly string[]
): string {
  if (!raw || startMarkers.length === 0) return raw;
  let work = raw;
  let changed = true;
  while (changed) {
    changed = false;
    const foldedWork = foldControlAscii(work);
    const prefixes = uniqueStartMarkerPrefixes(startMarkers);
    for (const prefix of prefixes) {
      if (foldedWork.endsWith(foldControlAscii(prefix))) {
        work = work.slice(0, work.length - prefix.length);
        changed = true;
        break;
      }
    }
  }
  return work;
}

/** Remove unclosed control blocks (start present, end missing). */
export function stripUnclosedControlBlocks(
  raw: string,
  blocks: readonly ControlBlockMarker[]
): string {
  let work = raw;
  for (const { start, end } of blocks) {
    const foldedWork = foldControlAscii(work);
    const idx = foldedWork.lastIndexOf(foldControlAscii(start));
    if (idx < 0) continue;
    const foldedTail = foldedWork.slice(idx);
    if (!foldedTail.includes(foldControlAscii(end))) {
      work = work.slice(0, idx);
    }
  }
  return work;
}

/** Stream-visible projection: incomplete prefix + unclosed server-control blocks. */
export function projectStreamVisibleWithoutIncompleteControlMarkers(
  raw: string,
  opts: {
    startMarkers: readonly string[];
    blocks?: readonly ControlBlockMarker[];
  }
): string {
  let work = raw;
  if (opts.blocks?.length) {
    work = stripUnclosedControlBlocks(work, opts.blocks);
  }
  return stripIncompleteControlMarkerSuffix(work, opts.startMarkers);
}
