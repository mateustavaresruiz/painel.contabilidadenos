import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Os tokens de cor são CSS vars com um valor oklch() COMPLETO
// (ex.: --primary: oklch(0.52 0.16 255)). O modificador de opacidade do
// Tailwind (bg-x/50) injeta alpha assumindo canais crus e gera
// `rgb(oklch(...) / .5)` — CSS inválido → o background SOME (transparente).
// Era por isso que dialogs, popovers e tints (bg-primary/10) ficavam
// transparentes. Este helper devolve uma função que o Tailwind chama com
// `opacityValue`: sem opacidade → a var crua (sólido, oklch válido); com
// opacidade → color-mix, que aceita o oklch() completo e aplica o alpha
// corretamente. Cast pra string porque o tipo do Config não modela
// valores-função (suportados em runtime — padrão "withOpacityValue").
function alpha(varName: string): string {
  return (({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined
      ? `var(${varName})`
      : `color-mix(in srgb, var(${varName}) calc(${opacityValue} * 100%), transparent)`) as unknown as string;
}

export default {
  // Claro ⇄ escuro pela classe `.dark` no <html> (lib/theme.ts).
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // Plus Jakarta Sans (variável) no corpo e nos títulos; emoji no fim.
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', "system-ui", "-apple-system", "Segoe UI", "sans-serif", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"],
        serif: ['"Plus Jakarta Sans Variable"', "system-ui", "sans-serif"],
        heading: ['"Plus Jakarta Sans Variable"', "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      // Sombra suave só em cartão (shadow-card); o resto continua sem. em cartão e botão; sombra só no que flutua.
      boxShadow: {
        sm: "none",
        DEFAULT: "none",
        md: "none",
        lg: "var(--sombra-flutuante)",
        xl: "var(--sombra-flutuante)",
        "2xl": "var(--sombra-flutuante)",
        card: "var(--sombra-card)",
        "card-hover": "var(--sombra-card-hover)",
      },
      colors: {
        border: alpha("--border"),
        input: alpha("--input"),
        ring: alpha("--ring"),
        background: alpha("--background"),
        foreground: alpha("--foreground"),
        primary: {
          DEFAULT: alpha("--primary"),
          foreground: alpha("--primary-foreground"),
        },
        secondary: {
          DEFAULT: alpha("--secondary"),
          foreground: alpha("--secondary-foreground"),
        },
        destructive: {
          DEFAULT: alpha("--destructive"),
          foreground: alpha("--destructive-foreground"),
        },
        // Semânticos quentes/dessaturados — status, dinheiro, alertas.
        success: {
          DEFAULT: alpha("--success"),
          foreground: alpha("--success-foreground"),
        },
        warning: {
          DEFAULT: alpha("--warning"),
          foreground: alpha("--warning-foreground"),
        },
        danger: {
          DEFAULT: alpha("--danger"),
          foreground: alpha("--danger-foreground"),
        },
        muted: {
          DEFAULT: alpha("--muted"),
          foreground: alpha("--muted-foreground"),
        },
        accent: {
          DEFAULT: alpha("--accent"),
          foreground: alpha("--accent-foreground"),
        },
        popover: {
          DEFAULT: alpha("--popover"),
          foreground: alpha("--popover-foreground"),
        },
        card: {
          DEFAULT: alpha("--card"),
          foreground: alpha("--card-foreground"),
        },
        lida: alpha("--lida"),
        "lida-propria": alpha("--lida-propria"),
        divider: alpha("--divider"),
        chip: alpha("--chip"),
        brand: {
          DEFAULT: alpha("--brand"),
          foreground: alpha("--brand-foreground"),
          soft: alpha("--brand-soft"),
        },
        sidebar: {
          DEFAULT: alpha("--sidebar"),
          foreground: alpha("--sidebar-foreground"),
          muted: alpha("--sidebar-muted"),
          hover: alpha("--sidebar-hover"),
          active: alpha("--sidebar-active"),
          border: alpha("--sidebar-border"),
        },
        bronze: {
          DEFAULT: alpha("--bronze"),
          foreground: alpha("--bronze-foreground"),
        },
      },
      // Área segura do iOS (notch em cima, barra de gestos embaixo). Só
      // valem porque o index.html declara `viewport-fit=cover` — sem ele o
      // navegador já reserva a faixa e todo env() vira 0. Servem a
      // padding/margin/inset (`pb-safe-b`, `pt-safe-t`, ...). Em qualquer
      // aparelho sem entalhe são 0: são no-op, não um espaço a mais.
      spacing: {
        "safe-t": "env(safe-area-inset-top)",
        "safe-b": "env(safe-area-inset-bottom)",
        "safe-l": "env(safe-area-inset-left)",
        "safe-r": "env(safe-area-inset-right)",
      },
      // Raios: 8 (utilitário, input, menu) · 11 (pearl) · 18 (cartão,
      // diálogo, balão) · pílula. Os nomes do Tailwind caem nessa escala.
      borderRadius: {
        sm: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius)",
        pearl: "var(--radius-pearl)",
        xl: "var(--radius-card)",
        "2xl": "var(--radius-card)",
        "3xl": "var(--radius-card)",
        card: "var(--radius-card)",
      },
      // Escala tipográfica do DESIGN.md (painel: corpo 15px).
      fontSize: {
        "2xs": ["12px", { lineHeight: "1.33", letterSpacing: "0" }],
        xs: ["13px", { lineHeight: "1.38", letterSpacing: "0" }],
        sm: ["15px", { lineHeight: "1.47", letterSpacing: "0" }],
        base: ["17px", { lineHeight: "1.41", letterSpacing: "0" }],
        "title-sm": ["17px", { lineHeight: "1.41", letterSpacing: "0" }],
        "title-md": ["21px", { lineHeight: "1.19", letterSpacing: "-0.015em" }],
        "title-lg": ["28px", { lineHeight: "1.14", letterSpacing: "-0.015em" }],
        "title-xl": ["34px", { lineHeight: "1.12", letterSpacing: "-0.015em" }],
      },
      // Easing da marca como utilitário (`ease-brand`) — aponta pro token
      // --ease-brand. Mais confiável que `ease-[var(--ease-brand)]` arbitrário.
      transitionTimingFunction: {
        brand: "var(--ease-brand)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
