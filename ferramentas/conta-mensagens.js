#!/usr/bin/env node
/**
 * ============================================================================
 * CONTA-MENSAGENS.JS — quantas mensagens o bot envia em cada entrada
 * ============================================================================
 *
 * POR QUE EXISTE
 *   A partir de 01/10/2026 a Meta cobra mensagem de serviço acima de 1.000 por
 *   mês. Documentação/FLUXOS.md registra quantas mensagens cada fluxo custa —
 *   e um número escrito num .md envelhece em silêncio: basta alguém acrescentar
 *   um `Utils.enviarSimples` para o documento passar a mentir sem que nada
 *   falhe. Este script conta de novo, no código, a cada execução.
 *
 *   Não substitui teste em aparelho: conta envios, não confere o que aparece na
 *   tela. Mas é ele que pega a mensagem que voltou sem ninguém notar.
 *
 * COMO FUNCIONA
 *   Carrega os .gs de verdade (Config, MenuHandler, CadastroHandler,
 *   DevolucaoHandler) num contexto isolado e troca só a BORDA — Utils,
 *   OdooService, MediaService, StateManager, FlowHandler. O que roda é a lógica
 *   real de decisão; o que é falso é o que sai pela rede.
 *
 *   Nada é enviado, nada toca o Odoo. Pode rodar à vontade.
 *
 * USO
 *   node ferramentas/conta-mensagens.js
 *
 *   Sai com código 1 se algum cenário fugir do esperado — serve em CI.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// A borda: tudo o que sai do processo vira contador
// ---------------------------------------------------------------------------

let enviadas = [];
let gratis   = [];   // sinais que NÃO são mensagens cobradas
let consultas = [];  // domínios enviados ao Odoo, para conferir os filtros
const registra = (tipo, texto) => enviadas.push({ tipo, texto: String(texto || '') });

/**
 * Carrega o VisionService NUM CONTEXTO PRÓPRIO, só para os extratores puros.
 *
 * Não dá para carregá-lo junto dos handlers: `const VisionService = {...}` é
 * declaração léxica e sombrearia o stub, fazendo o ComprovanteHandler chamar a
 * API de OCR de verdade. Foi exatamente o que aconteceu ao tentar o atalho.
 */
function extratoresDoVision() {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Utilities: {}, Utils: {}, getVisionConfig: () => ({})
  };
  vm.createContext(ctx);
  return vm.runInContext(
    fs.readFileSync(path.join(RAIZ, 'VisionService.gs'), 'utf8') + '\n;VisionService',
    ctx, { filename: 'VisionService.gs' }
  );
}

function montarContexto(cenario) {
  // Só StateManager (cache/Properties), VisionService (OCR) e FlowHandler são
  // simulados por inteiro. Utils, OdooService, MediaService e os handlers são
  // carregados DE VERDADE — deles, apenas os métodos que falam com a rede são
  // trocados, depois da carga. Foi essa escolha que pegou duas coisas: uma
  // guarda que um stub de `criarDizimista` teria escondido, e um valor
  // formatado que um stub de `formatarValor` teria deixado passar.
  const StateManager = {
    setEstado: () => {}, getEstado: () => null, limparDados: () => {},
    iniciarSessaoCadastro: () => {}, registrarSessaoAtiva: () => {},
    appendLog: () => {}, setDados: () => {}, getDados: () => ({}),
    getCampo: (from, campo) => (cenario.sessao || {})[campo],
    salvarMultiplosCampos: () => {}, getDadosTemporarios: () => (cenario.dadosCadastro || {}),
    persistirLogCadastro: () => {}
  };

  const FlowHandler = {
    enviarFlowCadastro: () => {
      if (!cenario.flowLigado) return false;
      registra('flow', 'formulário de cadastro');
      return true;
    },
    enviarFlowMembro: () => false,
    enviarFlowOferta: () => {
      if (!cenario.flowOfertaLigado) return false;
      registra('flow', 'formulário de oferta');
      return true;
    }
  };

  const ctx = {
    StateManager, FlowHandler,
    // OCR: um comprovante legítimo, com a MESMA chave da comunidade — assim o
    // caminho exercitado é o do sucesso conferido (BL-26), não o de erro.
    // Este stub cobre a chamada à API; os EXTRATORES puros do VisionService são
    // testados à parte, com texto real de comprovante (seção do BL-14).
    VisionService: {
      analisarComprovante: () => ({
        valor: 50, data: '12/08/2026', tipo: 'PIX',
        banco: 'Banco do Brasil', chavePix: 'pix@paroquia.org'
      }),
      analisarPDF: () => null,
      validarComprovante: () => ({ ehComprovante: true })
    },
    console: { log() {}, warn() {}, error() {} },
    Utilities: {
      sleep() {},
      base64Encode: () => 'BASE64',
      // `registrarDevolucao` usa formatDate para a data de hoje. Só o formato
      // yyyy-MM-dd é usado no projeto, então o stub cobre esse caso.
      formatDate: (d, _tz, _fmt) => new Date(d).toISOString().slice(0, 10)
    },
    Logger: { log() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (cenario.propriedades || {})[k] || null,
        getProperties: () => cenario.propriedades || {},
        setProperty: () => {}, deleteProperty: () => {}, setProperties: () => {}
      })
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    UrlFetchApp: { fetch: () => { throw new Error('o teste não deve tocar a rede'); } }
  };
  vm.createContext(ctx);

  // Os .gs declaram `const Utils = {...}` no topo. Num contexto do `vm` isso é
  // declaração léxica: não vira propriedade do objeto de contexto. Por isso
  // tudo é carregado num script só e os objetos são devolvidos no fim — é a
  // forma de alcançá-los sem tocar nos arquivos do projeto.
  const ARQUIVOS = [
    'Config.gs', 'Utils.gs', 'OdooService.gs', 'MediaService.gs',
    'MenuHandler.gs', 'CadastroHandler.gs', 'DevolucaoHandler.gs', 'ComprovanteHandler.gs',
    'OfertaHandler.gs', 'TestePixNativo.gs'
  ];
  const fontes = ARQUIVOS
    .map(a => fs.readFileSync(path.join(RAIZ, a), 'utf8'))
    .join('\n;\n');

  const mod = vm.runInContext(
    fontes + '\n;({ Utils, OdooService, MediaService, MenuHandler, CadastroHandler, ' +
             'DevolucaoHandler, ComprovanteHandler, OfertaHandler, ESTADOS });',
    ctx,
    { filename: 'bot.gs' }
  );

  // ── A borda: só o que sai do processo ──────────────────────────────────────
  Object.assign(mod.Utils, {
    enviarSimples:      (to, t)         => registra('texto',  t),
    enviarComBotaoMenu: (to, t)         => registra('texto',  t),
    enviarConfirmar:    (to, t)         => registra('botoes', t),
    // O tipo distingue `menu` de `menu+imagem`: é a diferença entre a entrada
    // de 2 mensagens e a de 1 (A12), e sem isso nenhum teste veria a economia.
    enviarMenu: (to, t, botoes, opcoes = {}) => registra(
      opcoes.imagemId ? 'menu+imagem' : 'menu',
      t + ' [' + (botoes || []).map(b => b.id).join(', ') + ']'
    ),
    enviarLista:        (to, t)         => registra('lista',  t),
    // Indicador de digitação: NÃO é mensagem. Registrado à parte justamente
    // para o teste provar que ele não entra na conta.
    sinalizarProcessando: () => {
      gratis.push('digitando');
      return cenario.digitandoFunciona !== false;
    },
    // A API do QR Code. `getContent` alimenta o base64Encode acima.
    fetchComRetry: () => ({ getResponseCode: () => 200, getContent: () => 'qr', getContentText: () => '' }),

    // O card do BL-40 é montado no MediaService e vai direto pelo `_post`, sem
    // passar pelos `enviar*`. Sem interceptar aqui ele não seria contado — e o
    // fluxo que mais importa ficaria fora da conta.
    _post: (payload) => {
      if (payload.type === 'contacts') {
        registra('contato', JSON.stringify(payload.contacts));
        const ok = cenario.contatoAceito !== false;
        return { getResponseCode: () => (ok ? 200 : 400), getContentText: () => '' };
      }
      const card = payload.interactive && payload.interactive.type === 'order_details';
      registra(card ? 'card-pix' : 'outro', card
        ? payload.interactive.body.text
        : JSON.stringify(payload).slice(0, 80));
      const aceita = cenario.cardAceito !== false;
      return { getResponseCode: () => (aceita ? 200 : 400), getContentText: () => '' };
    }
  });
  // formatarValor, formatarDataOdoo, variantesNumeroBR e o resto continuam reais.

  Object.assign(mod.MediaService, {
    enviarImagemFixa:   (to, id, legenda)  => registra('imagem+legenda', legenda),
    // Sem avatar no Odoo não há id — é o que faz o A12 cair no caminho antigo.
    mediaIdDoAvatar:    () => (cenario.temAvatar ? 'MEDIA_ID' : null),
    enviarImagemBase64: (to, b64, caption) => { registra('imagem+legenda', caption); return {}; },
    baixarArquivo:      () => ({ base64: 'BASE64DOCOMPROVANTE' })
  });

  // OdooService: trocado no nível do RPC, para que `criarDizimista` — onde mora
  // a guarda contra o cadastro duplicado (BL-39) — rode de verdade.
  Object.assign(mod.OdooService, {
    searchRead: (modelo, campos, dominio) => {
      if (cenario.odooForaDoAr) throw new Error('connection refused (simulado)');
      consultas.push({ modelo, campos, dominio });
      // BL-41: com `campoTipoExiste`, o harness simula o Odoo DEPOIS da
      // migração. Sem isso, `_comTipo` nunca acrescenta o filtro e as regras
      // abaixo passariam sem testar nada.
      if (modelo === 'ir.model.fields') {
        const nome = (dominio || []).find(d => d[0] === 'name');
        const quer = nome && nome[2];
        if (quer === 'x_studio_tipo_contribuicao' || quer === 'x_studio_telefone_ofertante') {
          return cenario.camposNovos ? [{ id: 1, related: false, readonly: false }] : [];
        }
        if (quer === 'x_studio_comunidade') {
          return cenario.comunidadeGravavel
            ? [{ id: 2, related: false, readonly: false }]
            : [{ id: 2, related: 'x_studio_dizimista.x_studio_comunidade', readonly: true }];
        }
        return [];
      }
      if (modelo === 'x_dizimista') {
        const porTelefone = (dominio || []).some(d => d[0] === 'x_studio_partner_phone');
        if (porTelefone) return cenario.dizimista ? [cenario.dizimista] : [];
        // Busca por id — é como `registrarDevolucao` descobre a comunidade.
        const porId = (dominio || []).some(d => d[0] === 'id');
        if (porId) return cenario.dizimistaNoOdoo !== undefined
          ? (cenario.dizimistaNoOdoo ? [cenario.dizimistaNoOdoo] : [])
          : (cenario.dizimista ? [cenario.dizimista] : []);
        return cenario.familia || (cenario.dizimista ? [cenario.dizimista] : []);
      }
      if (modelo === 'x_devolucao') {
        // `devolucoesDoMes` filtra por intervalo de datas; o histórico e a linha
        // "última devolução", não. Distinguir aqui importa: sem isso, um cenário
        // com histórico também dispararia o aviso de duplicata, e o teste
        // passaria a medir outro caminho sem ninguém perceber.
        const porPeriodo = (dominio || []).some(d => d[0] === 'x_studio_data_da_devolucao');
        return (porPeriodo ? cenario.devolucoesDoMes : cenario.devolucoes) || [];
      }
      return [];
    },
    create: () => 99,
    buscarParametros:               () => ({ x_studio_avatar: cenario.temAvatar ? 'ID' : null }),
    listarComunidades:              () => [{ id: 1, x_name: 'Matriz' }],
    buscarDadosPagamentoComunidade: () => ({
      x_studio_chave_pix:     'pix@paroquia.org',
      x_studio_banco:         'Banco do Brasil',
      x_studio_titular_conta: 'Paróquia N. S. da Conceição Aparecida'
    }),
    contatosDoDizimista: () => ({
      comunidade: 'São José',
      // Formato do cadastro padrão do Odoo: com máscara e SEM o 55. Era
      // '5586988521231', já normalizado, e isso escondia um bug de produção —
      // o `wa_id` saía sem código de país e o WhatsApp lia o DDD 86 como
      // China. Um fixture já arrumado testa a si mesmo, não o código.
      contatos: cenario.contatos || [{ nome: 'João da Silva', whatsapp: '(86) 98852-1231' }]
    }),
    salvarFotoDizimista: () => {}
    // `devolucoesDoMes`, `buscarDevolucoesDizimista`, `listarDevolucoesPorPeriodo`
    // e `buscarDevolucoesPendentes` NÃO são trocadas: é nelas que vive o filtro
    // por tipo do BL-41 (A5). Stub aqui esconderia exatamente o que precisa ser
    // testado — foi o que aconteceu com `criarDizimista` (BL-39) e
    // `registrarDevolucao` (A3), e é a terceira vez que este erro aparece.
    // `registrarDevolucao` NÃO é trocado de propósito: é nele que vive a guarda
    // do BL-41 contra devolução sem comunidade. Um stub a esconderia — foi o que
    // aconteceu com `criarDizimista` e o BL-39 antes desta mudança.
  });

  return mod;
}

// ---------------------------------------------------------------------------
// Os cenários, com o número que Documentação/FLUXOS.md promete
// ---------------------------------------------------------------------------

const DIZIMISTA = { id: 7, x_name: 'Maria', x_studio_value: 50, x_studio_comunidade: [1, 'Matriz'] };
const COMPROVANTE = { id: 'media123', mime_type: 'image/jpeg', sha256: 'abc' };

// Sessão de um cadastro já preenchido, pronto para o "✅ Confirmar" do resumo.
const CADASTRO_PRONTO = {
  nome: 'Thalles da Silva', nomeUsual: 'Thalles', whatsapp: '55',
  dataNascimento: '15/03/1990', endereco: 'Rua A, 1', valorMensal: 50,
  comunidadeId: 1, notificacaoAtiva: true, diaPreferido: 15
};

const CENARIOS = [
  {
    nome: 'Primeiro contato — número NOVO vê as TRÊS portas',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.primeiroContato('55'),
    esperado: 1,
    porque: 'A12: avatar, boas-vindas e os 3 botões num balão só. Cadastro ' +
            'custa mais uma, uma vez na vida; oferta e contato deixam de ser ' +
            'invisíveis para quem chega.'
  },
  {
    nome: 'Entrada de número novo NÃO depende do formulário',
    cenario: { dizimista: null, temAvatar: true, flowLigado: false },
    roda: ctx => ctx.MenuHandler.primeiroContato('55'),
    esperado: 1,
    porque: 'o menu não é um flow: com o formulário desligado a entrada é a ' +
            'mesma. Antes o interruptor do flow mexia na 1ª mensagem.'
  },
  {
    nome: 'Quem toca "Ser Dizimista" recebe o formulário',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.CadastroHandler.iniciar('55', null),
    esperado: 1,
    porque: 'a mensagem a mais que o menu custa a quem quer cadastro — uma ' +
            'vez na vida, e só para quem escolhe esse caminho'
  },
  {
    nome: 'Primeiro contato — número JÁ CADASTRADO',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.primeiroContato('55'),
    esperado: 1,
    porque: 'A12: avatar, boas-vindas e os 3 botões num balão só. Eram 4, ' +
            'depois 2. Toda pessoa passa por aqui, uma vez.'
  },
  {
    nome: 'Primeiro contato — sem avatar no Odoo',
    cenario: { dizimista: DIZIMISTA, temAvatar: false, flowLigado: true },
    roda: ctx => ctx.MenuHandler.primeiroContato('55'),
    esperado: 2,
    porque: 'texto simples no lugar da imagem — continua sendo uma mensagem'
  },
  {
    nome: 'Botão antigo "Já sou Dizimista" (mensagem velha na conversa)',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.DevolucaoHandler.verificarDizimista('55'),
    esperado: 1,
    porque: 'vai direto ao menu do dizimista. Eram 3 (buscando/encontrado/menu).'
  },
  {
    nome: 'Botão antigo, de número que NÃO é dizimista',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.DevolucaoHandler.verificarDizimista('55'),
    esperado: 1,
    porque: 'cai no cadastro em vez de oferecer um menu para voltar ao mesmo lugar'
  },
  {
    nome: 'Primeiro contato com o Odoo fora do ar',
    cenario: { dizimista: null, temAvatar: false, flowLigado: true, odooForaDoAr: true },
    roda: ctx => { ctx.MenuHandler.boasVindas('55'); ctx.MenuHandler.entrada('55'); },
    esperado: 2,
    porque: 'boas-vindas + menu genérico. O que não pode acontecer é a pessoa ficar sem resposta.'
  },
  {
    nome: 'Devolução — dados de pagamento (metade 1)',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.DevolucaoHandler.iniciarDevolucao('55'),
    esperado: 1,
    porque: 'card nativo: texto + botão "Copiar código Pix" juntos. Eram 3.'
  },
  {
    nome: 'Devolução — card recusado pela Meta (rede de segurança)',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true, cardAceito: false },
    roda: ctx => ctx.DevolucaoHandler.iniciarDevolucao('55'),
    esperado: 3,
    porque: 'volta ao QR + copia-e-cola. Custa 2 a mais, mas é a mensagem por onde o dinheiro passa'
  },
  {
    nome: 'Devolução — comprovante analisado (metade 2)',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.TESTE'),
    esperado: 1,
    porque: 'só o resultado, com os dados do OCR dentro. Eram 3.'
  },
  {
    nome: 'Devolução — comprovante com o indicador de digitação recusado',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true, digitandoFunciona: false },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.TESTE'),
    esperado: 2,
    porque: 'sem o balão, o "⏳ Analisando..." volta — silêncio de segundos parece travamento'
  },
  {
    nome: 'Comprovante de OFERTA de quem não é cadastrado',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true, camposNovos: true,
               comunidadeGravavel: true,
               sessao: { ofertaComunidadeId: 3, ofertaValor: 20 } },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.T'),
    esperado: 1,
    porque: 'registra sem dizimista. O caminho normal responderia "não encontrei seu cadastro" DEPOIS de a pessoa ter pagado'
  },
  {
    nome: 'Formulário antigo respondido por quem JÁ é dizimista (BL-39)',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.CadastroHandler.finalizar('55'),
    esperado: 1,
    porque: 'o aviso vai junto do menu, numa mensagem só — e nada foi duplicado'
  },
  {
    nome: 'Cadastro concluído — a confirmação já é o menu',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true, dadosCadastro: CADASTRO_PRONTO },
    roda: ctx => ctx.CadastroHandler.finalizar('55'),
    esperado: 1,
    porque: 'antes eram 2 até devolver: esta + a do menu, depois do toque em "🔙 Menu"'
  },
  {
    nome: 'Contato Pastoral — cartão nativo',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    esperado: 1,
    porque: 'cartão com "Conversar". Antes era texto com o número para copiar — mesma 1 mensagem'
  },
  {
    nome: 'Contato Pastoral — cartão recusado (rede de segurança)',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true, contatoAceito: false },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    esperado: 2,
    porque: 'volta ao texto. Quem pediu ajuda não pode ficar sem contato nenhum'
  },
  {
    nome: 'Oferta de quem JÁ é dizimista — TAMBÉM escolhe a comunidade',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.OfertaHandler.iniciar('55'),
    esperado: 1,
    porque: 'a do cadastro é sugestão, não resposta: dá para ofertar para outra'
  },
  {
    nome: 'Oferta de quem NÃO é cadastrado — pergunta a comunidade',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.OfertaHandler.iniciar('55'),
    esperado: 1,
    porque: 'oferta não exige cadastro — é o primeiro fluxo do bot nessa condição'
  },
  {
    nome: 'Oferta — valor escolhido no botão leva ao pagamento',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               sessao: { ofertaComunidadeId: 1, ofertaComunidadeNome: 'Matriz' } },
    roda: ctx => ctx.OfertaHandler.processarBotaoValor('55', 'ofv_20'),
    esperado: 1,
    porque: 'card nativo do BL-40, igual ao dízimo'
  },
  {
    nome: 'Oferta com o formulário ligado — 2 perguntas viram 1',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true, flowOfertaLigado: true },
    roda: ctx => ctx.OfertaHandler.iniciar('55'),
    esperado: 1,
    porque: 'comunidade e valor numa submissão, e a comunidade já vem selecionada'
  },
  {
    nome: 'Oferta de não cadastrado — pede o nome depois da comunidade',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.OfertaHandler.processarComunidade('55', 'ofc_3', 'São José'),
    esperado: 1,
    porque: 'sem nome, a oferta chega à secretaria como um telefone solto'
  },
  {
    nome: 'Oferta de dizimista — NÃO pede o nome (já se sabe)',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               sessao: { ofertaNome: 'Maria' } },
    roda: ctx => ctx.OfertaHandler.processarComunidade('55', 'ofc_3', 'São José'),
    esperado: 1,
    porque: 'vai direto ao valor'
  },
  {
    nome: 'Submenu "Outras opções"',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.menuOutrasOpcoes('55'),
    esperado: 1,
    porque: 'lista, porque 4 destinos não cabem em 3 botões. Custa só a quem entra'
  },
  {
    nome: 'Menu principal de quem já é dizimista',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.menuPrincipal('55'),
    esperado: 1,
    porque: 'o menu decide pelo número — não pergunta quem é'
  }
];

// ---------------------------------------------------------------------------

// O histórico saiu do menu do dizimista (3 botões é o teto do WhatsApp) e virou
// contexto dentro da devolução. Se voltar para lá, um destes dois quebra.
const REGRAS_DE_BOTAO = [
  {
    nome: 'Menu do dizimista tem exatamente os 3 botões combinados',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.menuDizimista('55', DIZIMISTA),
    confere: msgs => {
      const ids = (msgs[0].texto.match(/\[(.*)\]/) || [, ''])[1];
      const esperado = 'btn_devolver_dizimo, btn_oferta, btn_outras_opcoes';
      return ids === esperado ? null : `botões "${ids}", esperado "${esperado}"`;
    }
  },
  {
    nome: 'Quem NÃO é dizimista também vê o botão de Oferta',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.menuPrincipal('55'),
    confere: msgs => msgs[0].texto.includes('btn_oferta')
      ? null
      : 'oferta não exige cadastro, mas sumiu do menu de quem não é cadastrado'
  },
  {
    nome: 'Menu de quem não é dizimista não oferece "Já sou Dizimista"',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.menuPrincipal('55'),
    confere: msgs => msgs[0].texto.includes('btn_ja_sou_dizimista')
      ? 'o botão de identificação voltou ao menu'
      : null
  }
];

// As fusões do BL-37 só valem se NADA sair da tela. Cada regra abaixo guarda
// uma informação que antes tinha mensagem própria e agora divide espaço.
const REGRAS_DE_CONTEUDO = [
  {
    nome: 'A entrada de número NOVO mostra as três portas, não só o cadastro',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.primeiroContato('55'),
    confere: msgs => {
      const m = msgs.find(x => x.tipo === 'menu+imagem');
      if (!m) return 'a entrada não saiu com cabeçalho de imagem';
      if (!m.texto.includes('Cidinha')) return 'a Cidinha não se apresenta';
      if (!m.texto.includes('Bem-vindo')) return 'faltou a boas-vindas';
      // A regra que motivou esta tela: oferta não exige cadastro, e o contato
      // da pastoral não exige nada. Se sobrar só o cadastro, quem chega para
      // ofertar volta ao beco sem saída que isto veio corrigir.
      const faltam = ['btn_ser_dizimista', 'btn_oferta', 'btn_secretaria']
        .filter(b => !m.texto.includes(b));
      return faltam.length ? `faltou porta: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'A entrada única carrega imagem, saudação e os 3 botões',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.primeiroContato('55'),
    confere: msgs => {
      // Fundir três coisas num balão é fácil de desfazer por acidente: some a
      // imagem e ninguém nota, porque a mensagem continua chegando.
      const m = msgs.find(x => x.tipo === 'menu+imagem');
      if (!m) return 'a entrada não saiu com cabeçalho de imagem';
      if (!m.texto.includes('Cidinha')) return 'a Cidinha não se apresenta';
      if (!m.texto.includes('Maria')) return 'a pessoa não é chamada pelo nome';
      // Dois "olá" no mesmo balão foi o motivo de `_textoBoasVindasDizimista`
      // existir; se voltarem, é porque alguém prefixou em vez de trocar.
      if ((m.texto.match(/Olá/g) || []).length > 1) return 'dois "olá" no mesmo balão';
      const faltam = ['btn_devolver_dizimo', 'btn_oferta', 'btn_outras_opcoes']
        .filter(b => !m.texto.includes(b));
      return faltam.length ? `faltou botão: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'O card carrega os dados de pagamento inteiros',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.DevolucaoHandler.iniciarDevolucao('55'),
    confere: msgs => {
      const card = (msgs.find(m => m.tipo === 'card-pix') || {}).texto || '';
      const faltam = ['Banco do Brasil', 'Paróquia', 'pix@paroquia.org', 'comprovante']
        .filter(t => !card.includes(t));
      return faltam.length ? `faltou no card: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'Card recusado → o caminho antigo entrega tudo, sem faltar nada',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true, cardAceito: false },
    roda: ctx => ctx.DevolucaoHandler.iniciarDevolucao('55'),
    confere: (msgs, ctx) => {
      // A regra que não pode quebrar: se o card falhar, a pessoa AINDA tem
      // como pagar. Dados de pagamento + BR Code intacto.
      const tem = msgs.some(m => m.texto.includes('pix@paroquia.org') && m.texto.includes('DADOS PARA PAGAMENTO'));
      if (!tem) return 'os dados de pagamento não chegaram';
      const esperado = ctx.MediaService._gerarPayloadPix(
        'pix@paroquia.org', DIZIMISTA.x_studio_value, 'Paróquia N. S. da Conceição Aparecida'
      );
      return msgs.some(m => m.texto === esperado) ? null : 'o BR Code de reserva não veio intacto';
    }
  },
  {
    nome: 'No caminho de reserva, o copia-e-cola segue sozinho e sem formatação',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true, cardAceito: false },
    roda: ctx => ctx.DevolucaoHandler.iniciarDevolucao('55'),
    confere: (msgs, ctx) => {
      // Um toque longo → Copiar precisa levar EXATAMENTE o código EMV. Qualquer
      // texto em volta, ou negrito/crase envolvendo o código, entraria na cópia
      // e o app do banco recusaria.
      //
      // A comparação é com o payload que o próprio MediaService gera, em vez de
      // uma lista de caracteres proibidos. Duas versões anteriores deste teste
      // acusaram o código à toa: uma proibia `*`, que é o campo txid do padrão
      // PIX (`62070503***`), e a outra proibia espaço, que existe no nome do
      // recebedor (`5925PAROQUIA N S DA CONCEICAO`). Comparar com o esperado
      // não tem como errar assim.
      const esperado = ctx.MediaService._gerarPayloadPix(
        'pix@paroquia.org', DIZIMISTA.x_studio_value, 'Paróquia N. S. da Conceição Aparecida'
      );
      const ultima = msgs[msgs.length - 1];
      return ultima.texto === esperado
        ? null
        : 'a última mensagem não é exatamente o BR Code (veio texto ou formatação junto)';
    }
  },
  {
    nome: 'O resultado mostra o que o OCR leu (valor, data, chave)',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.TESTE'),
    confere: msgs => {
      const t = msgs[msgs.length - 1].texto;
      const faltam = ['DADOS IDENTIFICADOS', '50,00', '12/08/2026', 'pix@paroquia.org']
        .filter(x => !t.includes(x));
      return faltam.length ? `faltou no resultado: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'A devolução mostra a última devolução como contexto',
    cenario: {
      dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
      devolucoes: [{ x_studio_data_da_devolucao: '12/08/2026', x_studio_value: 150 }]
    },
    roda: ctx => ctx.DevolucaoHandler.iniciarDevolucao('55'),
    confere: msgs => {
      const card = (msgs.find(m => m.tipo === 'card-pix') || {}).texto || '';
      return card.includes('última devolução') && card.includes('histórico')
        ? null : 'a linha do histórico sumiu da mensagem de pagamento';
    }
  },
  {
    nome: 'A confirmação do cadastro oferece devolver o dízimo na hora',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true, dadosCadastro: CADASTRO_PRONTO },
    roda: ctx => ctx.CadastroHandler.finalizar('55'),
    confere: msgs => {
      const t = msgs[msgs.length - 1].texto;
      if (!t.includes('Cadastro realizado')) return 'a mensagem de sucesso não saiu';
      const faltam = ['btn_devolver_dizimo', 'btn_oferta', 'btn_outras_opcoes']
        .filter(b => !t.includes(b));
      return faltam.length ? `faltou o botão: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'As três telas de dizimista mostram os MESMOS botões',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true, dadosCadastro: CADASTRO_PRONTO },
    roda: ctx => {
      // Menu, fim do cadastro e fim do cadastro de membro. Se um dia divergirem,
      // é aqui que aparece — foi o que aconteceu antes do BL-38, quando o menu
      // de "já sou dizimista" tinha botões diferentes do menu principal.
      ctx.MenuHandler.menuDizimista('55', DIZIMISTA);
      ctx.CadastroHandler.finalizar('55');
    },
    confere: msgs => {
      const ids = msgs.map(m => (m.texto.match(/\[(.*)\]/) || [, ''])[1]);
      return ids.every(x => x === ids[0]) ? null : `conjuntos diferentes: ${ids.join(' | ')}`;
    }
  },
  {
    nome: 'A lista de comunidades marca a da pessoa, mas traz todas',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.OfertaHandler.iniciar('55'),
    confere: msgs => {
      const t = msgs[0].texto;
      if (!t.includes('Para qual comunidade')) return 'não perguntou a comunidade';
      return null;
    }
  },
  {
    nome: 'O cartão de contato leva nome, número e a comunidade',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    confere: msgs => {
      const c = msgs.find(m => m.tipo === 'contato');
      if (!c) return 'não saiu cartão de contato';
      const faltam = ['João da Silva', '+5586988521231', 'São José']
        .filter(t => !c.texto.includes(t));
      return faltam.length ? `faltou no cartão: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'O wa_id do cartão leva o código do país',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    confere: msgs => {
      const c = msgs.find(m => m.tipo === 'contato');
      if (!c) return 'não saiu cartão de contato';
      // Sem o 55, o WhatsApp lê o DDD 86 como código de país da China: o
      // contato é salvo com o país errado e "Conversar" abre um número que
      // não existe. O `phone` pode estar certo e o `wa_id` errado — eram
      // montados por caminhos diferentes, e foi assim que o bug passou.
      const m = c.texto.match(/"wa_id":"(\d+)"/);
      if (!m) return 'o cartão não trouxe wa_id';
      return m[1] === '5586988521231'
        ? null
        : `wa_id saiu como ${m[1]} — devia ser 5586988521231`;
    }
  },
  {
    nome: 'A oferta grava o valor ESCOLHIDO, não o que o OCR leu',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true, camposNovos: true,
               comunidadeGravavel: true,
               sessao: { ofertaComunidadeId: 3, ofertaValor: 20 } },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.T'),
    confere: msgs => {
      // O OCR devolve 50 no stub; a pessoa escolheu 20. Vale o que ela disse —
      // a extração de valor é reconhecidamente frágil (BL-14).
      const t = msgs[msgs.length - 1].texto;
      if (!t.includes('Oferta recebida')) return 'não confirmou a oferta';
      return t.includes('20,00') ? null : 'gravou o valor do OCR, não o escolhido';
    }
  },
  {
    nome: 'Reserva: legenda longa demais não derruba os dados de pagamento',
    cenario: {
      dizimista: { id: 7, x_name: 'M'.repeat(400), x_studio_value: 50, x_studio_comunidade: [1, 'Matriz'] },
      temAvatar: true, flowLigado: true, cardAceito: false
    },
    roda: ctx => ctx.DevolucaoHandler.iniciarDevolucao('55'),
    confere: msgs => {
      // Acima de 1024 caracteres a Meta recusa a imagem INTEIRA. A legenda
      // volta a ser mensagem própria: gasta uma mensagem, mas nada se perde.
      const tem = msgs.some(m => m.texto.includes('pix@paroquia.org') && m.texto.includes('DADOS PARA PAGAMENTO'));
      return tem ? null : 'os dados de pagamento não chegaram';
    }
  }
];

let falhas = 0;

console.log('\n📊 Mensagens enviadas por entrada no bot\n' + '─'.repeat(64));

for (const c of CENARIOS) {
  enviadas = [];
  gratis   = [];
  consultas = [];
  const ctx = montarContexto(c.cenario);
  c.roda(ctx);

  const ok = enviadas.length === c.esperado;
  if (!ok) falhas++;

  console.log(`\n${ok ? '✅' : '❌'} ${c.nome}`);
  console.log(`   ${enviadas.length} mensagem(ns)${ok ? '' : ` — FLUXOS.md diz ${c.esperado}`}`);
  console.log(`   ${c.porque}`);
  enviadas.forEach((m, i) => console.log(`     ${i + 1}. [${m.tipo}] ${m.texto.split('\n')[0].slice(0, 70)}`));
  if (gratis.length) console.log(`     (+ ${gratis.join(', ')} — não é mensagem, não é cobrado)`);
}

console.log('\n' + '─'.repeat(64));
console.log('🔘 Botões dos menus\n');

for (const r of REGRAS_DE_BOTAO) {
  enviadas = [];
  gratis   = [];
  consultas = [];
  const ctx = montarContexto(r.cenario);
  r.roda(ctx);
  const erro = enviadas.length ? r.confere(enviadas) : 'nenhuma mensagem enviada';
  if (erro) falhas++;
  console.log(`${erro ? '❌' : '✅'} ${r.nome}${erro ? ' — ' + erro : ''}`);
}

console.log('\n' + '─'.repeat(64));
console.log('🔑 tipoDaChavePix — o key_type que o card de pagamento exige\n');

// 11 dígitos é ambíguo: CPF e celular brasileiro têm o mesmo tamanho. Uma
// primeira versão classificava por tamanho e chamava TODO celular guardado sem
// o '+' de CPF — a Meta recusaria o card sem dizer por quê. O desempate é o
// dígito verificador, e estes casos guardam isso.
const CHAVES = [
  ['pix@paroquia.org',                      'EMAIL', 'e-mail'],
  ['+5586988521231',                        'PHONE', 'telefone com +'],
  ['39580525000189',                        'CNPJ',  '14 dígitos'],
  ['11144477735',                           'CPF',   'CPF com DV válido'],
  ['111.444.777-35',                        'CPF',   'CPF pontuado'],
  ['86988521231',                           'PHONE', 'celular sem + (DV não fecha)'],
  ['11987654321',                           'PHONE', 'celular de SP sem +'],
  ['e7b8c9d0-1234-5678-9abc-def012345678',  'EVP',   'chave aleatória'],
  ['',                                      'null',  'vazio'],
  ['abc',                                   'null',  'lixo']
];

{
  const ctx = montarContexto({ dizimista: null, temAvatar: false, flowLigado: false });
  for (const [chave, esperado, oQue] of CHAVES) {
    const obtido = String(ctx.Utils.tipoDaChavePix(chave));
    const ok = obtido === esperado;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${oQue.padEnd(30)} → ${obtido}${ok ? '' : `  (esperado ${esperado})`}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('☎️  _e164 — o número que faz o botão "Conversar" funcionar\n');

// O Odoo guarda telefone em formatos variados: com máscara, sem DDI, com
// espaços. O cartão de contato precisa de E.164, e um número mal formado não
// falha — só gera um botão "Conversar" que não abre conversa nenhuma.
const TELEFONES = [
  ['5586988521231',    '+5586988521231', 'já com DDI'],
  ['86988521231',      '+5586988521231', 'sem DDI (11 dígitos)'],
  ['(86) 98852-1231',  '+5586988521231', 'com máscara'],
  ['86 3221-1234',     '+558632211234',  'fixo, 10 dígitos'],
  ['+55 86 98852-1231','+5586988521231', 'já em E.164'],
  ['',                 '',               'vazio']
];

{
  const ctx = montarContexto({ dizimista: null, temAvatar: false, flowLigado: false });
  for (const [entrada, esperado, oQue] of TELEFONES) {
    const obtido = ctx.Utils._e164(entrada);
    const ok = obtido === esperado;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${oQue.padEnd(24)} ${JSON.stringify(entrada).padEnd(22)} → ${obtido || '(vazio)'}${ok ? '' : `  (esperado ${esperado})`}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🧭 Métodos chamados que não existem\n');

// POR QUE ISTO EXISTE
// Em 19/09, com o bot em produção, o Cloud Logging mostrou
// "this._mesAtual is not a function" repetindo a cada 5 minutos. A função era
// chamada em QUATRO lugares e nunca tinha sido definida.
//
// Ficou invisível porque as três chamadas estavam dentro de `try/catch` com
// `console.warn`. O bot funcionava; só a medição de consumo estava morta — e
// `registrarConsumoExterno` lançava na PRIMEIRA linha do try, então nem a cota
// de UrlFetch chegava a ser gravada.
//
// Esta varredura é estática: lê o fonte de cada objeto, junta todo `this.x(`
// e confere se `x` existe. Não substitui teste de comportamento — pega uma
// classe de erro que só aparece em runtime, dentro de um catch que ninguém lê.
{
  const OBJETOS = [
    ['Utils.gs',              'Utils'],
    ['OdooService.gs',        'OdooService'],
    ['MediaService.gs',       'MediaService'],
    ['MenuHandler.gs',        'MenuHandler'],
    ['CadastroHandler.gs',    'CadastroHandler'],
    ['DevolucaoHandler.gs',   'DevolucaoHandler'],
    ['ComprovanteHandler.gs', 'ComprovanteHandler'],
    ['OfertaHandler.gs',      'OfertaHandler'],
    ['FlowHandler.gs',        'FlowHandler'],
    ['VisionService.gs',      'VisionService']
  ];

  // Contexto com TODOS os .gs carregados, para alcançar cada objeto por nome.
  const ctxTudo = {
    console: { log() {}, warn() {}, error() {} },
    Utilities: { formatDate: () => '', sleep() {}, base64Encode: () => '' },
    Logger: { log() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}) }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    UrlFetchApp: { fetch: () => ({}) },
    SpreadsheetApp: {}, DriveApp: {}, MailApp: {}, Session: {}
  };
  vm.createContext(ctxTudo);
  const fontes = OBJETOS.map(([arq]) => fs.readFileSync(path.join(RAIZ, arq), 'utf8'));
  const tudo = vm.runInContext(
    [fs.readFileSync(path.join(RAIZ, 'Config.gs'), 'utf8')].concat(fontes).join('\n;\n') +
    '\n;({' + OBJETOS.map(([, nome]) => nome).join(', ') + '});',
    ctxTudo, { filename: 'todos.gs' }
  );

  let achados = 0;
  OBJETOS.forEach(([arquivo, nome], i) => {
    const obj = tudo[nome];
    const fonte = fontes[i];
    const usados = new Set();
    let m;
    const re = /this\.(_?[a-zA-Z][\w]*)\s*\(/g;
    while ((m = re.exec(fonte)) !== null) usados.add(m[1]);

    for (const metodo of usados) {
      if (typeof obj[metodo] !== 'function') {
        achados++;
        falhas++;
        console.log(`❌ ${nome}.${metodo}() é chamado e NÃO existe  (${arquivo})`);
      }
    }
  });

  if (!achados) {
    console.log(`✅ ${OBJETOS.length} objetos varridos — todo this.metodo() chamado existe`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🛰️  As sondas rodam de ponta a ponta\n');

// ─────────────────────────────────────────────────────────────────────────
// As sondas nunca eram executadas por nada antes de rodarem em produção. Três
// quebras seguidas saíram assim, e as três só apareceram no aparelho de quem
// pediu o teste:
//
//   `NUMERO_TESTE is not defined`  — global de arquivo que o .claspignore corta
//   `comImagem is not defined`     — definição apagada num refactor
//   media ID lido sem as travas    — a sonda mentiu sobre o resultado
//
// `node --check` não pega nenhuma: são erros de runtime, não de sintaxe. A
// varredura de `this.metodo()` também não, porque numa sonda tudo é função
// solta. O único jeito de pegar é CHAMAR a função.
//
// Aqui cada sonda roda inteira contra stubs. Nada sai para a rede: o que se
// afirma é só que ela chega ao fim sem ReferenceError e envia o que promete.
{
  const sondas = [
    {
      arquivo: 'TesteCabecalhoImagem.gs',
      funcao:  'testarCabecalhoImagem',
      envios:  3,   // imagem sozinha, botões com cabeçalho, botões sem
      confere(enviados) {
        const [img, comCab, semCab] = enviados;
        if (!img || img.type !== 'image') return '1º envio devia ser a imagem sozinha';
        if (!comCab || !comCab.interactive) return '2º envio devia ser interativo';
        const h = comCab.interactive.header;
        if (!h || h.type !== 'image') return '2º envio devia ter cabeçalho de imagem';
        if (semCab.interactive.header) return '3º envio (controle) não pode ter cabeçalho';
        return null;
      }
    },
    {
      arquivo: 'TesteCabecalhoFlow.gs',
      funcao:  'testarCabecalhoFlow',
      envios:  2,   // flow com cabeçalho de imagem, flow com cabeçalho de texto
      confere(enviados) {
        const [comImg, comTxt] = enviados;
        if (!comImg || comImg.interactive.type !== 'flow') return '1º envio devia ser flow';
        if (comImg.interactive.header.type !== 'image') return '1º envio devia ter cabeçalho de imagem';
        if (comTxt.interactive.header.type !== 'text') return '2º envio (controle) devia ter cabeçalho de texto';
        // O que distingue uma sonda útil de um envio qualquer: entre os dois
        // envios só o cabeçalho pode mudar. Se o resto divergir, o resultado
        // não prova nada sobre cabeçalho.
        const semCabecalho = (p) => {
          const c = JSON.parse(JSON.stringify(p));
          delete c.interactive.header;
          delete c.interactive.body;
          delete c.interactive.action.parameters.flow_token;  // carrega Date.now()
          return JSON.stringify(c);
        };
        return semCabecalho(comImg) === semCabecalho(comTxt)
          ? null
          : 'os dois envios diferem em mais do que o cabeçalho';
      }
    },
    {
      // A mesma sonda com AVATAR_URL configurada. Sem esta variante o braço 1b
      // — o único que ainda responde alguma coisa — nunca seria executado por
      // nada antes de rodar em produção.
      arquivo: 'TesteCabecalhoFlow.gs',
      funcao:  'testarCabecalhoFlow',
      rotulo:  'testarCabecalhoFlow() com AVATAR_URL',
      props:   { AVATAR_URL: 'https://meudizimo.pnscaparecida.com/avatar.png' },
      envios:  3,   // por id, por link, e o controle de texto
      confere(enviados) {
        const porLink = enviados[1];
        const img = porLink && porLink.interactive.header.image;
        if (!img) return '2º envio devia ter cabeçalho de imagem';
        if (!img.link) return '2º envio devia mandar a imagem por link';
        if (img.id) return 'link e id juntos — a Meta recusa os dois no mesmo header';
        return null;
      }
    },
    {
      // Duas URLs, e a primeira funciona: a segunda tem de ser PULADA. Cada
      // tentativa é uma mensagem cobrada, então um laço que insiste depois de
      // acertar gasta dinheiro à toa — e é o tipo de coisa que só apareceria
      // na fatura.
      arquivo: 'TesteCabecalhoFlow.gs',
      funcao:  'testarCabecalhoFlow',
      rotulo:  'testarCabecalhoFlow() para de tentar quando uma URL funciona',
      props:   { AVATAR_URL: 'https://um.exemplo/a.png, https://dois.exemplo/b.png' },
      envios:  3,   // id, a PRIMEIRA url, e o controle — a segunda não sai
      confere(enviados) {
        const links = enviados
          .filter(p => (p.interactive.header.image || {}).link)
          .map(p => p.interactive.header.image.link);
        if (links.length !== 1) return `mandou ${links.length} links, devia mandar 1`;
        return links[0] === 'https://um.exemplo/a.png'
          ? null
          : `tentou ${links[0]} — devia começar pela primeira da lista`;
      }
    },
    {
      // Não manda mensagem: o que ela faz é apagar cache, sessão e o registro
      // no Odoo. Entra aqui pelo mesmo motivo das outras — é função que só
      // roda no editor, e por isso ninguém a executa antes de você.
      arquivo: 'Setup.gs',
      funcao:  'reviverPrimeiroContato',
      envios:  0,
      confere: (_envios, apagados) => (apagados.includes('x_contato_bot')
        ? null
        : 'não apagou o x_contato_bot — limpar só o cache não revive o contato')
    },
    {
      arquivo: 'TestePixNativo.gs',
      funcao:  'testarPixNativo',
      envios:  1,
      confere(enviados) {
        const p = enviados[0];
        if (!p || p.type !== 'interactive') return 'devia enviar uma interativa';
        if (p.interactive.type !== 'order_details') return 'devia ser order_details';
        return null;
      }
    }
  ];

  for (const sonda of sondas) {
    const enviados = [];
    const apagados = [];
    const respostaOk = {
      getResponseCode: () => 200,
      getContentText:  () => JSON.stringify({
        messages: [{ id: 'wamid.TESTE' }],
        // O que a Graph API devolve na consulta de um media ID vivo.
        id: '123', url: 'https://exemplo/x', mime_type: 'image/png', file_size: 1
      })
    };

    const PROPS = Object.assign({
      NUMERO_TESTE:      '5586988521231',
      WHATSAPP_TOKEN:    'tok',
      WHATSAPP_PHONE_ID: '111',
      FLOW_ID_CADASTRO:  '123456',
      // Recém-guardado, para a sonda seguir pelo caminho do cache.
      media_id_avatar: JSON.stringify({ id: '999', digital: 'x', em: Date.now() })
    }, sonda.props || {});

    const ctx = {
      console: { log() {}, warn() {}, error() {} },
      Logger:  { log() {} },
      Utilities: {
        formatDate: () => '2026-09-19',
        base64Decode: () => [],
        newBlob: () => ({}),
        sleep() {}
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty(k) { return PROPS[k] || null; },
          setProperty() {}, setProperties() {}, deleteProperty() {},
          getProperties: () => PROPS
        })
      },
      CacheService: {
        getScriptCache: () => ({ get: () => null, put() {}, remove() {}, removeAll() {} })
      },
      StateManager: { PREFIXO_SESSAO: 'sessao_ativa_' },
      FlowHandler:  { TOKEN_CADASTRO: 'cadastro:' },
      LockService:  { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      UrlFetchApp:  { fetch: () => respostaOk },
      Utils: {
        _post(payload) { enviados.push(payload); return respostaOk; },
        fetchComRetry: () => respostaOk,
        tipoDaChavePix: () => 'CPF'
      },
      MediaService: {
        MEDIA_ID_VALIDADE_MS: 7 * 24 * 60 * 60 * 1000,
        _descartarMediaId() {},
        mediaIdDoAvatar: () => '999',
        subirImagem: () => '999',
        _gerarPayloadPix: () => '00020126...BR.GOV.BCB.PIX...6304ABCD'
      },
      OdooService: {
        buscarParametros: () => ({ x_studio_avatar: 'base64', x_studio_chave_pix: 'chave' }),
        buscarContatoBot: () => ({ id: 7, x_name: '5586988521231' }),
        listarComunidades: () => [{ id: 1, x_name: 'Matriz' }],
        unlink: (modelo) => { apagados.push(modelo); },
        buscarDizimistaPorWhatsapp: () => ({
          id: 1, x_name: 'Fulano',
          x_studio_comunidade: [1, 'Matriz']
        }),
        buscarDadosPagamentoComunidade: () => ({
          id: 1, x_name: 'Matriz',
          x_studio_chave_pix: '12345678900',
          x_studio_titular_conta: 'Paroquia',
          x_studio_cidade: 'TERESINA'
        })
      }
    };
    vm.createContext(ctx);

    let erro = null;
    try {
      vm.runInContext(
        fs.readFileSync(path.join(RAIZ, 'Config.gs'), 'utf8') + '\n;\n' +
        fs.readFileSync(path.join(RAIZ, sonda.arquivo), 'utf8') + '\n;\n' +
        sonda.funcao + '();',
        ctx, { filename: sonda.arquivo }
      );
    } catch (e) {
      erro = e.message;
    }

    if (!erro && enviados.length !== sonda.envios) {
      erro = `enviou ${enviados.length} mensagem(ns), esperava ${sonda.envios}`;
    }
    if (!erro) erro = sonda.confere(enviados, apagados);

    if (erro) falhas++;
    const ok = sonda.envios
      ? 'roda inteira e envia o previsto'
      : 'roda inteira e faz o que promete, sem enviar nada';
    const nome = sonda.rotulo || (sonda.funcao + '()');
    console.log(`${erro ? '❌' : '✅'} ${nome} ${erro ? '— ' + erro : ok}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('📦 Globais que só existem fora do deploy\n');

// ─────────────────────────────────────────────────────────────────────────
// A armadilha: `.claspignore` decide o que chega ao Apps Script. `Tests.gs`
// está lá, e é onde mora `const NUMERO_TESTE`. Um arquivo que É enviado podia
// escrever `numero || NUMERO_TESTE`, passar em toda revisão de código, rodar
// no harness — e explodir em produção com `NUMERO_TESTE is not defined`,
// porque a linha que declara a constante nunca subiu junto.
//
// Foi exatamente o que aconteceu com as sondas S1 e BL-40. O jeito certo é
// ler a Script Property direto, como Setup.gs e NotificacaoHandler.gs fazem.
//
// Esta varredura lê o .claspignore, coleta o que os arquivos EXCLUÍDOS
// declaram no topo, e acusa quem é enviado e depende disso.
{
  const padroes = fs.readFileSync(path.join(RAIZ, '.claspignore'), 'utf8')
    .split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  // Só precisamos dos .gs: são os únicos que compartilham escopo global no GAS.
  const todosGs = fs.readdirSync(RAIZ).filter(f => f.endsWith('.gs'));
  const excluidos = todosGs.filter(f => padroes.includes(f));
  const enviados  = todosGs.filter(f => !padroes.includes(f));

  // O que cada arquivo excluído declara no nível do arquivo. No V8 do Apps
  // Script todo .gs compartilha um escopo, então isto seria visível — se o
  // arquivo subisse.
  const DECL = /^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm;
  const foraDoDeploy = new Map();
  for (const arq of excluidos) {
    const fonte = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
    let m;
    while ((m = DECL.exec(fonte)) !== null) foraDoDeploy.set(m[1], arq);
  }

  let achados = 0;
  for (const arq of enviados) {
    const fonte = fs.readFileSync(path.join(RAIZ, arq), 'utf8')
      // Comentários e strings citam esses nomes o tempo todo; só o código conta.
      // Uma passada só, com alternância: quem começa primeiro vence. Em duas
      // passadas o `//` de uma URL dentro de string comeria o resto da linha e
      // desalinharia as aspas seguintes — foi assim que a varredura acusou
      // Setup.gs, que só cita o nome em comentário e em string.
      .replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
        ' '
      );

    for (const [nome, origem] of foraDoDeploy) {
      // Se o próprio arquivo enviado também declara o nome, não há dependência.
      if (new RegExp('^(?:const|let|var|function)\\s+' + nome + '\\b', 'm').test(fonte)) continue;
      // Ignora `obj.NOME` e `NOME:` — só o uso como global solto quebra.
      if (new RegExp('(?<![.\\w$])' + nome + '(?![\\w$:])').test(fonte)) {
        achados++;
        falhas++;
        console.log(`❌ ${arq} usa \`${nome}\`, declarado só em ${origem} (fora do deploy)`);
      }
    }
  }

  if (!achados) {
    console.log(`✅ ${enviados.length} arquivos enviados não dependem de nenhum dos ` +
                `${foraDoDeploy.size} globais de ${excluidos.join(', ')}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('⛔ Lista de bloqueio — BL-36\n');

// A regra que não pode quebrar: bloqueado não recebe NADA. Nem o aviso de
// pausa do freio de taxa — por isso o portão vem antes dele.
{
  const casos = [
    { nome: 'Número bloqueado não recebe resposta nenhuma', bloqueado: true,  espera: 0 },
    { nome: 'Número normal continua sendo atendido',        bloqueado: false, espera: 1 }
  ];
  for (const c of casos) {
    enviadas = [];
    const ctx = montarContexto({ dizimista: DIZIMISTA, propriedades: c.bloqueado ? { 'bloqueado_55': '{}' } : {} });
    if (!ctx.Utils.estaBloqueado('55')) ctx.MenuHandler.menuDizimista('55', DIZIMISTA);
    const ok = enviadas.length === c.espera;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${c.nome}${ok ? '' : `  (esperava ${c.espera}, veio ${enviadas.length})`}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🔍 Extração do comprovante — BL-14\n');

// O BL-14 nasceu de uma falha REAL: o extrator devolveu "4339441920260" como
// chave PIX, que não é chave nenhuma — são os 13 primeiros dígitos do ID da
// transação (E**4339441920260**4052103uuGZ7BZQ3g5). O padrão de telefone vinha
// primeiro no array e casava com o trecho numérico antes de chegar à chave de
// verdade. Isso grava dado enganoso no Odoo e inviabiliza a conferência do
// BL-26.
//
// O código já foi corrigido, mas nada guardava a correção. Estes casos guardam.
const COMPROVANTES = [
  {
    nome: 'ID da transação NÃO vira chave PIX',
    texto: 'Comprovante de transferência\n' +
           'ID da transação: E43394419202604052103uuGZ7BZQ3g5\n' +
           'Valor: R$ 150,00\n' +
           'Chave Pix: 160.740.093-68\n',
    chave: '160.740.093-68',
    valor: 150
  },
  {
    nome: 'Tarifa não é confundida com o valor pago',
    texto: 'Tarifa: R$ 2,50\nValor: R$ 80,00\n',
    chave: null,
    valor: 80
  },
  {
    nome: 'Saldo não é confundido com o valor pago',
    texto: 'Saldo disponível: R$ 4.320,15\nPix enviado\nR$ 45,00\n',
    chave: null,
    valor: 45
  },
  {
    nome: 'Chave de e-mail com domínio multinível',
    texto: 'Chave Pix: tesouraria@paroquia.org.br\nValor: R$ 30,00\n',
    chave: 'tesouraria@paroquia.org.br',
    valor: 30
  },
  {
    nome: 'Chave aleatória (UUID)',
    texto: 'Chave Pix: e7b8c9d0-1234-5678-9abc-def012345678\nValor: R$ 10,00\n',
    chave: 'e7b8c9d0-1234-5678-9abc-def012345678',
    valor: 10
  },
  {
    nome: 'Telefone só conta como chave com o +55',
    texto: 'Chave Pix: +55 86 98852-1231\nValor: R$ 25,00\n',
    chave: '+55 86 98852-1231',
    valor: 25
  }
];

{
  const V = extratoresDoVision();
  for (const c of COMPROVANTES) {
    const chave = V._extrairChavePix(c.texto);
    const valor = V._extrairValor(c.texto);
    const okC = chave === c.chave;
    const okV = valor === c.valor;
    if (!okC || !okV) falhas++;
    console.log(`${okC && okV ? '✅' : '❌'} ${c.nome}`);
    if (!okC) console.log(`   ⚠️ chave: esperado ${JSON.stringify(c.chave)}, veio ${JSON.stringify(chave)}`);
    if (!okV) console.log(`   ⚠️ valor: esperado ${c.valor}, veio ${valor}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🧾 Filtro por tipo de contribuição (BL-41 · A5)\n');

// Depois que a oferta passou a morar no mesmo modelo do dízimo, toda consulta a
// x_devolucao devolve os dois. Não existe default bom para todas — e errar aqui
// NÃO FALHA, só faz o número do coordenador mentir. Daí as regras.
const filtroTipo = dominio =>
  (dominio || []).filter(d => d[0] === 'x_studio_tipo_contribuicao').map(d => d[2])[0] || null;

const FILTROS = [
  {
    nome: 'Aviso de duplicata olha só dízimo',
    porque: 'quem ofertou não pode levar "você já devolveu este mês"',
    roda: ctx => ctx.OdooService.devolucoesDoMes(7),
    espera: 'dizimo'
  },
  {
    nome: 'Histórico do dizimista olha só dízimo',
    porque: 'a linha "sua última devolução" vive dentro do fluxo de dízimo',
    roda: ctx => ctx.OdooService.buscarDevolucoesDizimista(7),
    espera: 'dizimo'
  },
  {
    nome: 'Relatório do coordenador olha só dízimo por padrão',
    porque: 'somar oferta no total do dízimo faz os números da paróquia mentirem',
    roda: ctx => ctx.OdooService.listarDevolucoesPorPeriodo('2026-09-01', '2026-09-30'),
    espera: 'dizimo'
  },
  {
    nome: 'Relatório aceita pedir oferta explicitamente',
    porque: 'sem isso não haveria como a paróquia ver o que arrecadou em ofertas',
    roda: ctx => ctx.OdooService.listarDevolucoesPorPeriodo('2026-09-01', '2026-09-30', 'oferta'),
    espera: 'oferta'
  },
  {
    nome: 'Relatório aceita o consolidado dos dois',
    porque: 'null = sem filtro',
    roda: ctx => ctx.OdooService.listarDevolucoesPorPeriodo('2026-09-01', '2026-09-30', null),
    espera: null
  },
  {
    nome: 'Fila de conferência NÃO filtra',
    porque: 'comprovante de oferta também precisa ser conferido pela secretaria',
    roda: ctx => ctx.OdooService.buscarDevolucoesPendentes(1),
    espera: null
  }
];

for (const f of FILTROS) {
  consultas = [];
  const ctx = montarContexto({ dizimista: DIZIMISTA, camposNovos: true });
  let errFiltro = ''; try { f.roda(ctx); } catch (e) { errFiltro = e.message; }
  const dev = consultas.filter(c => c.modelo === 'x_devolucao').pop();
  const obtido = dev ? filtroTipo(dev.dominio) : 'NENHUMA CONSULTA';
  const ok = obtido === f.espera;
  if (!ok) falhas++;
  console.log(`${ok ? '✅' : '❌'} ${f.nome}`);
  console.log(`   ${f.porque}${ok ? '' : `\n   ⚠️ filtro esperado ${f.espera}, veio ${obtido}${errFiltro ? ' — ' + errFiltro : ''}`}`);
}

// E a trava que impede o filtro de derrubar tudo antes da migração.
{
  consultas = [];
  const ctx = montarContexto({ dizimista: DIZIMISTA, camposNovos: false });
  ctx.OdooService.devolucoesDoMes(7);
  const dev = consultas.filter(c => c.modelo === 'x_devolucao').pop();
  const semFiltro = dev && filtroTipo(dev.dominio) === null;
  if (!semFiltro) falhas++;
  console.log(`${semFiltro ? '✅' : '❌'} Antes da migração, NÃO filtra`);
  console.log('   o campo ainda não existe; filtrar por ele faria o search_read inteiro falhar');
}

console.log('\n' + '─'.repeat(64));
console.log('🏛️  registrarDevolucao — a comunidade é obrigatória (BL-41)\n');

// Antes da migração, a comunidade era espelhada do dizimista e o bot nunca a
// gravava. Depois, quem não gravar deixa o campo vazio EM SILÊNCIO: nada falha,
// e a linha some dos relatórios do coordenador. Por isso é erro, não omissão.
const GRAVACAO = [
  {
    nome: 'Dízimo: herda a comunidade do dizimista',
    cenario: { dizimista: DIZIMISTA },
    roda: ctx => ctx.OdooService.registrarDevolucao(7, { valor: 50, data: '12/08/2026' }),
    espera: 'ok'
  },
  {
    nome: 'Oferta sem dizimista, com comunidade informada',
    cenario: { dizimista: null },
    roda: ctx => ctx.OdooService.registrarDevolucao(null, { valor: 20 }, null, 'imagem', '',
      { comunidadeId: 3, tipo: 'oferta', telefoneOfertante: '5586988521231' }),
    espera: 'ok'
  },
  {
    nome: 'Oferta SEM comunidade → recusa, em vez de gravar linha órfã',
    cenario: { dizimista: null },
    roda: ctx => ctx.OdooService.registrarDevolucao(null, { valor: 20 }, null, 'imagem', '',
      { tipo: 'oferta' }),
    espera: 'erro'
  },
  {
    nome: 'Dizimista sem comunidade no Odoo → recusa',
    cenario: { dizimista: DIZIMISTA, dizimistaNoOdoo: { id: 7, x_studio_comunidade: false } },
    roda: ctx => ctx.OdooService.registrarDevolucao(7, { valor: 50 }),
    espera: 'erro'
  }
];

for (const g of GRAVACAO) {
  enviadas = [];
  gratis   = [];
  const ctx = montarContexto(g.cenario);
  let obtido;
  let motivo = '';
  try { g.roda(ctx); obtido = 'ok'; } catch (e) { obtido = 'erro'; motivo = e.message; }
  const ok = obtido === g.espera;
  if (!ok) falhas++;
  console.log(`${ok ? '✅' : '❌'} ${g.nome}${ok ? '' : `  (esperado ${g.espera}, veio ${obtido}: ${motivo})`}`);
}

console.log('\n' + '─'.repeat(64));
console.log('🧩 Conteúdo que não pode se perder nas fusões\n');

for (const r of REGRAS_DE_CONTEUDO) {
  enviadas = [];
  gratis   = [];
  consultas = [];
  const ctx = montarContexto(r.cenario);
  r.roda(ctx);
  const erro = enviadas.length ? r.confere(enviadas, ctx) : 'nenhuma mensagem enviada';
  if (erro) falhas++;
  console.log(`${erro ? '❌' : '✅'} ${r.nome}${erro ? ' — ' + erro : ''}`);
}

console.log('\n' + '─'.repeat(64));
if (falhas) {
  console.log(`❌ ${falhas} verificação(ões) fora do esperado.`);
  console.log('   Ou o código mudou e Documentação/FLUXOS.md precisa acompanhar,');
  console.log('   ou voltou uma mensagem que tinha sido cortada.\n');
  process.exit(1);
}
console.log('✅ Tudo conforme Documentação/FLUXOS.md.\n');
