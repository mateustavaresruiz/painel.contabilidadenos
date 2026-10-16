// Edge Function: portal. Ver o cabeçalho de handler.ts (rotas e regras).
import { exigirColaborador } from "../_shared/acesso.ts";
import { dentroDoLimite } from "../_shared/rate-limit.ts";
import { serve } from "../_shared/serve.ts";
import { gerarSenhaForte, hashSenha, verifySenha } from "../_shared/senha.ts";
import { hashToken, randomToken } from "../_shared/token.ts";
import { criarHandler } from "./handler.ts";
import { repoReal } from "./repo.ts";

/** Endereço do site do painel, onde mora a página /portal/<token>. */
const WEB_URL = (Deno.env.get("PORTAL_WEB_URL") ?? "https://painel-web.at63vf.easypanel.host").replace(/\/+$/, "");

serve(
  criarHandler({
    repo: repoReal,
    hashToken,
    randomToken,
    gerarSenha: gerarSenhaForte,
    hashSenha,
    verifySenha,
    limite: (action, sujeito, max, windowSecs) => dentroDoLimite({ action, sujeito, max, windowSecs }),
    autenticar: async (req, permissao) => {
      const eu = await exigirColaborador(req, { permissao });
      return eu instanceof Response ? eu : { id: eu.id, nome: eu.nome };
    },
    baseUrl: WEB_URL,
  }),
);
