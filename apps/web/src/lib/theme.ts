/**
 * Tema da aplicação — claro ⇄ escuro.
 *
 * O app inteiro pinta por TOKEN semântico (bg-card, text-foreground…); as duas
 * paletas vivem em `:root` (claro) e `.dark` (escuro) no index.css. Trocar de
 * tema = só adicionar/remover a classe `.dark` no <html>. O default é CLARO.
 * A escolha persiste em localStorage e é re-aplicada no boot —
 * e também por um script inline no index.html, ANTES do bundle, pra não dar
 * flash do tema claro antes do React subir.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "denos:theme";
/** Tema atual do produto — default pra quem nunca escolheu. */
const DEFAULT_THEME: Theme = "light";

export function getStoredTheme(): Theme {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Cor da barra do browser mobile (meta theme-color) por tema — casa com o
 *  --background de cada paleta no index.css. */
const THEME_COLOR: Record<Theme, string> = {
  light: "#f5f5f7",
  dark: "#1d1d1f",
};

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // color-scheme alinha widgets nativos (scrollbar, inputs date/checkbox,
  // autofill) ao tema — sem isso eles ficam claros no escuro e vice-versa.
  root.style.colorScheme = theme;
  // Barra do browser no mobile segue o fundo do tema.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* modo privativo / storage bloqueado — segue só em memória */
  }
  applyTheme(theme);
  // Avisa quem escuta (useTheme, Toaster) sem prop-drilling.
  window.dispatchEvent(new CustomEvent("denos:theme", { detail: theme }));
}

export function toggleTheme(): Theme {
  const next: Theme = getStoredTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function bootTheme() {
  applyTheme(getStoredTheme());
}
