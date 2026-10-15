import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Root = TooltipPrimitive.Root;
const Trigger = TooltipPrimitive.Trigger;

function Content({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md",
          "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/**
 * Tooltip simples — passa `label` e o `children` é o gatilho. Default
 * com delay 300ms (não atrapalha quem só passa o mouse rápido).
 *
 *   <Tooltip label="Excluir"><Button><Trash2/></Button></Tooltip>
 */
export function Tooltip({
  label,
  children,
  side = "top",
  delay = 300,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delay?: number;
}) {
  if (!label) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={delay} skipDelayDuration={100}>
      <Root>
        <Trigger asChild>{children}</Trigger>
        <Content side={side}>{label}</Content>
      </Root>
    </TooltipProvider>
  );
}
