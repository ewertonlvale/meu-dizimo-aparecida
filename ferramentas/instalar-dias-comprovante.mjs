/**
 * instalar-dias-comprovante.mjs — O limite de idade do comprovante (BL-69).
 *
 * CRIA UM CAMPO SÓ: `x_studio_dias_comprovante` em x_parametros.
 *
 * A partir de quantos dias um comprovante deixa de ser aceito como "dízimo
 * deste mês" e passa a cair em "Não confere", com a pessoa avisada.
 *
 * POR QUE PARÂMETRO E NÃO NÚMERO NO CÓDIGO
 *   Quem sabe se dois meses é muito ou pouco é a paróquia, não quem escreveu
 *   isto. Mesma forma dos `x_studio_meses_regular` do BL-56.
 *
 * ENQUANTO O CAMPO NÃO EXISTIR, o bot usa o padrão de fábrica de 60 dias
 * (DIAS_COMPROVANTE_ANTIGO_PADRAO, em Config.gs) — a regra já vale sem isto.
 * Este instalador serve para poder AJUSTAR.
 *
 *     node ferramentas/instalar-dias-comprovante.mjs            (simula)
 *     node ferramentas/instalar-dias-comprovante.mjs --aplicar  (grava)
 */

import { carregarEnv } from './odoo-env.mjs';

const env = carregarEnv(process.env.ODOO_ENV_FILE || 'ferramentas/.odoo-env');
if (env?.carregadas.length) console.log(`🔑 ${env.caminho}: ${env.carregadas.join(', ')}`);

const argv = process.argv.slice(2);
{
  const CONHECIDOS = new Set(['--aplicar', '--simular']);
  const estranhos = argv.filter((a) => a.startsWith('--') && !CONHECIDOS.has(a));
  if (estranhos.length) {
    console.error(`❌ Não conheço: ${estranhos.join(', ')}`);
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
    console.error('   Isso é CONEXÃO, não credencial. Nada foi criado.');
    process.exit(1);
  }
  const json = await res.json();
  if (json.error) throw new Error(json.error.data?.message || json.error.message);
  return json.result;
}
const buscar = (m, d, c, o = {}) => rpc(m, 'search_read', [d], { fields: c, ...o });

console.log(`\n🔌 ${CONFIG.url} (db=${CONFIG.db}, uid=${CONFIG.uid})`);
console.log(CONFIG.aplicar ? '✍️  modo: APLICAR\n' : '👀 modo: simulação (use --aplicar para gravar)\n');

const CAMPO = 'x_studio_dias_comprovante';
const PADRAO = 60;

const [modelo] = await buscar('ir.model', [['model', '=', 'x_parametros']], ['id'], { limit: 1 });
if (!modelo) { console.error('❌ modelo x_parametros não encontrado.'); process.exit(1); }

const [existe] = await buscar('ir.model.fields',
  [['model', '=', 'x_parametros'], ['name', '=', CAMPO]], ['id', 'ttype'], { limit: 1 });

if (existe) {
  const ok = existe.ttype === 'integer';
  console.log(`${ok ? '·' : '⚠️'} ${CAMPO} já existe (${existe.ttype})`
    + (ok ? ' — não vou mexer' : ' — esperava integer, NÃO vou mexer'));
} else if (!CONFIG.aplicar) {
  console.log(`+ ${CAMPO} (integer) seria CRIADO`);
  console.log(`  A partir de quantos dias o comprovante deixa de ser aceito.`);
  console.log(`  Em branco, vale o padrão de fábrica: ${PADRAO} dias.`);
  console.log(`  Fora de 1..365 o bot ignora e volta ao padrão — o campo é`);
  console.log(`  editável por quem não escreveu o código.`);
} else {
  const id = await rpc('ir.model.fields', 'create', [{
    model_id: modelo.id, model: 'x_parametros', name: CAMPO,
    field_description: 'Dias para comprovante antigo',
    ttype: 'integer', state: 'manual', store: true,
  }]);
  console.log(`✓ ${CAMPO} criado (id ${id})`);
}

console.log(CONFIG.aplicar
  ? `\n✅ pronto. Deixe em branco para manter os ${PADRAO} dias de fábrica.\n`
  : '\n👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
