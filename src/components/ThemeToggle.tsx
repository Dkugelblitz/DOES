"use client";
import { useState } from "react";

type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "🖥️ Auto", light: "☀️ Light", dark: "🌙 Dark" };

/** Cycles Auto → Light → Dark. Remembered in a cookie so the server renders the right theme. */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const change = () => {
    const t = NEXT[theme];
    setTheme(t);
    document.cookie = `theme=${t}; path=/; max-age=31536000; samesite=lax`;
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  return (
    <button type="button" className="btn" onClick={change} aria-label={`Theme: ${theme === "system" ? "matches your device" : theme}. Change theme.`}>
      {LABEL[theme]}
    </button>
  );
}
