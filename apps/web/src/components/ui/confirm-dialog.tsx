import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ConfirmOptions = {
  titulo: string;
  descricao?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Resolver = (value: boolean) => void;

let externalResolver: Resolver | null = null;
let externalSetState: ((s: ConfirmOptions | null) => void) | null = null;

/**
 * Provider singleton — monte uma vez no app (em main.tsx via App tree).
 * Depois use a função `confirmar()` em qualquer lugar como substituta
 * de `window.confirm()`:
 *
 *   if (!(await confirmar({ titulo: "Excluir?", destructive: true }))) return;
 */
export function ConfirmDialogProvider() {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    externalSetState = setState;
    return () => {
      externalSetState = null;
    };
  }, []);

  function fechar(ok: boolean) {
    setState(null);
    externalResolver?.(ok);
    externalResolver = null;
  }

  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) fechar(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state?.destructive ? (
              <AlertTriangle className="size-5 text-destructive" />
            ) : null}
            {state?.titulo}
          </DialogTitle>
          {state?.descricao ? (
            <DialogDescription className="[overflow-wrap:anywhere]">
              {state.descricao}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={() => fechar(false)}
          >
            {state?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            variant={state?.destructive ? "destructive" : "default"}
            onClick={() => fechar(true)}
          >
            {state?.confirmLabel ?? "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Substitui window.confirm — retorna Promise<boolean>. */
export function confirmar(options: ConfirmOptions): Promise<boolean> {
  if (!externalSetState) {
    // Fallback se o provider não estiver montado
    return Promise.resolve(window.confirm(options.titulo));
  }
  return new Promise<boolean>((resolve) => {
    externalResolver = resolve;
    externalSetState!(options);
  });
}
