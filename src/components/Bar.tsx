/** Two-segment progress bar (done + in progress). Decorative; callers provide the text. */
export function Bar({ done, inProgress, total }: { done: number; inProgress: number; total: number }) {
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="bar" aria-hidden="true">
      <i className="bar-done" style={{ width: pct(done) }} />
      <i className="bar-wip" style={{ width: pct(inProgress) }} />
    </div>
  );
}
