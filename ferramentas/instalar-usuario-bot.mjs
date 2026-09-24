/**
 * instalar-usuario-bot.mjs — O usuário dedicado do bot (BL-17, segunda metade).
 *
 * O PROBLEMA
 *   O bot fala com o Odoo como ADMINISTRADOR (`ODOO_UID = 2`). Quem obtiver a
 *   chave de API — um script exposto, uma conta Google comprometida, alguém com
 *   acesso ao editor do Apps Script — pode apagar ou exportar a base inteira da
 *   paróquia. Não só as devoluções: usuários, configurações, tudo.
 *
 *   O bot precisa escrever em três modelos. Ele tem permissão sobre todos.
 *
 * O QUE ESTE SCRIPT FAZ
 *   Cria o grupo "Meu Dízimo · Bot" com EXATAMENTE as permissões que o código
 *   usa, levantadas das chamadas reais — não do que parece razoável.
 *
 * O QUE ELE NÃO FAZ, DE PROPÓSITO
 *   Não cria o usuário nem gera a chave de API. Isso envolve segredo, e segredo
 *   não passa por script que alguém possa reexecutar ou logar. Você cria o
 *   usuário na tela do Odoo e gera a chave lá; este script só dá a ele os
 *   direitos certos e confere o resultado.
 *
 * ⚠️ CUSTO: no Odoo Online, usuário INTERNO é cobrado por assento. Um usuário
 *    dedicado para o bot soma uma licença à fatura da paróquia. É o preço de
 *    separar o que o bot pode fazer do que um administrador pode.
 *
 * COMO RODAR
 *     node ferramentas/instalar-usuario-bot.mjs                      (simula)
 *     node ferramentas/instalar-usuario-bot.mjs --aplicar
 *     node ferramentas/instalar-usuario-bot.mjs --aplicar --login=bot@paroquia.org
 *     node ferramentas/instalar-usuario-bot.mjs --verificar          (com a chave do BOT)
 *
 *   O `--verificar` é o que importa: rode-o com as credenciais do usuário NOVO
 *   em ferramentas/.odoo-env. Ele pergunta ao próprio Odoo, operação por
 *   operação, o que aquele usuário pode fazer — e acusa tanto o que falta
 *   quanto o que sobra.
 */

import { carregarEnv } from './odoo-env.mjs';

const env = carregarEnv(process.env.ODOO_ENV_FILE || 'ferramentas/.odoo-env');
if (env?.carregadas.length) console.log(`🔑 ${env.caminho}: ${env.carregadas.join(', ')}`);

const argv = process.argv.slice(2);
{
  const CONHECIDOS = new Set(['--aplicar', '--simular', '--verificar', '--explicar', '--restringir']);
  const estranhos = argv.filter((a) => a.startsWith('--') && !CONHECIDOS.has(a) && !a.startsWith('--login='));
  if (estranhos.length) {
    console.error(`❌ Não conheço: ${estranhos.join(', ')}`);
    console.error(`   Conhecidos: ${[...CONHECIDOS].join(' ')} --login=<email>`);
    process.exit(1);
  }
}

const CONFIG = {
  url: (process.env.ODOO_URL || '').replace(/\/+$/, ''),
  db: process.env.ODOO_DB || '',
  uid: Number(process.env.ODOO_UID || 0),
  apiKey: process.env.ODOO_API_KEY || '',
  aplicar: argv.includes('--aplicar'),
  verificar: argv.includes('--verificar'),
  explicar: argv.includes('--explicar'),
  restringir: argv.includes('--restringir'),
  login: (argv.find((a) => a.startsWith('--login=')) || '').slice(8),
};
if (!CONFIG.url || !CONFIG.db || !CONFIG.uid || !CONFIG.apiKey) {
  console.error('❌ Faltam credenciais. Veja ferramentas/.odoo-env.exemplo.');
  process.exit(1);
}

async function rpc(model, method, args = [], kwargs = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.url}/jsonrpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {
        service: 'object', method: 'execute_kw',
        args: [CONFIG.db, CONFIG.uid, CONFIG.apiKey, model, method, args, kwargs] } }),
    });
  } catch (e) {
    console.error(`❌ não consegui falar com ${CONFIG.url} (${e.cause?.code || e.message})`);
    console.error('   Isso é CONEXÃO, não credencial. Nada foi alterado.');
    process.exit(1);
  }
  const json = await res.json();
  if (json.error) {
    const erro = new Error(json.error.data?.message || json.error.message);
    // O Odoo diz em `data.name` QUAL exceção foi, e isso distingue duas coisas
    // que não podem ser confundidas:
    //   odoo.exceptions.AccessDenied  → credencial errada (uid/chave)
    //   odoo.exceptions.AccessError   → autenticou, mas não tem permissão
    // Adivinhar isso pelo texto da mensagem é frágil e muda com o idioma.
    erro.odooName = json.error.data?.name || '';
    throw erro;
  }
  return json.result;
}
const buscar = (m, d, c, o = {}) => rpc(m, 'search_read', [d], { fields: c, ...o });

// ---------------------------------------------------------------------------
// A MATRIZ — levantada das chamadas do código, não do que parece razoável.
//
//   x_devolucao        registrar e preencher devolução
//   x_dizimista        cadastro e classificação
//   x_contato_bot      quem já escreveu ao bot
//   x_notificacao_log  o log do lembrete mensal (só escreve, nunca corrige)
//   x_comunidade       chave PIX, titular, banco, coordenador — só leitura
//   x_parametros*      configuração — só leitura
//   ir.model.fields    `campoExiste`/`campoGravavel`, em toda execução
//   res.users          telefone do coordenador (x_studio_usuarios) — só leitura
//
// NENHUM UNLINK. O único `unlink` do projeto está em `reviverPrimeiroContato`
// (Setup.gs), função manual de depuração — não em runtime. Quem precisar dela
// roda com credencial de administrador.
//
// NENHUMA ESCRITA DE SCHEMA. `SetupCamposFamilia` e `SetupCamposOferta` criam
// campos em ir.model.fields, e são setups manuais, executados uma vez.
// ---------------------------------------------------------------------------
const MATRIZ = [
  { model: 'x_devolucao',             read: 1, write: 1, create: 1, unlink: 0 },
  { model: 'x_dizimista',             read: 1, write: 1, create: 1, unlink: 0 },
  { model: 'x_contato_bot',           read: 1, write: 1, create: 1, unlink: 0 },
  { model: 'x_notificacao_log',       read: 1, write: 0, create: 1, unlink: 0 },
  { model: 'x_comunidade',            read: 1, write: 0, create: 0, unlink: 0 },
  { model: 'x_parametros',            read: 1, write: 0, create: 0, unlink: 0 },
  { model: 'x_parametros_line_c498a', read: 1, write: 0, create: 0, unlink: 0 },
  { model: 'ir.model.fields',         read: 1, write: 0, create: 0, unlink: 0 },
  // `write` aqui NÃO é 0 por engano, e a matriz não o exige mais: o ACL de
  // fábrica do Odoo (base/security/ir.model.access.csv) já dá write em
  // res.users a todo `base.group_user`:
  //
  //   "access_res_users_employee","res_users all","model_res_users","base.group_user",1,1,0,0
  //
  // É o que permite a cada um editar as próprias preferências (idioma, fuso,
  // assinatura). Tirar isso quebra todo usuário interno, e o Odoo restaura na
  // próxima atualização. Exigir 0 aqui era pedir o impossível e gerar um
  // achado que ninguém pode resolver — some junto com `res.partner` no piso.
  { model: 'res.users',               read: 1, write: null, create: 0, unlink: 0 },
];

const NOME_GRUPO = 'Meu Dízimo · Bot';

console.log(`\n🔌 ${CONFIG.url} (db=${CONFIG.db}, uid=${CONFIG.uid})`);

// ===========================================================================
// MODO VERIFICAR — pergunta ao Odoo o que ESTE usuário pode fazer
// ===========================================================================
if (CONFIG.verificar) {
  console.log('🔎 modo: VERIFICAR — perguntando ao Odoo, operação por operação\n');

  // ── ANTES DE TUDO: esta credencial autentica? ──────────────────────────
  //
  // Sem isto, um uid inexistente produzia o relatório COMPLETO — matriz,
  // FALTA, SOBRA, veredito — contra credencial que nem logava. E a parte
  // pior: as checagens de segurança apareciam como "· ok", porque um erro
  // não é `true`. Falha total de autenticação lida como aprovação.
  //
  // Foi encontrado com um uid digitado errado de propósito. Um comando que
  // responde "está tudo trancado" quando nem conectou é pior que comando
  // nenhum: ele encerra a investigação.
  let euSou = null;
  try {
    const eu = await rpc('res.users', 'read', [[CONFIG.uid], ['login', 'name']]);
    if (!eu || !eu.length) {
      console.error(`\n❌ uid ${CONFIG.uid} NÃO EXISTE neste banco.`);
      console.error('   Confira ODOO_UID em ferramentas/.odoo-env.\n');
      process.exit(1);
    }
    euSou = eu[0];
  } catch (e) {
    if (/AccessDenied/.test(e.odooName)) {
      console.error(`\n❌ credencial recusada (uid ${CONFIG.uid}).`);
      console.error('   O par ODOO_UID + ODOO_API_KEY não autentica neste banco.');
      console.error('   Nada foi verificado — o relatório abaixo não existiria.\n');
      process.exit(1);
    }
    console.error(`\n❌ não consegui nem me identificar: ${e.message}`);
    console.error('   Sem isso, qualquer resposta abaixo seria indistinguível de');
    console.error('   "sem permissão". Abortando em vez de adivinhar.\n');
    process.exit(1);
  }

  console.log(`   conectado como: ${euSou.name} <${euSou.login}> (uid ${CONFIG.uid})`);
  console.log('   ⚠️  confira se é MESMO o usuário do bot — verificar o usuário');
  console.log('       errado devolve um relatório perfeitamente coerente e inútil.\n');

  // `has_access` devolve booleano e não executa nada.
  //
  // A CHAMADA É `[[], op]`, NÃO `[op]`. Eu tinha escrito `[op]` acreditando que
  // "sem ids" bastava — e o Odoo respondeu, 39 vezes:
  //
  //     BaseModel.has_access() missing 1 required positional argument: 'operation'
  //
  // O motivo está em `odoo/api.py`. Para método que NÃO é `@api.model`, o
  // despacho é `_call_kw_multi`:
  //
  //     ids, args = args[0], args[1:]
  //     recs = model.browse(ids)
  //     result = method(recs, *args, **kwargs)
  //
  // Ou seja, `args[0]` é SEMPRE consumido como a lista de ids. Mandando
  // `['read']`, o Odoo leu `'read'` como ids e chamou `has_access(recs)` sem
  // operação. O recordset vazio que se quer vem de passar `[]` explicitamente
  // como primeiro argumento, e aí `has_access` responde pelo MODELO.
  //
  // Eu tinha escrito `check_access_rights`, que é o nome antigo e NÃO EXISTE
  // MAIS nesta versão: em odoo/orm/models.py da saas-19.3 há `check_access`,
  // que levanta exceção, e `has_access`, que devolve o booleano.
  //
  // TRÊS ESTADOS, não dois: true, false e null. `null` é "não sei", e não sei
  // NUNCA é achado — nem falta, nem sobra. Antes isto devolvia a string do
  // erro, que comparada com booleano dava sempre diferente e virava veredito.
  const porQue = {};
  const pode = async (model, op) => {
    try {
      const r = await rpc(model, 'has_access', [[], op]);
      return typeof r === 'boolean' ? r : null;
    } catch (e) {
      // AccessError é resposta: autenticou e não pode. Qualquer outra coisa
      // é ignorância nossa, e ignorância não vira conclusão.
      if (/AccessError/.test(e.odooName)) return false;
      porQue[`${model}.${op}`] = e.message.split('\n')[0];
      return null;
    }
  };

  const marca = (v) => (v === true ? '✓' : v === false ? '·' : '?');

  // DUAS SOBRAS DIFERENTES, e confundi-las já produziu diagnóstico errado.
  //
  //   sobraNoBot    escrita a mais nos modelos x_*. Vem de OUTRA regra de
  //                 ir.model.access — as ACLs do Odoo são ADITIVAS, então o
  //                 grupo restritivo não anula uma regra permissiva que já
  //                 exista (tipicamente a que o Studio cria junto com o
  //                 modelo, valendo para todo usuário interno).
  //   sobraDeAdmin  escrita em ir.ui.view / ir.cron / res.groups. ISSO sim é
  //                 poder de administrador.
  //
  // Dizer "ainda é administrador" por causa da primeira contradiz a própria
  // saída do comando, que mostra os três de admin como `· ok`. E manda a
  // pessoa procurar no lugar errado.
  let faltando = 0, sobraNoBot = 0, sobraDeAdmin = 0, indeterminado = 0;

  for (const m of MATRIZ) {
    const linha = [];
    for (const op of ['read', 'write', 'create', 'unlink']) {
      // `null` na matriz = piso do Odoo, não se opina. Diferente de 0, que
      // quer dizer "não pode" e vira achado quando pode.
      if (m[op] === null) { linha.push(`${op}:~ piso`); continue; }

      const tem  = await pode(m.model, op);
      const quer = !!m[op];

      let nota = '';
      if (tem === null)      { indeterminado++; nota = ' ?'; }
      else if (tem === quer) { nota = ''; }
      else if (quer)         { faltando++;   nota = ' FALTA'; }
      else                   { sobraNoBot++; nota = ' SOBRA'; }

      linha.push(`${op}:${marca(tem)}${nota}`);
    }
    console.log(`   ${m.model.padEnd(24)} ${linha.join('  ')}`);
  }

  // ── Escrita que só administrador tem ──────────────────────────────────
  // Estes três exigem base.group_system (ou group_erp_manager, no caso de
  // res.groups). Se algum responder que pode, o usuário ainda tem poder de
  // administrador — e aí o grupo restritivo não limitou nada.
  //
  // `ir.model.fields` NÃO entra aqui: já está na MATRIZ com write:0, e
  // repetir fazia a mesma falha ser contada duas vezes no total.
  //
  // SÓ `false` É APROVAÇÃO. Era `w !== true`, e por isso um erro passava como
  // "ok": a checagem de segurança aprovava justamente quando não sabia.
  console.log('\n   Escrita que só administrador deveria ter:');
  for (const m of ['ir.ui.view', 'ir.cron', 'res.groups']) {
    const w = await pode(m, 'write');
    if (w === true)  sobraDeAdmin++;
    if (w === null)  indeterminado++;
    const veredito = w === false ? '· ok' : w === true ? '✓ SOBRA' : '? NÃO SEI';
    console.log(`   ${m.padEnd(24)} write:${veredito}`);
  }

  // ── O piso do Odoo, que não dá para baixar ────────────────────────────
  // Todo usuário INTERNO está em `base.group_user`, e esse grupo já concede
  // escrita em res.partner, mail.message, ir.attachment e companhia. Não é
  // sinal de administrador e NÃO conta como sobra — é o mínimo que o Odoo
  // dá a quem não é portal.
  console.log('\n   Piso do usuário interno (informativo, não é sobra):');
  for (const m of ['res.partner', 'ir.attachment', 'mail.message']) {
    const w = await pode(m, 'write');
    console.log(`   ${m.padEnd(24)} write:${w === true ? '✓ (esperado)' : marca(w)}`);
  }

  if (Object.keys(porQue).length) {
    console.log('\n   Por que não soube:');
    for (const [k, v] of Object.entries(porQue)) console.log(`   ${k.padEnd(24)} ${v}`);
  }

  console.log('');
  if (faltando) console.log(`❌ ${faltando} permissão(ões) FALTANDO — o bot vai quebrar nelas.`);

  if (sobraDeAdmin) {
    console.log(`🚨 ${sobraDeAdmin} permissão(ões) de ADMINISTRADOR — o usuário ainda é admin.`);
    console.log('   Tire-o de Administração na tela do Odoo. Enquanto for admin, o');
    console.log('   grupo restritivo não limita nada.');
  }

  if (sobraNoBot) {
    console.log(`⚠️  ${sobraNoBot} permissão(ões) SOBRANDO nos modelos do bot.`);
    if (!sobraDeAdmin) {
      console.log('   NÃO é poder de administrador — os três acima deram `ok`.');
      console.log('   É outra regra de ir.model.access concedendo isto: as ACLs do');
      console.log('   Odoo SOMAM, então o grupo restritivo não anula uma regra');
      console.log('   permissiva que já exista (em geral a que o Studio cria junto');
      console.log('   com o modelo, valendo para todo usuário interno).');
    }
    console.log('   Para ver QUAL regra, com a chave do ADMINISTRADOR em .odoo-env:');
    console.log('     node ferramentas/instalar-usuario-bot.mjs --explicar --login=<email do bot>');
  }

  if (indeterminado) console.log(`❓ ${indeterminado} resposta(s) INDETERMINADA(S) — isto NÃO é aprovação.`);

  if (!faltando && !sobraNoBot && !sobraDeAdmin && !indeterminado) {
    console.log('✅ Exatamente o que o código usa nos modelos do bot, e nada de administrador.');
    console.log('   Residual conhecido: o piso de `base.group_user` acima. Baixar disso');
    console.log('   exigiria regras de registro (record rules) por modelo — fora do BL-17.');
  }
  console.log('');
  // Indeterminado sai diferente de zero: "não sei" não passa em CI nem em
  // conferência humana apressada.
  process.exit(faltando || sobraNoBot || sobraDeAdmin || indeterminado ? 1 : 0);
}

// ===========================================================================
// MODO EXPLICAR — de ONDE vem a permissão que sobra
// ===========================================================================
//
// O `--verificar` diz QUE sobra. Este diz DE ONDE, que é a pergunta seguinte
// e a que não dá para responder olhando o grupo do bot: as ACLs do Odoo são
// ADITIVAS. Criar um grupo restritivo não anula uma regra permissiva que já
// exista — e o Studio cria uma, valendo para todo usuário interno, junto com
// cada modelo `x_*`.
//
// Roda com a chave do ADMINISTRADOR: ler `ir.model.access` e `res.groups` não
// é coisa que o bot deva poder fazer.
if (CONFIG.explicar) {
  console.log('🔍 modo: EXPLICAR — de onde vem cada permissão nos modelos do bot\n');

  if (!CONFIG.login) {
    console.error('❌ preciso de --login=<email do bot> para saber a quais grupos ele pertence.\n');
    process.exit(1);
  }

  const [u] = await buscar('res.users', [['login', '=', CONFIG.login]],
    ['id', 'name', 'group_ids', 'all_group_ids'], { limit: 1 });
  if (!u) {
    console.error(`❌ não achei usuário com login "${CONFIG.login}".\n`);
    process.exit(1);
  }
  console.log(`   bot: ${u.name} (uid ${u.id}), em ${u.group_ids.length} grupo(s) `
    + `(${u.all_group_ids.length} contando os implicados)\n`);

  const modelos = MATRIZ.map((m) => m.model);
  const acls = await buscar('ir.model.access',
    [['model_id.model', 'in', modelos]],
    ['name', 'model_id', 'group_id', 'perm_read', 'perm_write', 'perm_create', 'perm_unlink']);

  const querido = Object.fromEntries(MATRIZ.map((m) => [m.model, m]));
  const OPS = ['read', 'write', 'create', 'unlink'];
  let culpadas = 0;

  // O `model_id` do search_read vem como [id, rótulo], e o rótulo é o nome
  // AMIGÁVEL do modelo ("Devolução"), não o técnico. Sem resolver isto, o
  // agrupamento por modelo casaria com nada — mesma armadilha do grupo de
  // administrador buscado por nome.
  const ids = [...new Set(acls.map((a) => a.model_id[0]))];
  const nomes = await buscar('ir.model', [['id', 'in', ids]], ['model']);
  const tecnico = Object.fromEntries(nomes.map((n) => [n.id, n.model]));

  for (const model of modelos) {
    const linhas = acls.filter((a) => tecnico[a.model_id[0]] === model);
    const quer = querido[model];

    console.log(`   ${model}`);
    if (!linhas.length) {
      console.log('      (nenhuma regra — o acesso vem de outro lugar)');
      continue;
    }

    for (const a of linhas) {
      const concede = OPS.filter((o) => a[`perm_${o}`]);
      const demais  = OPS.filter((o) => a[`perm_${o}`] && !quer[o]);
      // Só é culpada se o BOT estiver no grupo dela. Regra sem grupo vale
      // para todo mundo, inclusive ele.
      const semGrupo = !a.group_id;
      // `all_group_ids`, não `group_ids`: uma ACL num grupo IMPLICADO também
      // alcança o usuário. Olhar só os explícitos deixaria passar.
      const doBot    = semGrupo || u.all_group_ids.includes(a.group_id[0]);
      const problema = demais.length && doBot;
      if (problema) culpadas++;

      const grupo = semGrupo ? '(SEM GRUPO — vale para todos)' : a.group_id[1];
      console.log(`      ${problema ? '🚨' : '· '} ${a.name}`);
      console.log(`         grupo: ${grupo}`);
      console.log(`         concede: ${concede.join(', ') || '(nada)'}`
        + (problema ? `  →  A MAIS: ${demais.join(', ')}` : ''));
    }
  }

  console.log('');
  if (!culpadas) {
    console.log('✅ Nenhuma regra concede ao bot mais do que a matriz pede.\n');
    process.exit(0);
  }

  console.log(`🚨 ${culpadas} regra(s) concedem ao bot mais do que a matriz pede.`);
  console.log('');
  console.log('   NÃO saia apagando: essas regras provavelmente existem para os');
  console.log('   agentes da pastoral, que precisam editar comunidade e parâmetros');
  console.log('   pela tela. Apagá-las tranca as pessoas para fora.');
  console.log('');
  console.log('   O caminho é restringir a regra a um grupo de quem USA a tela e');
  console.log('   deixar o bot fora dele — em Definições → Técnico → Direitos de');
  console.log('   Acesso. Isto é decisão sobre quem pode o quê na paróquia, então');
  console.log('   não faço por script.');
  console.log('');
  process.exit(1);
}

// ===========================================================================
// MODO RESTRINGIR — tira o excesso das ACLs do grupo de usuário interno
// ===========================================================================
//
// O `--explicar` de 24/09 mostrou que TODO o excesso vinha de um grupo só:
// `base.group_user` (aparece como "Role / User"), o grupo de qualquer usuário
// interno. As regras são as que o Studio cria junto com cada modelo `x_*`, e
// dão escrita a todo mundo.
//
// DUAS TRAVAS, porque isto mexe na permissão de TODOS os usuários internos,
// não só do bot:
//
//   1. Só toca em modelo que começa com `x_`. Os do Odoo (`res.users`,
//      `ir.model.fields`) ficam de fora por construção — e `res_users all`
//      com write É DE FÁBRICA (base/security/ir.model.access.csv), serve para
//      cada um editar as próprias preferências. Mexer ali quebra todo mundo e
//      o Odoo restaura na atualização.
//   2. Só toca em regra cujo grupo é `base.group_user`, resolvido por XML ID.
//      As da Secretaria, da Pastoral e do Administrador não são tocadas —
//      são elas que mantêm as PESSOAS trabalhando.
//
// O que sobra depois: quem tem papel na paróquia continua com o que o papel
// dá; quem só é usuário interno passa a poder LER e não escrever; e o bot
// fica na matriz.
//
//     node ferramentas/instalar-usuario-bot.mjs --restringir            (simula)
//     node ferramentas/instalar-usuario-bot.mjs --restringir --aplicar  (grava)
if (CONFIG.restringir) {
  console.log('🔒 modo: RESTRINGIR — excesso nas ACLs de base.group_user\n');
  console.log(CONFIG.aplicar ? '   ✍️  APLICAR\n' : '   👀 simulação (acrescente --aplicar para gravar)\n');

  const [gu] = await buscar('ir.model.data',
    [['model', '=', 'res.groups'], ['module', '=', 'base'], ['name', '=', 'group_user']],
    ['res_id'], { limit: 1 });
  if (!gu) {
    console.error('❌ não resolvi base.group_user. Abortando — sem isso eu não sei');
    console.error('   quais regras são do grupo de usuário interno.\n');
    process.exit(1);
  }

  // Só os x_*. Os modelos do Odoo ficam de fora por construção.
  const alvos = MATRIZ.filter((m) => m.model.startsWith('x_'));
  const acls = await buscar('ir.model.access',
    [['model_id.model', 'in', alvos.map((m) => m.model)], ['group_id', '=', gu.res_id]],
    ['name', 'model_id', 'perm_read', 'perm_write', 'perm_create', 'perm_unlink']);

  const ids = [...new Set(acls.map((a) => a.model_id[0]))];
  const tecnico = Object.fromEntries(
    (await buscar('ir.model', [['id', 'in', ids]], ['model'])).map((n) => [n.id, n.model]));

  // ── Quem mais escreve nestes modelos, além do grupo que vamos restringir?
  //
  // A pergunta que o script NÃO fazia, e que quase custou caro: tirar write de
  // `base.group_user` só é inócuo se OUTRA regra ainda der write a alguém que
  // não seja administrador. No caso real, `x_parametros` tinha a regra da
  // Secretaria e `x_parametros_line_c498a` NÃO — então restringir deixaria as
  // linhas de parâmetro editáveis só pelo Administrador, e a Secretaria
  // descobriria isso ao tentar salvar.
  //
  // Administrador não conta como saída: se a resposta for "só o admin", é
  // exatamente isso que precisa ser dito antes, não depois.
  const [adm] = await buscar('ir.model.data',
    [['model', '=', 'res.groups'], ['module', '=', 'base'], ['name', '=', 'group_system']],
    ['res_id'], { limit: 1 });

  const outras = await buscar('ir.model.access',
    [['model_id.model', 'in', alvos.map((m) => m.model)],
     ['group_id', '!=', gu.res_id], ['perm_write', '=', true]],
    ['model_id', 'group_id']);

  const OPS = ['read', 'write', 'create', 'unlink'];
  let mexidas = 0;
  const orfaos = [];

  for (const a of acls) {
    const model = tecnico[a.model_id[0]];
    const quer  = MATRIZ.find((m) => m.model === model);
    if (!quer) continue;

    const vals = {};
    const tirar = [];
    for (const op of OPS) {
      // `null` = piso, não se opina. Nunca chega aqui porque só x_* entram,
      // mas a regra fica explícita.
      if (quer[op] === null) continue;
      if (a[`perm_${op}`] && !quer[op]) { vals[`perm_${op}`] = false; tirar.push(op); }
    }

    if (!tirar.length) { console.log(`   · ${a.name.padEnd(36)} já está certo`); continue; }

    mexidas++;

    // Sobrou alguém que não seja o administrador nem o próprio bot?
    if (tirar.includes('write')) {
      const restam = outras.filter((o) => tecnico[o.model_id[0]] === model
        && o.group_id && o.group_id[0] !== (adm && adm.res_id)
        && o.group_id[1] !== NOME_GRUPO);
      if (!restam.length) orfaos.push(model);
    }

    if (!CONFIG.aplicar) {
      console.log(`   ~ ${a.name.padEnd(36)} perderia: ${tirar.join(', ')}`);
    } else {
      await rpc('ir.model.access', 'write', [[a.id], vals]);
      console.log(`   ✓ ${a.name.padEnd(36)} tirado: ${tirar.join(', ')}`);
    }
  }

  if (orfaos.length) {
    console.log('');
    console.log('⚠️  ATENÇÃO — depois disto, SÓ O ADMINISTRADOR escreve em:');
    orfaos.forEach((m) => console.log(`      ${m}`));
    console.log('');
    console.log('   Nenhum outro grupo (Secretaria, Pastoral) tem regra de escrita');
    console.log('   nesses modelos. Se alguém edita isso pela tela hoje, vai parar');
    console.log('   de conseguir — e o sintoma aparece na hora de salvar, não agora.');
    console.log('');
    console.log('   Se for o caso, crie antes a regra para o grupo de quem usa a tela');
    console.log('   (espelhando a que já existe no modelo "pai"), e rode isto de novo.');
  }

  console.log('');
  if (!mexidas) {
    console.log('✅ Nada a restringir — as regras de base.group_user já batem com a matriz.\n');
    process.exit(0);
  }
  if (!CONFIG.aplicar) {
    console.log(`👀 ${mexidas} regra(s) seriam alteradas. Nada foi gravado.`);
    console.log('   Repita com --aplicar quando quiser valer, e confira depois com');
    console.log('   --verificar usando a chave do bot.\n');
    process.exit(0);
  }
  console.log(`✅ ${mexidas} regra(s) restringidas.`);
  console.log('   Confira com a chave do BOT: --verificar');
  console.log('   E confira com uma pessoa da Secretaria que a tela dela ainda edita.\n');
  process.exit(0);
}

// ===========================================================================
// MODO INSTALAR
// ===========================================================================
console.log(CONFIG.aplicar ? '✍️  modo: APLICAR\n' : '👀 modo: simulação (use --aplicar para gravar)\n');

// ── 1. A categoria e o grupo ────────────────────────────────────────────────
console.log('── Grupo');

let grupoId = null;
{
  const [g] = await buscar('res.groups', [['name', '=', NOME_GRUPO]], ['id'], { limit: 1 });
  if (g) {
    grupoId = g.id;
    console.log(`   · "${NOME_GRUPO}" já existe (id ${g.id})`);
  } else if (!CONFIG.aplicar) {
    console.log(`   + "${NOME_GRUPO}" seria CRIADO`);
  } else {
    grupoId = await rpc('res.groups', 'create', [{ name: NOME_GRUPO }]);
    console.log(`   ✓ criado (id ${grupoId})`);
  }
}

// ── 2. As permissões ────────────────────────────────────────────────────────
console.log('\n── Permissões');

for (const m of MATRIZ) {
  const [modelo] = await buscar('ir.model', [['model', '=', m.model]], ['id'], { limit: 1 });
  if (!modelo) {
    console.log(`   ⚠️  modelo ${m.model} não existe nesta base — pulando`);
    continue;
  }
  const nome = `meu_dizimo_bot_${m.model.replace(/\./g, '_')}`;
  const vals = {
    name: nome, model_id: modelo.id, group_id: grupoId,
    perm_read: !!m.read, perm_write: !!m.write,
    perm_create: !!m.create, perm_unlink: !!m.unlink,
  };
  const resumo = ['read', 'write', 'create', 'unlink'].filter((o) => m[o]).join('+') || 'nada';

  const [existe] = await buscar('ir.model.access', [['name', '=', nome]],
    ['id', 'perm_read', 'perm_write', 'perm_create', 'perm_unlink'], { limit: 1 });

  if (!grupoId) { console.log(`   + ${m.model.padEnd(24)} ${resumo}`); continue; }

  if (!existe) {
    if (!CONFIG.aplicar) { console.log(`   + ${m.model.padEnd(24)} ${resumo}`); continue; }
    await rpc('ir.model.access', 'create', [vals]);
    console.log(`   ✓ ${m.model.padEnd(24)} ${resumo}`);
    continue;
  }
  const igual = ['read', 'write', 'create', 'unlink']
    .every((o) => !!existe[`perm_${o}`] === !!m[o]);
  if (igual) { console.log(`   · ${m.model.padEnd(24)} ${resumo} (já está assim)`); continue; }
  if (!CONFIG.aplicar) { console.log(`   ~ ${m.model.padEnd(24)} passaria a ${resumo}`); continue; }
  await rpc('ir.model.access', 'write', [[existe.id], vals]);
  console.log(`   ✓ ${m.model.padEnd(24)} ${resumo} (ajustado)`);
}

// ── 3. O usuário, se você disser qual ───────────────────────────────────────
console.log('\n── Usuário do bot');

if (!CONFIG.login) {
  console.log('   (nenhum --login=<email> informado)');
  console.log('   Crie o usuário no Odoo, gere a chave de API dele, e rode de novo');
  console.log('   com --login=<email> para eu pô-lo no grupo e conferir.');
} else {
  const [u] = await buscar('res.users', [['login', '=', CONFIG.login]],
    ['id', 'name', 'group_ids', 'all_group_ids'], { limit: 1 });
  if (!u) {
    console.log(`   ⚠️  não achei usuário com login "${CONFIG.login}".`);
    console.log('      Crie-o em Definições → Usuários e Empresas → Usuários.');
  } else {
    console.log(`   · ${u.name} (login ${CONFIG.login}, uid ${u.id})`);

    // O ponto inteiro do item: se ele for administrador, o grupo novo não
    // limita nada. Odoo soma permissões; não subtrai.
    //
    // POR XML ID, NÃO POR NOME. Estava `['name', 'ilike', 'Settings']`, e
    // `res.groups.name` É TRADUZIDO: num Odoo em português o grupo se chama
    // "Configurações"/"Administração" e o filtro não casaria com nada. O
    // script então SILENCIARIA sobre um usuário que ainda é administrador —
    // um falso "está tudo certo" no único aviso que justifica este item.
    // Mesma classe do `check_access_rights` que já quebrou aqui.
    //
    // Os dois grupos que dão poder de administrador:
    //   base.group_system        Administração → Configurações
    //   base.group_erp_manager   Administração → Direitos de acesso
    const dados = await buscar('ir.model.data',
      [['model', '=', 'res.groups'], ['module', '=', 'base'],
       ['name', 'in', ['group_system', 'group_erp_manager']]],
      ['name', 'res_id']);

    // Pelos IMPLICADOS: quem está num grupo que implica base.group_system é
    // administrador sem ter group_system na lista explícita.
    const idsAdmin = dados.map((d) => d.res_id).filter((id) => u.all_group_ids.includes(id));

    if (!dados.length) {
      // Não achar os XML IDs é anormal e não pode passar como "sem problema".
      console.log('   ⚠️  não consegui resolver base.group_system / base.group_erp_manager.');
      console.log('      NÃO dá para afirmar que este usuário não é administrador —');
      console.log('      confira à mão em Definições → Usuários.');
    } else if (idsAdmin.length) {
      const nomes = await buscar('res.groups', [['id', 'in', idsAdmin]], ['name']);
      console.log(`   🚨 ESTE USUÁRIO É ADMINISTRADOR (${nomes.map((g) => `"${g.name}"`).join(', ')}).`);
      console.log('      Enquanto for, o grupo novo não limita NADA: o Odoo SOMA');
      console.log('      permissões, nunca subtrai. Tire-o de Administração na tela');
      console.log('      do Odoo — eu não faço isso por script, porque tirar acesso');
      console.log('      de um usuário errado tranca alguém para fora.');
    } else {
      console.log('   · não está em nenhum grupo de administrador');
    }

    if (grupoId && u.all_group_ids.includes(grupoId)) {
      console.log(`   · já está em "${NOME_GRUPO}"`);
    } else if (!CONFIG.aplicar || !grupoId) {
      console.log(`   ~ entraria em "${NOME_GRUPO}"`);
    } else {
      // Grava no EXPLÍCITO. `all_group_ids` é computed (all_implied_ids).
      await rpc('res.users', 'write', [[u.id], { group_ids: [[4, grupoId]] }]);
      console.log(`   ✓ adicionado a "${NOME_GRUPO}"`);
    }

    console.log('');
    console.log(`   👉 ODOO_UID do bot = ${u.id}`);
    console.log('      Ponha esse número na Script Property ODOO_UID do Apps Script,');
    console.log('      junto com a chave de API dele em ODOO_API_KEY.');
  }
}

console.log(CONFIG.aplicar
  ? '\n✅ pronto.\n\n'
    + '   Depois, com a chave do usuário NOVO em ferramentas/.odoo-env:\n'
    + '     node ferramentas/instalar-usuario-bot.mjs --verificar\n\n'
    + '   É esse comando que prova que ficou certo — ele pergunta ao Odoo\n'
    + '   operação por operação, e acusa o que falta e o que sobra.\n'
  : '\n👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
