import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  ClipboardList,
  Home,
  Landmark,
  MessageSquare,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";

import type { ModuloChave } from "@/lib/modulos";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Módulo que liga/desliga o item (Configurações > Módulos). */
  modulo?: ModuloChave;
  /** Sub-páginas do módulo, mostradas quando o módulo está aberto. */
  filhos?: { to: string; label: string; end?: boolean; soAdmin?: boolean }[];
};

/** Módulos do painel, na ordem definida pelo dono (sidebar e gaveta mobile). */
export const NAV_APP: NavItem[] = [
  { to: "/", label: "Início", icon: Home, end: true },
  {
    to: "/whatsapp",
    label: "WhatsApp",
    icon: MessageSquare,
    modulo: "whatsapp",
    filhos: [
      { to: "/whatsapp", label: "Conversas", end: true },
      // Um lugar só para as conexões: Configurações (como no adv3).
      { to: "/configuracoes?tab=conexoes", label: "Conexões", soAdmin: true },
    ],
  },
  { to: "/chamados", label: "Chamados", icon: ClipboardList, modulo: "chamados" },
  {
    to: "/clientes",
    label: "Clientes",
    icon: Users,
    modulo: "clientes",
    filhos: [
      { to: "/clientes", label: "Lista", end: true },
      { to: "/clientes/aniversarios", label: "Aniversários" },
    ],
  },
  { to: "/certificados", label: "Certificados digitais", icon: BadgeCheck, modulo: "certificados" },
  { to: "/pendencias-fiscais", label: "Pendências fiscais", icon: Landmark, modulo: "pendenciasFiscais" },
  { to: "/equipe", label: "Equipe", icon: UsersRound, modulo: "equipe" },
];

/** Fica no pé do menu e só aparece para admin. */
export const NAV_CONFIGURACOES: NavItem = { to: "/configuracoes", label: "Configurações", icon: Settings };
