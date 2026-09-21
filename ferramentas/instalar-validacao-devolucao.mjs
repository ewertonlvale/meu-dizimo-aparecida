/**
 * instalar-validacao-devolucao.mjs — A validação do coordenador (BL-60).
 *
 * O QUE ELE CRIA
 *   Um campo só: `x_studio_validacao` em x_devolucao, com três estados —
 *   A validar · Validado · Não recebido.
 *
 * POR QUE UM CAMPO NOVO E NÃO O x_studio_status QUE JÁ EXISTE
 *   Porque são dois julgamentos diferentes, feitos por dois autores, sobre
 *   coisas diferentes:
 *
 *     x_studio_status     o BOT leu o comprovante e ele bate  (BL-51)
 *     x_studio_validacao  o COORDENADOR viu o dinheiro entrar
 *
 *   Num campo só, "Confirmado" passa a significar duas coisas e ninguém sabe
 *   qual delas está vendo. Pior: o coordenador não consegue DISCORDAR do bot
 *   sem apagar a leitura dele — e é justamente a discordância (bot diz que
 *   bate, o dinheiro não entrou) que a paróquia precisa enxergar.
 *
 *   É a mesma forma do BL-59, onde a ação agendada desfazia a classificação
 *   feita à mão. Lá a saída foi separar quem decide o quê. Aqui também.
 *
 * QUEM VALIDOU E QUANDO — sem campo nenhum
 *   O campo nasce com `tracking`, e x_devolucao tem chatter. Toda mudança de
 *   validação vira uma linha no histórico do registro, com autor e horário.
 *   Dois campos a menos para manter, e um histórico em vez de um instante.
 *
 * ⚠️ ELE ESCREVE NOS REGISTROS QUE JÁ EXISTEM
 *   Campo novo nasce vazio, e barra de status vazia não mostra estado nenhum.
 *   Então o --aplicar marca toda devolução existente como "A validar". A
 *   simulação diz quantas são antes de você decidir.
 *
 * COMO RODAR
 *     node ferramentas/instalar-validacao-devolucao.mjs            (simula)
 *     node ferramentas/instalar-validacao-devolucao.mjs --aplicar  (grava)
 *
 *   Depois: node ferramentas/baixar-views.mjs --update
 *   para levar as views (formulário, lista e filtros) que usam o campo.
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

const CAMPO = 'x_studio_validacao';
// Rótulos curtos de propósito: isto vira barra de status no topo do
// formulário, e "Aguardando validação do coordenador" não cabe ali.
const ESTADOS = [
  { value: 'a_validar',    name: 'A validar',    sequence: 10 },
  { value: 'validado',     name: 'Validado',     sequence: 20 },
  { value: 'nao_recebido', name: 'Não recebido', sequence: 30 },
];

const [modelo] = await buscar('ir.model', [['model', '=', 'x_devolucao']], ['id'], { limit: 1 });
if (!modelo) {
  console.error('❌ modelo x_devolucao não encontrado.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. O campo
// ---------------------------------------------------------------------------

console.log('── Campo em x_devolucao');

const [existe] = await buscar('ir.model.fields',
  [['model', '=', 'x_devolucao'], ['name', '=', CAMPO]], ['id', 'ttype'], { limit: 1 });

let campoId = existe?.id || null;

if (existe) {
  const ok = existe.ttype === 'selection';
  console.log(`   ${ok ? '·' : '⚠️'} ${CAMPO} já existe (${existe.ttype})`
    + (ok ? ' — não vou mexer' : ' — esperava selection, NÃO vou mexer'));
  if (!ok) process.exit(1);
} else if (!CONFIG.aplicar) {
  console.log(`   + ${CAMPO} (selection) seria CRIADO`);
  console.log(`     estados: ${ESTADOS.map((e) => e.name).join(' → ')}`);
  console.log(`     com tracking: toda mudança vira linha no histórico do registro`);
} else {
  campoId = await rpc('ir.model.fields', 'create', [{
    model_id: modelo.id,
    model: 'x_devolucao',
    name: CAMPO,
    field_description: 'Validação',
    ttype: 'selection',
    state: 'manual',
    store: true,
    // Inteiro, e não booleano: em ir.model.fields este campo é "Enable
    // Ordered Tracking", e o número é a ordem em que a mudança aparece no
    // histórico quando várias mudam de uma vez.
    tracking: 1,
    selection_ids: ESTADOS.map((e) => [0, 0, e]),
  }]);
  console.log(`   ✓ ${CAMPO} criado (id ${campoId})`);
}

// ---------------------------------------------------------------------------
// 2. O padrão, para registro novo já nascer na barra
// ---------------------------------------------------------------------------

console.log('\n── Padrão para registros novos');

if (!campoId) {
  console.log('   · (o campo ainda não existe; o padrão vem junto no --aplicar)');
} else {
  const [padrao] = await buscar('ir.default',
    [['field_id', '=', campoId]], ['id', 'json_value'], { limit: 1 });
  if (padrao) {
    console.log(`   · já existe (${padrao.json_value}) — não vou mexer`);
  } else if (!CONFIG.aplicar) {
    console.log('   + padrão "a_validar" seria criado');
  } else {
    const id = await rpc('ir.default', 'create', [{
      field_id: campoId,
      json_value: '"a_validar"',
    }]);
    console.log(`   ✓ padrão "a_validar" criado (id ${id})`);
  }
}

// ---------------------------------------------------------------------------
// 3. Os registros que já existem
//
// Campo novo nasce vazio, e barra de status sem valor não destaca nada: o
// coordenador abriria as devoluções de hoje e não veria em que ponto está.
// ---------------------------------------------------------------------------

console.log('\n── Devoluções que já existem');

const semValor = campoId
  ? await rpc('x_devolucao', 'search', [[[CAMPO, '=', false]]], {})
  : await rpc('x_devolucao', 'search', [[]], {});

if (!semValor.length) {
  console.log('   · nenhuma sem validação — nada a fazer');
} else if (!CONFIG.aplicar || !campoId) {
  console.log(`   ~ ${semValor.length} devolução(ões) seriam marcadas como "A validar"`);
  console.log('     Nenhuma conclusão sobre elas: "A validar" quer dizer');
  console.log('     exatamente que ninguém olhou ainda, que é a verdade.');
} else {
  await rpc('x_devolucao', 'write', [semValor, { [CAMPO]: 'a_validar' }]);
  console.log(`   ✓ ${semValor.length} devolução(ões) marcadas como "A validar"`);
}

// ---------------------------------------------------------------------------

console.log(CONFIG.aplicar
  ? '\n✅ pronto.\n\n'
    + '   Agora: node ferramentas/baixar-views.mjs --update\n'
    + '   É ele que leva o formulário, a lista e os filtros que usam o campo.\n'
    + '   Até lá o campo existe e ninguém o alcança pela tela.\n'
  : '\n👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
