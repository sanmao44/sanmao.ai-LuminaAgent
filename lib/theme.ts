export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sanmao-theme";
const THEME_CHANGE_EVENT = "sanmao-theme-change";

export function normalizeTheme(value: string | null | undefined): AppTheme {
  return value === "dark" ? "dark" : "light";
}

export function readStoredTheme(): AppTheme {
  if (typeof window === "undefined") return "light";

  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function applyTheme(theme: AppTheme): void {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0f1117" : "#f5f6f8");
}

export function saveTheme(theme: AppTheme): void {
  applyTheme(theme);

  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme changes should still apply when localStorage is unavailable.
  }

  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

export function subscribeToThemeChanges(onChange: (theme: AppTheme) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleThemeChange = (theme: AppTheme) => {
    applyTheme(theme);
    onChange(theme);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      handleThemeChange(normalizeTheme(event.newValue));
    }
  };
  const handleCustomEvent = (event: Event) => {
    const theme = (event as CustomEvent<unknown>).detail;
    if (theme === "light" || theme === "dark") handleThemeChange(theme);
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, handleCustomEvent);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, handleCustomEvent);
  };
}
