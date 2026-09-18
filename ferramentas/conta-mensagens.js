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
const registra = (tipo, texto) => enviadas.push({ tipo, texto: String(texto || '') });

function montarContexto(cenario) {
  const Utils = {
    enviarSimples:      (to, t)          => registra('texto',   t),
    enviarComBotaoMenu: (to, t)          => registra('texto',   t),
    enviarConfirmar:    (to, t)          => registra('botoes',  t),
    enviarMenu:         (to, t, botoes)  => registra('menu',    t + ' [' + (botoes || []).map(b => b.id).join(', ') + ']'),
    enviarLista:        (to, t)          => registra('lista',   t),
    formatarNumeroExibicao: n => n,
    formatarValor:      v => 'R$ ' + v,
    formatarDataOdoo:   d => d,
    parseValorBR:       v => v
  };

  const OdooService = {
    buscarParametros:            () => ({ x_studio_avatar: cenario.temAvatar ? 'ID' : null }),
    buscarDizimistaPorWhatsapp:  () => {
      if (cenario.odooForaDoAr) throw new Error('connection refused (simulado)');
      return cenario.dizimista;
    },
    listarComunidades:           () => [{ id: 1, x_name: 'Matriz' }],
    buscarDevolucoesDizimista:   () => cenario.devolucoes || [],
    buscarDadosPagamentoComunidade: () => ({ x_studio_chave_pix: 'pix@teste' }),
    listarFamilia:               () => [cenario.dizimista]
  };

  const MediaService = {
    // Imagem com legenda é UMA mensagem — é o ponto da fusão das boas-vindas.
    enviarImagemFixa: (to, id, legenda) => registra('imagem+legenda', legenda)
  };

  const StateManager = {
    setEstado: () => {}, getEstado: () => null, limparDados: () => {},
    iniciarSessaoCadastro: () => {}, registrarSessaoAtiva: () => {},
    appendLog: () => {}, setDados: () => {}, getDados: () => ({})
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
    Utils, OdooService, MediaService, StateManager, FlowHandler,
    console: { log() {}, warn() {}, error() {} },
    Utilities: { sleep() {} },
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) }
  };
  vm.createContext(ctx);

  // Os .gs declaram `const MenuHandler = {...}` no topo. Num contexto do `vm`
  // isso é declaração léxica: não vira propriedade do objeto de contexto. Por
  // isso tudo é carregado num script só e os objetos são devolvidos no fim —
  // é a forma de alcançá-los sem tocar nos arquivos do projeto.
  const fontes = ['Config.gs', 'MenuHandler.gs', 'CadastroHandler.gs', 'DevolucaoHandler.gs']
    .map(a => fs.readFileSync(path.join(RAIZ, a), 'utf8'))
    .join('\n;\n');

  return vm.runInContext(
    fontes + '\n;({ MenuHandler, CadastroHandler, DevolucaoHandler, ESTADOS });',
    ctx,
    { filename: 'bot.gs' }
  );
}

// ---------------------------------------------------------------------------
// Os cenários, com o número que Documentação/FLUXOS.md promete
// ---------------------------------------------------------------------------

const DIZIMISTA = { id: 7, x_name: 'Maria', x_studio_comunidade: [1, 'Matriz'] };

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

let falhas = 0;

console.log('\n📊 Mensagens enviadas por entrada no bot\n' + '─'.repeat(64));

for (const c of CENARIOS) {
  enviadas = [];
  const ctx = montarContexto(c.cenario);
  c.roda(ctx);

  const ok = enviadas.length === c.esperado;
  if (!ok) falhas++;

  console.log(`\n${ok ? '✅' : '❌'} ${c.nome}`);
  console.log(`   ${enviadas.length} mensagem(ns)${ok ? '' : ` — FLUXOS.md diz ${c.esperado}`}`);
  console.log(`   ${c.porque}`);
  enviadas.forEach((m, i) => console.log(`     ${i + 1}. [${m.tipo}] ${m.texto.split('\n')[0].slice(0, 70)}`));
}

console.log('\n' + '─'.repeat(64));
console.log('🔘 Botões dos menus\n');

for (const r of REGRAS_DE_BOTAO) {
  enviadas = [];
  const ctx = montarContexto(r.cenario);
  r.roda(ctx);
  const erro = enviadas.length ? r.confere(enviadas) : 'nenhuma mensagem enviada';
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
