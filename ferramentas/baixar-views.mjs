/**
 * baixar-views.mjs — Baixa as views de um tipo (padrão: kanban) direto do Odoo.
 *
 * POR QUE EXISTE
 *   Ler o arch pela tela do Studio dá uma linha só, sem indentação, e obriga a
 *   copiar à mão modelo por modelo. Pior: para modelos do core (res.users) o
 *   que aparece ali é a view BASE ou um diff de herança — nunca o resultado
 *   final que o usuário vê. Este script baixa as duas coisas, separadas:
 *
 *     1. As views cruas (`ir.ui.view`), inclusive as herdadas, uma por arquivo
 *     2. A view COMBINADA, que é o Odoo aplicando as heranças em cima da base
 *
 *   Para x_dizimista e x_devolucao, que são modelos do Studio sem herança, as
 *   duas costumam coincidir. Para res.users, não: é ali que a diferença conta.
 *
 * COMO RODAR (Node 18+, usa fetch nativo — nada para instalar)
 *
 *   1. Uma vez só, crie o arquivo de credenciais:
 *        cp ferramentas/.odoo-env.exemplo ferramentas/.odoo-env
 *        chmod 600 ferramentas/.odoo-env
 *      e preencha ODOO_URL, ODOO_DB, ODOO_UID e ODOO_API_KEY.
 *      Esse arquivo está no .gitignore.
 *
 *   2. Depois, sempre:
 *        node ferramentas/baixar-views.mjs
 *
 *   Sem o arquivo, tudo continua funcionando por ambiente/argumento:
 *     bash:        ODOO_API_KEY=... node ferramentas/baixar-views.mjs \
 *                    --url https://sua-instancia.odoo.com --db seu_db --uid 2
 *     PowerShell:  $env:ODOO_API_KEY = "sua-chave"
 *                  node ferramentas/baixar-views.mjs --url https://... --db x --uid 2
 *
 *   Opcionais:
 *     --modelos x_dizimista,x_devolucao,res.users   (este é o padrão)
 *     --tipo    kanban                              (list, form, search…)
 *     --saida   ferramentas/views-odoo              (pasta de destino)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SEGURANÇA — a mesma postura do odoo-dump.mjs, e pelas mesmas razões
 *
 * Este arquivo é versionado num repositório PÚBLICO. Nada vem preenchido: url,
 * db e uid não são segredo isolados, mas juntos transformam um alvo anônimo num
 * alvo nomeado. O script recusa rodar sem os três.
 *
 * A API KEY só entra por VARIÁVEL DE AMBIENTE. Argumento de linha de comando
 * fica no histórico do shell e aparece na lista de processos da máquina.
 *
 * A pasta de saída nasce com um .gitignore próprio. Os archs não são segredo,
 * mas também não precisam ir para um repositório público sem alguém decidir
 * isso — e o padrão seguro é o que não exige lembrar.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { carregarEnv } from './odoo-env.mjs';

// Credenciais de ferramentas/.odoo-env, quando existir. Variável de ambiente
// real tem precedência sobre o arquivo — ver odoo-env.mjs.
const env = carregarEnv(process.env.ODOO_ENV_FILE || 'ferramentas/.odoo-env');
if (env?.carregadas.length) {
  console.log(`🔑 ${env.caminho}: ${env.carregadas.join(', ')}`);
}

const argv = process.argv.slice(2);
const arg = (nome) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
};

const CONFIG = {
  url: (arg('url') || process.env.ODOO_URL || '').replace(/\/+$/, ''),
  db:   arg('db')  || process.env.ODOO_DB  || '',
  uid:  Number(arg('uid') || process.env.ODOO_UID || 0),
  // Só env — ver a nota de segurança no topo.
  apiKey: process.env.ODOO_API_KEY || '',
  tipo:  arg('tipo')  || 'kanban',
  saida: arg('saida') || 'ferramentas/views-odoo',
  modelos: (arg('modelos') || 'x_dizimista,x_devolucao,res.users')
    .split(',').map((m) => m.trim()).filter(Boolean),
};

const faltando = [];
if (!CONFIG.url)    faltando.push('--url (ou ODOO_URL)');
if (!CONFIG.db)     faltando.push('--db (ou ODOO_DB)');
if (!CONFIG.uid)    faltando.push('--uid (ou ODOO_UID)');
if (!CONFIG.apiKey) faltando.push('ODOO_API_KEY (variável de ambiente)');

if (faltando.length) {
  console.error('❌ Faltou:\n   ' + faltando.join('\n   '));
  console.error('\nO jeito mais simples é o arquivo de credenciais:');
  console.error('   cp ferramentas/.odoo-env.exemplo ferramentas/.odoo-env');
  console.error('   chmod 600 ferramentas/.odoo-env');
  console.error('   (preencha os quatro valores — o arquivo está no .gitignore)');
  console.error('\nOu, sem arquivo:');
  console.error('   ODOO_API_KEY=sua-chave node ferramentas/baixar-views.mjs \\');
  console.error('     --url https://sua-instancia.odoo.com --db seu_db --uid 2');
  console.error('\nNada vem preenchido de fábrica de propósito — veja a nota de');
  console.error('segurança no topo do arquivo.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

async function rpc(model, method, args = [], kwargs = {}) {
  const res = await fetch(`${CONFIG.url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [CONFIG.db, CONFIG.uid, CONFIG.apiKey, model, method, args, kwargs],
      },
    }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.data?.message || json.error.message || JSON.stringify(json.error));
  }
  return json.result;
}

const searchRead = (model, domain = [], fields = [], opts = {}) =>
  rpc(model, 'search_read', [domain], { fields, ...opts });

// ---------------------------------------------------------------------------
// Indentação do arch
//
// O Odoo devolve o arch numa linha só. Sem indentar não dá para ler nem
// comparar dois archs em diff.
//
// Um `>` dentro de valor de atributo quebraria a regex — mas em XML válido ele
// vem como `&gt;`, então o caso não ocorre num arch que o Odoo aceitou salvar.
// ---------------------------------------------------------------------------

function indentar(xml) {
  const plano = String(xml || '')
    .replace(/\r?\n\s*/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();

  let nivel = 0;
  const linhas = [];

  for (const token of plano.split(/(<[^>]+>)/)) {
    const t = token.trim();
    if (!t) continue;

    const fechamento   = /^<\//.test(t);
    const autoFechada  = /\/>$/.test(t);
    const declaracao   = /^<[!?]/.test(t);
    const abertura     = /^</.test(t) && !fechamento && !autoFechada && !declaracao;

    if (fechamento) nivel = Math.max(0, nivel - 1);
    linhas.push('  '.repeat(nivel) + t);
    if (abertura) nivel++;
  }

  return linhas.join('\n');
}

// Nome de arquivo previsível e sem surpresa de sistema de arquivos.
const seguro = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------

console.log(`\n🔌 ${CONFIG.url} (db=${CONFIG.db}, uid=${CONFIG.uid})`);
console.log(`📐 tipo=${CONFIG.tipo}  modelos=${CONFIG.modelos.join(', ')}\n`);

// Sanity check antes de qualquer coisa: uma falha de auth aqui é uma mensagem
// clara, em vez de um erro obscuro no meio da coleta.
try {
  const eu = await searchRead('res.users', [['id', '=', CONFIG.uid]], ['login'], { limit: 1 });
  if (!eu?.length) throw new Error('uid não encontrado');
} catch (e) {
  console.error(`❌ Falha de autenticação: ${e.message}`);
  console.error('   Confira URL, DB, UID e a API key.');
  process.exit(1);
}

await mkdir(CONFIG.saida, { recursive: true });
// A pasta se protege sozinha: quem clonar o repo não recebe archs por engano.
await writeFile(join(CONFIG.saida, '.gitignore'), '*\n!.gitignore\n', 'utf8');

const indice = { gerado_em: new Date().toISOString(), tipo: CONFIG.tipo, modelos: [] };

for (const modelo of CONFIG.modelos) {
  console.log(`── ${modelo}`);
  const entrada = { modelo, views: [], combinada: null, erros: [] };

  // 1) As views cruas, base e herdadas.
  let views = [];
  try {
    views = await searchRead(
      'ir.ui.view',
      [['model', '=', modelo], ['type', '=', CONFIG.tipo]],
      ['id', 'name', 'type', 'model', 'priority', 'inherit_id', 'mode', 'active', 'arch_db'],
      { order: 'priority,id' }
    );
  } catch (e) {
    console.log(`   ✗ ir.ui.view: ${e.message}`);
    entrada.erros.push(`ir.ui.view: ${e.message}`);
  }

  for (const v of views) {
    const heranca = v.inherit_id ? `herda de ${v.inherit_id[0]}` : 'base';
    const arquivo = `${seguro(modelo)}.${v.id}.${seguro(v.name)}.xml`;
    await writeFile(
      join(CONFIG.saida, arquivo),
      `<!-- ${modelo} · view ${v.id} · ${v.name} · ${heranca}`
        + ` · prioridade ${v.priority}${v.active ? '' : ' · INATIVA'} -->\n`
        + indentar(v.arch_db),
      'utf8'
    );
    console.log(`   ✓ ${arquivo}  (${heranca})`);
    entrada.views.push({
      id: v.id, name: v.name, priority: v.priority, active: v.active,
      inherit_id: v.inherit_id ? v.inherit_id[0] : null, mode: v.mode, arquivo,
    });
  }

  if (!views.length) console.log(`   · nenhuma view ${CONFIG.tipo} registrada`);

  // 2) A view COMBINADA — o Odoo aplicando as heranças. É o que o usuário vê,
  //    e para res.users é a única leitura que significa alguma coisa.
  //
  //    `get_view` é o método do Odoo 17+. `fields_view_get` é o nome antigo, e
  //    fica como reserva: custa três linhas e evita o script morrer numa base
  //    mais velha.
  let combinada = null;
  for (const metodo of ['get_view', 'fields_view_get']) {
    try {
      const r = metodo === 'get_view'
        ? await rpc(modelo, 'get_view', [false, CONFIG.tipo])
        : await rpc(modelo, 'fields_view_get', [], { view_type: CONFIG.tipo });
      if (r?.arch) { combinada = { metodo, arch: r.arch, view_id: r.id || null }; break; }
    } catch (e) {
      entrada.erros.push(`${metodo}: ${e.message}`);
    }
  }

  if (combinada) {
    const arquivo = `${seguro(modelo)}.COMBINADA.xml`;
    await writeFile(
      join(CONFIG.saida, arquivo),
      `<!-- ${modelo} · ${CONFIG.tipo} combinada (via ${combinada.metodo})`
        + ` · view ${combinada.view_id ?? '?'} -->\n`
        + indentar(combinada.arch),
      'utf8'
    );
    console.log(`   ✓ ${arquivo}  ← é esta que você quer ler`);
    entrada.combinada = { arquivo, metodo: combinada.metodo, view_id: combinada.view_id };
  } else {
    console.log(`   ✗ não consegui a view combinada`);
  }

  indice.modelos.push(entrada);
}

await writeFile(join(CONFIG.saida, 'indice.json'), JSON.stringify(indice, null, 2), 'utf8');

const total = indice.modelos.reduce((n, m) => n + m.views.length, 0);
console.log(`\n✅ ${total} view(s) + ${indice.modelos.filter(m => m.combinada).length} combinada(s)`);
console.log(`   em ${CONFIG.saida}/  (índice em indice.json)\n`);
