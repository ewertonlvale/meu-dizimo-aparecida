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
const nodeCrypto = require('node:crypto');

const RAIZ = path.join(__dirname, '..');

// Toda leitura de fonte passa por aqui. No Windows, com `core.autocrlf=true`,
// o Git entrega os arquivos com CRLF — e as expressões deste harness, escritas
// com `\n`, deixavam de casar SÓ na máquina de quem desenvolve, enquanto o CI
// (Linux, LF) seguia verde. É a divergência que o verificar-tudo existe para
// impedir. Normalizar na leitura vale para qualquer checkout.
const lerTexto = (caminho) => fs.readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n');

// A fachada do Apps Script (BL-74, Fase 1). Todo contexto que EXECUTA `.gs` do
// deploy a carrega primeiro: os `.gs` só falam com a Plataforma, e ela delega
// aos stubs de CacheService, PropertiesService etc. de cada cenário — assim o
// harness exercita a fachada de verdade, não um dublê dela.
const PLATAFORMA = lerTexto(path.join(RAIZ, 'Plataforma.gs'));

// ---------------------------------------------------------------------------
// A borda: tudo o que sai do processo vira contador
// ---------------------------------------------------------------------------

let enviadas = [];
let gratis   = [];   // sinais que NÃO são mensagens cobradas
let consultas = [];  // domínios enviados ao Odoo, para conferir os filtros
let gravado  = null; // o último registro escrito no Odoo, para os cenários espiarem
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
    lerTexto(path.join(RAIZ, 'VisionService.gs')) + '\n;VisionService',
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
    // O cenário escolhe o estado: sem isso o Router cai sempre no ramo do
    // menu, e o de "escreveu com o formulário aberto" — o do BL-44 — nunca
    // seria alcançado por teste nenhum.
    setEstado: () => {}, getEstado: () => cenario.estado || null, limparDados: () => {},
    iniciarSessaoCadastro: () => {}, registrarSessaoAtiva: () => {},
    appendLog: () => {}, setDados: () => {}, getDados: () => ({}),
    getCampo: (from, campo) => (cenario.sessao || {})[campo],
    salvarMultiplosCampos: () => {}, getDadosTemporarios: () => (cenario.dadosCadastro || {}),
    persistirLogCadastro: () => {}
  };

  const FlowHandler = {
    // Os DADOS entram no texto registrado. Sem isso, "o formulário voltou"
    // e "o formulário voltou preenchido" são indistinguíveis — e é toda a
    // diferença do BL-45.
    enviarFlowCadastro: (from, preenchido) => {
      if (!cenario.flowLigado) return false;
      registra('flow', 'formulário de cadastro ' + JSON.stringify(preenchido || {}));
      return true;
    },
    // Era fixo em `false`, então o formulário de membro NUNCA saía no teste e
    // só o caminho por conversa era exercitado. O cenário decide.
    enviarFlowMembro: () => {
      if (!cenario.flowMembroLigado) return false;
      registra('flow', 'formulário de membro');
      return true;
    },
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
      // `cenario.ocr` sobrescreve campos. Sem isso não dá para exercitar
      // divergência — o stub devolvia sempre a chave certa, e o ramo do
      // alerta ficava inalcançável.
      analisarComprovante: () => Object.assign({
        valor: 50, data: '12/08/2026', tipo: 'PIX',
        banco: 'Banco do Brasil', chavePix: 'pix@paroquia.org',
        recebedor: { nome: 'Paróquia N. S. da Conceição', banco: 'Banco do Brasil' }
      }, cenario.ocr || {}),
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
    'Plataforma.gs',
    'Config.gs', 'Utils.gs', 'OdooService.gs', 'MediaService.gs',
    'MenuHandler.gs', 'CadastroHandler.gs', 'DevolucaoHandler.gs', 'ComprovanteHandler.gs',
    'OfertaHandler.gs', 'TestePixNativo.gs',
    // O Router decide o que acontece com cada texto e cada botão. Ficou de
    // fora até 19/09, e por isso o ramo "escreveu com o formulário aberto" —
    // onde mora o BL-44 — não era executado por teste nenhum.
    'Router.gs'
  ];
  const fontes = ARQUIVOS
    .map(a => lerTexto(path.join(RAIZ, a)))
    .join('\n;\n');

  const mod = vm.runInContext(
    fontes + '\n;({ Utils, OdooService, MediaService, MenuHandler, CadastroHandler, ' +
             'DevolucaoHandler, ComprovanteHandler, OfertaHandler, Router, ESTADOS, ' +
             'statusDaDevolucao, ' +
             'alertaDoador, exigeConferencia });',
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
    // As LINHAS entram no texto registrado, não só o título. O "bot" que
    // escapou para produção morava numa `description` de linha — com o stub
    // guardando só o título, toda varredura passaria por cima dele sem ver.
    enviarLista: (to, t, secoes) => registra('lista', t + ' ' +
      (secoes || []).map(sec =>
        (sec.rows || []).map(r => `${r.title} — ${r.description || ''}`).join(' | ')
      ).join(' | ')),
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
        // Qualquer outro campo opcional: o cenário diz quais existem.
        //
        // Antes daqui, este ramo devolvia [] para tudo que não fosse um dos
        // casos acima — e a consequência era pior que um teste faltando: TODO
        // caminho guardado por `campoExiste` era pulado no harness e parecia
        // coberto. Foi assim que o BL-62 nasceu verde sem nunca ter rodado.
        if ((cenario.camposOdoo || []).indexOf(quer) >= 0) {
          return [{ id: 3, name: quer, related: false, readonly: false }];
        }
        return [];
      }
      // Quem já escreveu ao bot: é aqui que mora o `wa_id` de verdade. O
      // cenário diz quais formas existem, para o teste cobrir os dois casos —
      // conta antiga (sem o nono dígito) e conta nova (com).
      if (modelo === 'x_contato_bot') {
        const alvo = (dominio || []).find(d => d[0] === 'x_name');
        const querendo = (alvo && alvo[2]) || [];
        return (cenario.contatoBotConhece || [])
          .filter(n => querendo.indexOf(n) >= 0)
          .map(n => ({ x_name: n }));
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
        // BL-62: a busca pelo mês em aberto e a que confere se o mês seguinte
        // já existe. Vêm antes das outras porque as duas citam competência, e
        // cair no ramo do histórico daria resposta errada em silêncio.
        // Busca por id: é como a oferta de corrigir descobre a competência do
        // registro que acabou de ser gravado, e como a troca lê as duas.
        const porId = (dominio || []).find(d => d[0] === 'id');
        if (porId) {
          const fonte = cenario.devolucaoPorId;
          const lista = Array.isArray(fonte) ? fonte : (fonte ? [fonte] : []);
          return porId[1] === 'in'
            ? lista.filter(r => (porId[2] || []).indexOf(r.id) >= 0)
            : lista.filter(r => r.id === porId[2]);
        }
        const porCompetencia = (dominio || []).find(d => d[0] === 'x_studio_competencia');
        if (porCompetencia) {
          // O OPERADOR IMPORTA, e ignorá-lo mentia nos dois sentidos: a busca
          // pelo mês anterior usa '<' e não achava nada, enquanto o mês igual
          // ao pago era devolvido como se fosse anterior. Um fake que trata
          // todo domínio como igualdade não testa a consulta — testa a si mesmo.
          // TODAS as condições de competência, não a primeira. A busca pelo
          // mês devido usa duas — "< mês corrente" E "!= o que foi pago" — e
          // um fake que honra só a primeira aprovaria de olhos fechados a
          // versão que perguntava em toda devolução.
          const compara = (v, op, alvo) =>
              op === '<'  ? v <  alvo
            : op === '<=' ? v <= alvo
            : op === '>'  ? v >  alvo
            : op === '>=' ? v >= alvo
            : op === '!=' ? v !== alvo
            : v === alvo;
          const condicoes = (dominio || []).filter(d => d[0] === 'x_studio_competencia');
          // O operador do STATUS também conta: a busca pela última devolução
          // PAGA usa `!= 'A devolver'`, e tratar isso como igualdade devolvia
          // o oposto do pedido. Terceira vez que este fake mente por ignorar
          // um operador.
          const qs = (dominio || []).find(d => d[0] === 'x_studio_status');
          return (cenario.devolucoesPorCompetencia || []).filter(r =>
            condicoes.every(([, op, alvo]) => compara(r.x_studio_competencia, op, alvo))
            && (!qs || compara(r.x_studio_status, qs[1], qs[2])));
        }
        // `devolucoesDoMes` filtra por intervalo de datas; o histórico e a linha
        // "última devolução", não. Distinguir aqui importa: sem isso, um cenário
        // com histórico também dispararia o aviso de duplicata, e o teste
        // passaria a medir outro caminho sem ninguém perceber.
        const porPeriodo = (dominio || []).some(d => d[0] === 'x_studio_data_da_devolucao');
        return (porPeriodo ? cenario.devolucoesDoMes : cenario.devolucoes) || [];
      }
      return [];
    },
    // O cenário pode espiar o que foi gravado. Sem isso, um campo calculado
    // — como o status do BL-51 — não tem como ser conferido: o stub devolvia
    // um id e jogava os dados fora.
    create: (modelo, dados) => {
      if (cenario.aoCriar) cenario.aoCriar(modelo, dados);
      return 99;
    },
    // BL-62: preencher um "A devolver" é um write, não um create. Sem espiar o
    // write, o teste não distingue "preencheu o mês em aberto" de "criou outro
    // registro" — que é exatamente a diferença que o item inteiro produz.
    write: (modelo, id, dados) => {
      if (cenario.aoEscrever) cenario.aoEscrever(modelo, id, dados);
      return true;
    },
    buscarParametros:               () => Object.assign(
      { x_studio_avatar: cenario.temAvatar ? 'ID' : null }, cenario.parametros || {}),
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

// O que a pessoa já preencheu quando chega na tela de confirmação — é isto
// que o "Corrigir" apagava (BL-45).
const DADOS_CADASTRO = {
  nome: 'Ewerton Leal Vale', nomeUsual: 'Ewerton',
  dataNascimento: '12/07/1987', endereco: 'R. Hegesipo Marques Sérvio, 5285',
  valorMensal: 150, notificacaoAtiva: true, diaPreferido: 12,
  comunidadeId: 3, comunidadeNome: 'N. Senhora do Desterro'
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
               estado: 'AGUARDANDO_COMPROVANTE_OFERTA',
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
    nome: '"Corrigir" reabre o formulário em vez de cancelar o cadastro',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true,
               dadosCadastro: DADOS_CADASTRO },
    roda: ctx => ctx.Router.rotear('55',
      { type: 'interactive', interactive: { type: 'button_reply',
        button_reply: { id: 'btn_cancelar_cadastro', title: '❌ Corrigir' } } }),
    esperado: 1,
    porque: 'BL-45: o botão dizia "Corrigir" e apagava os sete campos'
  },
  {
    nome: 'Membro: escreveu com o formulário aberto — lembrete, não as 14 mensagens',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               estado: 'AGUARDANDO_FLOW_CADASTRO',
               sessao: { cadastrandoMembro: true } },
    roda: ctx => ctx.Router.rotear('55', { type: 'text', text: { body: 'e aí?' } }),
    esperado: 1,
    porque: 'BL-44: cadastrar familiar por conversa é a mesma coisa que ' +
            'cadastrar dizimista por conversa — campo por campo'
  },
  {
    nome: 'Membro: formulário fora do ar e conversa desligada',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               flowMembroLigado: false },
    roda: ctx => ctx.CadastroHandler.iniciarCadastroMembro('55'),
    esperado: 1,
    porque: 'o dizimista recebe desculpas e o contato da pastoral, não silêncio'
  },
  {
    nome: 'Membro: com a CONVERSA ligada, o passo a passo volta',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               flowMembroLigado: false,
               propriedades: { CADASTRO_CONVERSA_ATIVO: 'true' } },
    roda: ctx => ctx.CadastroHandler.iniciarCadastroMembro('55'),
    esperado: 1,
    porque: 'a primeira pergunta do passo a passo — o interruptor é uma trava, ' +
            'não uma remoção'
  },
  {
    nome: 'Escreveu com o formulário aberto — lembrete, não as 19 mensagens',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true,
               estado: 'AGUARDANDO_FLOW_CADASTRO' },
    roda: ctx => ctx.Router.rotear('55', { type: 'text', text: { body: 'quanto é o dízimo?' } }),
    esperado: 1,
    porque: 'BL-44: a pessoa fica onde estava, o formulário continua clicável ' +
            'na conversa, e o lembrete traz as portas que não exigem cadastro'
  },
  {
    nome: 'Escreveu com o formulário aberto, mas a CONVERSA está ligada',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true,
               estado: 'AGUARDANDO_FLOW_CADASTRO',
               propriedades: { CADASTRO_CONVERSA_ATIVO: 'true' } },
    roda: ctx => ctx.Router.rotear('55', { type: 'text', text: { body: 'não abre' } }),
    esperado: 2,
    porque: 'o interruptor devolve o caminho antigo inteiro — é uma trava, ' +
            'não uma remoção'
  },
  {
    nome: 'Ser Dizimista com o formulário fora do ar e a conversa desligada',
    cenario: { dizimista: null, temAvatar: true, flowLigado: false },
    roda: ctx => ctx.CadastroHandler.iniciar('55', null),
    esperado: 1,
    porque: 'ninguém consegue se cadastrar agora — mas a pessoa recebe quem ' +
            'procurar, em vez de ficar sem resposta'
  },
  {
    nome: 'Convite — com o número do bot confirmado pela Meta',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               propriedades: { WHATSAPP_NUMERO_BOT: '5586981622537' } },
    roda: ctx => ctx.MenuHandler.convidar('55'),
    esperado: 2,
    porque: 'o cartão do bot + o texto que manda encaminhá-lo. `contacts` é um ' +
            'tipo de mensagem inteiro e não aceita corpo junto.'
  },
  {
    nome: 'Convite — cartão recusado pela Meta cai no link',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               contatoAceito: false,
               propriedades: { WHATSAPP_NUMERO_BOT: '5586981622537' } },
    roda: ctx => ctx.MenuHandler.convidar('55'),
    esperado: 2,
    porque: 'a tentativa do cartão ainda sai como mensagem; o texto vira o link'
  },
  {
    nome: 'Convite — sem número nenhum',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               propriedades: {} },
    roda: ctx => ctx.MenuHandler.convidar('55'),
    esperado: 1,
    porque: 'sem número não há cartão nem link — só o texto que manda perguntar ' +
            'à secretaria'
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
    nome: 'O resultado mostra quem recebeu: nome, chave, banco e valor',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.TESTE'),
    confere: msgs => {
      const m = msgs.map(x => x.texto).join('\n');
      // Se a mensagem pode dizer "não confere", ela tem de mostrar em cima de
      // QUE dado — senão a pessoa recebe uma acusação sem apelação.
      const faltam = ['Valor devolvido', 'Quem recebeu', 'Nome:', 'Chave PIX:', 'Banco:']
        .filter(t => !m.includes(t));
      return faltam.length ? `faltou no resumo: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'Divergência avisa E oferece a pastoral no mesmo balão',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               // Chave de outra conta: o caso que o BL-46 já alertava.
               ocr: { chavePix: 'outra@conta.com' } },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.TESTE'),
    confere: msgs => {
      const m = msgs.map(x => x.texto).join('\n');
      if (!m.includes('não confere')) return 'não avisou que o pagamento não confere';
      if (!m.includes('agente da Pastoral')) return 'não diz quem vai analisar';
      // Avisar e deixar sem saída é pior que não avisar.
      return m.includes('btn_secretaria')
        ? null
        : 'não ofereceu o contato da pastoral';
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
    nome: 'O lembrete do cadastro não é um beco sem saída',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true,
               estado: 'AGUARDANDO_FLOW_CADASTRO' },
    roda: ctx => ctx.Router.rotear('55', { type: 'text', text: { body: 'quanto é o dízimo?' } }),
    confere: msgs => {
      const m = msgs.find(x => x.tipo === 'menu');
      if (!m) return 'não saiu o lembrete';
      if (!m.texto.includes('cadastro')) return 'o lembrete não fala do cadastro';
      // A regra que não pode quebrar: quem escreveu ali pode estar travado no
      // formulário. Oferta não exige cadastro e falar com a pastoral não exige
      // nada — sem essas duas portas, o lembrete vira um muro.
      const faltam = ['btn_oferta', 'btn_secretaria'].filter(b => !m.texto.includes(b));
      if (faltam.length) return `faltou saída: ${faltam.join(', ')}`;
      // E não pode ter começado o passo a passo: é exatamente o que o BL-44
      // veio impedir.
      return msgs.some(x => x.texto.includes('passo a passo'))
        ? 'caiu no cadastro por conversa mesmo assim'
        : null;
    }
  },
  {
    nome: 'O convite manda o contato do bot, e o texto combina com ele',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               propriedades: { WHATSAPP_NUMERO_BOT: '5586981622537' } },
    roda: ctx => ctx.MenuHandler.convidar('55'),
    confere: msgs => {
      const cartao = msgs.find(m => m.tipo === 'contato');
      if (!cartao) return 'não saiu o cartão do bot';
      if (!cartao.texto.includes('"wa_id":"5586981622537"'))
        return 'o cartão não leva o número confirmado';
      // Uma forma só: o número do bot é confirmado, então mandar as duas do
      // nono dígito poluiria justamente o cartão que vai ser encaminhado.
      const ids = cartao.texto.match(/"wa_id":"\d+"/g) || [];
      if (ids.length !== 1) return `o cartão do bot levou ${ids.length} números`;

      const texto = msgs.find(m => m.tipo === 'texto');
      if (!texto) return 'não saiu o texto do convite';
      // Prometer um contato que não saiu deixaria a pessoa procurando o que
      // não existe — por isso o texto é escrito depois do cartão.
      return texto.texto.includes('contato acima')
        ? null
        : 'o texto não aponta para o cartão';
    }
  },
  {
    nome: 'O link do convite nunca sai sem o código do país',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
               contatoAceito: false,
               // O valor que estava em produção: digitado à mão, sem o 55. O
               // `wa.me` lia o 86 como China e o convite não levava a lugar
               // nenhum.
               // `getConfig()` exige token e phone id, ou lança — e o número
               // de exibição só é lido por ele.
               propriedades: { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '111',
                               WHATSAPP_NUMERO_EXIBICAO: '86981622537' } },
    roda: ctx => ctx.MenuHandler.convidar('55'),
    confere: msgs => {
      const texto = msgs.find(m => m.tipo === 'texto');
      if (!texto) return 'não saiu o texto do convite';
      const link = (texto.texto.match(/wa\.me\/(\d+)/) || [])[1];
      if (!link) return 'o convite saiu sem link';
      return link === '5586981622537'
        ? null
        : `o link saiu como wa.me/${link} — sem o código do país`;
    }
  },
  {
    nome: 'O cartão de contato leva nome, número e a comunidade',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    confere: msgs => {
      const c = msgs.find(m => m.tipo === 'contato');
      if (!c) return 'não saiu cartão de contato';
      // DDD 86 não está em DDD_MANTEM_NONO, então o provável é sem o 9.
      const faltam = ['João da Silva', '+558688521231', 'São José']
        .filter(t => !c.texto.includes(t));
      return faltam.length ? `faltou no cartão: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'Todo wa_id do cartão leva o código do país',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    confere: msgs => {
      const c = msgs.find(m => m.tipo === 'contato');
      if (!c) return 'não saiu cartão de contato';
      // Sem o 55, o WhatsApp lê o DDD 86 como código de país da China: o
      // contato é salvo com o país errado e "Conversar" não abre nada. O
      // `phone` pode estar certo e o `wa_id` errado — eram montados por
      // caminhos diferentes, e foi assim que o bug passou.
      const ids = (c.texto.match(/"wa_id":"(\d+)"/g) || [])
        .map(x => x.replace(/\D/g, ''));
      if (!ids.length) return 'o cartão não trouxe wa_id';
      const ruins = ids.filter(id => id.indexOf('55') !== 0 || id.length < 12);
      return ruins.length ? `wa_id sem código de país: ${ruins.join(', ')}` : null;
    }
  },
  {
    nome: 'wa_id NÃO confirmado → UM número só, o provável para o DDD',
    cenario: {
      dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
      contatos: [{ nome: 'João da Silva', whatsapp: '(86) 98852-1231' }]
    },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    confere: msgs => {
      const c = msgs.find(m => m.tipo === 'contato');
      if (!c) return 'não saiu cartão de contato';
      // Mandar as duas formas garantia que uma abrisse a conversa, mas o
      // cartão chegava com o mesmo telefone repetido e um deles quebrado.
      // Quem recebe não sabe que existe nono dígito.
      const ids = (c.texto.match(/"wa_id":"\d+"/g) || []);
      if (ids.length !== 1) return `mandou ${ids.length} números, devia mandar 1`;
      // DDD 86 está fora de DDD_MANTEM_NONO: a conta antiga é sem o 9.
      return c.texto.includes('"wa_id":"558688521231"')
        ? null
        : `mandou ${ids[0]} — no DDD 86 o provável é sem o nono dígito`;
    }
  },
  {
    nome: 'DDD que MANTÉM o nono dígito recebe a forma com 9',
    cenario: {
      dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
      // São Paulo recebeu o 9 antes de o WhatsApp existir por lá, então as
      // contas nasceram com ele. Uma regra fixa "tira o 9" quebraria aqui.
      contatos: [{ nome: 'Ana Paulista', whatsapp: '(11) 98852-1231' }]
    },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    confere: msgs => {
      const c = msgs.find(m => m.tipo === 'contato');
      if (!c) return 'não saiu cartão de contato';
      return c.texto.includes('"wa_id":"5511988521231"')
        ? null
        : 'no DDD 11 o provável é COM o nono dígito';
    }
  },
  {
    nome: 'wa_id CONFIRMADO → o cartão manda só ele',
    cenario: {
      dizimista: DIZIMISTA, temAvatar: true, flowLigado: true,
      contatos: [{ nome: 'João da Silva', whatsapp: '(86) 98852-1231',
                   waId: '558688521231' }]
    },
    roda: ctx => ctx.MenuHandler.infoSecretaria('55'),
    confere: msgs => {
      const c = msgs.find(m => m.tipo === 'contato');
      if (!c) return 'não saiu cartão de contato';
      const ids = (c.texto.match(/"wa_id":"(\d+)"/g) || []);
      if (ids.length !== 1) return `mandou ${ids.length} números, devia mandar 1`;
      // Confirmado em x_contato_bot: quem entregou esse valor foi o próprio
      // WhatsApp. Mandar a outra forma junto só poluiria o cartão.
      return c.texto.includes('"wa_id":"558688521231"')
        ? null
        : 'o wa_id confirmado não foi o usado';
    }
  },
  {
    // O caso real: oferta indicada de R$ 10,00, comprovante de R$ 55,00. A
    // mensagem dizia R$ 10,00 e o Odoo guardava R$ 10,00 — R$ 45,00 que
    // entraram na conta da paróquia sumiam da prestação de contas.
    nome: 'A oferta grava o valor do COMPROVANTE, não o escolhido — BL-53',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true, camposNovos: true,
               comunidadeGravavel: true, ocr: { valor: 55 },
               estado: 'AGUARDANDO_COMPROVANTE_OFERTA',
               sessao: { ofertaComunidadeId: 3, ofertaValor: 10 },
               aoCriar: (modelo, dados) => { if (modelo === 'x_devolucao') gravado = dados; } },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.T'),
    confere: msgs => {
      const t = msgs[msgs.length - 1].texto;
      if (!t.includes('Oferta recebida')) return 'não confirmou a oferta';
      if (!gravado) return 'nada foi gravado no Odoo';
      if (gravado.x_studio_value !== 55) return `o Odoo recebeu ${gravado.x_studio_value}`;
      // A conversa tem de dizer o mesmo número que o registro. Conferir só
      // "55,00" no texto não bastaria: a nota de divergência cita os DOIS
      // valores, então "10,00" também aparece — foi exatamente assim que a
      // versão anterior deste teste passou depois de o comportamento mudar.
      const m = t.match(/Valor devolvido:\*? (R\$ [\d.]+,\d{2})/);
      if (!m) return 'o bloco não mostrou valor nenhum';
      return m[1] === 'R$ 55,00' ? null : `o bloco mostrou ${m[1]}`;
    }
  },
  {
    nome: 'Valor diferente do escolhido é dito, mas não vira acusação — BL-53',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true, camposNovos: true,
               comunidadeGravavel: true, ocr: { valor: 55 },
               estado: 'AGUARDANDO_COMPROVANTE_OFERTA',
               sessao: { ofertaComunidadeId: 3, ofertaValor: 10 },
               aoCriar: (modelo, dados) => { if (modelo === 'x_devolucao') gravado = dados; } },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.T'),
    confere: msgs => {
      const t = msgs[msgs.length - 1].texto;
      if (!t.includes('10,00') || !t.includes('55,00')) return 'a mensagem não citou os dois valores';
      // A nota diz "registrei o valor do comprovante". O bloco acima dela tem
      // de mostrar esse mesmo valor — senão a frase é mentira, que foi o que
      // ela seria antes do BL-53.
      const bloco = (t.match(/Valor devolvido:\*? (R\$ [\d.]+,\d{2})/) || [])[1];
      const nota  = (t.match(/comprovante mostra (R\$ [\d.]+,\d{2})/) || [])[1];
      if (bloco !== nota) return `o bloco diz ${bloco} e a nota diz ${nota}`;
      // Pagar mais do que indicou não é erro de ninguém: a chave, o titular e o
      // banco conferem, então o status continua Confirmado e nada de
      // "será analisado".
      if (gravado.x_studio_status !== 'Confirmado') return `status virou ${gravado.x_studio_status}`;
      return /não confere|analisad/i.test(t) ? 'diferença de valor virou alerta' : null;
    }
  },
  {
    // O caso real: tocou em Oferta, desistiu, foi para Dízimo e mandou o
    // comprovante. `ofertaComunidadeId` ficou na sessão desde o toque em
    // Oferta, e era ele — não o estado — que decidia o caminho.
    nome: 'Dízimo depois de desistir da oferta é gravado como DÍZIMO — BL-77',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true, camposNovos: true,
               comunidadeGravavel: true, estado: 'AGUARDANDO_COMPROVANTE',
               sessao: { ofertaComunidadeId: 3, ofertaComunidadeNome: 'Matriz',
                         ofertaDizimistaId: 7 },
               aoCriar: (modelo, dados) => { if (modelo === 'x_devolucao') gravado = dados; } },
    roda: ctx => { gravado = null; ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.T'); },
    confere: msgs => {
      const t = msgs[msgs.length - 1].texto;
      if (/Oferta recebida/i.test(t)) return 'a conversa respondeu "Oferta recebida"';
      if (!gravado) return 'nada foi gravado no Odoo';
      if (gravado.x_studio_tipo_contribuicao === 'oferta') return 'o Odoo recebeu tipo oferta';
      return null;
    }
  },
  {
    nome: 'OCR sem valor: aí sim vale o escolhido — BL-53',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true, camposNovos: true,
               comunidadeGravavel: true, ocr: { valor: null },
               estado: 'AGUARDANDO_COMPROVANTE_OFERTA',
               sessao: { ofertaComunidadeId: 3, ofertaValor: 10 },
               aoCriar: (modelo, dados) => { if (modelo === 'x_devolucao') gravado = dados; } },
    roda: ctx => ctx.ComprovanteHandler.processar('55', COMPROVANTE, 'wamid.T'),
    confere: msgs => {
      const t = msgs[msgs.length - 1].texto;
      if (gravado.x_studio_value !== 10) return `o Odoo recebeu ${gravado.x_studio_value}`;
      // Sem dois números não há divergência a contar — a nota seria só ruído.
      return t.includes('havia indicado') ? 'notou diferença onde só há um valor' : null;
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
  gravado  = null;
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
  const fontes = OBJETOS.map(([arq]) => lerTexto(path.join(RAIZ, arq)));
  const tudo = vm.runInContext(
    [PLATAFORMA, lerTexto(path.join(RAIZ, 'Config.gs'))].concat(fontes).join('\n;\n') +
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
        PLATAFORMA + '\n;\n' +
        lerTexto(path.join(RAIZ, 'Config.gs')) + '\n;\n' +
        lerTexto(path.join(RAIZ, sonda.arquivo)) + '\n;\n' +
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
  const padroes = lerTexto(path.join(RAIZ, '.claspignore'))
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
    const fonte = lerTexto(path.join(RAIZ, arq));
    let m;
    while ((m = DECL.exec(fonte)) !== null) foraDoDeploy.set(m[1], arq);
  }

  let achados = 0;
  for (const arq of enviados) {
    const fonte = lerTexto(path.join(RAIZ, arq))
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
console.log('✏️  O formulário volta preenchido na correção — BL-45\n');

// ─────────────────────────────────────────────────────────────────────────
// A Meta recusa a mensagem inteira se um campo declarado em `data` não vier,
// ou se vier com o tipo errado — `valor_mensal` é `input-type: number`, e
// mandar "150" como texto derruba o envio. Como o cadastro é hoje o ÚNICO
// caminho de entrada, um erro aqui não degrada: fecha a porta.
{
  // O `FlowHandler` é stub no resto do arnês — é a borda que fala com a Meta.
  // Aqui o arquivo REAL é carregado num contexto próprio, só para exercitar a
  // conversão de tipos. Nada sai: `_dadosPreenchidos` só monta um objeto.
  const ctxFlow = {
    console: { log() {}, warn() {}, error() {} },
    Logger:  { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Utils: {}, OdooService: {}, StateManager: {}, CadastroHandler: {},
    MenuHandler: {}, OfertaHandler: {}, ESTADOS: {}
  };
  vm.createContext(ctxFlow);
  const FlowReal = vm.runInContext(
    PLATAFORMA + '\n;\n' +
    lerTexto(path.join(RAIZ, 'FlowHandler.gs')) + '\n;FlowHandler;',
    ctxFlow, { filename: 'FlowHandler.gs' }
  );

  const casos = [
    {
      nome: 'correção: os sete campos voltam, e os números como número',
      dados: {
        nome: 'Ewerton Leal Vale', nomeUsual: 'Ewerton',
        dataNascimento: '12/07/1987', endereco: 'R. Hegesipo, 5285',
        valorMensal: '150', notificacaoAtiva: true, diaPreferido: '12'
      },
      confere: (d) => {
        if (d.nome_padrao !== 'Ewerton Leal Vale') return 'o nome não voltou';
        if (typeof d.valor_padrao !== 'number') return `valor_padrao é ${typeof d.valor_padrao}, devia ser number`;
        if (d.valor_padrao !== 150) return `valor_padrao é ${d.valor_padrao}`;
        if (typeof d.dia_padrao !== 'number') return `dia_padrao é ${typeof d.dia_padrao}`;
        if (d.notificacao_padrao !== 'sim') return `notificacao_padrao é ${d.notificacao_padrao}`;
        return null;
      }
    },
    {
      nome: 'primeiro envio: tudo presente e vazio, nada faltando',
      dados: undefined,
      confere: (d) => {
        const esperados = ['nome_padrao', 'nome_usual_padrao', 'nascimento_padrao',
                           'endereco_padrao', 'valor_padrao', 'notificacao_padrao',
                           'dia_padrao'];
        const faltam = esperados.filter(k => !(k in d));
        if (faltam.length) return `faltou no payload: ${faltam.join(', ')}`;
        // Vazio, mas do TIPO certo: um '' num campo number é recusa na hora.
        return typeof d.valor_padrao === 'number' && typeof d.dia_padrao === 'number'
          ? null
          : 'número vazio saiu como texto';
      }
    },
    {
      nome: 'notificação desativada vira "nao", não some',
      dados: { notificacaoAtiva: false },
      confere: (d) => (d.notificacao_padrao === 'nao'
        ? null : `saiu "${d.notificacao_padrao}"`)
    }
  ];

  for (const c of casos) {
    const d = FlowReal._dadosPreenchidos(c.dados);
    const erro = c.confere(d);
    if (erro) falhas++;
    console.log(`${erro ? '❌' : '✅'} ${c.nome}${erro ? ' — ' + erro : ''}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🏦 Comprovantes REAIS, um por layout de banco — BL-49\n');

// ─────────────────────────────────────────────────────────────────────────
// Transcrições de comprovantes que chegaram de verdade. Cada um quebrou algo
// diferente, e é por isso que estão todos aqui em vez de um exemplo genérico:
//
//   Nubank sem chave no destino  → o CNPJ do RODAPÉ virava a chave. Como
//                                  divergência avisa a pessoa (BL-46), isso
//                                  era acusação falsa contra quem pagou certo.
//   Banco do Brasil              → Agência e Conta empurram a Chave Pix para
//                                  fora da janela; e a chave vem sem pontuação
//                                  ("08070690356"), numa linha separada do
//                                  rótulo.
//   Inter empresas               → o rótulo "Quem recebeu" tem duas palavras e
//                                  só letras: saía como se fosse o nome.
//   Nubank em geral              → "Nome THALLES BOITEUX VALE" sem dois-pontos
//                                  deixava o rótulo colado no nome.
{
  const V = extratoresDoVision();
  const COMPROVANTES = [
  { nome: 'Nubank — Destino sem Chave Pix (o do CNPJ do rodapé)',
    texto: ['Comprovante de transferência','24 JUL 2026 - 17:01:03','Valor R$ 32,00',
      'Tipo de transferência Pix','ID da transação E18236120202607242000s19bb9e8416',
      'Destino','Nome THALLES BOITEUX VALE','CPF ***.706.903-**','Instituição BANCO INTER',
      'Origem','Nome Marlice Martins Soares','Instituição NU PAGAMENTOS - IP','CPF ***.431.643-**',
      'Nu Pagamentos S.A. - Instituição de Pagamento','CNPJ 18.236.120/0001-58',
      'ID da transação:','E18236120202607242000s19bb9e8416'].join('\n'),
    chave: null, nomeRec: 'THALLES BOITEUX VALE', banco: 'Inter' },

  { nome: 'Itaú — Para, com Chave Pix de telefone',
    texto: ['itaú','Comprovante de Pix','R$ 10,00','Realizado em 24/07/2026 às 09:34:12',
      'De','MARIA PERPETUO S F FERREIRA','CPF: ***.043.053-**','Instituição: ITAÚ UNIBANCO S.A',
      'Para','ROSINEIDE DOS ANJOS COSTA RODR','CPF: ***316233**',
      'Instituição: CAIXA ECONOMICA FEDERAL','Chave Pix: +5586999913204',
      'Dados da transação','Autenticação:','195315132778695F24DCE340A974E33775078','ID da transação:',
      'E60701190202607241233DY5HUNVR4GW'].join('\n'),
    chave: '+5586999913204', nomeRec: 'ROSINEIDE DOS ANJOS COSTA RODR', banco: 'Caixa' },

  { nome: 'Nubank — Destino COM Chave Pix',
    texto: ['Comprovante de transferência','24 JUL 2026 - 09:48:10','Valor R$ 20,00',
      'Tipo de transferência Pix','ID da transação E18236120202607241247s1626e2ac1e',
      'Destino','Nome ROSINEIDE DOS ANJOS COSTA RODRIGUES','CPF ***.316.233-**',
      'Instituição CAIXA ECONOMICA FEDERAL','Chave Pix +5586999913204',
      'Origem','Nome Marcia Adriana da Silva Santos','Instituição NU PAGAMENTOS - IP',
      'CNPJ 18.236.120/0001-58'].join('\n'),
    chave: '+5586999913204', nomeRec: 'ROSINEIDE DOS ANJOS COSTA RODRIGUES', banco: 'Caixa' },

  { nome: 'Banco do Brasil — Agência e Conta antes da Chave Pix',
    texto: ['Comprovante BB','R$ 64,00','18/07/2026 às 10:23:50','Pix Enviado',
      'Recebedor','Thalles Boiteux Vale','CPF','***.706.903-**','Agência','0001','Conta','331033577',
      'Instituição','00416968 BANCO INTER','Tipo de conta','Conta Corrente','Chave Pix','08070690356',
      'Pagador','Andressa Suellem da Silva','CPF','***.840.533-**','Agência','5602-2',
      'Instituição','00000000 BCO DO BRASIL S.A.'].join('\n'),
    chave: '08070690356', nomeRec: 'Thalles Boiteux Vale', banco: 'Inter' },

  { nome: 'Inter empresas — Quem recebeu / Quem pagou',
    texto: ['inter empresas','Pix enviado','R$ 64,00','Sobre a transação',
      'Data da transação Quarta-feira, 15/07/2026','Horário 19h50',
      'ID da transação E00416968202607152249MMIICzeJuat',
      'Quem recebeu','Nome Thalles Boiteux Vale','CPF/CNPJ ***.706.903-**',
      'Instituição BANCO INTER','Chave Pix 080.706.903-56',
      'Quem pagou','Nome CLAUDENIRA VIVEIROS','CPF/CNPJ 54.169.161/0001-32',
      'Instituição BANCO INTER'].join('\n'),
    chave: '080.706.903-56', nomeRec: 'Thalles Boiteux Vale', banco: 'Inter' },

  { nome: 'Nubank — Destino com Agência e Conta (bloco longo)',
    texto: ['Comprovante de transferência','13 JUL 2026 - 09:58:31','Valor R$ 32,00',
      'Tipo de transferência Pix','ID da transação E18236120202607131258s08d669ae21',
      'Destino','Nome Thalles Boiteux Vale','CPF ***.706.903-**','Instituição BANCO INTER',
      'Agência 0001','Conta 33103357-7','Tipo de conta Conta corrente',
      'Origem','Nome Maria das Mercês Soares Dias','Instituição NU PAGAMENTOS - IP',
      'CNPJ 18.236.120/0001-58'].join('\n'),
    chave: null, nomeRec: 'Thalles Boiteux Vale', banco: 'Inter' }
];

  for (const c of COMPROVANTES) {
    const k = V._extrairChavePix(c.texto);
    const r = V._extrairRecebedor(c.texto);
    const errs = [];
    if (k !== c.chave)        errs.push(`chave: ${JSON.stringify(k)}`);
    if (r.nome !== c.nomeRec) errs.push(`nome: ${JSON.stringify(r.nome)}`);
    if (r.banco !== c.banco)  errs.push(`banco: ${JSON.stringify(r.banco)}`);
    if (errs.length) falhas++;
    console.log(`${errs.length ? '❌' : '✅'} ${c.nome}` +
                (errs.length ? `\n     ${errs.join('  ')}` : ''));
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🔁 baixar-views: indentar não pode mudar a impressão digital\n');

// ──────────────────────────────────────────────────────────────────
// O baixar-views compara o arquivo local com o arch do Odoo por uma
// impressão digital que ignora formatação. Se ela NÃO ignorar, o --update
// reescreve views idênticas a cada execução, sujando o histórico do Odoo sem
// uma única mudança real — e escondendo a view que de fato mudou no meio de
// dez falsos positivos. Foi o que aconteceu em produção.
//
// O invariante é simples: indentar não muda o significado, logo não pode
// mudar a digital. O caso que quebrou não foi o espaço ENTRE tags (esse eu
// tratei) e sim o texto solto, que o indentador põe na própria linha — e as
// views do Studio são cheias de `<attribute name="x">true</attribute>`.
{
  const fonte = lerTexto(path.join(RAIZ, 'ferramentas/baixar-views.mjs'));
  const trecho = (de, ate) => fonte.slice(fonte.indexOf(de), fonte.indexOf(ate));
  const digital  = new Function('createHash', trecho('const digital', '// Tira o comentário') + '; return digital;')(nodeCrypto.createHash);
  const indentar = new Function(trecho('function indentar', '// Nome de arquivo') + '; return indentar;')();

  const CASOS = [
    ['arch simples, sem texto solto',
     '<kanban><field name="a"/></kanban>'],
    ['<attribute> com texto — o caso que quebrou',
     '<data><xpath expr="/x" position="attributes"><attribute name="q">true</attribute></xpath></data>'],
    ['texto dentro de span',
     '<div><span>ola</span></div>'],
    ['aninhado, com texto e tag no meio',
     '<form><group><field name="a"/><div class="x">texto <b>e</b> mais</div></group></form>'],
  ];

  for (const [nome, xml] of CASOS) {
    const ok = digital(xml) === digital(indentar(xml));
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${nome}`);
  }

  // E o contrário: normalizar demais colapsaria mudança de verdade, e aí o
  // --update deixaria de subir o que precisa subir.
  const mudou = digital('<list><field name="x"/></list>') !== digital('<list><field name="y"/></list>');
  if (!mudou) falhas++;
  console.log(`${mudou ? '✅' : '❌'} campo diferente continua dando digital diferente`);
}

console.log('\n' + '─'.repeat(64));
console.log('📅 A data do pagamento, em qualquer layout — BL-52\n');

// ──────────────────────────────────────────────────────────────────────
// Três dos seis comprovantes reais lá de cima escrevem a data num formato que
// a versão antiga não lia — ela só conhecia dd/mm/aaaa. O Nubank escreve
// "24 JUL 2026"; o Google Pay escreve "domingo, 5 de abr., 18:03", sem ano
// nenhum.
//
// E o resultado de não ler não era um campo vazio. Era pior: quem grava no
// Odoo faz `data.split('/')`, que não quebra com outro formato — devolve
// `undefined-undefined-24 JUL 2026`. Por isso todo caso daqui cobra
// dd/mm/aaaa, e não "alguma data".
{
  const V = extratoresDoVision();

  const DATAS = [
    ['Itaú — dd/mm/aaaa no meio da frase',
     'Realizado em 24/07/2026 às 09:34:12', '24/07/2026'],

    ['Nubank — mês abreviado em maiúsculas',
     'Comprovante de transferência\n24 JUL 2026 - 17:01:03\nValor R$ 32,00', '24/07/2026'],

    ['Inter empresas — dia da semana antes da data',
     'Data da transação Quarta-feira, 15/07/2026\nHorário 19h50', '15/07/2026'],

    // O caso que motivou o BL-52. O ano não está na tela: está no E2E,
    // E43394419 20260405 2103 — ISPB do Inter, data, hora UTC.
    ['Google Pay — sem ano na tela, ano vindo do ID da transação',
     'Concluído • domingo, 5 de abr., 18:03\nID da transação\nPix - E43394419202604052103uuGZ7BZQ3g5',
     '05/04/2026'],

    ['Um dígito no dia vira dois',
     'Pago em 5 de abril de 2026', '05/04/2026'],

    ['Ano com dois dígitos', 'Pago em 05/04/26', '05/04/2026'],

    ['Formato ISO', 'Pagamento em 2026-04-05', '05/04/2026'],

    // Sem nenhuma data escrita, o E2E é melhor que nada — com a ressalva de
    // que a hora dele é UTC e pagamento de fim de noite cai no dia seguinte.
    ['Só o ID da transação',
     'Comprovante\nValor R$ 10,00\nID da transação E00416968202607152249MMIICzeJuat', '15/07/2026'],

    // Agência e conta são números soltos em toda tela de comprovante. Um
    // palpite aqui grava uma data errada que ninguém tem como desconfiar.
    ['Agência e conta não viram data',
     'Agência 0001\nConta 33103357-7\nValor R$ 32,00', null],

    ['Sem data alguma é resposta legítima',
     'Comprovante\nValor R$ 10,00', null]
  ];

  for (const [nome, texto, esperado] of DATAS) {
    const r = V._extrairData(texto);
    const ok = r === esperado;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${nome}` +
                (ok ? '' : ` — veio ${JSON.stringify(r)}, esperava ${JSON.stringify(esperado)}`));
  }

  // A prova de que o formato importa: o que sai daqui precisa atravessar
  // `registrarDevolucao` sem virar `undefined-undefined-...`.
  const ctx = montarContexto({ dizimista: DIZIMISTA, comunidadeGravavel: true,
                               aoCriar: (m, d) => { if (m === 'x_devolucao') gravado = d; } });
  gravado = null;
  ctx.OdooService.registrarDevolucao(7, { valor: 50, data: V._extrairData('24 JUL 2026 - 17:01:03') });
  const dataOdoo = gravado && gravado.x_studio_data_da_devolucao;
  const okOdoo = dataOdoo === '2026-07-24';
  if (!okOdoo) falhas++;
  console.log(`${okOdoo ? '✅' : '❌'} A data lida chega ao Odoo como aaaa-mm-dd` +
              (okOdoo ? '' : ` — chegou ${JSON.stringify(dataOdoo)}`));

  // E uma data fora do formato não entra torta: cai para hoje, com aviso.
  gravado = null;
  ctx.OdooService.registrarDevolucao(7, { valor: 50, data: '24 JUL 2026' });
  const bruta = gravado && gravado.x_studio_data_da_devolucao;
  const okGuarda = /^\d{4}-\d{2}-\d{2}$/.test(String(bruta));
  if (!okGuarda) falhas++;
  console.log(`${okGuarda ? '✅' : '❌'} Data em formato estranho não vira \`undefined-undefined-\``  +
              (okGuarda ? '' : ` — gravou ${JSON.stringify(bruta)}`));
}

console.log('\n' + '─'.repeat(64));
console.log('🔑 A chave PIX no BR Code vai sem máscara — BL-48\n');

// ─────────────────────────────────────────────────────────────────────────
// O Odoo guarda a chave como a pessoa digitou: "160.740.093-68". Isso é bom
// para ler na tela e ERRADO no BR Code, onde o campo 01 de um CPF tem 11
// dígitos. Com a máscara, o copia-e-cola sai fora do padrão e o banco de quem
// paga pode recusar — sem dizer por quê.
//
// O BL-40 foi testado com uma chave de e-mail, que não tem máscara para
// atrapalhar. Foi por isso que passou.
{
  const ctx = montarContexto({ dizimista: DIZIMISTA });

  const casos = [
    ['160.740.093-68',      '16074009368',      'CPF com máscara'],
    ['16074009368',         '16074009368',      'CPF já limpo'],
    ['12.345.678/0001-90',  '12345678000190',   'CNPJ com máscara'],
    ['(86) 98852-1231',     '+5586988521231',   'telefone vira E.164 com +'],
    ['PIX@Paroquia.ORG',    'pix@paroquia.org', 'e-mail em minúsculas'],
    ['123e4567-e89b-12d3-a456-426614174000',
     '123e4567-e89b-12d3-a456-426614174000',    'chave aleatória fica intacta']
  ];

  for (const [entrada, esperado, nome] of casos) {
    const r = ctx.Utils.chavePixCanonica(entrada);
    const ok = r === esperado;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${nome}${ok ? '' : ` — veio "${r}", esperava "${esperado}"`}`);
  }

  // A prova que importa: o código gerado carrega a chave SEM máscara.
  const codigo = ctx.MediaService._gerarPayloadPix('160.740.093-68', 100,
                                                   'Marlize Ferreira', 'TERESINA');
  const temMascara = codigo.indexOf('160.740.093-68') >= 0;
  const temLimpa   = codigo.indexOf('011116074009368') >= 0;   // tag 01, len 11
  const ok = !temMascara && temLimpa;
  if (!ok) falhas++;
  console.log(`${ok ? '✅' : '❌'} O BR Code leva a chave limpa, no campo 01 com 11 dígitos` +
              (ok ? '' : ` — máscara: ${temMascara}, campo certo: ${temLimpa}`));
}

console.log('─'.repeat(64));
console.log('🧾 Conferência do comprovante — BL-46\n');

// ─────────────────────────────────────────────────────────────────────────
// Aqui o erro tem lados MUITO desiguais. Deixar passar um comprovante errado
// custa uma conferência da secretaria. Acusar um comprovante certo custa
// dizer a alguém que acabou de devolver o dízimo que ela pagou errado.
//
// Por isso a maioria dos casos abaixo é do lado "NÃO pode acusar".
{
  const ctx = montarContexto({ dizimista: DIZIMISTA });
  const CH = ctx.ComprovanteHandler;

  const COMUNIDADE = {
    x_studio_chave_pix:     'pix@paroquia.org',
    x_studio_titular_conta: 'Paróquia Nossa Senhora da Conceição Aparecida',
    x_studio_banco:         'Banco do Brasil'
  };

  const casos = [
    // ── O que NÃO pode virar acusação ────────────────────────────────────
    { nome: 'tudo confere',
      dados: { chavePix: 'pix@paroquia.org',
               recebedor: { nome: 'Paróquia N. S. da Conceição', banco: 'Banco do Brasil' } },
      motivo: 'ok' },

    { nome: 'nome abreviado pelo banco ainda é a mesma conta',
      dados: { chavePix: 'pix@paroquia.org',
               recebedor: { nome: 'PAROQUIA N S CONCEICAO APARECIDA', banco: null } },
      motivo: 'ok' },

    { nome: 'layout não reconhecido: recebedor vazio não conta contra ninguém',
      dados: { chavePix: 'pix@paroquia.org', recebedor: { nome: null, banco: null } },
      motivo: 'ok' },

    { nome: 'sem recebedor E sem chave: conferência, nunca alerta',
      dados: { chavePix: null, recebedor: { nome: null, banco: null } },
      motivo: 'ausente' },

    { nome: 'só o banco diverge: conferência calada, não alerta',
      dados: { chavePix: null,
               recebedor: { nome: 'Paróquia Nossa Senhora da Conceição', banco: 'Nubank' } },
      motivo: 'ausente' },

    // ── O que DEVE alertar ────────────────────────────────────────────────
    { nome: 'chave de outra conta: alerta',
      dados: { chavePix: 'outro@banco.com', recebedor: { nome: null, banco: null } },
      motivo: 'divergente' },

    { nome: 'sem chave, mas nome E banco divergem: alerta',
      dados: { chavePix: null,
               recebedor: { nome: 'João Carlos Ferreira', banco: 'Nubank' } },
      motivo: 'tudo_divergente' },

    // ── Chave certa, resto estranho: conferir, sem acusar ────────────────
    { nome: 'chave certa e nome estranho: conferência, não alerta',
      dados: { chavePix: 'pix@paroquia.org',
               recebedor: { nome: 'João Carlos Ferreira', banco: 'Banco do Brasil' } },
      motivo: 'titular_divergente' }
  ];

  for (const c of casos) {
    const r = CH._conferirComprovante(c.dados, COMUNIDADE);
    const ok = r.motivo === c.motivo;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${c.nome}${ok ? '' : ` — veio "${r.motivo}", esperava "${c.motivo}"`}`);
  }

  // A regra que dá sentido a tudo acima: quem é avisado e quem não é.
  //
  // BL-50 alargou: QUALQUER campo lido que divirja passa a avisar, não só o
  // caso extremo. O que tornou isso aceitável foi a mensagem mostrar nome,
  // chave e banco lidos — a pessoa vê em cima de que dado a dúvida se apoia.
  //
  // O que NÃO mudou, e é o que segura tudo: campo não lido continua fora.
  // 'ausente' e 'sem_referencia' não avisam, porque ali não se sabe de nada.
  const alertam    = ['divergente', 'tudo_divergente',
                      'titular_divergente', 'banco_divergente'];
  const naoAlertam = ['ok', 'ausente', 'sem_referencia', 'codigo_que_nao_existe'];
  const err = alertam.filter(m => !ctx.alertaDoador(m))
    .concat(naoAlertam.filter(m => ctx.alertaDoador(m)));
  if (err.length) falhas++;
  console.log(`${err.length ? '❌' : '✅'} Só os graves avisam a pessoa` +
              (err.length ? ` — errou em: ${err.join(', ')}` : ''));
}

console.log('\n' + '─'.repeat(64));
console.log('📌 O status com que a devolução nasce — BL-51\n');

// ─────────────────────────────────────────────────────────────────────────
// A linha do meio é a que não pode sumir. Marcar 'Rejeitado' o que não foi
// LIDO rejeitaria pagamento legítimo em massa: o comprovante do Nubank sem
// chave no destino é o caso mais comum que existe (BL-49), e ali não se sabe
// de nada. Ausência de informação não é prova de erro.
{
  const ctx = montarContexto({ dizimista: DIZIMISTA });

  const casos = [
    ['ok',                  'Confirmado', 'tudo confere'],
    ['divergente',          'Rejeitado',  'chave de outra conta'],
    ['tudo_divergente',     'Rejeitado',  'nome e banco divergem'],
    ['titular_divergente',  'Rejeitado',  'nome lido diverge'],
    ['banco_divergente',    'Rejeitado',  'banco lido diverge'],
    ['ausente',             'Pendente',   'não deu para ler a chave'],
    ['sem_referencia',      'Pendente',   'a comunidade não tem chave cadastrada'],
    ['codigo_que_nao_existe', 'Pendente', 'código desconhecido não condena ninguém']
  ];

  for (const [codigo, esperado, nome] of casos) {
    const r = ctx.statusDaDevolucao(codigo);
    const ok = r === esperado;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${codigo.padEnd(21)} → ${esperado.padEnd(10)} (${nome})` +
                (ok ? '' : `  — veio ${r}`));
  }

  // E o status precisa chegar ao Odoo, não só existir na função.
  consultas = [];
  let gravado = null;
  const ctx2 = montarContexto({
    dizimista: DIZIMISTA,
    aoCriar: (modelo, dados) => { if (modelo === 'x_devolucao') gravado = dados.x_studio_status; }
  });
  ctx2.OdooService.registrarDevolucao(1, { valor: 50 }, null, 'imagem', 'divergente');
  const ok = gravado === 'Rejeitado';
  if (!ok) falhas++;
  console.log(`${ok ? '✅' : '❌'} O status chega ao registro no Odoo` +
              (ok ? '' : ` — gravou ${JSON.stringify(gravado)}`));
}

console.log('\n' + '─'.repeat(64));
console.log('📇 O wa_id do contato vem do Odoo, não de palpite\n');

// ─────────────────────────────────────────────────────────────────────────
// `contatosDoDizimista` é stubado no resto do harness, então `_comWaId` —
// que mora dentro de `buscarContatosComunidade` — não roda em nenhum cenário
// acima. Foi a quinta vez nesta sessão que um stub cômodo escondeu a lógica
// sob teste; aqui o método é chamado direto, com o `searchRead` controlado.
{
  const casos = [
    {
      nome: 'conta antiga: o wa_id sem o nono dígito é o que existe',
      conhece: ['558688521231'],
      espera:  '558688521231'
    },
    {
      nome: 'conta nova: o wa_id COM o nono dígito é o que existe',
      conhece: ['5586988521231'],
      espera:  '5586988521231'
    },
    {
      nome: 'número que nunca escreveu ao bot fica sem wa_id',
      conhece: [],
      espera:  undefined
    },
    {
      // O palpite por DDD diria "sem o 9" para o 86. Se algum dia alguém
      // trocar a confirmação pela heurística, este caso quebra.
      nome: 'o confirmado vence a heurística de DDD',
      conhece: ['5586988521231'],
      espera:  '5586988521231'
    }
  ];

  for (const c of casos) {
    const ctx = montarContexto({ dizimista: DIZIMISTA, contatoBotConhece: c.conhece });
    const res = ctx.OdooService._comWaId([
      { nome: 'João da Silva', whatsapp: '(86) 98852-1231' }
    ]);
    const obtido = res[0].waId;
    const ok = obtido === c.espera;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${c.nome}${ok ? '' : ` — veio ${obtido}`}`);
  }

  // O Odoo fora do ar não pode custar o cartão inteiro.
  const ctxErro = montarContexto({ dizimista: DIZIMISTA, odooForaDoAr: true });
  let sobreviveu = false;
  try {
    const r = ctxErro.OdooService._comWaId([{ nome: 'X', whatsapp: '(86) 98852-1231' }]);
    sobreviveu = r.length === 1 && !r[0].waId;
  } catch (e) { /* sobreviveu = false */ }
  if (!sobreviveu) falhas++;
  console.log(`${sobreviveu ? '✅' : '❌'} Odoo fora do ar → cartão sai sem wa_id, em vez de não sair`);
}

console.log('\n' + '─'.repeat(64));
console.log('🗣️  Nada de jargão nosso na boca da Cidinha\n');

// ─────────────────────────────────────────────────────────────────────────
// "Compartilhar o bot da paróquia" ficou meses num submenu. Ninguém do outro
// lado chama a Cidinha de bot — quem chama somos nós, e a palavra escapou de
// dentro para fora sem que nada reclamasse.
//
// Esta varredura lê os textos que o paroquiano REALMENTE recebe: o que o
// harness capturou em todos os cenários acima, e não o fonte — assim ela não
// acusa comentário nem nome de variável, que é onde o jargão é legítimo.
{
  const JARGAO = [
    'bot', 'webhook', 'api', 'token', 'payload', 'flow', 'json',
    'endpoint', 'timeout', 'cache', 'deploy', 'script'
  ];

  // Tudo o que saiu em qualquer cenário — as mensagens já vêm acumuladas nos
  // textos que cada regra conferiu, então rodamos os cenários de novo, de
  // graça, só para ler o que foi dito.
  const ditos = [];
  for (const c of CENARIOS) {
    enviadas = [];
    try { c.roda(montarContexto(c.cenario)); } catch (e) { continue; }
    enviadas.forEach(m => ditos.push({ cenario: c.nome, texto: m.texto }));
  }

  let achados = 0;
  for (const d of ditos) {
    for (const j of JARGAO) {
      // Fronteira de palavra, e sem acento nem caixa: "robot" e "botão" não
      // são jargão, e `\bbot\b` já os exclui.
      if (new RegExp(`\\b${j}\\b`, 'i').test(d.texto)) {
        achados++;
        falhas++;
        console.log(`❌ "${j}" apareceu para o usuário em: ${d.cenario}`);
        console.log(`   ${d.texto.slice(0, 90)}`);
      }
    }
  }

  if (!achados) {
    console.log(`✅ ${ditos.length} mensagens varridas — nenhuma usa palavra nossa`);
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
  },
  // BL-82: sem o ponto de milhar, a expressão parava no terceiro dígito.
  // "R$ 1234,56" virava 123, e o valor plausível passava por todas as
  // conferências.
  {
    nome: 'Valor sem separador de milhar, com rótulo — BL-82',
    texto: 'Valor: R$ 1234,56\n',
    chave: null,
    valor: 1234.56
  },
  {
    nome: 'Cinco dígitos sem separador — BL-82',
    texto: 'Valor pago R$ 10000,00\n',
    chave: null,
    valor: 10000
  },
  {
    nome: 'Sem rótulo e sem separador: o maior valor continua valendo — BL-82',
    texto: 'Pix enviado\nR$ 1500,00\nTarifa: R$ 2,50\n',
    chave: null,
    valor: 1500
  },
  {
    nome: 'Com separador de milhar continua certo — BL-82',
    texto: 'Valor: R$ 1.234,56\n',
    chave: null,
    valor: 1234.56
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
console.log('🔐 Nada que identifique a instância no repositório público\n');

// ──────────────────────────────────────────────────────────────────
// Este repositório é PÚBLICO. A URL da instância e o nome do banco estavam
// escritos em Config.gs e Setup.gs desde o começo — eu só percebi ao responder
// "é seguro usar essa solução?", olhando o arquivo em vez da memória.
//
// A URL não é credencial. Mas ela diz a quem quiser ONDE apontar uma tentativa
// de força bruta, e confirma o nome do banco — que é a outra metade do que se
// precisa, tendo a chave. Custa nada tirar, e custa caro deixar.
//
// Já está no histórico do git, e reescrever histórico de repositório público
// não desfaz o que foi lido. O que esta barreira impede é a REINTRODUÇÃO.
{
  const ARQUIVOS = fs.readdirSync(RAIZ)
    .filter((f) => /\.(gs|js|mjs|json|md)$/.test(f))
    .concat(['ferramentas/odoo-env.mjs', 'ferramentas/.odoo-env.exemplo']
      .filter((f) => fs.existsSync(path.join(RAIZ, f))));

  // Um host concreto — letras e números antes de .odoo.com. Placeholders em
  // MAIÚSCULAS, como SUA-INSTANCIA, não contam: eles existem justamente para
  // dizer onde colar o seu.
  const CONCRETO = /https?:\/\/(?!SUA[-_])[a-z0-9][a-z0-9-]*\.odoo\.com/;

  const achados = [];
  for (const f of ARQUIVOS) {
    const caminho = path.join(RAIZ, f);
    if (!fs.existsSync(caminho) || fs.statSync(caminho).isDirectory()) continue;
    const txt = lerTexto(caminho);
    for (const linha of txt.split('\n')) {
      const m = linha.match(CONCRETO);
      if (m) achados.push(`${f}: ${m[0]}`);
    }
  }

  if (achados.length) {
    falhas += achados.length;
    for (const a of achados) console.log(`❌ URL da instância versionada → ${a}`);
    console.log('   Ela vem das Script Properties, que não vão para o git.');
  } else {
    console.log(`✅ nenhuma URL de instância concreta em ${ARQUIVOS.length} arquivos versionados`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🔤 Nenhum código de conferência escapa sem tradução\n');

// ──────────────────────────────────────────────────────────────────
// `x_studio_conferencia_pix` é um campo CHAR: o valor gravado é o que aparece
// na tela. O coordenador via "tudo_divergente" e "sem_referencia".
//
// Converter para selection e dar rótulos seria o certo, e o Odoo não deixa:
// "Changing the type of a field is not yet supported. Please drop it and
// create it again!" (ir_model.py). Dropar apagaria o que o bot já leu em todo
// registro. Então a tradução mora nas views, por `invisible` de valor.
//
// O risco disso é óbvio: o Config.gs ganha um código novo, ninguém lembra das
// views, e aquele caso passa a aparecer sem texto — ou pior, some. É isso que
// esta verificação impede. A rede de segurança no arch é a SEGUNDA barreira;
// esta é a primeira.
{
  // A tabela vem do Config.gs de verdade, recortada e avaliada. Uma lista
  // copiada aqui envelheceria em silêncio — que é exatamente o problema que
  // esta verificação existe para pegar.
  const cfg = lerTexto(path.join(RAIZ, 'Config.gs'));
  const de = cfg.indexOf('const CONFERENCIA = {');
  const ate = cfg.indexOf('\n};', de) + 3;
  const CONFERENCIA = de < 0 ? {} : new Function(cfg.slice(de, ate) + '; return CONFERENCIA;')();

  const codigos = Object.keys(CONFERENCIA).filter((c) => c !== 'ok');
  if (!codigos.length) {
    falhas++;
    console.log('❌ não consegui ler a tabela CONFERENCIA do Config.gs');
  }

  const VISTAS = [
    ['formulário', 'x_devolucao.form.608.Odoo_Studio_Default_form_view_for_x_devolucao_customization.xml'],
    ['card do kanban', 'x_devolucao.kanban.679.Default_kanban_view_for_ir.model_447_.xml'],
  ];

  for (const [rotulo, arq] of VISTAS) {
    const caminho = path.join(RAIZ, 'ferramentas/views-odoo', arq);
    if (!fs.existsSync(caminho)) {
      falhas++;
      console.log(`❌ ${rotulo}: ${arq} não existe`);
      continue;
    }
    const xml = lerTexto(caminho);

    // Um código está traduzido quando há um <span invisible="… != 'codigo'">
    // com texto dentro — é essa a forma que faz a frase aparecer só no caso dele.
    const semTexto = [];
    for (const c of codigos) {
      const re = new RegExp(`<span invisible="x_studio_conferencia_pix != '${c}'">\\s*([^<]*\\S)`, 's');
      if (!re.test(xml)) semTexto.push(c);
    }

    // E a rede de segurança precisa listar TODOS os códigos, senão ela dispara
    // junto com uma frase e a tela mostra as duas coisas.
    const rede = xml.match(/invisible="x_studio_conferencia_pix in \[([^\]]*)\]"/);
    const naRede = rede ? [...rede[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
    const foraDaRede = Object.keys(CONFERENCIA).filter((c) => !naRede.includes(c));

    const erros = [];
    if (semTexto.length) erros.push(`sem tradução: ${semTexto.join(', ')}`);
    if (!rede) erros.push('não achei a rede de segurança do código desconhecido');
    else if (foraDaRede.length) erros.push(`fora da rede de segurança: ${foraDaRede.join(', ')}`);

    if (erros.length) {
      falhas += erros.length;
      for (const e of erros) console.log(`❌ ${rotulo}: ${e}`);
    } else {
      console.log(`✅ ${rotulo}: os ${codigos.length} códigos têm frase, e a rede cobre os ${naRede.length}`);
    }
  }
}

console.log('\n' + '─'.repeat(64));
console.log('📆 Idade do comprovante: antigo e futuro caem em "Não confere"\n');

// ──────────────────────────────────────────────────────────────────
// BL-69. Até aqui um comprovante de 2020 registrava como qualquer outro:
// não havia checagem de data nenhuma.
//
// A regra é mais dura que o resto da tabela de conferência de propósito.
// Chave que não bate pode ser layout de banco que não entendemos; data é data.
// Por isso os dois códigos entram como `alertaDoador`, e a pessoa é avisada.
{
  const dias = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  function confereIdade(dataBR, cenario) {
    const ctx = montarContexto(Object.assign({ camposOdoo: [] }, cenario || {}));
    return ctx.ComprovanteHandler._conferirIdade(dataBR);
  }

  const CASOS = [
    ['comprovante de hoje passa limpo',            dias(0),   null],
    ['de 30 dias ainda passa — quem pagou e esqueceu de mandar', dias(30), null],
    ['de 60 dias passa: o limite é "mais de", não "a partir de"', dias(60), null],
    ['de 61 dias já é antigo',                     dias(61),  'comprovante_antigo'],
    ['de 6 meses é antigo',                        dias(180), 'comprovante_antigo'],
    ['data no FUTURO é impossível, e acusa',       dias(-1),  'comprovante_futuro'],
    ['data ilegível NÃO acusa nada',               '',        null],
    ['data em formato estranho também não acusa',  '20 de setembro', null],
  ];

  for (const [nome, data, esperado] of CASOS) {
    const r = confereIdade(data);
    const obtido = r && r.motivo;
    const ok = obtido === esperado || (esperado === null && r === null);
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${nome}` + (ok ? '' : `  (esperado ${esperado}, veio ${obtido})`));
  }

  // O parâmetro da paróquia manda, dentro de limites
  {
    const comLimite = (n) => montarContexto({
      camposOdoo: ['x_studio_dias_comprovante'], parametros: { x_studio_dias_comprovante: n },
    }).ComprovanteHandler._conferirIdade(dias(40));
    const r10 = comLimite(10);
    const r90 = comLimite(90);
    let ok = r10 && r10.motivo === 'comprovante_antigo' && r90 === null;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} o parâmetro da paróquia manda: 10 dias reprova, 90 aprova o mesmo comprovante`
      + (ok ? '' : `  (10→${JSON.stringify(r10)} 90→${JSON.stringify(r90)})`));

    // Zero reprovaria todo mundo; 5000 não reprovaria ninguém.
    const rZero = montarContexto({
      camposOdoo: ['x_studio_dias_comprovante'], parametros: { x_studio_dias_comprovante: 0 },
    }).ComprovanteHandler._conferirIdade(dias(40));
    ok = rZero === null;   // 0 é inválido → volta ao padrão 60 → 40 dias passa
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} parâmetro absurdo (0) volta ao padrão em vez de reprovar todo mundo`
      + (ok ? '' : `  (veio ${JSON.stringify(rZero)})`));
  }

  // E o mais importante: chave divergente é MAIS grave e continua mandando
  {
    const ctx = montarContexto({ camposOdoo: [] });
    const r = ctx.ComprovanteHandler._conferirComprovante(
      { data: dias(200), chavePix: 'outra@chave.com', recebedor: {} },
      { x_studio_chave_pix: 'paroquia@pix.org' });
    const ok = r && r.motivo === 'divergente';
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} comprovante antigo E com chave divergente reporta a CHAVE, que é mais grave`
      + (ok ? '' : `  (veio ${JSON.stringify(r)})`));
  }

  // Antigo com a chave certa vira "Não confere" — a decisão de 23/09
  {
    const ctx = montarContexto({ camposOdoo: [] });
    const r = ctx.ComprovanteHandler._conferirComprovante(
      { data: dias(200), chavePix: 'paroquia@pix.org', recebedor: {} },
      { x_studio_chave_pix: 'paroquia@pix.org' });
    const status = r && ctx.statusDaDevolucao(r.motivo);
    const ok = r && r.motivo === 'comprovante_antigo' && status === 'Rejeitado';
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} antigo com a chave certa vira "Não confere" e avisa a pessoa`
      + (ok ? '' : `  (motivo ${r && r.motivo}, status ${status})`));
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🗓️  O ciclo da devolução: competência, mês em aberto, mês seguinte\n');

// ──────────────────────────────────────────────────────────────────
// BL-62, dentro do `registrarDevolucao` DE VERDADE — não de um stub. É o
// caminho do dinheiro, onde já viveram BL-02, BL-26, BL-27 e BL-51, e o modo
// de falhar aqui é caro nos dois sentidos: um registro a mais deixa o mês com
// duas linhas, e um "A devolver" com data faz a pessoa parar de ser cobrada e
// virar Regular sem ter pago nada.
{
  const CAMPOS = ['x_studio_competencia', 'x_studio_tipo_contribuicao',
                  'x_studio_comunidade', 'x_studio_validacao'];

  // `registrarDevolucao` exige comunidade (BL-41), e a tira do dizimista.
  const DIZIMISTA = { id: 7, x_name: 'Ewerton', x_studio_comunidade: [3, 'Matriz'] };

  function registra(cenario, dadosAnalise, extras) {
    const criados = [], escritos = [];
    const ctx = montarContexto(Object.assign({
      camposOdoo: CAMPOS,
      dizimistaNoOdoo: DIZIMISTA,
      aoCriar:    (m, d) => { if (m === 'x_devolucao') criados.push(d); },
      aoEscrever: (m, id, d) => { if (m === 'x_devolucao') escritos.push([id, d]); },
    }, cenario));
    const id = ctx.OdooService.registrarDevolucao(
      7, dadosAnalise, null, 'imagem', 'ok',
      Object.assign({ tipo: 'dizimo' }, extras || {}));
    return { id, criados, escritos };
  }

  const CASOS = [];
  const confere = (nome, ok, detalhe) => CASOS.push([nome, ok, detalhe]);

  // 1. A competência é gravada, e é o mês da DATA DA DEVOLUÇÃO
  {
    const r = registra({}, { valor: 50, data: '20/09/2026' });
    const d = r.criados[0] || {};
    confere('a competência sai do mês da data da devolução',
      d.x_studio_competencia === '2026-09-01', JSON.stringify(d.x_studio_competencia));
  }

  // 2. Nada mais é preenchido nem pré-criado: registrar é sempre CRIAR.
  //
  //    O ciclo automático — abrir o mês seguinte, procurar um "A devolver" da
  //    mesma competência para preencher — foi removido no BL-71. Ele resolvia
  //    a previsibilidade e criava três problemas: mês fantasma para quem devolve
  //    de dois em dois meses, pergunta disparando em toda devolução, e um buraco
  //    sem rastro quando alguém pulava um mês. A regra de ouro cobre o que
  //    importava com duas opções e nenhum registro inventado.
  {
    const r = registra({
      devolucoesPorCompetencia: [{ id: 41, x_studio_competencia: '2026-09-01',
                                   x_studio_status: 'A devolver' }],
    }, { valor: 50, data: '20/09/2026' });
    const abertos = r.criados.filter((d) => d.x_studio_status === 'A devolver');
    confere('registrar CRIA, e não abre mês nenhum nem preenche registro antigo',
      r.escritos.length === 0 && r.criados.length === 1 && abertos.length === 0,
      `escritos=${r.escritos.length} criados=${r.criados.length} abertos=${abertos.length}`);
  }

  // 3. Sem mês em aberto: cria normalmente
  {
    const r = registra({}, { valor: 50, data: '20/09/2026' });
    confere('sem mês em aberto, cria como sempre criou',
      r.escritos.length === 0 && r.criados.length >= 1,
      `escritos=${r.escritos.length} criados=${r.criados.length}`);
  }

  // 7. OFERTA não entra nesse ciclo
  {
    const r = registra({}, { valor: 50, data: '20/09/2026' }, { tipo: 'oferta' });
    const abertos = r.criados.filter((d) => d.x_studio_status === 'A devolver');
    confere('oferta não abre mês nenhum — não é compromisso mensal',
      abertos.length === 0, `abertos=${abertos.length}`);
  }

  // 8. Competência de OUTRO mês não é preenchida às cegas
  //    O aberto é de setembro, o pagamento chega em dezembro. Enquanto a
  //    pergunta ao dizimista não existir, setembro CONTINUA devendo — quitá-lo
  //    sozinho seria inventar um fato.
  {
    const r = registra({
      devolucoesPorCompetencia: [{ id: 41, x_studio_competencia: '2026-09-01',
                                   x_studio_status: 'A devolver' }],
    }, { valor: 50, data: '10/12/2026' });
    const pagou = r.escritos.find(([, d]) => d.x_studio_value === 50);
    confere('pagamento de dezembro NÃO quita o aberto de setembro',
      !pagou && r.criados.length >= 1,
      `escritos=${JSON.stringify(r.escritos.map(e => e[0]))}`);
  }

  // 9. Sem o campo de competência no Odoo, nada disso acontece
  //    A base rodou muito tempo sem campos que vieram depois; o bot não pode
  //    exigir schema que talvez não esteja lá.
  {
    const criados = [];
    const ctx = montarContexto({
      camposOdoo: ['x_studio_tipo_contribuicao', 'x_studio_comunidade'],
      dizimistaNoOdoo: DIZIMISTA,
      aoCriar: (m, d) => { if (m === 'x_devolucao') criados.push(d); },
    });
    ctx.OdooService.registrarDevolucao(7, { valor: 50, data: '20/09/2026' },
      null, 'imagem', 'ok', { tipo: 'dizimo' });
    confere('sem o campo de competência, registra como antes e não abre mês',
      criados.length === 1 && !('x_studio_competencia' in criados[0]),
      `criados=${criados.length}`);
  }

  // ── A REGRA DE OURO (BL-71) ─────────────────────────────────────────────
  //
  // Não é a primeira devolução, e o mês ANTERIOR não tem devolução nenhuma:
  // pergunta se é deste mês ou do anterior. Duas opções, sempre.
  //
  // Substituiu três mecanismos que foram ficando complicados — o mês em aberto
  // anterior, depois qualquer mês diferente, depois o intervalo inteiro desde
  // a última paga. Cada um resolvia um caso e criava outro.
  {
    function ofereceu(devolucoes, competenciaDoPago) {
      const enviadas = [];
      const ctx = montarContexto({
        camposOdoo: ['x_studio_competencia'],
        devolucoesPorCompetencia: devolucoes,
        devolucaoPorId: { id: 90, x_studio_competencia: competenciaDoPago },
      });
      ctx.Utils.enviarMenu = (to, texto, botoes) => enviadas.push({ texto, botoes });
      ctx.Utils.enviarComBotaoMenu = (to, texto) => enviadas.push({ texto, botoes: [] });
      ctx.ComprovanteHandler._ofereceCorrigirMes('55', 90, 7);
      return enviadas;
    }
    const paga = (comp) => ({ id: 10, x_studio_competencia: comp, x_studio_status: 'Confirmado' });

    // O caso do teste de 23/09: julho pago, comprovante de setembro
    const pulou = ofereceu([paga('2026-07-01')], '2026-09-01');
    confere('pagou julho e voltou em setembro: pergunta',
      pulou.length === 1 && pulou[0].botoes.length === 2, JSON.stringify(pulou));
    confere('duas opções: o mês registrado primeiro, o anterior depois',
      pulou.length === 1
      && /setembro\/2026/.test(pulou[0].botoes[0].title)
      && /agosto\/2026/.test(pulou[0].botoes[1].title),
      JSON.stringify(pulou[0] && pulou[0].botoes));
    confere('o id do botão carrega registro e mês, sem depender de sessão',
      pulou.length === 1 && pulou[0].botoes[1].id === 'compm_90_2026-08-01',
      JSON.stringify(pulou[0] && pulou[0].botoes));

    confere('quem devolve todo mês não é perguntado',
      ofereceu([paga('2026-08-01')], '2026-09-01').length === 0);

    confere('PRIMEIRA devolução da vida não é perguntada',
      ofereceu([], '2026-09-01').length === 0);

    // Sumiu por meses: continua sendo UMA pergunta de duas opções, não uma lista
    const sumiu = ofereceu([paga('2023-01-01')], '2026-09-01');
    confere('quem sumiu por anos recebe a mesma pergunta simples, de 2 opções',
      sumiu.length === 1 && sumiu[0].botoes.length === 2, JSON.stringify(sumiu));

    // Pagar no dia 1º pelo mês anterior — o caso que motivou tudo isto
    const diaPrimeiro = ofereceu([paga('2026-08-01')], '2026-10-01');
    confere('pagou dia 1º de outubro com agosto pago: pergunta outubro ou setembro',
      diaPrimeiro.length === 1
      && /outubro\/2026/.test(diaPrimeiro[0].botoes[0].title)
      && /setembro\/2026/.test(diaPrimeiro[0].botoes[1].title),
      JSON.stringify(diaPrimeiro[0] && diaPrimeiro[0].botoes));

    // `A devolver` não conta como devolução: é previsão, não pagamento
    const soPrevisao = ofereceu(
      [paga('2026-07-01'), { id: 11, x_studio_competencia: '2026-08-01', x_studio_status: 'A devolver' }],
      '2026-09-01');
    confere('registro "A devolver" no mês anterior não cobre nada — pergunta igual',
      soPrevisao.length === 1 && soPrevisao[0].botoes.length === 2, JSON.stringify(soPrevisao));

    // A escolha: só grava, não cria nem reabre nada
    {
      const escritos = [], criados = [];
      const ctx = montarContexto({
        camposOdoo: ['x_studio_competencia'],
        devolucaoPorId: { id: 90, x_studio_competencia: '2026-09-01' },
        aoEscrever: (m, id, d) => escritos.push([id, d.x_studio_competencia]),
        aoCriar: (m, d) => criados.push(d),
      });
      ctx.Utils.enviarComBotaoMenu = () => {};
      ctx.ComprovanteHandler.corrigirMes('55', 'compm_90_2026-08-01');
      confere('escolher o mês anterior só GRAVA — não cria registro para o que sobrou',
        escritos.length === 1 && escritos[0][0] === 90 && escritos[0][1] === '2026-08-01'
        && criados.length === 0,
        `escritos=${JSON.stringify(escritos)} criados=${criados.length}`);
    }

    // Escolher o mês que já estava não escreve nada
    {
      const escritos = [];
      const ctx = montarContexto({
        camposOdoo: ['x_studio_competencia'],
        devolucaoPorId: { id: 90, x_studio_competencia: '2026-09-01' },
        aoEscrever: (m, id) => escritos.push(id),
      });
      ctx.Utils.enviarComBotaoMenu = () => {};
      ctx.ComprovanteHandler.corrigirMes('55', 'compm_90_2026-09-01');
      confere('confirmar o mês que já estava não mexe em nada', escritos.length === 0,
        JSON.stringify(escritos));
    }

    // O LOTE DE FAMÍLIA COM UM MEMBRO SÓ.
    //
    // Escapou em produção, 23/09: quem abre "De quem é a devolução?" e escolhe
    // uma pessoa passa pelo caminho de FAMÍLIA, que nunca chamava a pergunta.
    // Eu tinha documentado o porquê no BL-62 — "uma pergunta por membro viraria
    // uma rajada" — e o raciocínio vale para família de verdade. Lote de um
    // não é lote.
    {
      const enviadas = [];
      const ctx = montarContexto({
        camposOdoo: ['x_studio_competencia'],
        // `buscarDizimistaPorWhatsapp` procura por telefone; o cenário precisa
        // dos dois caminhos, porque o lote também lê o dizimista por id.
        dizimista: { id: 7, x_name: 'Thalles', x_studio_comunidade: [3, 'Matriz'] },
        dizimistaNoOdoo: { id: 7, x_name: 'Thalles', x_studio_comunidade: [3, 'Matriz'] },
        comunidadeGravavel: true,
        devolucoesPorCompetencia: [paga('2026-07-01')],
        devolucaoPorId: { id: 99, x_studio_competencia: '2026-09-01' },
      });
      ctx.Utils.enviarMenu = (to, texto, botoes) => enviadas.push({ texto, botoes });
      ctx.Utils.enviarComBotaoMenu = () => {};
      ctx.Utils.enviarSimples = () => {};
      ctx.ComprovanteHandler._responderDesfecho = () => {};
      ctx.ComprovanteHandler._tratarResultadoFamilia('55',
        { dados: { valor: 400, data: '07/09/2026' }, tipo: 'imagem', arquivoOriginalBase64: null },
        [{ id: 7, nome: 'Thalles', valor: 100 }], '');
      const comMes = enviadas.filter((e) => /a qual mês/i.test(e.texto || ''));
      confere('lote de família com UM membro também recebe a pergunta do mês',
        comMes.length === 1 && comMes[0].botoes.length === 2, JSON.stringify(enviadas.map(e => e.texto && e.texto.slice(0, 40))));
    }

    // O VALOR: comprovante manda quando há um membro só (BL-72).
    //
    // Escapou em produção, 23/09: comprovante de R$ 400, registro de R$ 100.
    // O valor escolhido na conversa é uma inclinação — a pessoa devolve o que
    // quiser —, e gravar o escolhido põe no Odoo um número que não corresponde
    // a dinheiro nenhum. O relatório do mês ficava R$ 300 menor que o extrato.
    {
      function registraLote(membros) {
        const gravados = [];
        const ctx = montarContexto({
          camposOdoo: ['x_studio_competencia'],
          dizimista: { id: 7, x_name: 'Thalles', x_studio_comunidade: [3, 'Matriz'] },
          dizimistaNoOdoo: { id: 7, x_name: 'Thalles', x_studio_comunidade: [3, 'Matriz'] },
          comunidadeGravavel: true,
          devolucaoPorId: { id: 99, x_studio_competencia: '2026-09-01' },
          aoCriar: (m, d) => { if (m === 'x_devolucao') gravados.push(d.x_studio_value); },
        });
        ctx.Utils.enviarMenu = () => {}; ctx.Utils.enviarComBotaoMenu = () => {};
        ctx.Utils.enviarSimples = () => {};
        ctx.ComprovanteHandler._responderDesfecho = () => {};
        ctx.ComprovanteHandler._tratarResultadoFamilia('55',
          { dados: { valor: 400, data: '07/09/2026' }, tipo: 'imagem', arquivoOriginalBase64: null },
          membros, '');
        return gravados;
      }

      const um = registraLote([{ id: 7, nome: 'Thalles', valor: 100 }]);
      confere('um membro só: grava os R$ 400 do comprovante, não os R$ 100 escolhidos',
        um.length === 1 && um[0] === 400, JSON.stringify(um));

      const varios = registraLote([
        { id: 7, nome: 'Thalles', valor: 100 },
        { id: 8, nome: 'Black',   valor: 300 }]);
      confere('vários membros: mantém a alocação da conversa — o total não se divide sozinho',
        varios.length === 2 && varios[0] === 100 && varios[1] === 300, JSON.stringify(varios));
    }

    // Botão antigo, de mensagem que saiu antes do BL-71
    {
      const ditos = [];
      const ctx = montarContexto({ camposOdoo: [] });
      ctx.Utils.enviarComBotaoMenu = (to, t) => ditos.push(t);
      ctx.ComprovanteHandler.corrigirMes('55', 'comp_90_41');
      confere('botão do formato antigo avisa sem estourar e sem mentir',
        ditos.length === 1 && /está registrada/i.test(ditos[0]), JSON.stringify(ditos));
    }
  }

  for (const [nome, ok, detalhe] of CASOS) {
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${nome}${ok ? '' : '\n     ' + detalhe}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🛡️  baixar-views: o --download não pode apagar edição local\n');

// ──────────────────────────────────────────────────────────────────
// Aconteceu em produção, em 22/09: um --download passou por cima de duas
// views editadas AQUI e ainda não levadas ao Odoo com --update. O pivô e o
// calendário voltaram à versão antiga, e o `git status` mostrou isso como se
// fosse o resultado normal de baixar. Dois PRs já mesclados, desfeitos.
//
// A causa era o download comparar só dois lados — disco e Odoo — e, ao vê-los
// diferentes, escolher o Odoo. Sem saber POR QUE diferem, essa escolha é
// chute. O índice guarda a digital do que o Odoo tinha no download anterior,
// e é ela que diz qual dos dois se moveu.
//
// O --update já tinha a trava no sentido contrário. Esta é a simétrica.
{
  const fonte = lerTexto(path.join(RAIZ, 'ferramentas/baixar-views.mjs'));
  const de = fonte.indexOf('const decidirDownload');
  const ate = fonte.indexOf('};', de) + 2;
  if (de < 0) {
    falhas++;
    console.log('❌ não achei decidirDownload em baixar-views.mjs');
  } else {
    const decidir = new Function(fonte.slice(de, ate) + '; return decidirDownload;')();

    const A = 'digital-antiga', B = 'digital-nova', C = 'digital-outra';
    const CASOS = [
      // [nome, local, odoo, base, forcar, esperado]
      ['os dois dizem a mesma coisa → mantém o texto do disco',
       A, A, A, false, 'manter'],
      ['só o Odoo mudou → baixa, que é para isso que o download serve',
       A, B, A, false, 'baixar'],
      ['SÓ O DISCO MUDOU → preserva (foi este caso que apagou o pivô)',
       B, A, A, false, 'preservar'],
      ['os dois mudaram, cada um para um lado → preserva, e avisa',
       B, C, A, false, 'preservar'],
      ['sem base no índice (primeiro download) → baixa',
       B, C, null, false, 'baixar'],
      ['--forcar descarta a edição local de propósito',
       B, C, A, true, 'baixar'],
      ['--forcar não atrapalha quando os dois são iguais',
       A, A, A, true, 'manter'],
    ];

    for (const [nome, local, odoo, base, forcar, espera] of CASOS) {
      const obtido = decidir(local, odoo, base, forcar);
      const ok = obtido === espera;
      if (!ok) falhas++;
      console.log(`${ok ? '✅' : '❌'} ${nome}` + (ok ? '' : `  (esperado ${espera}, veio ${obtido})`));
    }
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🗓️  Domínios de filtro: só o que o navegador sabe avaliar\n');

// ──────────────────────────────────────────────────────────────────
// Domínio de filtro de busca NÃO é avaliado pelo Python do servidor. Quem
// avalia é o py_js, um Python parcial escrito em JavaScript que roda no
// navegador — e ele implementa bem menos coisa do que parece.
//
// Isso derrubou o filtro "Mês Atual" de x_devolucao, que nasceu com
// `context_today().replace(day=1)` e NUNCA devolveu nada: o PyDate do py_js
// não tem `replace`, então a expressão estourava em toda data. Não havia
// mensagem de erro em lugar nenhum — o filtro simplesmente não filtrava.
//
// Esta verificação é de graça e sem rede: procura, nos domínios versionados,
// as duas construções que já se provaram quebradas. A prova de verdade, que
// executa os domínios no avaliador real do Odoo, está em
// ferramentas/provar-dominio-filtro.mjs.
{
  const dirViews = path.join(RAIZ, 'ferramentas/views-odoo');
  const PROIBIDO = [
    [/\.replace\s*\(/,
     'PyDate do py_js não tem .replace() — use relativedelta(day=1)'],
    [/relativedelta\s*\([^)]*\bday\s*=\s*(3[01]|2[89])\b/,
     'relativedelta(day=31) transborda no py_js (fev vira 03/03) — use months=1, day=1 com "<"'],
  ];

  const arquivos = fs.existsSync(dirViews)
    ? fs.readdirSync(dirViews).filter((f) => f.endsWith('.xml') && !f.includes('.COMBINADA.'))
    : [];

  if (!arquivos.length) {
    falhas++;
    console.log('❌ não achei nenhuma view versionada em ferramentas/views-odoo');
  }

  let dominios = 0;
  const achados = [];
  for (const f of arquivos) {
    const xml = lerTexto(path.join(dirViews, f));
    // Só o conteúdo de domain="..." interessa: `.replace(` em outro lugar
    // (num t-out, num help) é JavaScript de verdade e funciona.
    for (const m of xml.matchAll(/\bdomain\s*=\s*"([^"]*)"/g)) {
      dominios++;
      for (const [re, porque] of PROIBIDO) {
        if (re.test(m[1])) achados.push(`${f}: ${porque}`);
      }
    }
  }

  if (achados.length) {
    falhas += achados.length;
    for (const a of achados) console.log(`❌ ${a}`);
  } else {
    console.log(`✅ ${dominios} domínios em ${arquivos.length} views, nenhum usa construção que o py_js não avalia`);
  }
  // ── `--` dentro de comentário XML ────────────────────────────────────────
  // XML proíbe dois hifens seguidos dentro de <!-- -->. Isso não é sutileza de
  // padrão: o Odoo recusa o arch inteiro, e a view não sobe.
  //
  // Parece exótico até se lembrar de que os comentários destas views explicam
  // como rodar as ferramentas, e as ferramentas têm flags. Escrever
  // "rode com <menos><menos>update" num comentário quebra o arquivo. Já
  // aconteceu duas vezes: nos 37 arquivos COMBINADA e no formulário de
  // devolução. A saída é a meia-risca (–), que não é hifen.
  {
    const quebrados = [];
    for (const f of arquivos) {
      const xml = lerTexto(path.join(dirViews, f));
      for (const c of xml.matchAll(/<!--([\s\S]*?)-->/g)) {
        if (c[1].includes('--')) {
          const trecho = c[1].match(/.{0,30}--.{0,20}/s)?.[0].replace(/\s+/g, ' ').trim();
          quebrados.push(`${f}: "--" em comentário XML → …${trecho}…`);
        }
      }
    }
    if (quebrados.length) {
      falhas += quebrados.length;
      for (const q of quebrados) console.log(`❌ ${q}`);
    } else {
      console.log(`✅ nenhum comentário XML com "--", que o Odoo recusaria`);
    }
  }

  // ── Os botões de validação no card do kanban ────────────────────────────
  // Duas situações são válidas, e a verificação aceita as duas:
  //
  //   ANTES DE INSTALAR — o arch traz o comentário MARCADOR-BOTOES-VALIDACAO,
  //     e instalar-botoes-kanban.mjs o troca pelos botões com os IDs das ações
  //     que acabou de criar. Se alguém renomear ou apagar esse comentário, o
  //     instalador para na máquina de quem usa, longe daqui.
  //
  //   DEPOIS DE INSTALAR — o marcador não existe mais, e no lugar dele há dois
  //     <button type="action"> apontando para IDs numéricos. Aqui o que
  //     importa é que os dois continuem lá e continuem condicionados ao campo:
  //     um --download que voltasse a view para antes dos botões apagaria o
  //     trabalho sem nada acusar.
  {
    const ARQ = 'x_devolucao.kanban.679.Default_kanban_view_for_ir.model_447_.xml';
    const MARCADOR = 'MARCADOR-BOTOES-VALIDACAO';
    const caminho = path.join(dirViews, ARQ);

    if (!fs.existsSync(caminho)) {
      falhas++;
      console.log(`❌ ${ARQ} não existe — é o card que leva os botões`);
    } else {
      const arch = lerTexto(caminho).replace(/^<!--[\s\S]*?-->\n/, '');
      const erros = [];

      if (arch.includes(MARCADOR)) {
        // Ainda não instalado: a troca precisa continuar pegando.
        const fingidos = '<div><button name="1" type="action">x</button></div>';
        const depois = arch.replace(new RegExp(`<!--\\s*${MARCADOR}[\\s\\S]*?-->`), fingidos);
        if (!/<!--\s*MARCADOR-BOTOES-VALIDACAO/.test(arch)) erros.push('o marcador não está dentro de <!-- -->');
        if (depois === arch) erros.push('a troca do marcador não pegou');
        if (depois.includes(MARCADOR)) erros.push('sobrou marcador depois da troca');
        if (!erros.length) console.log('✅ o marcador dos botões do kanban ainda é substituível');
      } else {
        // Já instalado: os dois botões precisam continuar de pé.
        // A tag inteira, e só depois os pedaços. A versão anterior casava o
        // texto exato do `invisible`, e quebrou no dia em que a condição ganhou
        // um segundo termo (` or x_studio_status == 'A devolver'`) — acusando
        // "achei 0 botões" quando os dois estavam lá, corretos. Teste que
        // depende da redação de um atributo testa a redação, não o que importa.
        const botoes = [...arch.matchAll(/<button\s[^>]*>/g)]
          .map((m) => ({
            id: m[0].match(/name="(\d+)"/)?.[1],
            acao: m[0].includes('type="action"'),
            estado: m[0].match(/x_studio_validacao == '([a-z_]+)'/)?.[1],
          }))
          .filter((b) => b.id && b.acao && b.estado)
          .map((b) => [null, b.id, b.estado]);
        const estados = botoes.map((b) => b[2]).sort();
        if (botoes.length !== 2) {
          erros.push(`esperava 2 botões de ação no card, achei ${botoes.length}`);
        } else if (estados.join(',') !== 'nao_recebido,validado') {
          erros.push(`os botões não cobrem os dois estados: ${estados.join(', ')}`);
        }
        if (!arch.includes('<field name="x_studio_validacao"/>')) {
          erros.push('x_studio_validacao não está declarado — as condições invisible não avaliam');
        }
        if (!erros.length) {
          console.log(`✅ os dois botões de validação estão no card (ações ${botoes.map((b) => b[1]).join(' e ')})`);
        }
      }

      if (erros.length) {
        falhas += erros.length;
        for (const e of erros) console.log(`❌ botões do kanban: ${e}`);
      }
    }
  }

  // ── Formulário e kanban precisam citar as MESMAS ações ───────────────────
  // Os dois botões existem em dois arquivos, e cada um carrega o id numérico
  // de uma ir.actions.server. Números iguais por coincidência hoje podem
  // divergir amanhã — basta alguém recriar as ações e baixar só uma das views.
  // Um botão apontando para id que não existe mais não avisa nada: ele
  // aparece, é clicado, e o Odoo responde com erro na cara de quem usa.
  {
    const lerBotoes = (arq) => {
      const caminho = path.join(dirViews, arq);
      if (!fs.existsSync(caminho)) return null;
      const xml = lerTexto(caminho);
      const achados = {};
      for (const m of xml.matchAll(/<button\s[^>]*>/g)) {
        const id = m[0].match(/name="(\d+)"/)?.[1];
        const estado = m[0].match(/x_studio_validacao == '([a-z_]+)'/)?.[1];
        if (id && m[0].includes('type="action"') && estado) achados[estado] = id;
      }
      return achados;
    };

    const noKanban = lerBotoes('x_devolucao.kanban.679.Default_kanban_view_for_ir.model_447_.xml');
    const noForm   = lerBotoes('x_devolucao.form.608.Odoo_Studio_Default_form_view_for_x_devolucao_customization.xml');

    if (!noKanban || !noForm) {
      falhas++;
      console.log('❌ não achei uma das views de devolução para comparar os botões');
    } else if (!Object.keys(noKanban).length) {
      // Ainda não instalado: o kanban traz o marcador. Nada a comparar.
      console.log('✅ (botões ainda não instalados — nada a comparar entre form e kanban)');
    } else {
      const k = JSON.stringify(noKanban, Object.keys(noKanban).sort());
      const f = JSON.stringify(noForm, Object.keys(noKanban).sort());
      const ok = k === f;
      if (!ok) falhas++;
      console.log(`${ok ? '✅' : '❌'} formulário e kanban citam as mesmas ações`
        + (ok ? ` (${Object.values(noKanban).join(' e ')})` : `\n     kanban ${k}\n     form   ${f}`));
    }
  }
}

console.log('\n' + '─'.repeat(64));
console.log('⏱️  O escalonamento do disparo de lembretes (BL-73)\n');

// ─────────────────────────────────────────────────────────────────────────
// O que este bloco protege é um modo de falha SILENCIOSO. Errar aqui não
// gera exceção nenhuma: gera lembrete que não sai, ou rajada que sai toda de
// uma vez. Nos dois casos o log diz "terminou sem enviar" ou "enviou 500", e
// nenhum dos dois parece errado sozinho.
//
// Por isso cada caso abaixo fixa o RELÓGIO e a RESPOSTA DO ODOO e afirma o
// número exato de mensagens. Nada vai para a rede.
{
  const fonteConfig = lerTexto(path.join(RAIZ, 'Config.gs'));
  const fonteNotif  = lerTexto(path.join(RAIZ, 'NotificacaoHandler.gs'));

  // Um dizimista sintético. `dia` 1 garante que o dia de notificação (dia+2,
  // teto 28) já passou na data fixada abaixo.
  const gente = (n) => Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    x_name: `Dizimista ${i + 1}`,
    x_studio_partner_phone: `55869000000${(i % 10)}`,
    x_studio_value: 50,
    x_studio_dia_preferido: 1
  }));

  /**
   * Roda executarNotificacoesDiarias() inteira contra stubs.
   * @returns {{enviados, contagens, ordem}}
   */
  const rodar = ({ hora, parametros = {}, dizimistas = gente(5), erroParametros = false }) => {
    const enviados = [];
    const contagens = [];   // toda chamada a OdooService.count
    const criados = [];     // x_notificacao_log gravados
    const buscas = [];      // toda chamada a searchRead

    const respostaOk = {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ messages: [{ id: 'wamid.T' }] })
    };

    const ctx = {
      console: { log() {}, warn() {}, error() {} },
      TIMEZONE: 'America/Fortaleza',
      Utilities: {
        // A rotina pede 'H' para saber a hora e 'yyyy-MM-dd' para a data do
        // log. Um formatDate que ignora o formato faria o teste de janela
        // passar por acidente.
        formatDate: (_d, _tz, fmt) => (fmt === 'H' ? String(hora) : '2026-09-23'),
        sleep() {}
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k) => ({ WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '111' }[k] || null),
          setProperty() {}, getProperties: () => ({})
        })
      },
      CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
      UrlFetchApp: { fetch: () => respostaOk },
      Utils: {
        _post(payload) { enviados.push(payload); return respostaOk; },
        registrarConsumoExterno() {}
      },
      getConfig: () => ({ WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '111' }),
      OdooService: {
        buscarParametros() {
          if (erroParametros) throw new Error('Odoo fora do ar');
          return Object.assign({ x_name: 'Padrão' }, parametros);
        },
        searchRead(modelo, _campos, _dominio, opcoes) {
          buscas.push({ modelo, opcoes });
          return modelo === 'x_dizimista' ? dizimistas.slice() : [];
        },
        // Ninguém foi notificado nem devolveu — todo candidato é elegível.
        count(modelo, dominio) { contagens.push({ modelo, dominio }); return 0; },
        create(modelo, dados) { criados.push({ modelo, dados }); return criados.length; }
      }
    };
    vm.createContext(ctx);
    vm.runInContext(
      PLATAFORMA + '\n;\n' + fonteConfig + '\n;\n' + fonteNotif + '\n;\nexecutarNotificacoesDiarias();',
      ctx, { filename: 'NotificacaoHandler.gs' }
    );

    return {
      enviados,
      contagens,
      criados,
      buscas,
      ordem: enviados.map((p) => p.template.components[0].parameters[0].text)
    };
  };

  const casos = [
    // ── A janela ──────────────────────────────────────────────────────────
    { nome: '8h (antes da janela padrão) não envia nada',
      entrada: { hora: 8 }, envios: 0 },
    { nome: '9h (primeiro degrau) envia',
      entrada: { hora: 9 }, envios: 5 },
    { nome: '17h é EXCLUSIVO — a hora do fim não dispara',
      entrada: { hora: 17, parametros: { x_studio_notif_intervalo: 1 } }, envios: 0 },
    { nome: '3h da madrugada não envia nada',
      entrada: { hora: 3 }, envios: 0 },

    // ── O degrau: o que o BL-73 acrescentou ───────────────────────────────
    // 10h está DENTRO da janela 9–17 e mesmo assim não dispara, porque o
    // intervalo é 2h. Sem esta regra o acionador horário mandaria 24 lotes.
    { nome: '10h está na janela mas não é degrau (intervalo 2h)',
      entrada: { hora: 10 }, envios: 0 },
    { nome: '11h, 13h e 15h são degraus',
      entrada: { hora: 13 }, envios: 5 },
    { nome: 'intervalo 1h faz toda hora da janela ser degrau',
      entrada: { hora: 10, parametros: { x_studio_notif_intervalo: 1 } }, envios: 5 },
    { nome: 'início 10h desloca os degraus (10h dispara, 11h não)',
      entrada: { hora: 11, parametros: { x_studio_notif_hora_inicio: 10 } }, envios: 0 },

    // ── O lote ────────────────────────────────────────────────────────────
    { nome: '50 elegíveis, lote padrão 20 → sai 20',
      entrada: { hora: 9, dizimistas: gente(50) }, envios: 20 },
    { nome: 'lote configurado em 3 → saem 3',
      entrada: { hora: 9, dizimistas: gente(50), parametros: { x_studio_notif_lote: 3 } },
      envios: 3 },
    // O teto tem que PARAR a seleção, não cortar o resultado: cada candidato
    // custa DUAS consultas ao Odoo. Filtrar 500 para enviar 20 gastaria ~1000
    // RPCs e estouraria o tempo de execução do Apps Script — com o log
    // dizendo "20 enviados", que é exatamente o que se esperava ver.
    { nome: 'o teto interrompe a seleção (não consulta os 50 no Odoo)',
      entrada: { hora: 9, dizimistas: gente(50), parametros: { x_studio_notif_lote: 3 } },
      envios: 3,
      confere: ({ contagens }) => (contagens.length <= 3 * 2
        ? null
        : `fez ${contagens.length} consultas de histórico para um lote de 3 — ` +
          `o teto virou corte no fim em vez de parada`) },
    { nome: 'menos gente que o lote envia todo mundo',
      entrada: { hora: 9, dizimistas: gente(4) }, envios: 4 },

    // ── Os parâmetros fora da faixa ───────────────────────────────────────
    { nome: 'lote 0 cairia no silêncio — volta ao padrão de 20',
      entrada: { hora: 9, dizimistas: gente(50), parametros: { x_studio_notif_lote: 0 } },
      envios: 20 },
    { nome: 'lote 9999 traria a rajada de volta — volta ao padrão de 20',
      entrada: { hora: 9, dizimistas: gente(50), parametros: { x_studio_notif_lote: 9999 } },
      envios: 20 },
    { nome: 'hora inicial 99 não existe — volta ao padrão',
      entrada: { hora: 9, parametros: { x_studio_notif_hora_inicio: 99 } }, envios: 5 },
    { nome: 'campo em branco (false, como o Odoo devolve) usa o padrão',
      entrada: { hora: 9, parametros: { x_studio_notif_lote: false, x_studio_notif_hora_inicio: false } },
      envios: 5 },
    { nome: 'texto no campo inteiro não derruba o disparo',
      entrada: { hora: 9, parametros: { x_studio_notif_lote: 'vinte' } }, envios: 5 },
    // Cada número sozinho é válido; juntos fecham a janela e o lembrete nunca
    // mais sai — em silêncio, que é o jeito ruim de quebrar.
    { nome: 'janela invertida (18h–10h) volta ao padrão em vez de calar',
      entrada: { hora: 9, parametros: { x_studio_notif_hora_inicio: 18, x_studio_notif_hora_fim: 10 } },
      envios: 5 },
    { nome: 'janela de largura zero (9h–9h) volta ao padrão',
      entrada: { hora: 9, parametros: { x_studio_notif_hora_inicio: 9, x_studio_notif_hora_fim: 9 } },
      envios: 5 },

    // ── O Odoo fora do ar ─────────────────────────────────────────────────
    // Instabilidade de rede às 9h não pode suprimir o lembrete do dia.
    { nome: 'x_parametros ilegível não impede o disparo (usa o padrão)',
      entrada: { hora: 9, erroParametros: true }, envios: 5 },
    { nome: 'x_parametros ilegível ainda respeita a janela (3h não envia)',
      entrada: { hora: 3, erroParametros: true }, envios: 0 },

    // ── A fila anda ───────────────────────────────────────────────────────
    // A ordem por dia_preferido é o que garante que quem venceu primeiro é
    // notificado primeiro. Sem ela o lote seria arbitrário e a mesma gente
    // poderia ficar sempre no fim.
    { nome: 'a busca pede ordem por dia preferido',
      entrada: { hora: 9 }, envios: 5,
      confere: ({ buscas }) => {
        const b = buscas.find((x) => x.modelo === 'x_dizimista');
        const ordem = b && b.opcoes && b.opcoes.order;
        return /x_studio_dia_preferido/.test(ordem || '')
          ? null
          : `searchRead de x_dizimista sem ordem por dia preferido (order=${ordem})`;
      } },
    { nome: 'cada envio grava um log de notificação',
      entrada: { hora: 9, dizimistas: gente(50), parametros: { x_studio_notif_lote: 3 } },
      envios: 3,
      confere: ({ criados }) => (criados.length === 3
        ? null
        : `gravou ${criados.length} logs para 3 envios — a deduplicação depende disso`) },
  ];

  for (const caso of casos) {
    let erro = null;
    let saida = null;
    try {
      saida = rodar(caso.entrada);
      if (saida.enviados.length !== caso.envios) {
        erro = `enviou ${saida.enviados.length}, esperava ${caso.envios}`;
      } else if (caso.confere) {
        erro = caso.confere(saida);
      }
    } catch (e) {
      erro = `estourou: ${e.message}`;
    }
    if (erro) falhas++;
    console.log(`${erro ? '❌' : '✅'} ${caso.nome}${erro ? ' — ' + erro : ''}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// A mesma decisão escrita duas vezes: os padrões e as faixas vivem em
// Config.gs (que o bot usa) e no instalador .mjs (cuja descrição é o ÚNICO
// lugar onde a paróquia lê a faixa antes de digitar um número). Divergir é
// pior que não documentar: alguém digitaria 300 porque o instalador disse que
// podia, e o bot voltaria calado para 20.
{
  const cfg = lerTexto(path.join(RAIZ, 'Config.gs'));
  const mjs = lerTexto(
    path.join(RAIZ, 'ferramentas', 'instalar-escalonamento-notificacao.mjs'));

  const doCampo = {
    horaInicio:     'x_studio_notif_hora_inicio',
    horaFim:        'x_studio_notif_hora_fim',
    intervaloHoras: 'x_studio_notif_intervalo',
    lote:           'x_studio_notif_lote'
  };

  // `const` no topo de um script não vira propriedade do contexto — por isso
  // o trecho termina devolvendo os dois objetos explicitamente.
  const ctx = {};
  vm.createContext(ctx);
  const doCodigo = vm.runInContext(
    cfg.match(/const NOTIFICACAO_PADRAO = \{[\s\S]*?\};/)[0] + '\n' +
    cfg.match(/const NOTIFICACAO_LIMITES = \{[\s\S]*?\};/)[0] + '\n' +
    '({ padrao: NOTIFICACAO_PADRAO, limites: NOTIFICACAO_LIMITES });',
    ctx);

  let divergencias = 0;
  for (const [chave, campo] of Object.entries(doCampo)) {
    const bloco = mjs.match(
      new RegExp(`\\{\\s*nome: '${campo}'[\\s\\S]*?\\},\\n`))?.[0];
    if (!bloco) {
      divergencias++;
      console.log(`❌ ${campo} não aparece no instalador`);
      continue;
    }
    const num = (k) => Number(bloco.match(new RegExp(`${k}:\\s*(-?\\d+)`))?.[1]);
    const esperado = {
      padrao: doCodigo.padrao[chave],
      min: doCodigo.limites[chave].min,
      max: doCodigo.limites[chave].max
    };
    for (const k of ['padrao', 'min', 'max']) {
      if (num(k) !== esperado[k]) {
        divergencias++;
        console.log(`❌ ${campo}: instalador diz ${k}=${num(k)}, Config.gs diz ${esperado[k]}`);
      }
    }
  }
  falhas += divergencias;
  if (!divergencias) {
    console.log('✅ padrões e faixas batem entre Config.gs e o instalador');
  }
}

// ─────────────────────────────────────────────────────────────────────────
// O acionador TEM QUE continuar de hora em hora. Se alguém "otimizar" para
// everyHours(2), o intervalo volta a morar no Apps Script e mudá-lo no Odoo
// deixa de ter efeito — sem erro nenhum, só com a configuração virando enfeite.
//
// Desde a Fase 1 do BL-74 o pedido passa pela Plataforma — então são dois
// elos: o handler pede 1 hora, e a fachada repassa o número sem mexer nele.
{
  const fonte = lerTexto(path.join(RAIZ, 'NotificacaoHandler.gs'));
  const m = fonte.match(/aCadaHoras\(\s*'executarNotificacoesDiarias'\s*,\s*(\d+)\s*\)/);
  const repassa = /aCadaHoras:\s*\(funcao, horas\)\s*=>[^;]*\.everyHours\(horas\)/.test(PLATAFORMA);
  const ok = m && m[1] === '1' && repassa;
  if (!ok) falhas++;
  console.log(`${ok ? '✅' : '❌'} o acionador acorda de hora em hora`
    + (ok ? ' (o intervalo real vem de x_parametros)'
          : !repassa ? ' — a Plataforma não repassa as horas ao everyHours'
          : ` — aCadaHoras(${m ? m[1] : '?'}) tira o intervalo do Odoo`));
}

console.log('\n' + '─'.repeat(64));
console.log('🗂️  Teto de 50 propriedades do editor (BL-75)\n');

// ─────────────────────────────────────────────────────────────────────────
// A pane não foi vazamento: a poda automática sempre funcionou. Foi ARITMÉTICA
// — a retenção estava dimensionada muito acima de qualquer leitor, e o regime
// permanente ficava em ~120 propriedades contra um teto de INTERFACE de 50.
// Acima dele a lista do editor vira somente leitura e se perde a tela de
// configuração inteira: não dá para trocar ODOO_API_KEY nem nada.
//
// Nada no código dizia esse número. Esta verificação diz: calcula o regime
// permanente a partir das constantes e reprova se ele voltar a passar do teto.
{
  const fonte = lerTexto(path.join(RAIZ, 'Utils.gs'));
  const num = (nome) => {
    const m = fonte.match(new RegExp(nome + ':\\s*(\\d+)'));
    return m ? Number(m[1]) : null;
  };

  const shards = num('URLFETCH_SHARDS');
  const dias   = num('URLFETCH_DIAS_GUARDADOS');
  const meses  = num('MSG_MESES_GUARDADOS');

  // Chaves de configuração que o código lê. É o piso: elas nunca são podadas.
  const config = new Set();
  for (const arq of fs.readdirSync(RAIZ).filter(f => f.endsWith('.gs'))) {
    const src = lerTexto(path.join(RAIZ, arq));
    for (const m of src.matchAll(/getProperty\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g)) {
      config.add(m[1]);
    }
  }

  const TETO = 50;
  // Folga para o que é transitório e não dá para contar daqui: sessões de
  // cadastro abertas, media_id, números em freio de taxa.
  const FOLGA = 6;

  const contadores = (dias * shards) + (meses * 2 * shards);
  const regime = contadores + config.size + FOLGA;

  const casos = [
    { nome: 'as três constantes de retenção existem',
      ok: shards !== null && dias !== null && meses !== null,
      detalhe: `shards=${shards} dias=${dias} meses=${meses}` },
    { nome: `regime permanente cabe nas ${TETO} propriedades da interface`,
      ok: regime <= TETO,
      detalhe: `${contadores} contador(es) + ${config.size} de config + ${FOLGA} de folga = ${regime}` },
    // Se alguém "melhorar" a precisão voltando a 5 shards ou 6 meses, o número
    // estoura de novo — e o sintoma só aparece semanas depois, no editor.
    { nome: 'a poda usa a constante, não um 7 literal',
      ok: /URLFETCH_DIAS_GUARDADOS \* 86400000/.test(fonte),
      detalhe: 'corte do urlfetch precisa sair de URLFETCH_DIAS_GUARDADOS' },
  ];

  for (const c of casos) {
    if (!c.ok) falhas++;
    console.log(`${c.ok ? '✅' : '❌'} ${c.nome} — ${c.detalhe}`);
  }

  // A poda manual não pode encostar em nada que não seja contador. Trocar a
  // pane da tela por perda de ODOO_API_KEY seria um negócio muito pior.
  {
    const setup = lerTexto(path.join(RAIZ, 'Setup.gs'));
    const corpo = setup.slice(setup.indexOf('function podarContadores()'));
    const fim   = corpo.indexOf('\nfunction ');
    const podar = fim > 0 ? corpo.slice(0, fim) : corpo;

    // As duas guardas de prefixo têm de estar lá, e toda chave apagada precisa
    // ter passado por uma delas: o `apagar.push` só pode acontecer dentro de um
    // ramo que já conferiu o prefixo.
    const temGuarda = /indexOf\(Utils\.URLFETCH_PREFIXO\) === 0/.test(podar)
                   && /indexOf\(Utils\.MSG_PREFIXO\) === 0/.test(podar);
    const pushes = (podar.match(/apagar\.push\(/g) || []).length;
    const ok = temGuarda && pushes === 2;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} podarContadores só apaga chave com prefixo de contador`
      + (ok ? '' : ` — ${pushes} ponto(s) de exclusão, guardas=${temGuarda}: risco de apagar configuração`));
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🔐 O verificador do usuário do bot (BL-17)\n');

// ─────────────────────────────────────────────────────────────────────────
// Este script existe para PROVAR que o bot deixou de ser administrador. Um
// erro nele não aparece como erro: aparece como "está tudo certo". Já
// aconteceu duas vezes — `check_access_rights`, que não existe mais nesta
// versão, e a busca do grupo de admin por nome em inglês num Odoo em
// português. As duas dariam falso OK.
{
  const bruto = lerTexto(
    path.join(RAIZ, 'ferramentas', 'instalar-usuario-bot.mjs'));

  // Os comentários deste script CITAM o código errado de propósito, ao
  // explicar por que ele foi trocado. Sem tirar comentário, a busca por
  // "não pode conter X" acusa a própria explicação de X — foi o que
  // aconteceu ao escrever esta verificação. Só o código executável conta.
  const fonte = bruto.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');

  const casos = [
    // res.groups.name é TRADUZIDO. Casar por nome só funciona em inglês.
    { nome: 'grupo de administrador é resolvido por XML ID, não por nome traduzido',
      ok: /ir\.model\.data/.test(fonte)
       && /group_system/.test(fonte)
       && !/name'\s*,\s*'ilike'\s*,\s*'Settings'/.test(fonte) },
    // group_system sozinho não cobre quem administra direitos de acesso.
    { nome: 'cobre também base.group_erp_manager',
      ok: /group_erp_manager/.test(fonte) },
    // has_access existe na saas-19.3; check_access_rights não.
    { nome: 'usa has_access, não o check_access_rights que sumiu',
      ok: /has_access/.test(fonte) && !/check_access_rights'/.test(fonte) },
    // Falhar em resolver os XML IDs não pode passar como "sem administrador".
    { nome: 'não achar os XML IDs avisa, em vez de calar',
      ok: /!dados\.length/.test(fonte) },
    // Tirar acesso por script tranca gente para fora — é passo manual.
    { nome: 'não remove ninguém de grupo por script',
      ok: !/groups_id:\s*\[\[\s*3\s*,/.test(fonte) },
    // res.partner com escrita é o PISO de base.group_user: todo usuário
    // interno tem. Contá-lo como sobra acusaria "ainda é administrador" em
    // cima de um usuário corretamente limitado — e alarme falso gasta o
    // alarme: na próxima sobra de verdade, ninguém olha.
    { nome: 'o piso do usuário interno não é contado como sobra',
      ok: /Piso do usuário interno/.test(fonte)
       && !/\[\s*'res\.partner',\s*'ir\.model\.fields'/.test(fonte) },
    // Estava na MATRIZ com write:0 E na lista de proibidos: a mesma falha
    // entrava duas vezes no total.
    { nome: 'ir.model.fields não é verificado em duplicidade',
      ok: (fonte.match(/'ir\.model\.fields'/g) || []).length === 1 },
    // Um uid inexistente recebia ✅ e exit 0. A conferência de credencial é o
    // que separa "não pode" de "não conectou".
    { nome: 'confere a credencial antes de montar a matriz',
      ok: /AccessDenied/.test(fonte) && /NÃO EXISTE/.test(fonte) },
    // Erro que não é AccessError vira null, nunca string: string comparada
    // com booleano é sempre diferente, e virava FALTA/SOBRA.
    { nome: 'resposta desconhecida é null, não string de erro',
      ok: /indeterminado/.test(fonte) && !/return `erro: /.test(fonte) },
    // Era `w !== true`, então erro passava como "ok" — a checagem de
    // segurança aprovava justamente quando não sabia.
    { nome: 'na lista de administrador, só false é aprovação',
      ok: /w === false \? '· ok'/.test(fonte) },
    // process.exit(faltando ? 1 : 0) ignorava sobrando: um usuário AINDA
    // ADMINISTRADOR saía com zero, e passaria em qualquer CI.
    { nome: 'sobra e indeterminado também derrubam o código de saída',
      ok: /(?:process\.exit|await sair)\(faltando \|\| sobraNoBot \|\| sobraDeAdmin \|\| indeterminado/.test(fonte) },
    // Sobra por ACL aditiva NÃO é poder de administrador, e dizer que é manda
    // a pessoa procurar em Administração quando o problema está em
    // ir.model.access. Os dois contadores têm de ser separados.
    { nome: 'sobra nos modelos do bot é distinguida de poder de administrador',
      ok: /sobraNoBot/.test(fonte) && /sobraDeAdmin/.test(fonte)
       && /NÃO é poder de administrador/.test(fonte) },
    // Saber QUE sobra sem saber DE ONDE não é acionável.
    { nome: 'existe modo --explicar apontando a regra culpada',
      ok: /--explicar/.test(fonte) && /ir\.model\.access/.test(fonte) },
    // ir.model.access.model_id volta como [id, RÓTULO amigável]. Agrupar pelo
    // rótulo casaria com nada — mesma armadilha do grupo de admin por nome.
    { nome: '--explicar resolve o nome técnico do modelo, não o rótulo',
      ok: /buscar\('ir\.model',\s*\[\['id', 'in', ids\]\]/.test(fonte) },
    // O call_kw do Odoo consome args[0] como lista de ids em todo método que
    // não é @api.model. Chamando `[op]`, a operação virava os ids e o Odoo
    // recusava as 39 perguntas. Tem de ser `[[], op]`.
    // res.users.groups_id virou group_ids na saas-19.3 (e all_group_ids para
    // os implicados). Conferido em odoo/addons/base/models/res_users.py:248.
    { nome: 'usa group_ids, não o groups_id que sumiu na saas-19.3',
      ok: !/\bgroups_id\b/.test(fonte) && /all_group_ids/.test(fonte) },
    // Grupo do Odoo IMPLICA outros: quem está num grupo que implica
    // base.group_system é admin sem ter group_system na lista explícita, e
    // uma ACL num grupo implicado também alcança o usuário.
    { nome: 'pertencimento a grupo olha os implicados',
      ok: /u\.all_group_ids\.includes/.test(fonte) },
    // Mas a GRAVAÇÃO tem de ir no explícito — all_group_ids é computed.
    { nome: 'entra no grupo gravando o campo explícito',
      ok: /group_ids: \[\[4, grupoId\]\]/.test(fonte) },
    // res_users write em base.group_user É DE FÁBRICA no Odoo
    // (base/security/ir.model.access.csv: ...,base.group_user,1,1,0,0) e é o
    // que permite a cada um editar as próprias preferências. Exigir 0 gerava
    // achado que ninguém pode resolver.
    { nome: 'res.users write é tratado como piso, não como achado',
      ok: /read: 1, write: null/.test(fonte) },
    // --restringir mexe na permissão de TODOS os internos. Duas travas.
    { nome: '--restringir só toca em modelo x_*',
      ok: /startsWith\('x_'\)/.test(fonte) },
    { nome: '--restringir só toca em regra de base.group_user',
      ok: /'name', '=', 'group_user'/.test(fonte)
       && /\['group_id', '=', gu\.res_id\]/.test(fonte) },
    // Tirar write de group_user só é inócuo se OUTRO grupo não-admin ainda
    // escrever. No caso real, x_parametros tinha regra da Secretaria e
    // x_parametros_line_c498a NÃO — restringir deixaria as linhas só com o
    // administrador, e a Secretaria descobriria ao tentar salvar.
    { nome: '--restringir avisa quando sobra só o administrador',
      ok: /SÓ O ADMINISTRADOR escreve/.test(fonte) && /orfaos/.test(fonte) },
    { nome: 'o aviso de órfão exclui o próprio grupo do bot e o admin',
      ok: /o\.group_id\[1\] !== NOME_GRUPO/.test(fonte)
       && /group_system/.test(fonte) },
    // "Nada foi alterado" saía de QUALQUER falha de rede, inclusive do meio do
    // laço de gravação. Timeout na 3a de 4 regras deixaria 2 no banco e o
    // script juraria que nada mudou.
    { nome: 'falha de rede não promete "nada foi alterado" sem saber',
      ok: /jaGravado/.test(fonte) && /JÁ FORAM FEITAS/.test(fonte)
       && /a falha veio antes de qualquer gravação/.test(fonte) },
    { nome: '--restringir simula por padrão',
      ok: /CONFIG\.restringir/.test(fonte) && /acrescente --aplicar para gravar/.test(fonte) },
    { nome: "has_access é chamado como [[], op], não [op]",
      ok: /has_access',\s*\[\[\],\s*op\]/.test(fonte) },
    // O mock lia args[0] como operação — repetia o engano de quem chamava e
    // por isso o abençoava. Tem de reproduzir o despacho para servir de prova.
    // A prova cobria só --verificar; o groups_id quebrou em --explicar e em
    // --aplicar --login=, modos que ela nem exercitava.
    { nome: 'a prova recusa campo inexistente, como o Odoo',
      ok: (() => {
        const pv = lerTexto(
          path.join(RAIZ, 'ferramentas', 'prova-verificador.mjs'));
        return /Invalid field/.test(pv) && /const CAMPOS = \{/.test(pv)
            && /modo: 'explicar'/.test(pv);
      })() },
    { nome: 'o Odoo de mentira reproduz o despacho do call_kw',
      ok: (() => {
        const pv = lerTexto(
          path.join(RAIZ, 'ferramentas', 'prova-verificador.mjs'));
        return /const \[ids, operacao\] = args/.test(pv)
            && /missing 1 required positional argument/.test(pv);
      })() },
  ];

  for (const c of casos) {
    if (!c.ok) falhas++;
    console.log(`${c.ok ? '✅' : '❌'} ${c.nome}`);
  }

  // Ler o código não pegou nenhuma das quatro falhas deste script — três
  // passaram por revisão. Só executar pega. A prova roda à parte porque sobe
  // servidor e processo filho; aqui só se garante que ela não sumiu.
  const prova = fs.existsSync(path.join(RAIZ, 'ferramentas', 'prova-verificador.mjs'));
  if (!prova) falhas++;
  console.log(`${prova ? '✅' : '❌'} a prova executável existe`
    + (prova ? ' (node ferramentas/prova-verificador.mjs)' : ' — foi apagada'));
}

console.log('\n' + '─'.repeat(64));
console.log('🔑 Todo modelo que o bot toca está na matriz de permissões (BL-17)\n');

// ─────────────────────────────────────────────────────────────────────────
// O `--verificar` prova que as permissões batem com a MATRIZ. Não prova que a
// matriz cobre o que o código usa — e essa é a metade que quebra em produção,
// em silêncio: basta alguém acrescentar um `OdooService.create('x_novo', …)`
// e o bot passa a levar AccessError num caminho que ninguém testa até alguém
// reclamar.
//
// A troca de ODOO_UID vale NA HORA (Script Property lida a cada execução),
// sem `clasp push`. Então uma matriz incompleta quebra a produção antes de
// qualquer deploy — não há janela para perceber.
{
  // `this.` além de `OdooService.`: dentro do próprio OdooService.gs as
  // chamadas são internas. E `\s*` tem de atravessar quebra de linha, porque
  // o nome do modelo costuma vir na linha seguinte ao parêntese — a primeira
  // versão disto não pegava nenhuma das duas coisas e acusou três modelos de
  // "sem uso" que são usados o tempo todo.
  const CHAMADAS = /(?:OdooService|this)\.(?:searchRead|count|create|write|unlink|read|campoExiste|camposExistentes)\(\s*'([a-z_][\w.]*)'/g;

  // Rodam só pelo menu do editor, com credencial de ADMINISTRADOR, e criam
  // schema — a matriz os exclui de propósito (ver comentário da MATRIZ).
  const MANUAIS = new Set(['SetupCamposFamilia.gs', 'SetupCamposOferta.gs']);

  const ignorados = lerTexto(path.join(RAIZ, '.claspignore'))
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  const matriz = lerTexto(
    path.join(RAIZ, 'ferramentas', 'instalar-usuario-bot.mjs'));
  const naMatriz = new Set(
    [...matriz.matchAll(/\{ model: '([^']+)'/g)].map((m) => m[1]));

  const forasteiros = new Map();
  for (const arq of fs.readdirSync(RAIZ).filter((f) => f.endsWith('.gs'))) {
    if (ignorados.includes(arq) || MANUAIS.has(arq)) continue;   // não vai a produção
    const fonte = lerTexto(path.join(RAIZ, arq));
    for (const m of fonte.matchAll(CHAMADAS)) {
      if (!naMatriz.has(m[1])) {
        if (!forasteiros.has(m[1])) forasteiros.set(m[1], []);
        forasteiros.get(m[1]).push(arq);
      }
    }
  }

  if (forasteiros.size) {
    falhas += forasteiros.size;
    for (const [modelo, arqs] of forasteiros) {
      console.log(`❌ ${modelo} é usado em ${[...new Set(arqs)].join(', ')} e NÃO está na matriz`);
      console.log(`   O bot vai levar AccessError ali. Acrescente à MATRIZ de`);
      console.log(`   instalar-usuario-bot.mjs e rode --aplicar de novo.`);
    }
  } else {
    console.log(`✅ ${naMatriz.size} modelos na matriz cobrem todas as chamadas do código de produção`);
  }

  // O caminho contrário também importa, mas é só desperdício, não quebra:
  // permissão concedida a modelo que o código não usa mais.
  const usados = new Set();
  for (const arq of fs.readdirSync(RAIZ).filter((f) => f.endsWith('.gs'))) {
    const fonte = lerTexto(path.join(RAIZ, arq));
    for (const m of fonte.matchAll(CHAMADAS)) usados.add(m[1]);
  }
  const sobrando = [...naMatriz].filter((m) => !usados.has(m));
  if (sobrando.length) {
    console.log(`⚠️  na matriz mas sem uso no código: ${sobrando.join(', ')}`);
    console.log('   Não quebra nada — é permissão a mais. Vale revisar.');
  }
}

console.log('\n' + '─'.repeat(64));
console.log('⚙️  O CI roda o mesmo que você roda (BL-74, Fase 0)\n');

// ─────────────────────────────────────────────────────────────────────────
// O valor da Fase 0 depende de uma coisa só: o CI e a máquina de quem
// desenvolve rodarem A MESMA lista. Se o workflow chamar as suítes por conta
// própria, os dois divergem no primeiro dia em que alguém acrescentar uma — e
// a divergência aparece como "passa aqui, quebra lá".
{
  const wf = path.join(RAIZ, '.github', 'workflows', 'verificacao.yml');
  const entrada = path.join(RAIZ, 'ferramentas', 'verificar-tudo.mjs');

  const casos = [];

  if (!fs.existsSync(wf)) {
    casos.push({ nome: 'o workflow de verificação existe', ok: false });
  } else {
    const y = lerTexto(wf);
    casos.push(
      { nome: 'o workflow existe e roda em pull_request',
        ok: /^on:/m.test(y) && /pull_request/.test(y) },
      { nome: 'o workflow chama verificar-tudo.mjs',
        ok: /node ferramentas\/verificar-tudo\.mjs/.test(y) },
      // Chamar uma suíte direto no YAML é justamente a divergência que a
      // Fase 0 existe para impedir.
      { nome: 'o workflow NÃO chama suíte direto, contornando a entrada',
        ok: !/node ferramentas\/(conta-mensagens|prova-verificador|valida-flow|provar-dominio-filtro)/.test(y) },
      // Sem segredo: nenhuma suíte fala com Odoo, WhatsApp ou Apps Script, e
      // um workflow que pede segredo sem precisar amplia superfície à toa.
      { nome: 'o workflow não recebe segredo nenhum',
        ok: !/secrets\./.test(y) },
    );
  }

  if (!fs.existsSync(entrada)) {
    casos.push({ nome: 'o ponto de entrada existe', ok: false });
  } else {
    const e = lerTexto(entrada);
    const listadas = [...e.matchAll(/arquivo: '([^']+)'/g)].map((m) => m[1]);
    const faltando = listadas.filter((f) => !fs.existsSync(path.join(RAIZ, f)));
    casos.push({
      nome: `as ${listadas.length} suítes listadas existem no disco`,
      ok: listadas.length > 0 && !faltando.length,
      detalhe: faltando.join(', '),
    });
  }

  for (const c of casos) {
    if (!c.ok) falhas++;
    console.log(`${c.ok ? '✅' : '❌'} ${c.nome}${c.detalhe ? ' — falta: ' + c.detalhe : ''}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🧱 A fachada da Plataforma não vaza (BL-74, Fase 1)\n');

// ─────────────────────────────────────────────────────────────────────────
// Para sair do Apps Script, só o Plataforma.gs pode falar com as APIs dele.
// Se um `.gs` do deploy voltar a chamar `CacheService.…` direto, a Fase 2
// (runtime Node) quebra ali — em produção, no dia do corte, e não aqui.
//
// Conta USO (`Nome.`), não menção: comentários e textos de log que explicam o
// CacheService continuam permitidos. Os arquivos cortados pelo .claspignore
// (a suíte de testes do editor) ficam fora: não vão para o runtime novo.
{
  const APIS = ['CacheService', 'PropertiesService', 'UrlFetchApp', 'Utilities',
                'LockService', 'ContentService', 'ScriptApp'];
  const USO = new RegExp(`\\b(${APIS.join('|')})\\s*\\.[A-Za-z]`);
  const ehComentario = (linha) => /^\s*(\/\/|\*|\/\*)/.test(linha);
  const usos = (fonte) => fonte.split('\n')
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => !ehComentario(linha) && USO.test(linha));

  // O detector precisa acusar o que deve e poupar o que deve — senão o verde
  // abaixo não prova nada.
  const detectorOk =
    usos('const c = CacheService.getScriptCache();').length === 1 &&
    usos('  Utilities.sleep(10);').length === 1 &&
    usos('// CacheService.getScriptCache() não lista chaves').length === 0 &&
    usos("Logger.log('o CacheService não lista chaves');").length === 0;

  const ignorados = lerTexto(path.join(RAIZ, '.claspignore'))
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const doDeploy = fs.readdirSync(RAIZ)
    .filter((f) => f.endsWith('.gs') && !ignorados.includes(f) && f !== 'Plataforma.gs');

  const vazamentos = [];
  for (const arq of doDeploy) {
    for (const u of usos(lerTexto(path.join(RAIZ, arq)))) {
      vazamentos.push(`${arq}:${u.n}  ${u.linha.trim().slice(0, 70)}`);
    }
  }

  const casos = [
    { nome: 'o detector acusa uso e poupa comentário e texto', ok: detectorOk },
    // Um diretório vazio ou um .claspignore que corta tudo daria verde por
    // falta de arquivo. 20 é folga abaixo dos 25 de hoje.
    { nome: `a varredura alcança o deploy (${doDeploy.length} arquivos)`, ok: doDeploy.length >= 20 },
    { nome: 'nenhum .gs do deploy fala com o Apps Script fora do Plataforma.gs',
      ok: vazamentos.length === 0 },
    { nome: 'o Plataforma.gs vai para o deploy', ok: !ignorados.includes('Plataforma.gs') },
  ];
  for (const c of casos) {
    if (!c.ok) falhas++;
    console.log(`${c.ok ? '✅' : '❌'} ${c.nome}`);
  }
  vazamentos.forEach((v) => console.log(`     ${v}`));
}

// ─────────────────────────────────────────────────────────────────────────
// O CONTRATO da fachada, executado. Na Fase 1 a troca foi mecânica e o resto
// do harness prova que nada mudou nos fluxos — mas três travas e os gatilhos
// moram em arquivos que nenhum outro cenário carrega (StateManager, Webhook,
// TriggerSessoes). E é este contrato que a implementação Node da Fase 2/3
// terá de cumprir: rodar os mesmos casos contra ela é o critério de troca.
{
  // Um LockService que obedece ao cenário e registra o que lhe pedem.
  const fazLock = (obtem) => {
    const log = [];
    return {
      log,
      LockService: { getScriptLock: () => ({
        waitLock(ms) { log.push(`wait ${ms}`); if (!obtem) throw new Error('timeout (simulado)'); },
        releaseLock() { log.push('release'); }
      }) }
    };
  };

  const carregar = (arquivos, globais, devolve) => {
    const ctx = Object.assign({
      console: { log() {}, warn() {}, error() {} }, Logger: { log() {} }
    }, globais);
    vm.createContext(ctx);
    return vm.runInContext(
      [PLATAFORMA].concat(arquivos.map((a) => lerTexto(path.join(RAIZ, a)))).join('\n;\n') +
      `\n;(${devolve});`, ctx, { filename: 'plataforma-contrato.gs' });
  };

  const casos = [];
  const caso = (nome, fn) => {
    let ok = false, detalhe = '';
    try { const r = fn(); ok = r === true; if (!ok) detalhe = String(r); }
    catch (e) { detalhe = 'lançou: ' + e.message; }
    casos.push({ nome, ok, detalhe });
  };

  // ── Plataforma.trava, isolada ─────────────────────────────────────────
  caso('trava obtida: roda fn, devolve o resultado e libera', () => {
    const L = fazLock(true);
    const P = carregar([], { LockService: L.LockService }, 'Plataforma');
    const r = P.trava.comTrava('k', 1234, () => 'feito');
    return r === 'feito' && L.log.join('|') === 'wait 1234|release' || L.log.join('|');
  });
  caso('fn que lança ainda libera a trava', () => {
    const L = fazLock(true);
    const P = carregar([], { LockService: L.LockService }, 'Plataforma');
    try { P.trava.comTrava('k', 1, () => { throw new Error('x'); }); } catch (e) { /* esperado */ }
    return L.log.includes('release') || L.log.join('|');
  });
  caso('trava negada: quem decide é aoFalhar, e nada é liberado', () => {
    const L = fazLock(false);
    const P = carregar([], { LockService: L.LockService }, 'Plataforma');
    let rodou = false;
    const r = P.trava.comTrava('k', 1, () => { rodou = true; }, () => 'desisti');
    return (r === 'desisti' && !rodou && !L.log.includes('release')) || `r=${r} rodou=${rodou}`;
  });
  caso('trava negada sem aoFalhar: o erro sobe', () => {
    const P = carregar([], { LockService: fazLock(false).LockService }, 'Plataforma');
    try { P.trava.comTrava('k', 1, () => 1); return 'não lançou'; } catch (e) { return true; }
  });

  // ── As três políticas do projeto, nos arquivos reais ──────────────────
  // StateManager: gravar campo do cadastro SEGUE sem trava (perder o campo é pior).
  caso('StateManager._comLock sem trava: grava mesmo assim (BL-20)', () => {
    const L = fazLock(false);
    const cache = {};
    const SM = carregar(['StateManager.gs'], {
      LockService: L.LockService,
      CacheService: { getScriptCache: () => ({
        get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) }
    }, 'StateManager');
    SM.salvarMultiplosCampos('5511999990000', { nome: 'Ana' });
    const dados = JSON.parse(cache['dados_5511999990000'] || '{}');
    return dados.nome === 'Ana' || JSON.stringify(cache);
  });
  // Primeiro contato DESISTE sem trava (duplicar o registro no Odoo é pior).
  caso('StateManager.ehPrimeiroContato sem trava: desiste e não toca o Odoo (BL-23)', () => {
    let tocou = false;
    const SM = carregar(['StateManager.gs'], {
      LockService: fazLock(false).LockService,
      CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
      OdooService: { buscarContatoBot() { tocou = true; }, registrarContatoBot() { tocou = true; } }
    }, 'StateManager');
    return (SM.ehPrimeiroContato('5511999990000') === false && !tocou) || `tocou=${tocou}`;
  });
  caso('StateManager.ehPrimeiroContato com trava: registra e responde true', () => {
    const registrados = [];
    const SM = carregar(['StateManager.gs'], {
      LockService: fazLock(true).LockService,
      CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
      OdooService: { buscarContatoBot: () => null, registrarContatoBot: (n) => registrados.push(n) }
    }, 'StateManager');
    return (SM.ehPrimeiroContato('5511999990000') === true && registrados.length === 1)
      || `registrados=${registrados.length}`;
  });
  // Criar dizimista SEGUE sem trava, mas ainda confere se já existe.
  caso('OdooService.criarDizimista sem trava: ainda confere e cria', () => {
    const OS = carregar(['OdooService.gs'], {
      LockService: fazLock(false).LockService,
      CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) }
    }, 'OdooService');
    let conferiu = false;
    OS.buscarDizimistaPorWhatsapp = () => { conferiu = true; return null; };
    OS._criarDizimista = () => 42;
    return (OS.criarDizimista({ whatsapp: '5511999990000' }) === 42 && conferiu) || `conferiu=${conferiu}`;
  });

  // ── Propriedades: o `true` que apaga tudo não passa ────────────────────
  caso('propriedades.setProperties só mescla, mesmo se pedirem para apagar o resto', () => {
    const chamadas = [];
    const P = carregar([], { PropertiesService: { getScriptProperties: () => ({
      setProperties: (...a) => chamadas.push(a.length) }) } }, 'Plataforma');
    P.propriedades.setProperties({ A: '1' }, true);
    return chamadas.join() === '1' || `argumentos repassados: ${chamadas.join()}`;
  });

  // ── Gatilhos: os dois instaladores, com os números de hoje ────────────
  caso('instalar/remover gatilhos: hora em hora e 5 min, removendo só os seus', () => {
    const existentes = [
      { getHandlerFunction: () => 'executarNotificacoesDiarias' },
      { getHandlerFunction: () => 'verificarSessoesAbandonadas' },
      { getHandlerFunction: () => 'outraCoisa' }
    ];
    const criados = [], apagados = [];
    const construtor = (f) => {
      const t = { f };
      const b = { timeBased: () => b, everyHours: (h) => { t.h = h; return b; },
                  everyMinutes: (m) => { t.m = m; return b; }, create: () => criados.push(t) };
      return b;
    };
    const g = carregar(['NotificacaoHandler.gs', 'TriggerSessoes.gs'], {
      ScriptApp: { newTrigger: construtor, getProjectTriggers: () => existentes,
                   deleteTrigger: (t) => apagados.push(t.getHandlerFunction()) },
      NOTIFICACAO_PADRAO: { horaInicio: 8, horaFim: 20, intervaloHoras: 2, lote: 20 }
    }, '{ instalarTriggerNotificacoes, instalarTriggerSessoes }');
    g.instalarTriggerNotificacoes();
    g.instalarTriggerSessoes();
    const ok = JSON.stringify(criados) ===
      JSON.stringify([{ f: 'executarNotificacoesDiarias', h: 1 }, { f: 'verificarSessoesAbandonadas', m: 5 }])
      && apagados.join() === 'executarNotificacoesDiarias,verificarSessoesAbandonadas';
    return ok || `criados=${JSON.stringify(criados)} apagados=${apagados}`;
  });

  // ── Webhook: o GET de verificação e a recusa sem segredo ──────────────
  caso('doGet responde o desafio e doPost sem segredo recusa', () => {
    const saidas = [];
    const W = carregar(['Webhook.gs'], {
      ContentService: {
        MimeType: { TEXT: 'text/plain' },
        createTextOutput: (c) => { const o = { c, mime: null,
          setMimeType(m) { o.mime = m; return o; } }; saidas.push(o); return o; }
      },
      getConfig: () => ({ VERIFY_TOKEN: 'v' }),
      getWebhookSecret: () => null,
      Utils: { registrarConsumoExterno() {} }
    }, '{ doGet, doPost }');
    const g = W.doGet({ parameter: { 'hub.mode': 'subscribe', 'hub.verify_token': 'v', 'hub.challenge': '42' } });
    const p = W.doPost({ parameter: {}, postData: { contents: '{}' } });
    return (g.c === '42' && p.c === 'Forbidden' && saidas.length === 2) || JSON.stringify(saidas);
  });

  for (const c of casos) {
    if (!c.ok) falhas++;
    console.log(`${c.ok ? '✅' : '❌'} ${c.nome}${c.ok ? '' : '\n     ' + c.detalhe}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🩹 Bugs da revisão de 24/09 (BL-78 a BL-83)\n');

// Cada caso carrega o ARQUIVO REAL com stubs mínimos e prova o conserto. O
// critério para entrar aqui: o caso tem de reprovar no código anterior à
// correção — foi conferido um a um, com o código antigo, ao escrever.
{
  const carregar = (arquivos, globais, devolve) => {
    const ctx = Object.assign({
      console: { log() {}, warn() {}, error() {} }, Logger: { log() {} }
    }, globais);
    vm.createContext(ctx);
    return vm.runInContext(
      [PLATAFORMA, lerTexto(path.join(RAIZ, 'Config.gs'))]
        .concat(arquivos.map((a) => lerTexto(path.join(RAIZ, a)))).join('\n;\n') +
      `\n;(${devolve});`, ctx, { filename: 'revisao-24-09.gs' });
  };

  const casos = [];
  const caso = (nome, fn) => {
    let ok = false, detalhe = '';
    try { const r = fn(); ok = r === true; if (!ok) detalhe = String(r); }
    catch (e) { detalhe = 'lançou: ' + e.message; }
    casos.push({ nome, ok, detalhe });
  };

  // ── BL-78 ──────────────────────────────────────────────────────────────
  caso('BL-78: a marca de mensagem já vista dura 6 h, e a reentrega é ignorada', () => {
    const cache = {}, ttls = {};
    let passou = 0;
    const W = carregar(['Webhook.gs'], {
      CacheService: { getScriptCache: () => ({
        get: (k) => cache[k] || null,
        put: (k, v, t) => { cache[k] = v; ttls[k] = t; } }) },
      // Bloqueado: a mensagem para logo depois da deduplicação — é só ela
      // que interessa aqui, sem arrastar Router, Odoo e WhatsApp.
      Utils: { estaBloqueado: () => { passou++; return true; } }
    }, '_processarMensagemWebhook');
    const msg = { from: '5511999990000', id: 'wamid.REENTREGA', type: 'text', text: { body: 'oi' } };
    W(msg);
    W(msg);
    return (ttls['msg_wamid.REENTREGA'] === 21600 && passou === 1)
      || `ttl=${ttls['msg_wamid.REENTREGA']} processada ${passou}x`;
  });

  // ── BL-79 ──────────────────────────────────────────────────────────────
  // O Router real, com o que ele chama registrando em vez de agir.
  const roteador = (estado) => {
    const r = { enviadas: [], estados: [], menus: 0 };
    r.Router = carregar(['Router.gs'], {
      StateManager: { getEstado: () => estado, setEstado: (f, e) => r.estados.push(e),
                      getCampo: () => undefined },
      Utils: { enviarSimples: (f, t) => r.enviadas.push(t) },
      MenuHandler: { menuPrincipal: () => { r.menus++; r.estados.push('MENU'); } }
    }, 'Router');
    return r;
  };
  caso('BL-79: reação no meio da devolução é ignorada — sem mensagem, estado intacto', () => {
    const r = roteador('AGUARDANDO_COMPROVANTE');
    r.Router.rotear('55', { type: 'reaction', reaction: { emoji: '👍', message_id: 'wamid.X' } });
    return (!r.enviadas.length && !r.estados.length && !r.menus)
      || `enviou ${r.enviadas.length}, estados ${r.estados.join()}`;
  });
  caso('BL-79: figurinha ou áudio no cadastro recebem aviso, e o cadastro continua', () => {
    const erros = [];
    for (const tipo of ['sticker', 'audio', 'video', 'location', 'contacts', 'unsupported']) {
      const r = roteador('AGUARDANDO_NOME');
      r.Router.rotear('55', { type: tipo });
      if (r.enviadas.length !== 1 || r.estados.length || r.menus) {
        erros.push(`${tipo}: ${r.enviadas.length} msg, estados [${r.estados.join()}]`);
      }
    }
    return !erros.length || erros.join('; ');
  });
  // ── BL-80 ──────────────────────────────────────────────────────────────
  caso('BL-80: o código de acesso ao relatório não aparece no log', () => {
    const log = [];
    const grava = (...a) => log.push(a.map(String).join(' '));
    const R = carregar(['Router.gs'], {
      console: { log: grava, warn: grava, error: grava },
      StateManager: { getEstado: () => 'AGUARDANDO_CODIGO_RELATORIO', setEstado() {},
                      getCampo: () => undefined },
      // O destino do código não importa aqui — só o que o Router registrou
      // antes de despachar.
      RelatorioHandler: new Proxy({}, { get: () => () => {} }),
      Utils: new Proxy({}, { get: () => () => {} }),
      MenuHandler: new Proxy({}, { get: () => () => {} })
    }, 'Router');
    R.rotear('55', { type: 'text', text: { body: 'CODIGO-SECRETO-4821' } });
    const vazou = log.filter((l) => l.includes('CODIGO-SECRETO-4821'));
    return (log.length > 0 && !vazou.length) || `vazou: ${vazou[0] || '(log vazio)'}`;
  });

  // ── BL-81 ──────────────────────────────────────────────────────────────
  // RelatorioHandler e Router reais; o Odoo é um mapa de devoluções.
  // `naSessao` imita o que o código anterior guardava em `pendente_devolucao_id`
  // — sem isso os casos passariam no código antigo só por achar a sessão vazia.
  const baixas = (acesso, devolucoes, naSessao) => {
    const r = { gravou: [], enviadas: [], botoes: [] };
    const globais = {
      StateManager: { getCampo: (f, c) => (c === 'relatorio_acesso' ? acesso
                        : c === 'pendente_devolucao_id' ? naSessao : undefined),
                      setEstado() {}, salvarMultiplosCampos() {}, salvarCampoEMudarEstado() {} },
      OdooService: {
        buscarDevolucaoDetalhada: (id) => devolucoes[id] || null,
        atualizarStatusDevolucao: (id, st) => r.gravou.push(`${id}:${st}`),
        listarPendentes: () => [], listarComunidades: () => []
      },
      Utils: new Proxy({
        enviarSimples: (f, t) => r.enviadas.push(t),
        enviarMenu: (f, t, b) => { r.enviadas.push(t); r.botoes.push(...(b || []).map((x) => x.id)); }
      }, { get: (o, k) => o[k] || (() => {}) }),
      MenuHandler: new Proxy({}, { get: () => () => {} }),
      // O detalhe espera entre as mensagens; sem isto ele lançaria no
      // `dormir` e os casos de "não abriu" passariam por acidente.
      Utilities: { sleep() {} }
    };
    const m = carregar(['RelatorioHandler.gs', 'Router.gs'], globais, '{ RelatorioHandler, Router }');
    r.R = m.RelatorioHandler; r.Router = m.Router;
    return r;
  };
  const COORD_1 = { tipoAcesso: 'coordenador', comunidadeId: 1, comunidadeNome: 'Matriz' };
  const pend = (id, com, status = 'Pendente') => ({ id, x_studio_status: status,
    x_studio_comunidade: [com, 'C' + com], x_studio_dizimista: [9, 'Ana'], x_studio_value: 50 });

  caso('BL-81: o botão carrega a devolução — tocar na mensagem antiga baixa a antiga', () => {
    const r = baixas(COORD_1, { 41: pend(41, 1), 42: pend(42, 1) });
    // Abriu A (41), depois B (42); tocou "Confirmar" na mensagem de A.
    r.R.processarSelecaoPendente('55', 'pend_41');
    r.R.processarSelecaoPendente('55', 'pend_42');
    const doA = r.botoes.find((b) => b.startsWith('btn_confirmar_baixa_41'));
    if (!doA) return `botões enviados: ${r.botoes.join()}`;
    r.Router.rotear('55', { type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: doA } } });
    return r.gravou.join() === '41:Confirmado' || `gravou ${r.gravou.join() || 'nada'}`;
  });
  caso('BL-81: não dá baixa em devolução que já saiu de Pendente', () => {
    const r = baixas(COORD_1, { 42: pend(42, 1, 'Rejeitado') }, 42);
    r.R.confirmarBaixa('55', 42);
    return !r.gravou.length || `gravou ${r.gravou.join()}`;
  });
  caso('BL-81: coordenador não abre nem dá baixa em outra comunidade', () => {
    const r = baixas(COORD_1, { 77: pend(77, 2) }, 77);
    r.R.processarSelecaoPendente('55', 'pend_77');
    r.R.rejeitarBaixa('55', 77);
    return (!r.gravou.length && !r.botoes.some((b) => b.includes('baixa')))
      || `gravou ${r.gravou.join()} botões ${r.botoes.join()}`;
  });
  caso('BL-81: o admin dá baixa em qualquer comunidade', () => {
    const r = baixas({ tipoAcesso: 'admin' }, { 77: pend(77, 2) });
    r.R.confirmarBaixa('55', 77);
    return r.gravou.join() === '77:Confirmado' || `gravou ${r.gravou.join() || 'nada'}`;
  });
  caso('BL-81: botão antigo, sem id, não age — reabre a lista', () => {
    const r = baixas(COORD_1, { 42: pend(42, 1) }, 42);
    r.Router.rotear('55', { type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'btn_confirmar_baixa' } } });
    return (!r.gravou.length && r.enviadas.some((t) => /mensagem antiga/.test(t)))
      || `gravou ${r.gravou.join()} · ${r.enviadas[0]}`;
  });

  caso('BL-79: subtipo interativo desconhecido recebe resposta, não silêncio', () => {
    const r = roteador('MENU');
    r.Router.rotear('55', { type: 'interactive', interactive: { type: 'call_permission_reply' } });
    return (r.enviadas.length === 1 && !r.estados.length) || `enviou ${r.enviadas.length}`;
  });

  for (const c of casos) {
    if (!c.ok) falhas++;
    console.log(`${c.ok ? '✅' : '❌'} ${c.nome}${c.ok ? '' : '\n     ' + c.detalhe}`);
  }
}

console.log('\n' + '─'.repeat(64));
if (falhas) {
  console.log(`❌ ${falhas} verificação(ões) fora do esperado.`);
  console.log('   Ou o código mudou e Documentação/FLUXOS.md precisa acompanhar,');
  console.log('   ou voltou uma mensagem que tinha sido cortada.\n');
  process.exit(1);
}
console.log('✅ Tudo conforme Documentação/FLUXOS.md.\n');
