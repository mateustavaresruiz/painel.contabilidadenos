-- 024 — QR da conexão do WhatsApp fora do alcance da tela
--
-- A coluna WhatsappSessao."qrCodeBase64" deixa de ser legível por
-- anon/authenticated (grant por coluna). Quem tinha só whatsapp.ver lia o QR
-- direto da tabela e podia vincular um aparelho à conta do escritório. O QR
-- continua saindo pela rota /qr da function whatsapp, que exige
-- whatsapp.conexoes.
--
-- 🔴 ORDEM: aplicar DEPOIS de publicar o front que não faz mais select("*") em
-- WhatsappSessao (commit 1afe287). Antes disso a tela do WhatsApp no ar quebra.
-- Depois de aplicar, quem estiver com o painel aberto precisa recarregar (F5).
--
-- 🔴 Coluna NOVA em WhatsappSessao que a tela precise ler entra no grant abaixo
-- (numa migração nova); sem isso o select dela dá "permission denied".
--
-- Não destrutiva.

revoke select on public."WhatsappSessao" from anon, authenticated;
grant select (id, "tenantId", nome, apelido, numero, status, "pushName", "ultimoErro",
              "fotoPath", "fotoPersonalizada", "conectadoEm", "criadoEm", "atualizadoEm")
  on public."WhatsappSessao" to authenticated;
