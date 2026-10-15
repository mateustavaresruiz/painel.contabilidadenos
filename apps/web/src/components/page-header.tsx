import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

type Props = {
  /**
   * Ícone do módulo — mesmo da sidebar (Users, FileText, etc).
   *
   * Aceita também qualquer componente que receba `className`, e não só um
   * ícone do lucide: a Aurora usa o avatar dela aqui, e amarrar o tipo à
   * biblioteca obrigaria a duplicar o cabeçalho só para trocar o desenho.
   */
  icon: LucideIcon | ComponentType<{ className?: string }>;
  /**
   * @deprecated O eyebrow duplicava o título (ex.: "AGENDA" + "Agenda").
   * Mantido por compatibilidade, mas não é mais renderizado. Use só
   * `title` + `description`.
   */
  eyebrow?: string;
  /** Título principal — string ou node (pra inline-edit, badges, etc). */
  title: ReactNode;
  /** Subtítulo opcional logo abaixo. */
  description?: ReactNode;
  /** Ações à direita (botões, exportar, etc). */
  actions?: ReactNode;
  /**
   * O ícone traz a própria moldura — some o quadrado azul de trás.
   *
   * Existe para o avatar da Aurora: um retrato redondo dentro de um quadrado
   * colorido lê como "foto colada num ícone", e o rosto ainda encolhia para
   * caber no `size-7` do ícone de linha.
   */
  iconePlano?: boolean;
};

/**
 * Cabeçalho padrão das páginas do `/app/*`: bloco de ícone azul à esquerda
 * + título sans + descrição curta. Ações alinhadas à direita no desktop.
 * (O eyebrow uppercase foi removido — duplicava o título.)
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  iconePlano = false,
}: Props) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {iconePlano ? (
          <Icon className="size-14 shrink-0" />
        ) : (
          <Icon className="size-7 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0 space-y-0.5">
          <h1 className="text-title-lg font-semibold truncate">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground [text-wrap:pretty]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}
