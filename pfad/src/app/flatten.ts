/**
 * Flatten a record's nested results into rows for tables, CSV and comparison.
 * An object with numeric `mean` and `se` (a Statistics.Estimate or similar) is
 * one row carrying its uncertainty; numeric arrays longer than `maxArray` are
 * summarised (they stay complete in the JSON export).
 */
export interface Row {
  path: string;
  value: number | string | boolean | null;
  se?: number;
  ci95?: [number, number];
  n?: number;
  /** a long array was summarised; the value is its length */
  summarised?: boolean;
}

function isEstimate(o: Record<string, unknown>): boolean {
  return typeof o.mean === 'number' && (typeof o.se === 'number' || o.se === null || Number.isNaN(o.se as number));
}

export function flatten(obj: unknown, opts: { maxArray?: number; maxRows?: number } = {}): Row[] {
  const maxArray = opts.maxArray ?? 32;
  const maxRows = opts.maxRows ?? 20000;
  const rows: Row[] = [];
  const visit = (v: unknown, path: string) => {
    if (rows.length >= maxRows) return;
    if (v === null || v === undefined) {
      rows.push({ path, value: null });
      return;
    }
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      rows.push({ path, value: v });
      return;
    }
    if (Array.isArray(v)) {
      if (v.length > maxArray && v.every((x) => typeof x === 'number' || x === null)) {
        rows.push({ path, value: v.length, summarised: true });
        return;
      }
      v.forEach((x, i) => visit(x, `${path}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (isEstimate(o)) {
        const row: Row = { path, value: o.mean as number };
        if (typeof o.se === 'number') row.se = o.se;
        if (Array.isArray(o.ci95) && o.ci95.length === 2) row.ci95 = [Number(o.ci95[0]), Number(o.ci95[1])];
        if (typeof o.n === 'number') row.n = o.n;
        rows.push(row);
        return;
      }
      for (const [k, x] of Object.entries(o)) visit(x, path ? `${path}.${k}` : k);
    }
  };
  visit(obj, '');
  return rows;
}

/** Case-insensitive substring filter on the path. */
export function filterRows(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.path.toLowerCase().includes(q));
}
