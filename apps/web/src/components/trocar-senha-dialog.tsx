import { FormSenhaNova } from "@/components/senha-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEu } from "@/lib/colaborador";
import { sessaoPorLink } from "@/lib/senha";
import { toast } from "@/lib/toast";

/**
 * "Trocar senha" / "Criar senha" do menu da conta. Sessão aberta com senha:
 * o Auth exige a senha atual (GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD).
 * Sessão aberta por link/código: o Auth não pede (é o caminho de quem esqueceu).
 * Salvar encerra as outras sessões da pessoa (celular, outro computador).
 */
export function TrocarSenhaDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { eu, sessao } = useEu();
  const criar = eu?.senhaDefinidaEm === null;
  const pedirAtual = !sessaoPorLink(sessao) && !criar;
  // Entrou pelo Google sem ter criado senha: o Auth pediria uma senha atual que a pessoa não conhece.
  const semCaminho = !sessaoPorLink(sessao) && criar;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{criar ? "Criar senha" : "Trocar senha"}</DialogTitle>
          <DialogDescription>
            {criar
              ? "Daqui em diante você entra no painel com o seu e-mail e esta senha."
              : "Os outros aparelhos em que você está conectado vão pedir a senha nova."}
          </DialogDescription>
        </DialogHeader>
        {semCaminho ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Para criar a senha, peça a um administrador um link de acesso em Equipe. Ao entrar pelo link, o painel
              pede a senha nova.
            </p>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onFechar}>
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          aberto && (
            <FormSenhaNova
              pedirAtual={pedirAtual}
              autoFocus
              rotuloBotao={criar ? "Criar senha" : "Salvar senha nova"}
              onSucesso={() => {
                toast.success(criar ? "Senha criada" : "Senha trocada");
                onFechar();
              }}
              rodape={
                <Button type="button" variant="ghost" onClick={onFechar} className="mr-auto">
                  Cancelar
                </Button>
              }
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
