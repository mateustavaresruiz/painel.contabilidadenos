import { Smile } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Paleta curada de emojis comuns — sem dependência externa nem fetch. O
// objetivo é "mandar um emoji" rápido no chat, não um teclado completo. Se
// um dia precisar de busca/skin tones, dá pra trocar por @emoji-mart.
const GRUPOS: { titulo: string; emojis: string[] }[] = [
  {
    titulo: "Rostos",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "😊",
      "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😋", "😜",
      "🤪", "🤨", "🧐", "🤓", "😎", "🥳", "🤩", "😏", "😒", "😔",
      "🙁", "😣", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡",
      "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓",
      "🤔", "🤭", "🤫", "😶", "😐", "😬", "🙄", "😴", "🤤", "🤐",
      "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🥱",
    ],
  },
  {
    titulo: "Gestos",
    emojis: [
      "👍", "👎", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙",
      "👈", "👉", "👆", "👇", "☝️", "✋", "🤚", "🖐️", "🖖", "👋",
      "🤝", "🙏", "✍️", "💪", "🙌", "👏", "🙆", "🤷", "🤦", "💁",
      "🙋",
    ],
  },
  {
    titulo: "Corações",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟",
    ],
  },
  {
    titulo: "Símbolos",
    emojis: [
      "🔥", "✨", "⭐", "🌟", "🎉", "🎊", "✅", "❌", "❗", "❓",
      "⚠️", "📌", "📎", "📞", "📅", "💰", "💵", "📄", "📝", "👀",
      "🎯", "💡", "🚀", "⏰", "💯", "👑", "🎁", "☕",
    ],
  },
];

/**
 * Botão de emoji + popover com paleta curada. Chama `onPick(emoji)` a cada
 * clique e MANTÉM o popover aberto (foco fica dentro do conteúdo do Radix),
 * pra dar pra mandar vários sem reabrir. A inserção no cursor é
 * responsabilidade do chamador (ver Composer).
 */
export function EmojiPicker({
  onPick,
  disabled,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 toque:size-11"
          disabled={disabled}
          title="Emoji"
          aria-label="Inserir emoji"
        >
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[324px] p-2"
        // Não devolve o foco pro trigger ao fechar — deixa o usuário voltar
        // pro campo de texto naturalmente.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-64 overflow-y-auto pr-1 space-y-3">
          {GRUPOS.map((g) => (
            <div key={g.titulo}>
              <p className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.titulo}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {g.emojis.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => onPick(e)}
                    className="size-9 grid place-items-center rounded-md text-xl leading-none hover:bg-accent transition-colors"
                    aria-label={e}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
