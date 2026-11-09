// Parses "email,levels" CSV for the admin import. Pure, no imports, so it's unit-tested directly.
// Accepted level formats in one cell: "1;2", "1|2", "1 2", "1/2", "1, 2" (quoted), or names such as
// "Data Engineer; Data Architect", "data_architect", "DE", "PDE", "DA", "principal".

export type ImportRow = { line: number; email: string; levels: number[] };
export type ImportProblem = { line: number; text: string; reason: string };

const NAMES: Record<string, number> = {
  "1": 1, de: 1, "data engineer": 1, data_engineer: 1, engineer: 1,
  "2": 2, pde: 2, "principal data engineer": 2, principal_data_engineer: 2, principal: 2,
  "3": 3, da: 3, "data architect": 3, data_architect: 3, architect: 3,
};

/** Split one CSV line, honouring double quotes ("a,b" stays one cell; "" is a literal quote). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseLevels(cell: string): number[] | null {
  const parts = cell.toLowerCase().split(/[;|/,]+|\s*\+\s*/).map((s) => s.trim()).filter(Boolean);
  const expanded = parts.flatMap((p) => (NAMES[p] !== undefined ? [p] : p.split(/\s+/)));
  const levels = new Set<number>();
  for (const p of expanded) {
    const n = NAMES[p];
    if (n === undefined) return null;
    levels.add(n);
  }
  return levels.size ? [...levels].sort() : null;
}

export function parseImportCsv(text: string, maxRows = 500): { rows: ImportRow[]; problems: ImportProblem[] } {
  const rows: ImportRow[] = [], problems: ImportProblem[] = [];
  const seen = new Map<string, ImportRow>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1, text = raw.trim();
    if (!text || text.startsWith("#")) return;
    const [email = "", ...rest] = cells(text);
    if (i === 0 && /^e-?mail$/i.test(email)) return; // header row
    const e = email.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { problems.push({ line, text, reason: "not a valid email" }); return; }
    const levels = parseLevels(rest.join(";"));
    if (!levels) { problems.push({ line, text, reason: "levels must be 1, 2, 3 or level names" }); return; }
    const prev = seen.get(e);
    if (prev) { prev.levels = [...new Set([...prev.levels, ...levels])].sort(); return; }
    if (rows.length >= maxRows) { problems.push({ line, text, reason: `only ${maxRows} rows per import` }); return; }
    const row = { line, email: e, levels };
    seen.set(e, row); rows.push(row);
  });
  return { rows, problems };
}
