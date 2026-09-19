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
const registra = (tipo, texto) => enviadas.push({ tipo, texto: String(texto || '') });

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
    enviarFlowMembro: () => false
  };

  const ctx = {
    StateManager, FlowHandler,
    // OCR: um comprovante legítimo, com a MESMA chave da comunidade — assim o
    // caminho exercitado é o do sucesso conferido (BL-26), não o de erro.
    VisionService: {
      analisarComprovante: () => ({
        valor: 50, data: '12/08/2026', tipo: 'PIX',
        banco: 'Banco do Brasil', chavePix: 'pix@paroquia.org'
      }),
      analisarPDF: () => null,
      validarComprovante: () => ({ ehComprovante: true })
    },
    console: { log() {}, warn() {}, error() {} },
    Utilities: { sleep() {}, base64Encode: () => 'BASE64' },
    Logger: { log() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
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
    'TestePixNativo.gs'
  ];
  const fontes = ARQUIVOS
    .map(a => fs.readFileSync(path.join(RAIZ, a), 'utf8'))
    .join('\n;\n');

  const mod = vm.runInContext(
    fontes + '\n;({ Utils, OdooService, MediaService, MenuHandler, CadastroHandler, ' +
             'DevolucaoHandler, ComprovanteHandler, ESTADOS, tipoDaChavePix });',
    ctx,
    { filename: 'bot.gs' }
  );

  // ── A borda: só o que sai do processo ──────────────────────────────────────
  Object.assign(mod.Utils, {
    enviarSimples:      (to, t)         => registra('texto',  t),
    enviarComBotaoMenu: (to, t)         => registra('texto',  t),
    enviarConfirmar:    (to, t)         => registra('botoes', t),
    enviarMenu:         (to, t, botoes) => registra('menu', t + ' [' + (botoes || []).map(b => b.id).join(', ') + ']'),
    enviarLista:        (to, t)         => registra('lista',  t),
    // Indicador de digitação: NÃO é mensagem. Registrado à parte justamente
    // para o teste provar que ele não entra na conta.
    sinalizarProcessando: () => {
      gratis.push('digitando');
      return cenario.digitandoFunciona !== false;
    },
    // A API do QR Code. `getContent` alimenta o base64Encode acima.
    fetchComRetry: () => ({ getResponseCode: () => 200, getContent: () => 'qr', getContentText: () => '' })
  });
  // formatarValor, formatarDataOdoo, variantesNumeroBR e o resto continuam reais.

  Object.assign(mod.MediaService, {
    enviarImagemFixa:   (to, id, legenda)  => registra('imagem+legenda', legenda),
    enviarImagemBase64: (to, b64, caption) => { registra('imagem+legenda', caption); return {}; },
    baixarArquivo:      () => ({ base64: 'BASE64DOCOMPROVANTE' })
  });

  // OdooService: trocado no nível do RPC, para que `criarDizimista` — onde mora
  // a guarda contra o cadastro duplicado (BL-39) — rode de verdade.
  Object.assign(mod.OdooService, {
    searchRead: (modelo, campos, dominio) => {
      if (cenario.odooForaDoAr) throw new Error('connection refused (simulado)');
      if (modelo === 'x_dizimista') {
        const porTelefone = (dominio || []).some(d => d[0] === 'x_studio_partner_phone');
        if (porTelefone) return cenario.dizimista ? [cenario.dizimista] : [];
        return cenario.familia || (cenario.dizimista ? [cenario.dizimista] : []);
      }
      if (modelo === 'x_devolucao') return cenario.devolucoes || [];
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
    devolucoesDoMes:    () => cenario.devolucoesDoMes || [],
    registrarDevolucao: () => 123,
    salvarFotoDizimista: () => {}
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
    nome: 'Primeiro contato — número NOVO, formulário ligado',
    cenario: { dizimista: null, temAvatar: true, flowLigado: true },
    roda: ctx => { ctx.MenuHandler.boasVindas('55'); ctx.MenuHandler.entrada('55'); },
    esperado: 2,
    porque: 'boas-vindas (imagem com legenda) + o formulário. Eram 4.'
  },
  {
    nome: 'Primeiro contato — número NOVO, formulário desligado',
    cenario: { dizimista: null, temAvatar: true, flowLigado: false },
    roda: ctx => { ctx.MenuHandler.boasVindas('55'); ctx.MenuHandler.entrada('55'); },
    esperado: 2,
    porque: 'boas-vindas + a primeira pergunta do cadastro por conversa'
  },
  {
    nome: 'Primeiro contato — número JÁ CADASTRADO',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => { ctx.MenuHandler.boasVindas('55'); ctx.MenuHandler.entrada('55'); },
    esperado: 2,
    porque: 'boas-vindas + menu de 3 opções. Eram 4, com identificação no meio.'
  },
  {
    nome: 'Primeiro contato — sem avatar no Odoo',
    cenario: { dizimista: DIZIMISTA, temAvatar: false, flowLigado: true },
    roda: ctx => { ctx.MenuHandler.boasVindas('55'); ctx.MenuHandler.entrada('55'); },
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
    esperado: 2,
    porque: 'QR com os dados na legenda + copia-e-cola sozinho. Eram 3.'
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
      const esperado = 'btn_devolver_dizimo, btn_adicionar_membro, btn_secretaria';
      return ids === esperado ? null : `botões "${ids}", esperado "${esperado}"`;
    }
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
    nome: 'A legenda do QR carrega os dados de pagamento inteiros',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
    roda: ctx => ctx.DevolucaoHandler.iniciarDevolucao('55'),
    confere: msgs => {
      const legenda = (msgs.find(m => m.tipo === 'imagem+legenda') || {}).texto || '';
      const faltam = ['Banco do Brasil', 'Paróquia', 'pix@paroquia.org', 'comprovante']
        .filter(t => !legenda.includes(t));
      return faltam.length ? `faltou na legenda: ${faltam.join(', ')}` : null;
    }
  },
  {
    nome: 'O copia-e-cola continua sozinho e sem formatação',
    cenario: { dizimista: DIZIMISTA, temAvatar: true, flowLigado: true },
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
      const legenda = (msgs.find(m => m.tipo === 'imagem+legenda') || {}).texto || '';
      return legenda.includes('última devolução') && legenda.includes('histórico')
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
      const faltam = ['btn_devolver_dizimo', 'btn_adicionar_membro', 'btn_secretaria']
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
    nome: 'Legenda longa demais não derruba os dados de pagamento',
    cenario: {
      dizimista: { id: 7, x_name: 'M'.repeat(400), x_studio_value: 50, x_studio_comunidade: [1, 'Matriz'] },
      temAvatar: true, flowLigado: true
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
    const obtido = String(ctx.tipoDaChavePix(chave));
    const ok = obtido === esperado;
    if (!ok) falhas++;
    console.log(`${ok ? '✅' : '❌'} ${oQue.padEnd(30)} → ${obtido}${ok ? '' : `  (esperado ${esperado})`}`);
  }
}

console.log('\n' + '─'.repeat(64));
console.log('🧩 Conteúdo que não pode se perder nas fusões\n');

for (const r of REGRAS_DE_CONTEUDO) {
  enviadas = [];
  gratis   = [];
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
