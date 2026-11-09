// Small, dependency-free charts for single-series data. Bars are thin (<= 24px), grow from one
// baseline with a 4px rounded data end, use one validated hue (--chart), and carry a hover and
// keyboard-focus tooltip. Every chart has a table view, so nothing depends on seeing the bars.

type Point = { label: string; full: string; value: number };

/** Vertical columns over time (e.g. minutes per day). Labels only the highest column. */
export function ColumnChart({ title, points, unit, height = 160 }: { title: string; points: Point[]; unit: string; height?: number }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  const top = niceMax(max);
  const peak = max > 0 ? points.findIndex((p) => p.value === max) : -1;
  return (
    <figure className="chart">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="col-chart" style={{ height }} role="img" aria-label={`${title}: ${points.map((p) => `${p.full} ${p.value} ${unit}`).join(", ")}`}>
        <span className="axis-top muted" aria-hidden="true">{top} {unit}</span>
        {points.map((p, i) => (
          <div key={p.full} className="col" tabIndex={0} aria-label={`${p.full}: ${p.value} ${unit}`}>
            <div className="col-bar" style={{ height: `${top ? (p.value / top) * 100 : 0}%` }}>
              {i === peak && <span className="col-peak">{p.value}</span>}
            </div>
            <span className="tip" role="tooltip">{p.full}: <strong>{p.value} {unit}</strong></span>
          </div>
        ))}
      </div>
      <div className="col-labels" aria-hidden="true">{points.map((p) => <span key={p.full}>{p.label}</span>)}</div>
      <TableView caption={title} rows={points.map((p) => [p.full, `${p.value} ${unit}`])} />
    </figure>
  );
}

/** Horizontal bars for a few categories (e.g. time of day). Value at each bar tip. */
export function BarList({ title, points, unit }: { title: string; points: Point[]; unit: string }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <figure className="chart">
      <figcaption className="sr-only">{title}</figcaption>
      <ul className="bar-list">
        {points.map((p) => (
          <li key={p.label}>
            <span className="bar-label">{p.label}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(p.value / max) * 100}%` }} /></span>
            <span className="bar-value">{p.value} {unit}</span>
          </li>
        ))}
      </ul>
      <TableView caption={title} rows={points.map((p) => [p.full, `${p.value} ${unit}`])} />
    </figure>
  );
}

function TableView({ caption, rows }: { caption: string; rows: [string, string][] }) {
  return (
    <details className="table-view">
      <summary>Show as a table</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td className="num">{v}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

/** Round an axis maximum up to a clean number (30, 60, 90, 120, 180, 240…). */
function niceMax(v: number): number {
  if (v <= 30) return 30;
  for (const step of [60, 90, 120, 180, 240, 300, 360, 480, 600, 720]) if (v <= step) return step;
  return Math.ceil(v / 120) * 120;
}
