import { createContext, useEffect, useState } from "react";

// Shared so any page (e.g. the Home header) can show the toggle while App owns the state.
export const ThemeContext = createContext({ theme: "dark", toggleTheme: () => {} });

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme); // drives the legacy index.css variables
    document.documentElement.classList.toggle("sgds-night-theme", theme === "dark"); // drives the SGDS components
    localStorage.setItem("theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  return { theme, toggleTheme };
}