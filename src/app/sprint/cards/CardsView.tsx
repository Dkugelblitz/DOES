"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { setCardMastered } from "../actions";

export type Card = { id: string; deck: string; question: string; answer: string; topic_id: string };

/** Rapid-fire flip cards: tap to reveal, mark mastered, filter by deck or hide mastered ones. */
export function CardsView({ cards, initialMastered }: { cards: Card[]; initialMastered: string[] }) {
  const [mastered, setMastered] = useState(() => new Set(initialMastered));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [deck, setDeck] = useState("All");
  const [hideMastered, setHideMastered] = useState(false);
  const [error, setError] = useState(false);
  const [, start] = useTransition();
  const decks = useMemo(() => ["All", ...new Set(cards.map((c) => c.deck))], [cards]);
  const shown = cards.filter((c) => (deck === "All" || c.deck === deck) && !(hideMastered && mastered.has(c.id)));

  const flip = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleMastered = (id: string) => {
    const on = !mastered.has(id);
    setMastered((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
    start(async () => {
      const r = await setCardMastered(id, on);
      setError(!r.ok);
      if (!r.ok) setMastered((s) => { const n = new Set(s); if (on) n.delete(id); else n.add(id); return n; });
    });
  };

  return (
    <>
      <section className="card" aria-label="Card filters">
        <p style={{ marginTop: 0 }}><strong>{cards.filter((c) => mastered.has(c.id)).length}/{cards.length}</strong> mastered. Tap a question to reveal the answer.</p>
        <div className="row" role="group" aria-label="Deck">
          {decks.map((d) => (
            <button key={d} type="button" className={`btn${d === deck ? " primary" : ""}`} aria-pressed={d === deck} onClick={() => setDeck(d)}>{d}</button>
          ))}
        </div>
        <label className="row inline-label" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={hideMastered} onChange={(e) => setHideMastered(e.target.checked)} style={{ width: 20, height: 20 }} />
          Hide cards I&apos;ve mastered
        </label>
        <div role="status" aria-live="polite">{error && <p className="error">Couldn&apos;t save that. Please try again.</p>}</div>
      </section>

      {shown.map((c) => {
        const isOpen = open.has(c.id), isM = mastered.has(c.id);
        return (
          <div key={c.id} className={`card flip${isOpen ? " open" : ""}`}>
            <button type="button" className="flip-q" aria-expanded={isOpen} aria-controls={`a-${c.id}`} onClick={() => flip(c.id)}>
              <span className="tag">{c.deck}</span> <strong>{c.question}</strong>
              {isM && <span className="ok" aria-label="mastered"> ✓</span>}
            </button>
            <div id={`a-${c.id}`} className="flip-a" hidden={!isOpen}>
              <p>{c.answer}</p>
              <div className="row">
                <button type="button" className={`btn${isM ? " primary" : ""}`} aria-pressed={isM} onClick={() => toggleMastered(c.id)}>{isM ? "✓ Mastered" : "Mark mastered"}</button>
                <Link className="muted" href={`/topics/${c.topic_id}`}>Open the topic</Link>
              </div>
            </div>
          </div>
        );
      })}
      {!shown.length && <p className="card muted">{hideMastered ? "You've mastered every card here. 🎉" : "No cards for this deck."}</p>}
    </>
  );
}
