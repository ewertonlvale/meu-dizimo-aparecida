/**
 * instalar-aniversarios.mjs — O calendário de aniversariantes (BL-65).
 *
 * O QUE ELE CRIA
 *   1. `x_studio_aniversario` em x_dizimista — data, gravada.
 *   2. A ação agendada diária que a mantém, cujo código é o arquivo
 *      ferramentas/odoo-acoes/atualizar-aniversarios.py
 *   3. `calendar` no view_mode da ação de Dizimista, se faltar.
 *
 * POR QUE UM CAMPO NOVO, SE JÁ EXISTE A DATA DE NASCIMENTO
 *   Porque o calendário do Odoo posiciona o evento pela data que o campo
 *   guarda, e a data de nascimento guarda 14/03/1975. A view de calendário que
 *   já existia apontava para ela: abria, e não mostrava ninguém em mês nenhum
 *   que alguém fosse abrir. Sem erro, sem aviso — um calendário vazio parece
 *   "ninguém faz aniversário".
 *
 *   `x_studio_aniversario` guarda o mesmo dia e mês no ANO CORRENTE.
 *
 * POR QUE NÃO UM CAMPO CALCULADO
 *   Calculado só recalcula quando uma dependência muda. A dependência seria a
 *   data de nascimento, que não muda nunca; o que muda é o ano, que não é
 *   dependência de coisa alguma. Em 1º de janeiro o campo ficaria com o ano
 *   velho e o calendário esvaziaria de novo, em silêncio.
 *
 * COMO RODAR
 *     node ferramentas/instalar-aniversarios.mjs            (simula)
 *     node ferramentas/instalar-aniversarios.mjs --aplicar  (grava)
 *
 *   Depois: node ferramentas/baixar-views.mjs --update
 *   para levar a view de calendário que usa o campo.
 *
 *   A ação roda uma vez por dia. Para ver o calendário cheio na hora, use
 *   "Executar manualmente" em Definições → Técnico → Ações Agendadas — senão o
 *   campo fica vazio até a madrugada e a tela parece continuar quebrada.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv } from './odoo-env.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTE_PY = join(AQUI, 'odoo-acoes', 'atualizar-aniversarios.py');
const NOME_CRON = 'Meu Dízimo: atualizar aniversários';
const CAMPO = 'x_studio_aniversario';

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

const [modelo] = await buscar('ir.model', [['model', '=', 'x_dizimista']], ['id'], { limit: 1 });
if (!modelo) {
  console.error('❌ modelo x_dizimista não encontrado.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. O campo
// ---------------------------------------------------------------------------

console.log('── Campo em x_dizimista');

const [existe] = await buscar('ir.model.fields',
  [['model', '=', 'x_dizimista'], ['name', '=', CAMPO]], ['id', 'ttype'], { limit: 1 });

if (existe) {
  const ok = existe.ttype === 'date';
  console.log(`   ${ok ? '·' : '⚠️'} ${CAMPO} já existe (${existe.ttype})`
    + (ok ? ' — não vou mexer' : ' — esperava date, NÃO vou mexer'));
  if (!ok) process.exit(1);
} else if (!CONFIG.aplicar) {
  console.log(`   + ${CAMPO} (date) seria CRIADO`);
  console.log('     Guarda o mesmo dia e mês de x_studio_date, no ano corrente.');
} else {
  const id = await rpc('ir.model.fields', 'create', [{
    model_id: modelo.id,
    model: 'x_dizimista',
    name: CAMPO,
    field_description: 'Aniversário (ano corrente)',
    ttype: 'date',
    state: 'manual',
    store: true,
  }]);
  console.log(`   ✓ ${CAMPO} criado (id ${id})`);
}

// Quantas pessoas o calendário teria para mostrar. Sem isto, alguém aplica,
// abre o calendário vazio e conclui que não funcionou — quando o que falta é
// data de nascimento no cadastro.
const comData = await rpc('x_dizimista', 'search_count', [[['x_studio_date', '!=', false]]], {});
const total = await rpc('x_dizimista', 'search_count', [[]], {});
console.log(`   · ${comData} de ${total} dizimistas têm data de nascimento`);
if (!comData) {
  console.log('     ⚠️  NENHUM tem. O calendário vai nascer vazio, e o motivo');
  console.log('        é o cadastro, não a view.');
}

// ---------------------------------------------------------------------------
// 2. A ação agendada
// ---------------------------------------------------------------------------

console.log('\n── Ação agendada');

const [cron] = await buscar('ir.cron', [['name', '=', NOME_CRON]],
  ['id', 'code', 'active', 'interval_number', 'interval_type'], { limit: 1 });

if (!cron) {
  if (!CONFIG.aplicar) {
    console.log(`   + "${NOME_CRON}" seria CRIADA — diária, ativa`);
  } else {
    const id = await rpc('ir.cron', 'create', [{
      name: NOME_CRON,
      model_id: modelo.id,
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
    console.log('   ~ o código DIVERGE do repositório');
    console.log(`     Odoo: ${(cron.code || '').trim().split('\n').length} linhas`
      + ` · repositório: ${codigo.trim().split('\n').length} linhas`);
    console.log('     --aplicar sobrescreve com a versão do repositório.');
  } else {
    await rpc('ir.cron', 'write', [[cron.id], { code: codigo }]);
    console.log('   ✓ código atualizado a partir do repositório');
  }
}

// ---------------------------------------------------------------------------
// 3. O calendário no menu
// ---------------------------------------------------------------------------

console.log('\n── Ação de Dizimista');

const [acao] = await buscar('ir.actions.act_window',
  [['res_model', '=', 'x_dizimista']], ['id', 'name', 'view_mode'], { limit: 1 });

if (!acao) {
  console.log('   ⚠️  não achei a ação de x_dizimista — acrescente `calendar` ao view_mode à mão');
} else if ((acao.view_mode || '').split(',').map((v) => v.trim()).includes('calendar')) {
  console.log(`   · "${acao.name}" já tem calendar no view_mode (${acao.view_mode})`);
} else {
  const novo = `${acao.view_mode},calendar`;
  if (!CONFIG.aplicar) {
    console.log(`   ~ view_mode iria de "${acao.view_mode}" para "${novo}"`);
  } else {
    await rpc('ir.actions.act_window', 'write', [[acao.id], { view_mode: novo }]);
    console.log(`   ✓ view_mode agora é "${novo}"`);
  }
}

// ---------------------------------------------------------------------------

console.log(CONFIG.aplicar
  ? '\n✅ pronto.\n\n'
    + '   1. node ferramentas/baixar-views.mjs --update\n'
    + '      leva a view de calendário que usa o campo.\n\n'
    + '   2. Definições → Técnico → Ações Agendadas → "' + NOME_CRON + '"\n'
    + '      → Executar manualmente.\n'
    + '      Sem isso o campo fica vazio até a madrugada, e o calendário\n'
    + '      continua parecendo quebrado quando já não está.\n'
  : '\n👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
