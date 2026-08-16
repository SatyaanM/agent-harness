import { create } from "zustand";

type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  init: () => void;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

function setThemeCookie(theme: Theme): void {
  if (typeof document === "undefined") return;
  // biome-ignore lint/suspicious/noDocumentCookie: This fixed first-party cookie bridges the client theme to server rendering.
  document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "dark",
  init: () => {
    const theme = getInitialTheme();
    set({ theme });
    applyTheme(theme);
    setThemeCookie(theme);
  },
  setTheme: (theme) => {
    set({ theme });
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    applyTheme(theme);
    setThemeCookie(theme);
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
