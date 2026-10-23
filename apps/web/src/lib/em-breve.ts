// Módulos da fase 2 (reunião com a Franceli em 07/10/2026): aparecem no fim do
// menu com o selo "Em breve", sem link (não abrem nada até existirem).
//
// Quando um módulo sair do papel, ele vira item normal em app-nav.ts e sai
// daqui.

import type { LucideIcon } from "lucide-react";
import { FileSignature, ListChecks, Target, Wallet } from "lucide-react";

export type ModuloEmBreve = { chave: string; menu: string; icone: LucideIcon };

export const MODULOS_EM_BREVE: ModuloEmBreve[] = [
  { chave: "comercial", menu: "Comercial (CRM)", icone: Target },
  { chave: "financeiro", menu: "Financeiro", icone: Wallet },
  { chave: "contratos", menu: "Contratos", icone: FileSignature },
  { chave: "tarefas", menu: "Tarefas", icone: ListChecks },
];
