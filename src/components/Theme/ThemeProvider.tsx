"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

type ThemeContextType = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const getInitial = useCallback((): Theme => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage.getItem("theme-choice");
    if (saved === "light" || saved === "dark") return saved;
    const m = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return m ? "dark" : "light";
  }, []);

  const [theme, setThemeState] = useState<Theme>(getInitial);
  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((s) => (s === "dark" ? "light" : "dark")), []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("theme-choice", theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}


