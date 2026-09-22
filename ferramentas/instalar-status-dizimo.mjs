/**
 * instalar-status-dizimo.mjs — O ciclo de vida da devolução (BL-62).
 *
 * O QUE ELE FAZ
 *   1. Acrescenta o estado `A devolver` a x_studio_status — o mês que já existe
 *      como compromisso e ainda não foi devolvido. É a previsibilidade.
 *   2. Renomeia os RÓTULOS dos três estados que já existem. Os valores
 *      gravados não mudam, então nada precisa ser migrado e o Config.gs não
 *      muda uma linha.
 *   3. Ordena os quatro na sequência do ciclo.
 *
 * POR QUE OS RÓTULOS MUDAM
 *   "Pendente" não significa "não devolveu". Significa "o comprovante chegou e
 *   o bot não conseguiu confirmar" — e é a maioria dos casos. Se o mesmo
 *   rótulo passasse a valer para "ainda não pagou", quem pagou com comprovante
 *   ilegível apareceria junto com quem não pagou, sem como distinguir.
 *
 *     Pendente   → Em conferência   o comprovante chegou, o bot não confirmou
 *     Confirmado → Conferido        o comprovante bate com a comunidade
 *     Rejeitado  → Não confere      o comprovante diverge
 *
 *   "Rejeitado" também acusava a pessoa. O registro não foi rejeitado; o
 *   comprovante não bateu. Quem lê isso antes de ligar para alguém precisa da
 *   diferença.
 *
 * ESTE INSTALADOR NÃO CRIA REGISTRO NENHUM
 *   Os `A devolver` nascem do bot, no Apps Script, quando uma devolução é
 *   registrada. Enquanto essa parte não subir, o estado existe e ninguém o usa
 *   — o que é inofensivo, e é de propósito: a base no Odoo pode ser conferida
 *   sozinha, antes de mexer no caminho do dinheiro.
 *
 * COMO RODAR
 *     node ferramentas/instalar-status-dizimo.mjs            (simula)
 *     node ferramentas/instalar-status-dizimo.mjs --aplicar  (grava)
 *
 *   Depois: node ferramentas/baixar-views.mjs --update
 */

import { carregarEnv } from './odoo-env.mjs';

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

console.log(`\n🔌 ${CONFIG.url} (db=${CONFIG.db}, uid=${CONFIG.uid})`);
console.log(CONFIG.aplicar ? '✍️  modo: APLICAR\n' : '👀 modo: simulação (use --aplicar para gravar)\n');

// ---------------------------------------------------------------------------
// 0. O campo precisa ser selection — e isso se confere, não se supõe
//
// `x_studio_conferencia_pix` parecia selection e era char; descobri tarde, e o
// plano inteiro para humanizá-lo teve de mudar (BL-61). Aqui a checagem vem
// antes de qualquer escrita.
// ---------------------------------------------------------------------------

const [campo] = await buscar('ir.model.fields',
  [['model', '=', 'x_devolucao'], ['name', '=', 'x_studio_status']],
  ['id', 'ttype', 'field_description'], { limit: 1 });

if (!campo) {
  console.error('❌ x_studio_status não existe em x_devolucao.');
  process.exit(1);
}
if (campo.ttype !== 'selection') {
  console.error(`❌ x_studio_status é ${campo.ttype}, não selection.`);
  console.error('   Sem seleção não há rótulo para renomear nem valor para acrescentar,');
  console.error('   e o Odoo recusa mudar o tipo de um campo existente. O caminho');
  console.error('   passaria a ser outro — me diga o que apareceu aqui.');
  process.exit(1);
}
console.log(`── x_studio_status (selection, id ${campo.id})`);

// ---------------------------------------------------------------------------
// 1. Os quatro estados
// ---------------------------------------------------------------------------

const CICLO = [
  { value: 'A devolver',  name: 'A devolver',      sequence: 10, novo: true },
  { value: 'Pendente',    name: 'Em conferência',  sequence: 20 },
  { value: 'Confirmado',  name: 'Conferido',       sequence: 30 },
  { value: 'Rejeitado',   name: 'Não confere',     sequence: 40 },
];

const atuais = await buscar('ir.model.fields.selection',
  [['field_id', '=', campo.id]], ['id', 'value', 'name', 'sequence'], { order: 'sequence asc' });

console.log(`   hoje: ${atuais.map((a) => `${a.value}="${a.name}"`).join(', ') || '(nenhum)'}`);

// Quantos registros existem em cada estado. Renomear rótulo não move registro
// nenhum, e dizer isso com número é mais convincente que dizer com palavra.
console.log('');
for (const e of CICLO) {
  const n = await rpc('x_devolucao', 'search_count', [[['x_studio_status', '=', e.value]]], {});
  const atual = atuais.find((a) => a.value === e.value);

  if (!atual) {
    if (e.novo) {
      console.log(CONFIG.aplicar
        ? `   ✓ "${e.value}" será criado — rótulo "${e.name}"`
        : `   + "${e.value}" seria CRIADO, rótulo "${e.name}" (0 registros, é estado novo)`);
      if (CONFIG.aplicar) {
        await rpc('ir.model.fields.selection', 'create', [{
          field_id: campo.id, value: e.value, name: e.name, sequence: e.sequence,
        }]);
      }
    } else {
      console.log(`   ⚠️  "${e.value}" não existe na seleção — esperava encontrá-lo. NÃO vou criar.`);
    }
    continue;
  }

  const mudaNome = atual.name !== e.name;
  const mudaOrdem = atual.sequence !== e.sequence;
  if (!mudaNome && !mudaOrdem) {
    console.log(`   · "${e.value}" já está como "${e.name}" (${n} registro(s))`);
    continue;
  }
  if (!CONFIG.aplicar) {
    console.log(`   ~ "${e.value}": rótulo "${atual.name}" → "${e.name}"`
      + `${mudaOrdem ? `, ordem ${atual.sequence} → ${e.sequence}` : ''}`
      + `  (${n} registro(s) — nenhum é movido, só o rótulo muda)`);
    continue;
  }
  await rpc('ir.model.fields.selection', 'write', [[atual.id], { name: e.name, sequence: e.sequence }]);
  console.log(`   ✓ "${e.value}" agora se chama "${e.name}" (${n} registro(s) intactos)`);
}

// Valores que existem no Odoo e não estão no ciclo: não são meus para mexer,
// mas quem vai usar precisa saber que estão lá.
const extras = atuais.filter((a) => !CICLO.some((c) => c.value === a.value));
if (extras.length) {
  console.log('');
  console.log(`   ⚠️  a seleção tem valor que este ciclo não prevê: ${extras.map((e) => `"${e.value}"`).join(', ')}`);
  console.log('      Não vou mexer neles. Confira se ainda fazem sentido.');
}

console.log(CONFIG.aplicar
  ? '\n✅ pronto.\n\n'
    + '   Nenhum registro mudou de estado: só rótulo e ordem.\n'
    + '   O estado "A devolver" existe e ainda não tem quem o use — quem cria\n'
    + '   esses registros é o bot, e essa parte ainda não subiu.\n\n'
    + '   Agora: node ferramentas/baixar-views.mjs --update\n'
  : '\n👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
