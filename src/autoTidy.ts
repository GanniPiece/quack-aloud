/**
 * Which card ids appeared since the last look, excluding ones this browser added itself.
 * `local` is consumed: an id found in it is removed, so a later turn cannot mis-attribute it.
 * A null `prevIds` means the first load, which is never an addition.
 */
export function additionsFromOutside(prevIds: string[] | null, nextIds: string[], local: Set<string>): string[] {
  if (prevIds === null) return [];
  const before = new Set(prevIds);
  const out: string[] = [];
  for (const id of nextIds) {
    if (before.has(id)) continue;
    if (local.has(id)) {
      local.delete(id);
      continue;
    }
    out.push(id);
  }
  return out;
}
