import { setActiveLevel } from "@/app/actions";

/** Shown only when the user holds more than one level. The database refuses unheld levels. */
export function LevelSwitch({ held, active }: { held: { level: number; name: string }[]; active: number }) {
  if (held.length < 2) return null;
  return (
    <form action={setActiveLevel} className="row">
      <label className="row" style={{ fontWeight: 400 }}>
        <span>View as</span>
        <select name="level" defaultValue={active} key={active} style={{ width: "auto" }}>
          {held.map((l) => <option key={l.level} value={l.level}>{l.name}</option>)}
        </select>
      </label>
      <button className="btn" type="submit">Switch</button>
    </form>
  );
}
