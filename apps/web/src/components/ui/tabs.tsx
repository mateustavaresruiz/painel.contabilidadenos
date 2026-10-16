import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";

import { useFadeRolagem } from "@/hooks/use-fade-rolagem";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const fade = useFadeRolagem<HTMLDivElement>();
  return (
  <TabsPrimitive.List
    ref={(n) => {
      fade(n);
      if (typeof ref === "function") ref(n);
      else if (ref) ref.current = n;
    }}
    className={cn(
      // max-w-full + rolagem: no celular as abas rolam de lado em vez de cortar.
      "inline-flex h-9 max-lg:h-11 max-w-full items-center justify-start overflow-x-auto scrollbar-none rounded-full border border-border bg-card p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-7 max-lg:h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs transition-[color,background-color,transform] duration-150 active:scale-[.97] [&_svg]:size-3.5 disabled:pointer-events-none disabled:opacity-50 hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:font-semibold",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-150",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
