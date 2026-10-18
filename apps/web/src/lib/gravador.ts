/**
 * Gravador de atendimento: captura o áudio, entrega um arquivo pronto para
 * subir. Só isso. Não fala com o Supabase, não conhece cliente nem gravação:
 * quem costura é `queries/gravacoes.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * UMA FAIXA POR FONTE, CADA UMA CONTÍNUA
 * ────────────────────────────────────────────────────────────────────────
 *   `microfone`   — o microfone da máquina: quem está na sala.
 *   `dispositivo` — o áudio da GUIA do navegador. É assim que Google Meet, Zoom
 *                   e Teams entregam o outro lado: o usuário escolhe a aba da
 *                   reunião e marca "compartilhar áudio da guia".
 *
 * Cada uma é gravada DIRETO do próprio stream, num arquivo próprio e contínuo, e
 * transcrita separadamente. A emenda dos dois textos acontece no servidor, pelo
 * carimbo de tempo de cada fala (ver `gravacao-processar`).
 *
 * 🔴 ESTA É A TERCEIRA VERSÃO DISTO, e as duas anteriores explicam o desenho:
 *
 *   v1 — duas faixas, mas PICADAS A CADA 5 MINUTOS. A separação de quem falou
 *        funcionava; o picote é que era ruim (emenda cortando palavra no meio,
 *        idioma detectado pedaço a pedaço).
 *   v2 — arquivo único MISTURADO, para matar o picote. Matou junto a separação de
 *        quem falou, que era o diferencial, e ainda pôs o `AudioContext` no
 *        caminho crítico: contexto suspenso grava silêncio SEM DAR ERRO.
 *   v3 — o que está aqui: separado como a v1, contínuo como a v2. O picote nunca
 *        foi consequência de separar as faixas; era um problema à parte.
 *
 * O `AudioContext` saiu do caminho crítico junto: ele agora serve só ao medidor
 * de nível e ao áudio DO VÍDEO. Se falhar, perde-se a barrinha e o som do vídeo,
 * nunca a gravação que vira texto.
 *
 * O preço: duas transcrições em vez de uma quando há reunião remota, ou seja o
 * dobro de minutos cobrados. É o custo da separação, e é pequeno em absoluto.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 POR QUE EXISTE "PARTE", se cada faixa é contínua
 * ────────────────────────────────────────────────────────────────────────
 * A API de transcrição recusa acima de 25 MB. No bitrate que usamos isso dá
 * mais ou menos 100 minutos, então atendimento normal cabe inteiro num arquivo
 * e nunca vê uma emenda. Audiência longa passa disso, e aí não há escolha: a
 * faixa vira uma segunda parte.
 *
 * A troca é medida em BYTES, não em relógio, porque é byte que a API recusa. Por
 * isso o `start()` leva um `timeslice`: os pedaços que ele entrega não servem
 * como arquivo sozinhos — e não é para isso que servem aqui —, servem para
 * SOMAR e saber quando a parte está perto do teto. Eles são acumulados e só
 * viram arquivo quando a parte fecha, que é quando o WebM ganha cabeçalho e
 * final de verdade.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 🔴 O VÍDEO É UMA TRILHA À PARTE, e não substitui as de áudio
 * ────────────────────────────────────────────────────────────────────────
 * Gravar a imagem da guia é opcional e desligado por padrão. Quando entra, ela é
 * uma TERCEIRA trilha, com o áudio misturado só para ficar assistível.
 *
 * Extrair o som do arquivo de vídeo na hora de transcrever seria "mais
 * econômico" e não funcionaria por dois motivos: a API recusa acima de 25 MB (e
 * vídeo passa disso em minutos), e o som ali já vem MISTURADO — ou seja, sem a
 * separação de quem falou, que é justamente o que se quer.
 */

export type FonteDeAudio = "microfone" | "dispositivo";

/**
 * `audio` é o que vira transcrição. `video` é o registro da tela da reunião, um
 * artefato à parte: não passa pela transcrição (o teto de 25 MB da API mataria
 * em minutos) e pode ser apagado sozinho, liberando disco sem perder o texto.
 */
export type TipoDeParte = FonteDeAudio | "video";

export type PartePronta = {
  tipo: TipoDeParte;
  /** Índice da parte (0, 1, 2...). No caso normal só existe a 0. */
  ordem: number;
  /** Milissegundos desde o início da gravação. */
  inicioMs: number;
  duracaoMs: number;
  blob: Blob;
  mimeType: string;
  /** Extensão do arquivo, derivada do mime que o navegador escolheu. */
  ext: string;
};

export type EstadoGravador = "ocioso" | "gravando" | "pausado" | "encerrado";

/**
 * Bitrate do áudio gravado. 32 kbps em opus é folgado para VOZ (opus foi
 * desenhado para fala e a esta taxa ela sai limpa), e é o que torna a conta do
 * teto previsível: 25 MB / 32 kbps ≈ 104 minutos por parte.
 */
const BITRATE = 32_000;

/**
 * Quando fechar a parte e abrir outra. 22 MB e não 25: a margem cobre o
 * cabeçalho, a variação do encoder e o fato de a checagem só acontecer a cada
 * fatia. Estourar o teto seria descobrir na hora de transcrever, quando a
 * audiência já acabou.
 */
const MAX_BYTES_PARTE = 22 * 1024 * 1024;

/** De quanto em quanto tempo o recorder entrega bytes para gente somar. */
const FATIA_MS = 5_000;

/** Teto duro: 8 horas. Passou disso, encerra sozinho em vez de comer memória. */
export const DURACAO_MAXIMA_MS = 8 * 60 * 60 * 1000;

/**
 * Contêineres na ordem de preferência. Opus é o que dá arquivo pequeno com voz
 * limpa; o mp4/aac é a saída pro Safari, que não faz webm. A lista existe
 * porque `MediaRecorder` joga se receber um mime que ele não suporta, e
 * descobrir isso no meio de uma audiência seria péssimo.
 */
const CONTAINERS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function escolherMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of CONTAINERS) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return ""; // deixa o navegador decidir
}

function extDoMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("aac")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}

/** O navegador tem o que é preciso para gravar? */
export function gravacaoSuportada(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Dá para capturar a tela? (Chrome/Edge no desktop; Safari não) */
export function capturaDeTelaSuportada(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

/**
 * O navegador entrega ÁUDIO junto com a tela?
 *
 * 🔴 ISSO É EXCLUSIVO DO CHROMIUM, e a checagem existe porque o resto do módulo
 * agora EXIGE o som da guia. O Firefox implementa `getDisplayMedia` e ignora a
 * parte do áudio em silêncio: sem erro, sem aviso, simplesmente não vem faixa de
 * som (bugzilla 1541425, aberto). Ele ainda nem oferece guia no seletor. O
 * Safari está no mesmo lugar.
 *
 * Sem esta checagem, quem abrisse o adv3 no Firefox veria o modo de reunião,
 * escolheria a tela e receberia uma recusa sem entender por quê. Melhor a opção
 * nascer desligada, dizendo que o caminho é Chrome ou Edge.
 *
 * A detecção é por marca do navegador porque não existe feature detection para
 * isso: `getDisplayMedia` está presente nos três, e a diferença só aparece
 * depois de o usuário escolher.
 */
export function capturaComAudioSuportada(): boolean {
  if (typeof navigator === "undefined") return false;
  const marcas = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } })
    .userAgentData?.brands;
  if (marcas?.length) return marcas.some((m) => /Chromium|Google Chrome|Microsoft Edge/i.test(m.brand));
  // Navegador sem `userAgentData` (Firefox, Safari): sobra o UA, e o que
  // interessa é justamente excluir esses dois.
  const ua = navigator.userAgent;
  return /Chrome|Chromium|Edg\//.test(ua) && !/Firefox|FxiOS/.test(ua);
}

export class ErroDeGravacao extends Error {
  readonly causa:
    | "permissao"
    | "sem-audio"
    | "superficie-errada"
    | "sem-suporte"
    | "sem-gesto"
    | "sem-tela-inteira"
    | "desconhecida";
  constructor(message: string, causa: ErroDeGravacao["causa"]) {
    super(message);
    this.name = "ErroDeGravacao";
    this.causa = causa;
  }
}

/**
 * O tamanho e o ritmo pedidos ao navegador, alinhados com o que o relé grava de
 * fato (`LARGURA_MAX_VIDEO`, `FPS_VIDEO`). Pedir grande e reduzir depois só
 * gastaria trabalho de captura para jogar pixel fora.
 *
 * ⚠️ AQUI JÁ ESTEVE 1080p A 15 fps, com o argumento de que resolução alta
 * custava quase nada porque "o codificador não escreve o que não muda". Custava:
 * o relé repinta, todo repinte é quadro novo, e o resultado medido foi 555 MB
 * por hora. Ver `BITRATE_VIDEO`.
 *
 * Isto continua sendo PREFERÊNCIA, e não requisito: em tela inteira o navegador
 * costuma entregar o tamanho nativo do monitor de qualquer forma, e quem impõe
 * o limite de verdade é o canvas do relé.
 */
const VIDEO_PREFERIDO: MediaTrackConstraints = {
  frameRate: { ideal: 15, max: 30 },
  width: { max: 1920 },
  height: { max: 1080 },
};

/**
 * Membros de PRIMEIRO NÍVEL do `DisplayMediaStreamOptions`, que o lib.dom do
 * TypeScript ainda não declara.
 *
 * 🔴 O ANINHAMENTO É A ARMADILHA: `selfBrowserSurface`, `surfaceSwitching` e
 * `monitorTypeSurfaces` moram na RAIZ do dicionário, enquanto `displaySurface` é
 * constraint e mora dentro de `video`. No lugar errado, o WebIDL descarta em
 * silêncio e fica parecendo que a opção não funciona.
 */
type OpcoesDeTela = DisplayMediaStreamOptions & {
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  monitorTypeSurfaces?: "include" | "exclude";
};

/**
 * Os argumentos do pedido.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 SÓ GUIA, DESDE 27/08/2026, E A DECISÃO É DO DONO DEPOIS DE ESGOTAR O RESTO.
 *
 * O áudio do sistema no Windows é loopback WASAPI da saída padrão, e quando essa
 * saída está num estado que o Chrome não consegue abrir, o pedido inteiro morre
 * com `NotReadableError` — imagem junto. Não é defeito nosso e não há API que
 * contorne: o mesmo sintoma está reportado no Chromium via jitsi-meet#15417 e
 * #15418, os dois fechados sem correção. Aba com áudio funciona; tela inteira
 * com áudio quebra.
 *
 * Como o produto precisa do som dos dois lados para transcrição valer alguma
 * coisa, a superfície deixou de ser escolha: pede-se a GUIA, cujo áudio sai do
 * processo da própria aba e não encosta na saída do Windows.
 *
 * ⚠️ O QUE ISSO CUSTA, e é bom estar escrito: reunião em APLICATIVO INSTALADO
 * (Teams, Zoom desktop) deixa de ter imagem gravável. Quem usa isso grava só o
 * microfone. Foi decisão consciente: o caminho que serviria a esse caso é
 * justamente o que não funciona.
 *
 * ⚠️ E `monitorTypeSurfaces` NÃO cobre tudo: ele tira "Tela inteira" do seletor,
 * mas o painel "Janela" continua lá e não existe opção que o remova. Quem
 * termina o serviço é a checagem da superfície DEVOLVIDA, em
 * `capturarTelaDaReuniao` — a spec obriga o navegador a deixar o usuário
 * escolher, então a única garantia é olhar o que veio.
 * ══════════════════════════════════════════════════════════════════════════════
 */
function argumentosDe(semAudio: boolean, comVideo: boolean): OpcoesDeTela {
  return {
    // `video` é exigência do Chrome mesmo quando só se quer o áudio: sem pedir
    // imagem ele não oferece a lista de superfícies. Quando o vídeo não foi
    // pedido, a trilha é descartada em `prepararStream`.
    //
    // `displaySurface: "browser"` abre o seletor já no painel da guia. É dica, e
    // é por isso que sozinha ela não basta.
    video: comVideo
      ? { ...VIDEO_PREFERIDO, displaySurface: "browser" }
      : // Sem imagem gravada, mas o pedido continua sendo o da guia: é a
        // superfície que traz o som certo, e a faixa de vídeo é descartada em
        // `prepararStream` logo depois.
        { displaySurface: "browser" },
    audio: !semAudio,
    // Tira a própria aba do adv3 da lista: escolhê-la grava o efeito espelho
    // deste diálogo.
    selfBrowserSurface: "exclude",
    // Tira o painel "Tela inteira". O painel "Janela" não tem equivalente.
    monitorTypeSurfaces: "exclude",
    // Deixa trocar de guia sem encerrar a gravação.
    surfaceSwitching: "include",
  };
}

/** O que a pessoa escolheu de fato: a spec obriga o navegador a deixá-la escolher. */
function superficieDe(stream: MediaStream): string | null {
  const cfg = stream.getVideoTracks()[0]?.getSettings() as
    | { displaySurface?: string }
    | undefined;
  return cfg?.displaySurface ?? null;
}

/**
 * Pede ao navegador a tela da reunião: imagem e, quando houver, som.
 *
 * 🔴 O NOME IMPORTA, E O ANTIGO CAUSOU UM DEFEITO. Ela se chamava
 * `capturarAudioDaGuia`, e por causa disso jogava fora a faixa de IMAGEM quando
 * o compartilhamento vinha sem áudio — o que é comum, porque janela não oferece
 * áudio nenhum e na tela inteira a caixinha é fácil de não marcar. Resultado:
 * quem pedia vídeo recebia uma gravação só de microfone. Aqui o áudio é o
 * acessório; a imagem é o pedido.
 *
 * 🔴 CHAME ISTO COMO A PRIMEIRA COISA DO CLIQUE, ANTES DE QUALQUER `await`.
 * `getDisplayMedia` exige *transient activation*: ela só funciona enquanto o
 * navegador considera que a página ainda está respondendo a um gesto do
 * usuário, e essa janela é de poucos segundos. Chamada depois de uma ida ao
 * servidor, ela lança `InvalidStateError` e o seletor de guia NUNCA APARECE.
 *
 * Isso não é teoria: foi exatamente o defeito. A função ficava atrás de duas
 * chamadas de rede, então em rede rápida o seletor abria e em rede lenta não
 * abria — e a mensagem de erro ainda dizia que o usuário tinha cancelado.
 *
 * Por isso ela mora FORA da classe: quem chama precisa poder invocá-la no
 * primeiro instante do clique e só depois montar o resto.
 */
export async function capturarTelaDaReuniao(
  opts: { comVideo?: boolean; semAudio?: boolean } = {},
): Promise<MediaStream> {
  if (!capturaDeTelaSuportada()) {
    throw new ErroDeGravacao(
      "Este navegador não captura o áudio de uma guia. Use o Chrome ou o Edge no computador.",
      "sem-suporte",
    );
  }
  const semAudio = !!opts.semAudio;
  let bruto: MediaStream;
  try {
    bruto = await navigator.mediaDevices.getDisplayMedia(
      argumentosDe(semAudio, !!opts.comVideo),
    );
  } catch (e) {
    const nome = (e as Error)?.name ?? "";

    // ══════════════════════════════════════════════════════════════════════════
    // 🔴 UMA SEGUNDA TENTATIVA, CRUA, E SÓ UMA.
    //
    // Os limites de resolução são PREFERÊNCIA, não requisito, e monitor grande
    // (4K, ultrawide) é onde o navegador às vezes recusa a combinação em vez de
    // reduzir. O tamanho do arquivo continua controlado porque quem decide a
    // resolução gravada é o relé, não a fonte.
    //
    // `NotReadableError` entra aqui junto com os erros de constraint, e isso é
    // decisão MEDIDA, não teoria: o pedido cru é o que funciona em máquina onde
    // o pedido detalhado falha. Ele já foi tirado daqui uma vez, com bom
    // argumento no papel, e o resultado foi captura que funcionava parando de
    // funcionar.
    //
    // ⚠️ `NotAllowedError` NÃO entra: ali a pessoa já viu o seletor e recusou, e
    // reabrir seria insistir sobre um "não".
    // ══════════════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
    // 🔴 ÁUDIO DO SISTEMA QUEBRADO: CONFIRMADO PELO DONO EM 27/08/2026, COM
    // PRINT. Ligando "Share with system audio" a captura falha; desligando, ela
    // grava a tela normalmente. Some o áudio, some o defeito.
    //
    // A cadeia, no código do Chromium: o áudio do sistema no Windows é loopback
    // WASAPI do dispositivo de REPRODUÇÃO padrão (`kLoopbackInputDeviceId`,
    // `eRender`, `GetDefaultAudioEndpoint` com papel `eConsole`). Se esse
    // endpoint não inicia, vem `TRACK_START_FAILURE_AUDIO`, o Blink converte em
    // `NotReadableError` e o erro derruba a captura INTEIRA, imagem junto.
    //
    // ⚠️ REPETIR AQUI É SELETOR JOGADO FORA: a segunda chamada pede o mesmo
    // áudio e morre na mesma função. Quem decide o próximo passo é a pessoa,
    // com os botões que a tela oferece, e cada botão traz ativação nova.
    //
    // A retentativa crua continua valendo para os erros de CONSTRAINT e para o
    // pedido que já vem sem áudio: ali ela não esbarra no loopback.
    // ══════════════════════════════════════════════════════════════════════════
    if (nome === "NotReadableError" && !semAudio) {
      console.error(`[gravacao] áudio do sistema não subiu: ${nome} (pedido com áudio)`);
      throw new ErroDeGravacao(
        "O Windows não entregou o áudio do sistema, e o navegador cancelou o " +
          "compartilhamento inteiro por causa disso. Duas saídas: compartilhe a GUIA da " +
          'reunião marcando "Compartilhar áudio da guia" ("Also share tab audio"), que é ' +
          "outro caminho de som e não depende da saída do Windows, ou grave a tela sem o " +
          "som do computador.",
        "sem-tela-inteira",
      );
    }

    if (
      nome === "OverconstrainedError" ||
      nome === "TypeError" ||
      nome === "NotSupportedError" ||
      nome === "NotReadableError"
    ) {
      try {
        bruto = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: !semAudio,
        });
      } catch (e2) {
        const nome2 = (e2 as Error)?.name ?? "";
        // 🔴 O NOME DO ERRO VAI JUNTO, E AQUI ELE TINHA SUMIDO. Esta é a
        // mensagem final da captura: engolir os dois nomes deixa "não consegui"
        // valendo para sete causas diferentes, e o diagnóstico volta a ser
        // adivinhação. Já custou caro neste módulo, e custou de novo em
        // 27/08/2026, quando o relato veio sem o único dado que decidia.
        // 🔴 TEXTO PLANO, E NÃO UM OBJETO. Objeto no console chega colapsado
        // como "Object", e quem está reportando o defeito manda o print do jeito
        // que apareceu: a informação existe e não é lida. Uma linha só, com
        // tudo escrito, é o que sobrevive ao copiar e colar.
        console.error(
          `[gravacao] captura falhou: primeira=${nome || "?"} segunda=${nome2 || "?"} ` +
            `semAudio=${semAudio} comVideo=${!!opts.comVideo} ` +
            `msg=${(e2 as Error)?.message || "sem mensagem"}`,
        );
        throw new ErroDeGravacao(
          (semAudio
            ? "O navegador não conseguiu capturar a tela, nem sem som. Feche o que estiver " +
              "capturando ou espelhando a tela (gravador de vídeo, acesso remoto, reunião já " +
              "compartilhando) e reinicie o navegador. Para gravar agora, volte e escolha " +
              '"Atendimento presencial": o microfone sozinho não depende disso.'
            : "O navegador não conseguiu abrir o compartilhamento. Vale tentar de novo " +
              "escolhendo outra opção na janela do navegador: a guia da reunião costuma " +
              "funcionar onde a tela inteira falha, e gravar sem o som do computador " +
              "descarta o áudio como culpado.") + ` (${nome} / ${nome2 || "sem nome"})`,
          semAudio ? "sem-suporte" : "sem-tela-inteira",
        );
      }
      return prepararStream(bruto, opts);
    }
    if (nome === "InvalidStateError") {
      // O seletor nem chegou a aparecer: o gesto do usuário já tinha expirado.
      // Culpar o usuário aqui ("você cancelou") é o pior erro possível, porque
      // manda procurar defeito onde não há.
      throw new ErroDeGravacao(
        "O navegador não chegou a pedir a guia (o clique já tinha expirado). Tente de novo.",
        "sem-gesto",
      );
    }
    if (nome === "NotAllowedError") {
      // 🔴 NÃO AFIRME "você cancelou" AQUI. `NotAllowedError` cobre DOIS casos
      // que a pessoa vive de forma oposta: ela clicou em cancelar no seletor,
      // ou o navegador recusou na POLÍTICA e o seletor nunca apareceu. O
      // segundo aconteceu de verdade — o `Permissions-Policy` do site trazia
      // `display-capture=()` (corrigido no .htaccess em 27/08/2026) —, e a
      // mensagem que culpava o usuário mandou procurar defeito onde não havia,
      // duas vezes. A frase abaixo cobre os dois sem mentir em nenhum.
      // ⚠️ A ÚLTIMA FRASE MENTIA. Ela dizia "a gravação continua pelo
      // microfone", que era verdade enquanto o compartilhamento negado virava
      // aviso. Com a conferência, captura que não vem não grava nada.
      throw new ErroDeGravacao(
        "O navegador não liberou o compartilhamento da tela. Se a janela de escolha " +
          "nem chegou a aparecer, é bloqueio do navegador, não escolha sua. Para gravar " +
          'só o microfone, volte e escolha "Atendimento presencial".',
        "permissao",
      );
    }
    // 🔴 O NOME DO ERRO VAI JUNTO. Sem ele esta linha vira "não consegui" para
    // sete causas diferentes, e o diagnóstico volta a ser adivinhação — que é o
    // que já custou caro neste módulo.
    throw new ErroDeGravacao(
      `Não consegui capturar a tela (${nome || "erro desconhecido"}). Tente de novo.`,
      "desconhecida",
    );
  }


  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 SÓ GUIA, E SÓ COM SOM. Duas paredes, nesta ordem.
  //
  // ⚠️ A REGRA JÁ FOI "QUEM DECIDE É O SOM" POR ALGUMAS HORAS, aceitando janela
  // e tela inteira quando o áudio do sistema vinha junto. Era defensável no
  // papel — gravação com som está completa, seja qual for a superfície — e o
  // dono cortou depois de ver na prática: janela com o áudio do sistema marcado
  // é o caminho que FALHA na máquina dele, e deixar a porta entreaberta só
  // multiplica o jeito de errar. Menos escolha, menos erro.
  //
  // A superfície é conferida no que VOLTOU, não no que foi pedido:
  // `displaySurface` é dica e `monitorTypeSurfaces` só apaga o painel da tela
  // inteira. "Janela" continua escolhível e a spec obriga o navegador a deixar
  // escolher, então a garantia é olhar a faixa devolvida.
  // ══════════════════════════════════════════════════════════════════════════
  if (superficieDe(bruto) !== "browser") {
    bruto.getTracks().forEach((t) => t.stop());
    throw new ErroDeGravacao(
      'Aqui só dá para gravar a GUIA da reunião: na janela de escolha, use a aba "Guia do ' +
        'Chrome" ("Chrome Tab"). Janela e tela inteira dependem do áudio do sistema, que ' +
        "falha nesta máquina e derruba a captura inteira.",
      "superficie-errada",
    );
  }

  // O som da guia é exigido, e dá para exigir porque dá para DETECTAR: a caixinha
  // vem ligada por padrão, mas pode ser desmarcada, e desmarcada em silêncio (o
  // stream volta com imagem e nenhuma faixa de áudio). Pré-marcar é que não dá:
  // consentimento de áudio é ato do usuário, e quem decide é o navegador.
  if (!semAudio && bruto.getAudioTracks().length === 0) {
    bruto.getTracks().forEach((t) => t.stop());
    throw new ErroDeGravacao(
      'Faltou marcar "Compartilhar áudio da guia" ("Also share tab audio") na janela de ' +
        "escolha. Sem isso a voz de quem está do outro lado não entra na gravação.",
      "sem-audio",
    );
  }

  // Duas linhas no console que respondem sozinhas o que antes se perguntava por
  // mensagem: qual superfície, com ou sem som, quantas faixas.
  const superficie = superficieDe(bruto) ?? "?";
  console.info(
    `[gravacao] captura aberta: superficie=${superficie} ` +
      `audio=${bruto.getAudioTracks().length} video=${bruto.getVideoTracks().length} ` +
      `pedidoSemAudio=${semAudio}`,
  );

  return prepararStream(bruto, opts);
}

/** Descarta o que não foi pedido e decide se sobrou coisa suficiente. */
function prepararStream(bruto: MediaStream, opts: { comVideo?: boolean }): MediaStream {
  if (!opts.comVideo) {
    bruto.getVideoTracks().forEach((t) => {
      t.stop();
      bruto.removeTrack(t);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 FALTAR ÁUDIO NÃO PODE MATAR O VÍDEO.
  //
  // Isto derrubava tudo quando o compartilhamento vinha sem som — e vir sem som
  // é COMUM: compartilhar uma janela não oferece áudio nenhum no Chrome, e na
  // tela inteira a caixinha do áudio do sistema é fácil de não marcar.
  //
  // O efeito era o oposto do esperado: a pessoa escolhia gravar a reunião em
  // vídeo, esquecia a caixinha, e a gravação saía SÓ com o microfone. A imagem,
  // que o navegador tinha entregue, ia pro lixo aqui.
  //
  // Agora só é fatal quando não sobra nada: sem áudio E sem imagem. Havendo
  // imagem, ela volta, e quem chamou avisa que o som do outro lado não vem.
  // ══════════════════════════════════════════════════════════════════════════
  if (bruto.getAudioTracks().length === 0 && bruto.getVideoTracks().length === 0) {
    bruto.getTracks().forEach((t) => t.stop());
    throw new ErroDeGravacao(
      'O compartilhamento veio sem áudio e sem imagem. Na janela de escolha, marque "Também compartilhar o áudio do sistema".',
      "sem-audio",
    );
  }

  return bruto;
}

/**
 * Abre o microfone da máquina, com as constraints que esta gravação exige.
 *
 * Mora fora da classe por simetria com `capturarTelaDaReuniao`: as duas abrem
 * fonte, e o tratamento de erro de cada uma fica num lugar só.
 */
async function abrirMicrofone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        // Desligados de propósito. Os três existem para deixar CHAMADA
        // agradável, e fazem isso cortando o que julgam ruído. Numa sala com
        // duas pessoas falando ao mesmo tempo, o que eles cortam é fala — e
        // fala cortada não volta na transcrição.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (e) {
    // Aqui SIM é fatal: sem microfone não há gravação nenhuma.
    const nome = (e as Error)?.name ?? "";
    if (nome === "NotAllowedError" || nome === "SecurityError") {
      throw new ErroDeGravacao(
        "O navegador bloqueou o microfone. Libere o acesso no cadeado da barra de endereço e tente de novo.",
        "permissao",
      );
    }
    throw new ErroDeGravacao(
      "Não consegui acessar o microfone. Confira se algum outro programa está usando ele.",
      "desconhecida",
    );
  }
}

export type OpcoesGravador = {
  /**
   * Áudio da guia JÁ CAPTURADO por `capturarTelaDaReuniao()`. Vem pronto de fora
   * exatamente por causa da regra do gesto do usuário (ver lá).
   */
  streamDispositivo?: MediaStream | null;
  onParte: (p: PartePronta) => void;
  onEstado?: (e: EstadoGravador) => void;
  /** Chamado ~1x por segundo com o tempo GRAVADO (pausa não conta). */
  onTempo?: (ms: number) => void;
  /** O usuário encerrou o compartilhamento da guia pelo botão do navegador. */
  onGuiaEncerrada?: () => void;
};

type Medidor = { analisador: AnalyserNode; buffer: Uint8Array<ArrayBuffer> };

/** Pico da onda no instante, 0 a 1. É o que as barrinhas desenham. */
function picoDoMedidor(m: Medidor): number {
  m.analisador.getByteTimeDomainData(m.buffer);
  let pico = 0;
  for (let i = 0; i < m.buffer.length; i++) {
    const v = Math.abs(m.buffer[i] - 128) / 128;
    if (v > pico) pico = v;
  }
  return Math.min(1, pico * 1.6);
}



/**
 * O que está acontecendo com a IMAGEM, para tela poder mostrar.
 *
 * 🔴 ISTO EXISTE PORQUE O VÍDEO PODE MORRER SOZINHO, EM SILÊNCIO. O Chrome
 * coloca a faixa de imagem de uma guia capturada em `muted` quando julga que
 * não há atividade suficiente nela — o áudio segue perfeito e o `MediaRecorder`
 * simplesmente para de receber quadro. Não é erro, não é evento de `ended`, não
 * é nada: o arquivo sai vazio e ninguém fica sabendo.
 * (Chromium 40703184 — "MediaRecorder produces 1 second duration files from
 * getDisplayMedia() Tab capture".)
 *
 * Aconteceu de verdade em 27/08/2026: gravação de 17min41 com as DUAS faixas de
 * áudio inteiras e zero bytes de vídeo, sem uma linha de aviso em lugar nenhum.
 * É o mesmo modo de falha que deu origem ao medidor de áudio, e a resposta é a
 * mesma: mostrar DURANTE, enquanto ainda dá para consertar.
 */
export type SaudeDoVideo = {
  /** A faixa de imagem ainda existe (o compartilhamento não foi encerrado). */
  ativa: boolean;
  /** O navegador não manda quadro novo há alguns segundos. Ver acima. */
  semImagem: boolean;
  /** Bytes de vídeo já gravados. */
  bytes: number;
  /** Quantos quadros a GUIA entregou de fato. É o número que encerra a dúvida. */
  quadros: number;
  /**
   * Quantos quadros o relé DESENHOU, que é o que virou vídeo. Comparado com o
   * tempo, diz se o relógio está no compasso ou foi estrangulado pelo navegador.
   */
  desenhos: number;
  /**
   * Quantos arquivos de vídeo a trilha chegou a ENTREGAR para subir. Zero com
   * `bytes` alto é o caso mais traiçoeiro: gravou e perdeu antes de sair da aba.
   */
  partes: number;
  /** O `MediaRecorder` do vídeo reclamou. */
  erro: string | null;
};

/**
 * Contêineres de VÍDEO, na mesma lógica da lista de áudio lá em cima.
 */
// ⚠️ AV1 (`video/webm;codecs=av01`) FICOU DE FORA DE PROPÓSITO. Ele comprime
// bem melhor que o VP9 e o Chrome aceita gravar com ele, mas sem aceleração por
// hardware o encoder come CPU e começa a descartar quadro — durante uma
// audiência, num notebook, é troca ruim: economiza disco e arrisca a gravação.
// VP9 já é ~50% melhor que VP8 e tem hardware na maioria das máquinas.
const CONTAINERS_VIDEO = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

function escolherMimeDeVideo(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of CONTAINERS_VIDEO) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/**
 * TETO da taxa do vídeo.
 *
 * ⚠️ AQUI TETO VIROU CONSUMO, E A MEDIÇÃO QUE DIZIA O CONTRÁRIO ESTAVA VELHA.
 * O texto anterior garantia que tela parada custava ~90 kbps e que a folga só
 * seria usada quando a tela mexesse. Isso foi medido ANTES do relé de canvas
 * existir, quando a guia entregava 11 quadros em 1min46 e o arquivo era leve
 * porque quase não havia quadro nenhum.
 *
 * 🔴 MEDIDO DEPOIS, EM 27/08/2026: 24 segundos de reunião = 3,7 MB, ou seja
 * 1,23 Mbps, o teto inteiro, em 555 MB por hora. O relé repinta o canvas mesmo
 * com a tela parada, e para o codificador todo repinte é quadro novo: a
 * economia de "não escrever o que não muda" deixou de acontecer sozinha.
 *
 * A correção de verdade é o relé pintar menos (ver `HEARTBEAT_VIDEO_MS`); este
 * número é o cinto.
 *
 * 🔴 MEDIDO EM 28/08 COM O RELÉ JÁ CORRIGIDO: 6min25 de reunião deram 10,4 MB,
 * ou seja **216 kbps reais** num teto de 450. O teto não estava limitando nada:
 * quem borrava a imagem era a RESOLUÇÃO (ver `LARGURA_MAX_VIDEO`), e sobrava
 * mais da metade da banda sem uso.
 *
 * Por isso ele sobe junto com a resolução, para os quadros que existem terem
 * bits de sobra. Continua sendo teto, e teto que o caso normal não alcança: com
 * pintura por novidade, tela parada gasta o que couber em uma pintura por
 * segundo, não 900 kbps.
 */
const BITRATE_VIDEO = 900_000;

/**
 * De quanto em quanto tempo o relé repinta quando NÃO chegou quadro novo.
 *
 * 🔴 É O QUE SEPARA "arquivo válido" de "arquivo caro". O relé existe porque
 * canvas que nunca é pintado não emite faixa e o vídeo sai vazio; mas pintar 15
 * vezes por segundo uma tela que não mudou gasta banda para gravar a mesma
 * imagem de novo. Com quadro novo, ele pinta na hora; sem quadro novo, pinta uma
 * vez por segundo, só para o stream continuar vivo.
 */
const HEARTBEAT_VIDEO_MS = 1_000;

/**
 * Teto por parte de VÍDEO. Diferente do áudio, e o motivo é outro: aqui não há
 * limite de API para respeitar (vídeo não vai para transcrição), o que manda é o
 * teto do bucket e a memória da aba, porque a parte inteira fica em RAM até
 * fechar. 200 MB cobre ~1h05 de reunião num arquivo só, que é o que faz o vídeo
 * ser ASSISTÍVEL: partido em pedaços, vira um monte de arquivo solto.
 */
const MAX_BYTES_PARTE_VIDEO = 200 * 1024 * 1024;

/**
 * Largura da miniatura. 480 px cobre com folga o tamanho em que ela é mostrada
 * e ainda serve numa tela retina; o arquivo fica em ~20 KB, que é o que permite
 * a listagem carregar dezenas delas sem pensar no assunto.
 */
const LARGURA_CAPA = 480;

/**
 * De quanto em quanto tempo tentar tirar a miniatura, e quantas vezes.
 *
 * 🔴 UMA TENTATIVA SÓ NÃO BASTA, e a prova veio de uma gravação real: a guia
 * entregou 11 quadros em 1min46 (o Chrome só manda quadro quando a tela
 * repinta), então aos 3 segundos o relé ainda mostrava o preto inicial e a
 * miniatura saiu preta. Insistir até vir um quadro com conteúdo é o que resolve,
 * e o teto existe para não ficar tentando a reunião inteira.
 */
const ESPERA_CAPA_MS = 5_000;
const TENTATIVAS_CAPA = 24;

/**
 * Quadros por segundo do relé de canvas (abaixo).
 *
 * ⚠️ ERA 15, PELO ARGUMENTO DE QUE TELA PARADA NÃO GERAVA BITS. Gerava: cada
 * repinte do relé é quadro novo para o codificador, e foi assim que 24 segundos
 * viraram 3,7 MB. Isto aqui é o TETO de quadros; quem pinta de fato é o relé, e
 * ele só pinta quando a guia entrega quadro (ver `HEARTBEAT_VIDEO_MS`).
 *
 * ⚠️ VOLTOU PRA 15 no mesmo dia, e o motivo é que o cálculo mudou: com a pintura
 * por novidade, este número deixou de ser consumo e virou de fato um TETO. Tela
 * parada custa 1 pintura por segundo qualquer que seja ele; movimento custa o
 * que precisar. A 10, vídeo rodando dentro da reunião ficava visivelmente
 * travado, e é justamente aí que a fluidez importa.
 */
const FPS_VIDEO = 15;

/**
 * Largura máxima do vídeo gravado. O pedido ao `getDisplayMedia` já traz este
 * número, mas lá ele é PREFERÊNCIA: em tela inteira o navegador costuma entregar
 * o tamanho nativo do monitor. Aqui é limite de verdade.
 *
 * ⚠️ ESTEVE EM 1280 POR UM DIA, E FOI ERRO DE ALVO. A ideia era cortar peso, e
 * cortou: 555 MB/h viraram ~97. Só que o peso já tinha sido resolvido pela
 * pintura por novidade, e o que 1280 fez foi borrar a leitura — num monitor
 * 1080p, cada letra perdeu um terço da altura, e ainda passou por uma reescala
 * bilinear no canvas, que é o que mais destrói texto fino.
 *
 * 🔴 A MEDIÇÃO QUE DECIDIU: com 1280 e teto de 450 kbps, uma reunião de 6min25
 * usou 216 kbps. Ou seja, sobrava metade da banda e a imagem estava ruim assim
 * mesmo: o gargalo era o número de pixels, não a taxa.
 *
 * Em 1920 numa tela 1080p não há reescala nenhuma: o que se grava é exatamente
 * o que está na tela. Em monitor maior, a redução continua acontecendo, e é aí
 * que o `imageSmoothingQuality` do relé passa a importar.
 */
const LARGURA_MAX_VIDEO = 1920;

/**
 * Depois de quanto tempo sem quadro novo a guia é dada como parada. Quatro
 * segundos é o mesmo prazo em que o Chrome muta a captura de uma guia sem
 * atividade, então é onde o aviso e o comportamento do navegador coincidem.
 */
const SEM_QUADRO_MS = 4_000;

/**
 * Um `MediaRecorder` e a contabilidade de UMA trilha (o áudio, ou o vídeo).
 *
 * Existe porque com vídeo ligado são DUAS gravações simultâneas sobre as mesmas
 * fontes, e duplicar a rotação de partes em dois lugares é como as duas cópias
 * passam a divergir. Aqui a regra mora uma vez só.
 *
 * 🔴 POR QUE DUAS GRAVAÇÕES, e não um arquivo de vídeo do qual se extrai o som:
 * a transcrição recusa acima de 25 MB, e vídeo passa disso em minutos. O áudio
 * precisa sair PURO e leve para ir ao Whisper. O vídeo é outro artefato, para
 * gente assistir, e por isso pode ser grande e pode ser apagado sozinho depois.
 */
class TrilhaGravada {
  private rec: MediaRecorder | null = null;
  private pedacos: Blob[] = [];
  private bytes = 0;
  private ordem = 0;
  private inicioDaParteMs = 0;
  private encerrando = false;
  /** Soma de TODAS as partes, não só a corrente. Zero aqui = nada foi gravado. */
  private bytesTotais = 0;
  private partesEntregues = 0;
  private inicioParaEntrega = 0;
  private erro: string | null = null;

  constructor(
    private readonly stream: MediaStream,
    private readonly tipo: TipoDeParte,
    private readonly maxBytes: number,
    private readonly opcoesRec: MediaRecorderOptions,
    /** Relógio da gravação (o mesmo para as duas trilhas). */
    private readonly relogio: () => number,
    private readonly aindaGravando: () => boolean,
    private readonly onParte: (p: PartePronta) => void,
  ) {}

  abrir(): void {
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, this.opcoesRec);
    } catch {
      rec = new MediaRecorder(this.stream);
    }

    this.pedacos = [];
    this.bytes = 0;
    this.inicioDaParteMs = this.relogio();
    const inicioMs = this.inicioDaParteMs;

    rec.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      this.pedacos.push(ev.data);
      this.bytes += ev.data.size;
      this.bytesTotais += ev.data.size;
      // A parte encheu: fecha e abre outra.
      if (this.bytes >= this.maxBytes && !this.encerrando && rec.state !== "inactive") {
        rec.stop();
      }
    };

    // 🔴 SEM ISTO, O `MediaRecorder` FALHA CALADO. Ele para, vira `inactive`, e
    // a única pista fica num console que ninguém abre no meio de uma audiência.
    rec.onerror = (ev) => {
      // O tipo do evento varia entre as versões da lib do DOM; o que interessa
      // é o `error`, e ele pode simplesmente não vir.
      const e = (ev as Event & { error?: DOMException }).error;
      this.erro = e?.message || e?.name || "o navegador interrompeu a gravação";
      console.error(`[gravacao] MediaRecorder de ${this.tipo} falhou`, e);
    };

    this.inicioParaEntrega = inicioMs;
    rec.onstop = () => {
      this.entregarParte(rec.mimeType);
      // 🔴 NÃO REABRIR SOBRE FONTE MORTA. Um `MediaRecorder` novo sobre um
      // stream cujas faixas já terminaram não dá erro: ele fica gravando nada,
      // para sempre, e o único vestígio é um arquivo que nunca aparece.
      const viva = this.stream.getTracks().some((t) => t.readyState === "live");
      if (!this.encerrando && this.aindaGravando() && viva) this.abrir();
    };

    // O `timeslice` NÃO é para fatiar arquivo — é para PESAR. Os pedaços que ele
    // entrega não abrem sozinhos; são acumulados e só viram arquivo no `stop`,
    // que é quando o contêiner ganha cabeçalho e final de verdade.
    rec.start(FATIA_MS);
    this.rec = rec;
  }

  /**
   * Fecha o que está acumulado num arquivo e entrega.
   *
   * Mora fora do `onstop` porque tem DOIS chamadores: o `onstop` normal e o
   * `fechar()` de um gravador que já estava parado. Duplicar isso nos dois
   * lugares é como um deles deixa de entregar sem ninguém notar.
   */
  private entregarParte(mimeDoRec: string): void {
    const mime = mimeDoRec || this.opcoesRec.mimeType || "";
    const blob = new Blob(this.pedacos, { type: mime });
    this.pedacos = [];
    // Parte sem conteúdo não vira arquivo: subir um contêiner vazio só gastaria
    // cota e ainda faria a transcrição pagar por silêncio.
    if (blob.size === 0) return;
    this.partesEntregues++;
    this.onParte({
      tipo: this.tipo,
      ordem: this.ordem++,
      inicioMs: this.inicioParaEntrega,
      duracaoMs: Math.max(0, this.relogio() - this.inicioParaEntrega),
      blob,
      mimeType: mime || (this.tipo === "video" ? "video/webm" : "audio/webm"),
      ext: extDoMime(mime),
    });
  }

  /** Bytes gravados em todas as partes desta trilha. */
  totalDeBytes(): number {
    return this.bytesTotais;
  }

  /** Quantas partes esta trilha chegou a ENTREGAR para subir. */
  totalDePartes(): number {
    return this.partesEntregues;
  }

  erroAtual(): string | null {
    return this.erro;
  }

  pausar(): void {
    if (this.rec?.state === "recording") this.rec.pause();
  }

  retomar(): void {
    if (this.rec?.state === "paused") this.rec.resume();
  }

  /** Fecha a parte corrente e resolve quando ela tiver sido entregue. */
  fechar(): Promise<void> {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec || rec.state === "inactive") {
        // 🔴 GRAVADOR JÁ PARADO AINDA PODE TER BYTES NA MÃO, e sair daqui sem
        // olhar joga fora tudo que ele acumulou. Era um caminho de perda
        // silenciosa: os bytes apareciam na contagem e o arquivo não existia em
        // lugar nenhum.
        this.entregarParte(rec?.mimeType ?? "");
        resolve();
        return;
      }
      this.encerrando = true;
      const jaEra = rec.onstop;
      rec.onstop = (ev) => {
        try {
          jaEra?.call(rec, ev);
        } finally {
          resolve();
        }
      };
      // Recorder pausado não dispara `stop` direito em todo navegador: retoma
      // por um instante só para ele conseguir fechar o arquivo.
      if (rec.state === "paused") rec.resume();
      rec.stop();
      // Rede de segurança: se o `onstop` não vier (navegador travado), não deixa
      // a promessa pendurada para sempre segurando a tela do usuário.
      setTimeout(resolve, 4000);
    });
  }
}

export class Gravador {
  private audioCtx: AudioContext | null = null;
  private destino: MediaStreamAudioDestinationNode | null = null;
  private fontes: MediaStream[] = [];
  private medidores = new Map<FonteDeAudio, Medidor>();
  private trilhas: TrilhaGravada[] = [];
  private comVideo = false;
  /** A trilha de vídeo, separada, para poder ser perguntada pela tela. */
  private trilhaVideo: TrilhaGravada | null = null;
  private faixaVideo: MediaStreamTrack | null = null;
  private capa: Blob | null = null;
  /** Quadros que a GUIA entregou. Ver `montarReleDeVideo`. */
  private quadrosDaGuia = 0;
  /** Quadros que o relé desenhou. Ver `criarRelogio`. */
  private desenhosDoRele = 0;
  private ultimoQuadroEm = 0;
  private releVideo: { tela: HTMLCanvasElement; parar: () => void } | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private estado: EstadoGravador = "ocioso";
  private acumuladoMs = 0;
  private marcoMs = 0;
  private readonly opts: OpcoesGravador;

  constructor(opts: OpcoesGravador) {
    this.opts = opts;
  }

  /** Tempo GRAVADO até agora. O que está em pausa não conta. */
  decorridoMs(): number {
    if (this.estado !== "gravando") return this.acumuladoMs;
    return this.acumuladoMs + (Date.now() - this.marcoMs);
  }

  estadoAtual(): EstadoGravador {
    return this.estado;
  }

  /** O vídeo da guia está sendo gravado? */
  gravandoVideo(): boolean {
    return this.comVideo;
  }

  /**
   * Como vai a imagem. `null` quando o vídeo nem foi pedido.
   *
   * Perguntado pela tela algumas vezes por segundo, igual ao medidor de áudio —
   * e pelo mesmo motivo: é a única forma de saber que o vídeo parou ENQUANTO a
   * reunião ainda está acontecendo.
   */
  saudeDoVideo(): SaudeDoVideo | null {
    if (!this.trilhaVideo) return null;
    return {
      ativa: this.comVideo,
      // 🔴 A PERGUNTA CERTA É "CHEGOU QUADRO NOVO?", e não "a faixa está
      // mutada?". O `muted` cobre um caso só; a guia parada não repinta e o
      // navegador simplesmente não entrega nada, sem mutar coisa nenhuma.
      semImagem:
        this.faixaVideo?.muted === true ||
        this.quadrosDaGuia === 0 ||
        Date.now() - this.ultimoQuadroEm > SEM_QUADRO_MS,
      bytes: this.trilhaVideo.totalDeBytes(),
      quadros: this.quadrosDaGuia,
      desenhos: this.desenhosDoRele,
      partes: this.trilhaVideo.totalDePartes(),
      erro: this.trilhaVideo.erroAtual(),
    };
  }

  /** Fontes de áudio que estão entrando agora. */
  fontesAtivas(): FonteDeAudio[] {
    return [...this.medidores.keys()];
  }

  /**
   * O medidor está funcionando?
   *
   * 🔴 SEM ISTO A TELA MENTE, E MENTE DO PIOR JEITO. O medidor vive no
   * `AudioContext`, que NÃO está no caminho da gravação — as faixas são gravadas
   * direto da fonte. Quando o contexto não sobe, o medidor lê zero em tudo e a
   * tela grita "não estou captando som nenhum" enquanto o áudio está sendo
   * gravado perfeitamente.
   *
   * É o pior aviso possível: manda abortar uma audiência que estava indo bem.
   */
  medindoSom(): boolean {
    return this.audioCtx?.state === "running";
  }

  /** Nível de áudio de uma fonte, 0 a 1. Para desenhar o medidor.
   *  Os medidores continuam SEPARADOS mesmo com a gravação misturada: é o que
   *  permite ver que a guia está mesmo entrando, antes de perder a audiência. */
  nivel(fonte: FonteDeAudio): number {
    const m = this.medidores.get(fonte);
    return m ? picoDoMedidor(m) : 0;
  }

  async iniciar(): Promise<void> {
    if (this.estado !== "ocioso") return;
    if (!gravacaoSuportada()) {
      throw new ErroDeGravacao(
        "Este navegador não grava áudio. Use o Chrome ou o Edge no computador.",
        "sem-suporte",
      );
    }

    const streamMic = await abrirMicrofone();

    const guia = this.opts.streamDispositivo;
    const precisaMisturar = !!guia && guia.getAudioTracks().length > 0;
    const trilhaDeVideo = guia?.getVideoTracks()[0] ?? null;

    this.audioCtx = new AudioContext();
    // 🔴 CONTEXTO SUSPENSO GRAVA SILÊNCIO, e sem dar erro nenhum.
    // `AudioContext` criado fora de um gesto do usuário nasce `suspended` por
    // política de autoplay. Suspenso, ele não processa nada — mas o
    // `MediaStreamDestination` continua ANUNCIANDO uma faixa de áudio, o
    // `MediaRecorder` grava essa faixa, e o arquivo sai válido, do tamanho
    // esperado, e MUDO. É o pior modo de falha que este módulo pode ter: só se
    // descobre depois da audiência, na transcrição vazia.
    try {
      await this.audioCtx.resume();
    } catch {
      /* tratado logo abaixo pelo estado do contexto */
    }

    if (this.audioCtx.state !== "running") {
      // Já NÃO é fatal, e essa é a consequência boa de tirar a mistura do
      // caminho crítico: sem o contexto, perde-se o medidor e o som do vídeo,
      // mas cada faixa continua sendo gravada direto da própria fonte. Antes
      // isto derrubava a gravação inteira, porque a mistura era o único caminho.
      console.warn("[gravacao] AudioContext não subiu, sem medidor e sem áudio no vídeo.");
    }

    // 🔴 A TRANSCRIÇÃO NÃO PASSA MAIS PELA MISTURA. Cada fonte é gravada DIRETO
    // do próprio stream, num arquivo próprio, e é isso que dá a separação de
    // quem falou de volta: o rótulo sai da FAIXA, não de palpite do modelo.
    //
    // O ganho escondido é de robustez: o `AudioContext` saiu do caminho crítico.
    // Ele agora serve só ao medidor e ao áudio DO VÍDEO — se ele falhar, o que
    // se perde é a barrinha e o som do vídeo, nunca a gravação que vira texto.
    // A armadilha do contexto suspenso (que grava silêncio sem dar erro) deixou
    // de poder atingir o que importa.
    //
    // O preço: duas transcrições em vez de uma, ou seja, o dobro de minutos
    // cobrados quando há reunião remota. Ver o cabeçalho do arquivo.
    // 🔴 BASTA HAVER VÍDEO, e não é detalhe: quando o compartilhamento vem sem
    // som (janela, ou tela inteira com a caixinha desmarcada), exigir o áudio da
    // reunião aqui deixava o vídeo MUDO. Com a mistura ligada só por existir
    // imagem, o vídeo sai pelo menos com o seu microfone — que é o mínimo para
    // ele servir de registro.
    const querMisturaParaVideo = !!trilhaDeVideo;
    if (querMisturaParaVideo && this.audioCtx.state === "running") {
      this.destino = this.audioCtx.createMediaStreamDestination();
    }
    this.ligarFonte("microfone", streamMic, !!this.destino);
    if (precisaMisturar) this.ligarFonte("dispositivo", guia!, !!this.destino);

    if (precisaMisturar) {
      // O usuário pode encerrar o compartilhamento pelo botão do navegador, que
      // fica fora da nossa tela. Quando isso acontece a gravação NÃO para: o
      // microfone continua entrando na mistura, e só a guia se despede.
      guia!.getAudioTracks()[0].addEventListener("ended", () => {
        this.medidores.delete("dispositivo");
        this.opts.onGuiaEncerrada?.();
      });
    }

    this.acumuladoMs = 0;
    this.marcoMs = Date.now();
    this.mudarEstado("gravando");

    // ── Trilhas de ÁUDIO: uma POR FONTE, cada uma direto do próprio stream ──
    const mimeAudio = escolherMime();
    const opcoesAudio: MediaRecorderOptions = { audioBitsPerSecond: BITRATE };
    if (mimeAudio) opcoesAudio.mimeType = mimeAudio;

    const novaTrilhaDeAudio = (fonte: FonteDeAudio, stream: MediaStream) =>
      new TrilhaGravada(
        // Recorte só com o áudio: o `MediaRecorder` receberia a trilha de vídeo
        // junto e gravaria um arquivo de vídeo onde se quer som puro.
        new MediaStream(stream.getAudioTracks()),
        fonte,
        MAX_BYTES_PARTE,
        opcoesAudio,
        () => this.decorridoMs(),
        () => this.estado === "gravando",
        this.opts.onParte,
      );

    this.trilhas.push(novaTrilhaDeAudio("microfone", streamMic));
    if (precisaMisturar) this.trilhas.push(novaTrilhaDeAudio("dispositivo", guia!));

    // ── Trilha de VÍDEO: só quando a guia veio com imagem e foi pedida ──────
    if (trilhaDeVideo) {
      const mimeVideo = escolherMimeDeVideo();
      const opcoesVideo: MediaRecorderOptions = {
        videoBitsPerSecond: BITRATE_VIDEO,
        audioBitsPerSecond: BITRATE,
      };
      if (mimeVideo) opcoesVideo.mimeType = mimeVideo;
      // O áudio do vídeo: a mistura quando ela existe (assistir a reunião sem
      // ouvir o lado de cá não serviria para nada) e, quando o AudioContext não
      // subiu, o áudio da própria guia — melhor vídeo com metade do som do que
      // vídeo mudo. A transcrição não depende de nada disto.
      // A mistura quando ela existe; sem ela, o que houver — o som do
      // compartilhamento, e se nem isso, o microfone. Vídeo mudo não serve de
      // registro de nada.
      const audioDoVideo = this.destino
        ? this.destino.stream.getAudioTracks()
        : guia!.getAudioTracks().length > 0
          ? guia!.getAudioTracks()
          : streamMic.getAudioTracks();
      // 🔴 O QUE VAI PRO GRAVADOR É O RELÉ, não a faixa da guia. Ver
      // `montarReleDeVideo`: gravar a faixa crua faz o arquivo depender de a
      // guia repintar, e guia parada = arquivo vazio.
      const faixaParaGravar = this.montarReleDeVideo(trilhaDeVideo) ?? trilhaDeVideo;
      const streamVideo = new MediaStream([faixaParaGravar, ...audioDoVideo]);
      this.comVideo = true;
      this.faixaVideo = trilhaDeVideo;
      this.trilhaVideo = new TrilhaGravada(
        streamVideo,
        "video",
        MAX_BYTES_PARTE_VIDEO,
        opcoesVideo,
        () => this.decorridoMs(),
        () => this.estado === "gravando",
        this.opts.onParte,
      );
      this.trilhas.push(this.trilhaVideo);
      // Parar de compartilhar a guia encerra a IMAGEM. O áudio segue pelo
      // microfone, então a gravação continua e o vídeo simplesmente termina ali.
      trilhaDeVideo.addEventListener("ended", () => {
        this.comVideo = false;
      });
      // Sem `await`: a miniatura é enfeite da listagem e não pode fazer a
      // gravação esperar por ela. Falhou, fica sem miniatura.
      void this.tirarCapa();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 🔴 A TELA COMPARTILHADA PRECISA ENTRAR NA LISTA DO QUE SE ENCERRA.
    //
    // `this.fontes` é o que o `encerrar()` percorre para parar as faixas, e quem
    // enchia essa lista era o `ligarFonte` — chamado para guia SÓ QUANDO ELA TEM
    // ÁUDIO. Compartilhamento sem som (janela, ou tela inteira sem a caixinha)
    // nunca era registrado, e a faixa de IMAGEM ficava viva depois do fim: o
    // Chrome seguia anunciando "você está compartilhando a tela" para sempre.
    //
    // Não é cosmético. Enquanto a faixa vive, o navegador continua capturando o
    // que está na tela de quem gravou.
    // ══════════════════════════════════════════════════════════════════════════
    if (guia && !this.fontes.includes(guia)) this.fontes.push(guia);

    for (const t of this.trilhas) t.abrir();

    // Um relógio só, de 1 em 1 segundo: atualiza a tela e aplica o teto de 8h.
    // A troca de parte NÃO mora aqui — ela é por bytes, e quem conta os bytes é
    // o `ondataavailable` de cada trilha.
    this.tick = setInterval(() => {
      const t = this.decorridoMs();
      this.opts.onTempo?.(t);
      if (t >= DURACAO_MAXIMA_MS) void this.encerrar();
    }, 1000);
  }

  /** Um quadro da reunião, para listagem. `null` quando não houve vídeo. */
  capaDaReuniao(): Blob | null {
    return this.capa;
  }

  /**
   * O relé: a imagem da guia passa por um canvas nosso antes de ser gravada.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * 🔴 SEM ISTO O VÍDEO NUNCA SAI, E A CULPA NÃO É DO NOSSO CÓDIGO.
   *
   * A captura de guia do Chrome só entrega quadro quando a guia REPINTA. Guia
   * parada — um documento aberto, um slide, uma reunião em outra janela —
   * significa zero quadro novo, e o `MediaRecorder` sem quadro nenhum não
   * escreve arquivo: sai vazio, sem erro, sem evento, com o áudio perfeito ao
   * lado. Depois de ~4 segundos sem atividade o Chrome ainda MUTA a faixa.
   * (Chromium 40703184: "when a web page is static with nothing new to render,
   * the WebRenderer is idle and no new data is passed to the stream".)
   *
   * Isso não é teoria: em TODAS as gravações com vídeo pedido desde que o
   * recurso existe, nenhuma produziu um único byte de imagem.
   *
   * O relé inverte quem manda no ritmo. Quem repinta passa a ser a gente, num
   * relógio próprio, e o que se grava é o canvas. Quadro novo da guia entra
   * quando chega; quando não chega, o canvas é redesenhado com o último quadro
   * conhecido — o vídeo congela na última imagem em vez de não existir.
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Devolve a faixa a gravar, ou `null` se algo faltar (aí grava-se a faixa
   * crua, que é o comportamento antigo: pior, mas nunca pior que não gravar).
   */
  private montarReleDeVideo(faixa: MediaStreamTrack): MediaStreamTrack | null {
    try {
      // 🔴 O TETO DE RESOLUÇÃO MORA AQUI, e não só no pedido ao navegador. O
      // `getDisplayMedia` trata largura e altura como PREFERÊNCIA — em tela
      // inteira ele frequentemente entrega o tamanho nativo do monitor, e num
      // 4K isso seria quatro vezes mais pixels por quadro do que se pediu.
      // Limitando no canvas, o arquivo fica previsível qualquer que seja a tela.
      const cfg = faixa.getSettings();
      const largura0 = Math.max(2, Math.round(cfg.width ?? 1280));
      const altura0 = Math.max(2, Math.round(cfg.height ?? 720));
      const escala = Math.min(1, LARGURA_MAX_VIDEO / largura0);
      const largura = Math.max(2, Math.round(largura0 * escala));
      const altura = Math.max(2, Math.round(altura0 * escala));

      // 🔴 "text" É GANHO DE NITIDEZ DE GRAÇA. `contentHint` diz ao codificador
      // o que ele está codificando; com "text" ele preserva DETALHE espacial em
      // vez de suavidade de movimento, que é exatamente a troca certa para tela
      // de reunião (slide, documento, petição). Sem a dica, ele assume vídeo
      // comum e borra letra para economizar bits que aqui não faltam.
      definirDica(faixa, "text");

      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = new MediaStream([faixa]);
      void v.play().catch(() => undefined);

      // Conta o que a GUIA entregou de verdade. É o número que separa "o
      // navegador não mandou imagem" de "a imagem chegou e nós perdemos", e sem
      // ele o diagnóstico volta a ser adivinhação.
      const pedirQuadro = (
        v as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        }
      ).requestVideoFrameCallback;
      if (typeof pedirQuadro === "function") {
        const passo = () => {
          this.quadrosDaGuia++;
          this.ultimoQuadroEm = Date.now();
          pedirQuadro.call(v, passo);
        };
        pedirQuadro.call(v, passo);
      } else {
        // Navegador sem `requestVideoFrameCallback`: não dá para contar, e
        // fingir que chegou quadro seria pior que admitir que não se sabe.
        this.ultimoQuadroEm = Date.now();
      }

      const tela = document.createElement("canvas");
      // Do TAMANHO EXATO da fonte: qualquer diferença aqui vira redimensionamento
      // a cada quadro, e redimensionar texto é o que produz o borrão que se está
      // tentando evitar.
      tela.width = largura;
      tela.height = altura;
      // `alpha: false` porque captura de tela não tem transparência: dizer isso
      // ao navegador tira um canal do caminho a cada quadro.
      const ctx = tela.getContext("2d", { alpha: false });
      if (!ctx) return null;
      // 🔴 SÓ IMPORTA QUANDO HÁ REDUÇÃO, e aí importa muito: em monitor maior
      // que 1920 o quadro é reescalado, e reescala barata é o que transforma
      // letra fina em borrão. Em tela 1080p isto é inócuo, porque não há
      // redução nenhuma.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Um primeiro desenho SEMPRE, antes do `captureStream`: canvas que nunca
      // foi pintado não emite faixa, e a gravação sairia vazia de novo.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, largura, altura);

      // ══════════════════════════════════════════════════════════════════════
      // 🔴 PINTAR SÓ QUANDO HÁ O QUE PINTAR, E DETECTAR ISSO POR `currentTime`.
      //
      // Repintar a 15 fps uma tela que não mudou gastava o teto inteiro do
      // codificador para gravar a mesma imagem: 3,7 MB em 24 segundos, medido.
      // Então o relé passou a pintar por novidade.
      //
      // ⚠️ A PRIMEIRA VERSÃO DISTO USAVA O CONTADOR DO `requestVideoFrameCallback`
      // E DEU VÍDEO A 1 fps (relatado pelo dono em 27/08, com vídeo rodando na
      // reunião). O motivo: o rVFC é estrangulado pelo navegador quando a aba do
      // adv3 está em SEGUNDO PLANO, que é o caso normal de quem grava — a pessoa
      // está na aba da reunião. Sem callback, sobrava só o heartbeat de 1 por
      // segundo, e o vídeo saía travado.
      //
      // `currentTime` do elemento não depende de callback nenhum: ele avança
      // conforme os quadros chegam e é lido de forma síncrona, então continua
      // valendo com a aba escondida. O relógio que chama isto já é um Worker
      // justamente por esse motivo (ver `criarRelogio`).
      //
      // O contador do rVFC continua existindo, mas só para diagnóstico.
      // ══════════════════════════════════════════════════════════════════════
      let tempoPintado = -1;
      let pintadoEm = 0;
      const desenhar = () => {
        const agora = Date.now();
        const temQuadroNovo = v.currentTime !== tempoPintado;
        if (!temQuadroNovo && agora - pintadoEm < HEARTBEAT_VIDEO_MS) return;
        try {
          ctx.drawImage(v, 0, 0, largura, altura);
          this.desenhosDoRele++;
          tempoPintado = v.currentTime;
          pintadoEm = agora;
        } catch {
          // Vídeo ainda sem quadro decodificado. O canvas fica como estava.
        }
      };
      const relogio = criarRelogio(desenhar, Math.round(1000 / FPS_VIDEO));

      const saida = tela.captureStream(FPS_VIDEO);
      const faixaRele = saida.getVideoTracks()[0];
      if (!faixaRele) {
        relogio.parar();
        return null;
      }
      // É ESTA faixa que o `MediaRecorder` codifica, então é nela que a dica
      // precisa estar. Marcar só a da guia não alcançaria o codificador.
      definirDica(faixaRele, "text");

      this.releVideo = {
        tela,
        parar: () => {
          relogio.parar();
          v.pause();
          v.srcObject = null;
          saida.getTracks().forEach((t) => t.stop());
        },
      };
      return faixaRele;
    } catch {
      return null;
    }
  }

  /**
   * Tira um quadro da reunião e guarda como JPEG pequeno, para listagem.
   *
   * Sai do canvas do relé, que já está sendo repintado: não precisa de um
   * segundo `<video>` nem de esperar a guia colaborar.
   *
   * 🔴 AQUI, E NÃO NA LISTAGEM. Extrair um quadro na hora de listar obrigaria o
   * navegador a baixar pedaço do vídeo POR LINHA da tabela.
   */
  private async tirarCapa(): Promise<void> {
    for (let i = 0; i < TENTATIVAS_CAPA; i++) {
      await new Promise((r) => setTimeout(r, ESPERA_CAPA_MS));
      if (this.estado === "encerrado" || this.capa) return;
      try {
        const blob = await this.quadroDoRele();
        if (blob) {
          this.capa = blob;
          return;
        }
      } catch {
        /* sem miniatura, e a gravação segue */
      }
    }
  }

  /**
   * Um quadro do relé, reduzido, ou `null` se ele ainda não presta.
   *
   * 🔴 QUADRO PRETO É RECUSADO. Enquanto a guia não repinta, o canvas do relé é
   * o retângulo preto do primeiro `fillRect`, e miniatura preta é PIOR que
   * miniatura nenhuma: parece gravação com a tela apagada, quando na verdade é
   * só a imagem que ainda não chegou.
   */
  private async quadroDoRele(): Promise<Blob | null> {
    const tela = this.releVideo?.tela;
    if (!tela || this.quadrosDaGuia === 0) return null;

    const escala = Math.min(1, LARGURA_CAPA / tela.width);
    const pequena = document.createElement("canvas");
    pequena.width = Math.max(1, Math.round(tela.width * escala));
    pequena.height = Math.max(1, Math.round(tela.height * escala));
    const ctx = pequena.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(tela, 0, 0, pequena.width, pequena.height);
    if (!temConteudo(ctx, pequena.width, pequena.height)) return null;

    return await new Promise<Blob | null>((res) =>
      pequena.toBlob((b) => res(b), "image/jpeg", 0.7),
    );
  }

  /**
   * Pendura um medidor na fonte e, quando `misturar`, também a liga no destino.
   *
   * O medidor existe mesmo sem mistura: é o que deixa ver, ANTES de perder a
   * audiência, que o microfone certo foi escolhido e que a guia está entrando.
   */
  private ligarFonte(fonte: FonteDeAudio, stream: MediaStream, misturar: boolean): void {
    const ctx = this.audioCtx!;
    // 🔴 SÓ O ÁUDIO ENTRA NO WEB AUDIO. `createMediaStreamSource` recebendo um
    // stream que também tem trilha de VÍDEO é terreno movediço, e foi
    // exatamente a mudança que coincidiu com o defeito "no áudio só a minha
    // voz": antes do vídeo, a trilha de imagem era REMOVIDA da guia, então o
    // que chegava aqui já era áudio puro; ao passar a guardar o vídeo, o mesmo
    // stream passou a chegar com as duas.
    //
    // Montar um `MediaStream` só com as trilhas de áudio deixa a intenção
    // explícita e tira a ambiguidade — o nó passa a ter uma coisa só para pegar.
    const soAudio = new MediaStream(stream.getAudioTracks());
    const origem = ctx.createMediaStreamSource(soAudio);
    if (misturar && this.destino) origem.connect(this.destino);
    // Guarda o stream ORIGINAL (não o recorte): é ele que tem as trilhas de
    // verdade, e é nelas que o `stop()` do encerramento precisa bater.
    this.fontes.push(stream);
    try {
      const analisador = ctx.createAnalyser();
      analisador.fftSize = 512;
      origem.connect(analisador);
      this.medidores.set(fonte, {
        analisador,
        // `new ArrayBuffer(...)` explícito: o TypeScript tipa `new Uint8Array(n)`
        // como `Uint8Array<ArrayBufferLike>`, e `getByteTimeDomainData` exige um
        // respaldo em `ArrayBuffer` mesmo (nada de SharedArrayBuffer).
        buffer: new Uint8Array(new ArrayBuffer(analisador.fftSize)),
      });
    } catch {
      // Medidor é enfeite. Se o AudioContext não colaborar, grava sem ele.
    }
  }

  pausar(): void {
    if (this.estado !== "gravando") return;
    this.acumuladoMs += Date.now() - this.marcoMs;
    this.mudarEstado("pausado");
    for (const t of this.trilhas) t.pausar();
  }

  retomar(): void {
    if (this.estado !== "pausado") return;
    this.marcoMs = Date.now();
    this.mudarEstado("gravando");
    for (const t of this.trilhas) t.retomar();
  }

  /** Encerra, fecha a parte corrente de cada trilha e solta microfone e guia. */
  async encerrar(): Promise<void> {
    if (this.estado === "encerrado" || this.estado === "ocioso") return;
    if (this.estado === "gravando") this.acumuladoMs += Date.now() - this.marcoMs;
    this.mudarEstado("encerrado");
    if (this.tick) {
      clearInterval(this.tick);
      this.tick = null;
    }

    // Espera o `onstop` das duas: é ele que entrega a última parte. Sem esperar,
    // a gravação perderia justamente o fim da conversa.
    await Promise.all(this.trilhas.map((t) => t.fechar()));
    this.trilhas = [];

    // Depois de fechar as trilhas: parar o relógio antes faria a última parte
    // do vídeo terminar num canvas congelado.
    this.releVideo?.parar();
    this.releVideo = null;

    for (const s of this.fontes) s.getTracks().forEach((t) => t.stop());
    this.fontes = [];
    this.medidores.clear();
    try {
      await this.audioCtx?.close();
    } catch {
      /* o contexto já pode ter fechado sozinho */
    }
    this.audioCtx = null;
    this.destino = null;
  }

  private mudarEstado(e: EstadoGravador): void {
    this.estado = e;
    this.opts.onEstado?.(e);
  }
}

/**
 * Diz ao codificador que tipo de imagem é esta.
 *
 * `contentHint` é padrão e opcional: navegador que não conhece ignora, e por
 * isso a atribuição é solta em vez de exigida. Nunca vale quebrar uma gravação
 * por causa de uma dica de qualidade.
 */
/**
 * Um relógio que NÃO é estrangulado quando a aba vai pro fundo.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 ESTE É O MOTIVO DE O VÍDEO SAIR TRAVADO. O Chrome limita 
 * a UMA VEZ POR SEGUNDO em aba que não está na frente — e a aba do adv3 está
 * sempre atrás durante a reunião, porque quem está na frente é o Meet.
 *
 * Como é o relógio que repinta o canvas do relé, e é o canvas que o
 *  grava, o efeito era gravar a 1 quadro por segundo justamente
 * durante a reunião inteira. Na aba visível parecia bom; em uso real, não.
 *
 * O compasso vai para um Web Worker, que roda em outra thread e não sofre esse
 * limite. O worker só apita; quem desenha continua sendo a thread principal,
 * que é onde o canvas vive.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Sem Worker disponível, cai no  — pior, mas nunca pior que não
 * gravar.
 */
function criarRelogio(aoBater: () => void, intervaloMs: number): { parar: () => void } {
  try {
    // O worker não faz nada além de apitar no compasso. Mora aqui como texto
    // para não virar um arquivo separado que o build teria de saber empacotar.
    const fonte =
      "let id=null;" +
      "onmessage=function(e){" +
      "  if(e.data&&e.data.parar){clearInterval(id);close();return;}" +
      "  clearInterval(id);" +
      "  id=setInterval(function(){postMessage(0)},e.data.intervalo);" +
      "};";
    const url = URL.createObjectURL(new Blob([fonte], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = () => aoBater();
    w.postMessage({ intervalo: intervaloMs });
    return {
      parar: () => {
        try {
          w.postMessage({ parar: true });
          w.terminate();
        } finally {
          URL.revokeObjectURL(url);
        }
      },
    };
  } catch {
    const id = setInterval(aoBater, intervaloMs);
    return { parar: () => clearInterval(id) };
  }
}
function definirDica(faixa: MediaStreamTrack, dica: "text" | "detail" | "motion"): void {
  try {
    (faixa as MediaStreamTrack & { contentHint?: string }).contentHint = dica;
  } catch {
    /* navegador sem suporte; segue sem a dica */
  }
}

/**
 * O quadro tem alguma coisa, ou é uma tela apagada?
 *
 * Usado pelas duas pontas que produzem miniatura — a do gravador e a que
 * conserta gravação antiga a partir do arquivo —, porque a decisão é a mesma nos
 * dois lugares: miniatura preta é pior que miniatura nenhuma.
 *
 * Olha uma amostra dos pixels, não todos: a resposta é a mesma e sai instantânea
 * mesmo numa imagem grande.
 */
export function temConteudo(
  ctx: CanvasRenderingContext2D,
  largura: number,
  altura: number,
): boolean {
  try {
    const dados = ctx.getImageData(0, 0, largura, altura).data;
    // 4 bytes por pixel; o passo pula para amostrar ~1 pixel a cada 64.
    const passo = 4 * 64;
    let claro = 0;
    let vistos = 0;
    for (let i = 0; i < dados.length; i += passo) {
      vistos++;
      // Média simples serve: o que se procura é "saiu do preto", não a cor.
      if ((dados[i] + dados[i + 1] + dados[i + 2]) / 3 > 16) claro++;
    }
    // 2% de pixels acima do preto já é conteúdo: uma tela escura com uma janela
    // clara no canto continua sendo uma miniatura útil.
    return vistos > 0 && claro / vistos > 0.02;
  } catch {
    // `getImageData` falhou (canvas de outra origem). Não dá para julgar, e
    // recusar aqui deixaria a gravação sem miniatura por precaução demais.
    return true;
  }
}

/** mm:ss (ou h:mm:ss) — o cronômetro da tela. */
export function formatarDuracao(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(seg).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
