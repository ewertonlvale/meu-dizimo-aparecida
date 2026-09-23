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
  const CONHECIDOS = new Set(['--aplicar', '--simular', '--verificar']);
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
  if (json.error) throw new Error(json.error.data?.message || json.error.message);
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
  { model: 'res.users',               read: 1, write: 0, create: 0, unlink: 0 },
];

const NOME_GRUPO = 'Meu Dízimo · Bot';

console.log(`\n🔌 ${CONFIG.url} (db=${CONFIG.db}, uid=${CONFIG.uid})`);

// ===========================================================================
// MODO VERIFICAR — pergunta ao Odoo o que ESTE usuário pode fazer
// ===========================================================================
if (CONFIG.verificar) {
  console.log('🔎 modo: VERIFICAR — perguntando ao Odoo, operação por operação\n');
  console.log('   Rode isto com a chave do usuário NOVO para valer.\n');

  const pode = async (model, op) => {
    try {
      // check_access_rights responde sem executar nada.
      return await rpc(model, 'check_access_rights', [op], { raise_exception: false });
    } catch (e) {
      return `erro: ${e.message.split('\n')[0]}`;
    }
  };

  let faltando = 0, sobrando = 0;
  for (const m of MATRIZ) {
    const linha = [];
    for (const op of ['read', 'write', 'create', 'unlink']) {
      const tem = await pode(m.model, op);
      const quer = !!m[op];
      const ok = tem === quer;
      if (!ok && quer)  faltando++;
      if (!ok && !quer) sobrando++;
      linha.push(`${op}:${tem === true ? '✓' : tem === false ? '·' : '?'}${ok ? '' : (quer ? ' FALTA' : ' SOBRA')}`);
    }
    console.log(`   ${m.model.padEnd(24)} ${linha.join('  ')}`);
  }

  // O que NÃO devia poder de jeito nenhum.
  console.log('\n   Modelos que este usuário não deveria alcançar:');
  for (const m of ['res.partner', 'ir.model.fields', 'ir.ui.view', 'ir.cron', 'res.groups']) {
    const w = await pode(m, 'write');
    const esperado = false;
    const ok = w === esperado;
    if (!ok) sobrando++;
    console.log(`   ${m.padEnd(24)} write:${w === true ? '✓ SOBRA' : '· ok'}`);
  }

  console.log('');
  if (faltando) console.log(`❌ ${faltando} permissão(ões) FALTANDO — o bot vai quebrar nelas.`);
  if (sobrando) console.log(`⚠️  ${sobrando} permissão(ões) SOBRANDO — provavelmente o usuário ainda é administrador.`);
  if (!faltando && !sobrando) console.log('✅ Exatamente o que o código usa, nada além.');
  console.log('');
  process.exit(faltando ? 1 : 0);
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
    ['id', 'name', 'groups_id'], { limit: 1 });
  if (!u) {
    console.log(`   ⚠️  não achei usuário com login "${CONFIG.login}".`);
    console.log('      Crie-o em Definições → Usuários e Empresas → Usuários.');
  } else {
    console.log(`   · ${u.name} (login ${CONFIG.login}, uid ${u.id})`);

    // O ponto inteiro do item: se ele for administrador, o grupo novo não
    // limita nada. Odoo soma permissões; não subtrai.
    const [admin] = await buscar('res.groups',
      [['id', 'in', u.groups_id], ['name', 'ilike', 'Settings']], ['id', 'name'], { limit: 1 });
    if (admin) {
      console.log(`   🚨 ESTE USUÁRIO É ADMINISTRADOR (grupo "${admin.name}").`);
      console.log('      Enquanto for, o grupo novo não limita NADA: o Odoo SOMA');
      console.log('      permissões, nunca subtrai. Tire-o de Administração na tela');
      console.log('      do Odoo — eu não faço isso por script, porque tirar acesso');
      console.log('      de um usuário errado tranca alguém para fora.');
    }

    if (grupoId && u.groups_id.includes(grupoId)) {
      console.log(`   · já está em "${NOME_GRUPO}"`);
    } else if (!CONFIG.aplicar || !grupoId) {
      console.log(`   ~ entraria em "${NOME_GRUPO}"`);
    } else {
      await rpc('res.users', 'write', [[u.id], { groups_id: [[4, grupoId]] }]);
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
