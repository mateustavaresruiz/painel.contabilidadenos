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
  /** Aparece para quem tem pelo menos uma destas permissões do cargo. */
  permissao?: string[];
  /** Sub-páginas do módulo, mostradas quando o módulo está aberto. */
  filhos?: { to: string; label: string; end?: boolean; permissao?: string[] }[];
};

/** Módulos do painel, na ordem definida pelo dono (sidebar e gaveta mobile). */
export const NAV_APP: NavItem[] = [
  { to: "/", label: "Início", icon: Home, end: true },
  {
    to: "/whatsapp",
    label: "WhatsApp",
    icon: MessageSquare,
    modulo: "whatsapp",
    // Como no adv3: abre direto as conversas. Conexões só em Configurações.
    permissao: ["whatsapp.ver"],
  },
  {
    to: "/chamados",
    label: "Chamados",
    icon: ClipboardList,
    modulo: "chamados",
    permissao: ["chamados.ver", "chamados.criar", "chamados.gerenciar"],
  },
  {
    to: "/clientes",
    label: "Clientes",
    icon: Users,
    modulo: "clientes",
    permissao: ["clientes.ver", "aniversarios.ver"],
    filhos: [
      { to: "/clientes", label: "Lista", end: true, permissao: ["clientes.ver"] },
      { to: "/clientes/aniversarios", label: "Aniversários", permissao: ["aniversarios.ver"] },
    ],
  },
  { to: "/certificados", label: "Certificados digitais", icon: BadgeCheck, modulo: "certificados", permissao: ["certificados.ver"] },
  { to: "/pendencias-fiscais", label: "Pendências fiscais", icon: Landmark, modulo: "pendenciasFiscais", permissao: ["serpro.consultar"] },
  { to: "/equipe", label: "Equipe", icon: UsersRound, modulo: "equipe", permissao: ["equipe.ver", "equipe.gerenciar"] },
];

/** Fica no pé do menu. Quem só gerencia números cai direto em Conexões. */
export const NAV_CONFIGURACOES: NavItem = {
  to: "/configuracoes",
  label: "Configurações",
  icon: Settings,
  permissao: ["configuracoes.gerenciar", "whatsapp.conexoes"],
};
