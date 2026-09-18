/**
 * odoo-dump.mjs — Extrai o schema e as regras de negócio do Odoo via JSON-RPC.
 *
 * O QUE BAIXA:
 *   - Modelos customizados (x_* e "manual") + contagem de registros
 *   - Campos de cada modelo (tipo, relação, required, store, related, selection)
 *   - Opções de campos selection
 *   - Crons / ações agendadas (rotinas)
 *   - Server actions (código Python de regras)
 *   - Automações do Studio (base.automation)
 *   - Record rules (ir.rule)
 *
 * COMO RODAR (Node 18+, usa fetch nativo — nada para instalar):
 *
 *   PowerShell:
 *     $env:ODOO_API_KEY = "SUA_API_KEY"
 *     node odoo-dump.mjs --url https://sua-instancia.odoo.com --db seu_db --uid 2
 *
 *   bash:
 *     ODOO_API_KEY=... node odoo-dump.mjs --url ... --db ... --uid 2
 *
 *   Ou tudo por variável de ambiente: ODOO_URL, ODOO_DB, ODOO_UID, ODOO_API_KEY.
 *
 * SAÍDA (na pasta atual):
 *   - odoo-dump.json  → tudo, estruturado
 *   - odoo-dump.md    → resumo legível
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SEGURANÇA — por que nada vem preenchido aqui
 *
 * Este arquivo é versionado num repositório PÚBLICO. URL, banco e uid não são
 * segredo por si sós, mas juntos transformam um alvo anônimo num alvo nomeado:
 * são exatamente as entradas que este script pede, menos a chave. Por isso não
 * há valor padrão nenhum — o script recusa rodar sem receber os três.
 *
 * A API KEY só entra por VARIÁVEL DE AMBIENTE, nunca por argumento. Argumento
 * de linha de comando fica no histórico do shell e aparece na lista de
 * processos da máquina; variável de ambiente, não.
 *
 * A identificação (url, db, uid, login do usuário) FICA DE FORA dos arquivos
 * gerados, a menos que você peça com --identificar. Assim o dump pode ser
 * versionado ou enviado para análise sem carregar o endereço da instância.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const arg = nome => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
};

const IDENTIFICAR = argv.includes('--identificar');

const CONFIG = {
  url:    (arg('url') || process.env.ODOO_URL || '').replace(/\/+$/, ''),
  db:      arg('db')  || process.env.ODOO_DB  || '',
  uid:     Number(arg('uid') || process.env.ODOO_UID || 0),
  // Só env: argumento de linha de comando fica no histórico do shell e na
  // lista de processos.
  apiKey:  process.env.ODOO_API_KEY || '',
};

const faltando = [];
if (!CONFIG.url)    faltando.push('--url (ou ODOO_URL)');
if (!CONFIG.db)     faltando.push('--db (ou ODOO_DB)');
if (!CONFIG.uid)    faltando.push('--uid (ou ODOO_UID)');
if (!CONFIG.apiKey) faltando.push('ODOO_API_KEY (variável de ambiente)');

if (faltando.length) {
  console.error('❌ Faltou:\n   ' + faltando.join('\n   '));
  console.error('\nExemplo:');
  console.error('   $env:ODOO_API_KEY = "sua-chave"');
  console.error('   node odoo-dump.mjs --url https://sua-instancia.odoo.com --db seu_db --uid 2');
  console.error('\nNada vem preenchido de fábrica de propósito — veja a nota de');
  console.error('segurança no topo do arquivo.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

async function rpc(model, method, args = [], kwargs = {}) {
  const payload = {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args: [CONFIG.db, CONFIG.uid, CONFIG.apiKey, model, method, args, kwargs],
    },
  };
  const res = await fetch(`${CONFIG.url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error.data?.message || json.error.message || JSON.stringify(json.error);
    throw new Error(msg);
  }
  return json.result;
}

const searchRead = (model, domain = [], fields = [], opts = {}) =>
  rpc(model, 'search_read', [domain], { fields, ...opts });

// Executa uma seção e captura erro sem abortar o dump inteiro.
async function secao(nome, fn) {
  process.stdout.write(`• ${nome}... `);
  try {
    const r = await fn();
    const n = Array.isArray(r) ? r.length : (r && typeof r === 'object' ? Object.keys(r).length : r);
    console.log(`ok (${n})`);
    return { ok: true, data: r };
  } catch (e) {
    console.log(`FALHOU: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------

const out = { gerado_em: new Date().toISOString() };

// A identificação da instância só entra no arquivo com --identificar. Sem ela,
// o dump é só o schema — que é o que serve para analisar — e pode ser
// versionado ou enviado adiante sem carregar o endereço da instância.
out.odoo = IDENTIFICAR
  ? { url: CONFIG.url, db: CONFIG.db, uid: CONFIG.uid }
  : { url: '(omitido)', db: '(omitido)', uid: '(omitido)' };

console.log(`\n🔌 Conectando em ${CONFIG.url} (db=${CONFIG.db}, uid=${CONFIG.uid})\n`);

// 0) Sanity check de autenticação
{
  const chk = await secao('auth (res.users)', () =>
    searchRead('res.users', [['id', '=', CONFIG.uid]], ['login', 'name'], { limit: 1 }));
  if (!chk.ok) {
    console.error('\n❌ Falha de autenticação — confira URL/DB/UID/API key.');
    process.exit(1);
  }
  out.usuario = IDENTIFICAR ? (chk.data?.[0] || null) : '(omitido)';
}

// 1) Modelos
const modelosRes = await secao('modelos (ir.model)', () =>
  searchRead('ir.model', [], ['model', 'name', 'state', 'transient'], { order: 'model asc' }));
out.modelos = modelosRes;

const modelosCustom = (modelosRes.data || [])
  .filter(m => m.model.startsWith('x_') || m.state === 'manual')
  .map(m => m.model);

out.modelos_custom = modelosCustom;

// 2) Campos dos modelos customizados
out.campos = await secao('campos (ir.model.fields dos modelos x_/manual)', () =>
  searchRead(
    'ir.model.fields',
    [['model', 'in', modelosCustom]],
    ['model', 'name', 'field_description', 'ttype', 'relation', 'relation_field',
     'required', 'readonly', 'store', 'related', 'selection', 'help'],
    { order: 'model asc, name asc' }
  ));

// 3) Opções de campos selection (Odoo 14+: ir.model.fields.selection)
out.selection_options = await secao('opções de selection (ir.model.fields.selection)', async () => {
  const ids = (out.campos.data || []).filter(f => f.ttype === 'selection').map(f => f.id);
  if (!ids.length) return [];
  return searchRead('ir.model.fields.selection', [['field_id', 'in', ids]],
    ['field_id', 'value', 'name', 'sequence']);
});

// 4) Contagem de registros por modelo customizado
out.contagens = await secao('contagem de registros (search_count por modelo)', async () => {
  const res = {};
  for (const m of modelosCustom) {
    try { res[m] = await rpc(m, 'search_count', [[]]); }
    catch (e) { res[m] = `erro: ${e.message}`; }
  }
  return res;
});

// 5) Crons / ações agendadas (rotinas)
out.crons = await secao('crons (ir.cron)', () =>
  searchRead('ir.cron', [], ['name', 'model_id', 'state', 'active', 'interval_number',
    'interval_type', 'numbercall', 'nextcall', 'code'], { order: 'name asc' }));

// 6) Server actions (código de regras)
out.server_actions = await secao('server actions (ir.actions.server)', () =>
  searchRead('ir.actions.server', [], ['name', 'model_name', 'state', 'usage', 'code'],
    { order: 'name asc' }));

// 7) Automações do Studio
out.automacoes = await secao('automações (base.automation)', () =>
  searchRead('base.automation', [], ['name', 'model_id', 'trigger', 'filter_domain',
    'active', 'action_server_id'], { order: 'name asc' }));

// 8) Record rules
out.record_rules = await secao('record rules (ir.rule)', () =>
  searchRead('ir.rule', [], ['name', 'model_id', 'domain_force', 'active'], { order: 'name asc' }));

// ---------------------------------------------------------------------------
// Escrita dos arquivos
// ---------------------------------------------------------------------------

await writeFile('odoo-dump.json', JSON.stringify(out, null, 2), 'utf8');

// Resumo legível (.md)
function mdResumo(o) {
  const L = [];
  L.push(`# Dump do Odoo — ${o.gerado_em}`);
  L.push(`\nOdoo: ${o.odoo.url} · db: ${o.odoo.db} · uid: ${o.odoo.uid}`);

  const camposPorModelo = {};
  (o.campos.data || []).forEach(f => {
    (camposPorModelo[f.model] ||= []).push(f);
  });
  const selPorCampo = {};
  (o.selection_options.data || []).forEach(s => {
    const fid = Array.isArray(s.field_id) ? s.field_id[0] : s.field_id;
    (selPorCampo[fid] ||= []).push(s.value);
  });

  L.push(`\n## Modelos customizados (${(o.modelos_custom || []).length})\n`);
  for (const modelo of o.modelos_custom || []) {
    const cnt = o.contagens.data?.[modelo];
    L.push(`### \`${modelo}\`  — registros: ${cnt}`);
    const fs = camposPorModelo[modelo] || [];
    if (!fs.length) { L.push('_(sem campos custom listados)_\n'); continue; }
    L.push('| campo | tipo | relação | related (path) | req | store | ro | selection |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const f of fs) {
      const sel = (selPorCampo[f.id] || []).join(', ');
      L.push(`| \`${f.name}\` | ${f.ttype} | ${f.relation || ''} | ${f.related || ''} | ` +
        `${f.required ? 'sim' : ''} | ${f.store ? 'sim' : ''} | ${f.readonly ? 'sim' : ''} | ${sel} |`);
    }
    L.push('');
  }

  const secaoLista = (titulo, res, fmt) => {
    L.push(`## ${titulo}`);
    if (!res.ok) { L.push(`_falhou: ${res.error}_\n`); return; }
    const arr = res.data || [];
    if (!arr.length) { L.push('_(nenhum)_\n'); return; }
    arr.forEach(x => L.push(fmt(x)));
    L.push('');
  };

  secaoLista('Crons / rotinas', o.crons, c =>
    `- **${c.name}** — ${c.active ? 'ativo' : 'inativo'}, a cada ${c.interval_number} ${c.interval_type}, próx: ${c.nextcall}`);
  secaoLista('Server actions', o.server_actions, a =>
    `- **${a.name}** (${a.model_name || '-'}, ${a.state})`);
  secaoLista('Automações (Studio)', o.automacoes, a =>
    `- **${a.name}** — trigger: ${a.trigger}, ${a.active ? 'ativa' : 'inativa'}`);
  secaoLista('Record rules', o.record_rules, r =>
    `- **${r.name}** — ${r.active ? 'ativa' : 'inativa'}`);

  return L.join('\n');
}

await writeFile('odoo-dump.md', mdResumo(out), 'utf8');

console.log('\n✅ Concluído.');
console.log('   → odoo-dump.json  (completo — envie este para análise)');
console.log('   → odoo-dump.md    (resumo legível)');
console.log(`\nModelos customizados encontrados: ${out.modelos_custom.length}`);
