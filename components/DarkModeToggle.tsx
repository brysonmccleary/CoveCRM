import { useEffect, useState } from "react";

const DarkModeToggle = () => {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const saved = window.localStorage.getItem("cove-color-scheme");
    const followSystem = saved !== "light" && saved !== "dark";
    const apply = (dark: boolean) => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      setIsDark(dark);
    };

    apply(followSystem ? media.matches : saved === "dark");
    if (!followSystem) return;

    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    const next = !(isDark ?? document.documentElement.classList.contains("dark"));
    window.localStorage.setItem("cove-color-scheme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    setIsDark(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg border border-[color:var(--cove-border)] bg-[color:var(--cove-surface)] px-3 py-2 text-xs font-semibold text-[color:var(--cove-text)] transition hover:bg-[color:var(--cove-surface-hover)]"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? "Light mode" : "Dark mode"}
    </button>
  );
};

export default DarkModeToggle;
