import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  ClipboardList,
  Home,
  Landmark,
  MessageSquare,
  Users,
  UsersRound,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Sub-páginas do módulo, mostradas quando o módulo está aberto. */
  filhos?: { to: string; label: string; end?: boolean }[];
};

/** Módulos do painel, na ordem definida pelo dono (sidebar e gaveta mobile). */
export const NAV_APP: NavItem[] = [
  { to: "/", label: "Início", icon: Home, end: true },
  {
    to: "/whatsapp",
    label: "WhatsApp",
    icon: MessageSquare,
    filhos: [
      { to: "/whatsapp", label: "Conversas", end: true },
      { to: "/whatsapp/conexoes", label: "Conexões" },
    ],
  },
  { to: "/chamados", label: "Chamados", icon: ClipboardList },
  {
    to: "/clientes",
    label: "Clientes",
    icon: Users,
    filhos: [
      { to: "/clientes", label: "Lista", end: true },
      { to: "/clientes/aniversarios", label: "Aniversários" },
    ],
  },
  { to: "/certificados", label: "Certificados digitais", icon: BadgeCheck },
  { to: "/pendencias-fiscais", label: "Pendências fiscais", icon: Landmark },
  { to: "/equipe", label: "Equipe", icon: UsersRound },
];
