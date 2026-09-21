/**
 * instalar-acao-classificacao.mjs — Instala no Odoo a ação agendada que
 * classifica o dizimista em Regular / Eventual / Inativo.
 *
 * O QUE ELE CRIA
 *   1. Dois campos em x_parametros, que são os controles da regra:
 *        x_studio_meses_regular   quantos meses fechados seguidos = Regular
 *        x_studio_meses_inativo   quantos meses sem devolver = Inativo
 *   2. Uma ação agendada (ir.cron) diária, cujo código é o arquivo
 *      ferramentas/odoo-acoes/classificar-dizimistas.py
 *
 * O ARQUIVO .py É A FONTE. O que está no Odoo é cópia.
 *   Ação agendada não tem histórico, nem diff, nem revisão — é o achado D3 da
 *   análise. Versionar o código no repositório e instalar a partir dele
 *   devolve as três coisas. Se alguém editar direto no Odoo, a simulação
 *   deste script acusa a divergência em vez de sobrescrever calado.
 *
 * COMO RODAR
 *   Usa as mesmas credenciais de ferramentas/.odoo-env.
 *
 *     node ferramentas/instalar-acao-classificacao.mjs            (simula)
 *     node ferramentas/instalar-acao-classificacao.mjs --aplicar  (grava)
 *
 * SIMULAR É O PADRÃO, ao contrário do baixar-views.
 *   Lá o --update reescreve uma view, e a versão anterior está no git. Aqui
 *   se cria campo e rotina que passa a rodar sozinha todo dia sobre 508
 *   registros. Gravar sem querer é de outra ordem, então gravar exige dizer
 *   que quer.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv } from './odoo-env.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTE_PY = join(AQUI, 'odoo-acoes', 'classificar-dizimistas.py');
const NOME_CRON = 'Meu Dízimo: classificar dizimistas';

const env = carregarEnv(process.env.ODOO_ENV_FILE || 'ferramentas/.odoo-env');
if (env?.carregadas.length) console.log(`🔑 ${env.caminho}: ${env.carregadas.join(', ')}`);
if (env?.vazias.length) console.log(`⚠️  ${env.caminho}: em branco → ${env.vazias.join(', ')}`);

const argv = process.argv.slice(2);
{
  const CONHECIDOS = new Set(['--aplicar', '--simular']);
  const estranhos = argv.filter((a) => a.startsWith('--') && !CONHECIDOS.has(a));
  if (estranhos.length) {
    console.error(`❌ Não conheço: ${estranhos.join(', ')}`);
    console.error(`   Conhecidos: ${[...CONHECIDOS].join(' ')}`);
    process.exit(1);
  }
}

const CONFIG = {
  url: (process.env.ODOO_URL || '').replace(/\/+$/, ''),
  db: process.env.ODOO_DB || '',
  uid: Number(process.env.ODOO_UID || 0),
  apiKey: process.env.ODOO_API_KEY || '',
  aplicar: argv.includes('--aplicar'),
};

if (!CONFIG.url || !CONFIG.db || !CONFIG.uid || !CONFIG.apiKey) {
  console.error('❌ Faltam credenciais. Veja ferramentas/.odoo-env.exemplo.');
  process.exit(1);
}
if (!existsSync(FONTE_PY)) {
  console.error(`❌ ${FONTE_PY} não existe — é ele que carrega o código da ação.`);
  process.exit(1);
}

async function rpc(model, method, args = [], kwargs = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call',
        params: {
          service: 'object', method: 'execute_kw',
          args: [CONFIG.db, CONFIG.uid, CONFIG.apiKey, model, method, args, kwargs],
        },
      }),
    });
  } catch (e) {
    // "fetch failed" é conexão, não credencial — ver a mesma nota no baixar-views.
    const causa = e.cause?.code || e.cause?.message || e.message;
    console.error(`❌ não consegui falar com ${CONFIG.url} (${causa})`);
    console.error('   Isso é CONEXÃO, não credencial. Nada foi criado.');
    process.exit(1);
  }
  const json = await res.json();
  if (json.error) throw new Error(json.error.data?.message || json.error.message);
  return json.result;
}

const buscar = (m, dom, campos, opts = {}) => rpc(m, 'search_read', [dom], { fields: campos, ...opts });

const codigo = readFileSync(FONTE_PY, 'utf8');

console.log(`\n🔌 ${CONFIG.url} (db=${CONFIG.db}, uid=${CONFIG.uid})`);
console.log(`📄 ${FONTE_PY.replace(/.*ferramentas/, 'ferramentas')} — ${codigo.split('\n').length} linhas`);
console.log(CONFIG.aplicar ? '✍️  modo: APLICAR\n' : '👀 modo: simulação (use --aplicar para gravar)\n');

// ---------------------------------------------------------------------------
// 1. Os dois parâmetros
// ---------------------------------------------------------------------------

const CAMPOS = [
  { name: 'x_studio_meses_regular', field_description: 'Meses para Regular',
    ajuda: 'quantos meses fechados seguidos com devolução classificam como Regular (padrão 3)' },
  { name: 'x_studio_meses_inativo', field_description: 'Meses para Inativo',
    ajuda: 'quantos meses sem nenhuma devolução classificam como Inativo (padrão 3)' },
];

const [modeloParam] = await buscar('ir.model', [['model', '=', 'x_parametros']], ['id'], { limit: 1 });
if (!modeloParam) {
  console.error('❌ modelo x_parametros não encontrado.');
  process.exit(1);
}

console.log('── Parâmetros em x_parametros');
for (const c of CAMPOS) {
  const [existe] = await buscar(
    'ir.model.fields',
    [['model', '=', 'x_parametros'], ['name', '=', c.name]], ['id', 'ttype'], { limit: 1 });

  if (existe) {
    const ok = existe.ttype === 'integer';
    console.log(`   ${ok ? '·' : '⚠️'} ${c.name} já existe (${existe.ttype})`
      + (ok ? ' — nada a fazer' : ' — esperava integer, NÃO vou mexer'));
    continue;
  }

  if (!CONFIG.aplicar) {
    console.log(`   + ${c.name} (integer) seria CRIADO — ${c.ajuda}`);
    continue;
  }
  const id = await rpc('ir.model.fields', 'create', [{
    model_id: modeloParam.id,
    model: 'x_parametros',
    name: c.name,
    field_description: c.field_description,
    ttype: 'integer',
    state: 'manual',
    store: true,
  }]);
  console.log(`   ✓ ${c.name} criado (id ${id})`);
}

// ---------------------------------------------------------------------------
// 2. A ação agendada
//
// Em Odoo moderno `ir.cron` HERDA de `ir.actions.server`: o cron É a ação, com
// o código dentro. Não há dois registros para manter em sincronia.
// ---------------------------------------------------------------------------

console.log('\n── Ação agendada');

const [modeloDizimista] = await buscar('ir.model', [['model', '=', 'x_dizimista']], ['id'], { limit: 1 });
if (!modeloDizimista) {
  console.error('❌ modelo x_dizimista não encontrado.');
  process.exit(1);
}

const [cron] = await buscar('ir.cron', [['name', '=', NOME_CRON]],
  ['id', 'code', 'active', 'interval_number', 'interval_type'], { limit: 1 });

if (!cron) {
  if (!CONFIG.aplicar) {
    console.log(`   + "${NOME_CRON}" seria CRIADA — diária, ativa`);
  } else {
    const id = await rpc('ir.cron', 'create', [{
      name: NOME_CRON,
      model_id: modeloDizimista.id,
      state: 'code',
      code: codigo,
      interval_number: 1,
      interval_type: 'days',
      active: true,
      user_id: CONFIG.uid,
    }]);
    console.log(`   ✓ criada (id ${id}) — diária`);
  }
} else {
  const igual = (cron.code || '').trim() === codigo.trim();
  console.log(`   · existe (id ${cron.id}), ${cron.active ? 'ativa' : 'INATIVA'},`
    + ` a cada ${cron.interval_number} ${cron.interval_type}`);

  if (igual) {
    console.log('   · o código no Odoo é igual ao do repositório');
  } else if (!CONFIG.aplicar) {
    console.log(`   ~ o código DIVERGE do repositório`);
    console.log(`     Odoo: ${(cron.code || '').trim().split('\n').length} linhas`
      + ` · repositório: ${codigo.trim().split('\n').length} linhas`);
    console.log(`     --aplicar sobrescreve com a versão do repositório.`);
    console.log(`     Se alguém editou no Odoo, aquilo se perde — confira antes.`);
  } else {
    await rpc('ir.cron', 'write', [[cron.id], { code: codigo }]);
    console.log('   ✓ código atualizado a partir do repositório');
  }
}

console.log(CONFIG.aplicar
  ? '\n✅ pronto. A ação roda uma vez por dia; para rodar agora, use "Executar manualmente"'
    + ' em Definições → Técnico → Ações Agendadas.\n'
  : '\n👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
