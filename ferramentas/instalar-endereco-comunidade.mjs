/**
 * instalar-endereco-comunidade.mjs — Endereço e mapa da comunidade (BL-54).
 *
 * O QUE ELE CRIA
 *   1. `x_studio_partner_id` em x_comunidade — many2one para res.partner.
 *      É o endereço de verdade, e é o que o mapa lê.
 *   2. Cinco campos RELACIONADOS, que espelham o endereço do parceiro direto
 *      na tela da comunidade: rua, complemento, cidade, UF e CEP. Editáveis —
 *      quem digita ali escreve no parceiro, sem precisar abrir outra tela.
 *   3. A view de MAPA de x_comunidade, que não existe hoje.
 *   4. `map` no view_mode da ação de Comunidade, senão a view existe e
 *      ninguém a alcança.
 *
 * POR QUE ATRAVÉS DE res.partner, E NÃO CAMPOS SOLTOS
 *   O mapa do Odoo geolocaliza ATRAVÉS do res.partner — verificado no arch da
 *   própria instância, na view de mapa de dizimista:
 *
 *       <map res_partner="x_studio_partner_id">
 *
 *   Ele não lê latitude e longitude soltas num modelo qualquer. Campos de
 *   endereço próprios em x_comunidade dariam a tela pedida e nenhum mapa.
 *
 *   Os cinco relacionados existem para dar as duas coisas: o endereço visível
 *   e editável na tela da comunidade, e um res.partner de verdade por baixo,
 *   que o mapa entende. O dado mora num lugar só — o parceiro —, então não há
 *   duas cópias para manter em sincronia.
 *
 * ⚠️ CRIAR O CAMPO NÃO POVOA O CAMPO
 *   O mapa de dizimista existe, está configurado e vive vazio: ninguém nunca
 *   preencheu `x_studio_partner_id` lá (0 de 508). Depois de rodar isto,
 *   alguém precisa abrir as 6 comunidades e informar o endereço. Sem isso o
 *   mapa novo nasce igualmente vazio.
 *
 * COMO RODAR
 *     node ferramentas/instalar-endereco-comunidade.mjs            (simula)
 *     node ferramentas/instalar-endereco-comunidade.mjs --aplicar  (grava)
 *
 *   Simular é o padrão: isto cria campo e view, que é bem menos reversível
 *   que reescrever o arch de uma view já existente.
 *
 *   Depois de aplicar, rode `node ferramentas/baixar-views.mjs --download`:
 *   a view de mapa nova passa a ser versionada como todas as outras.
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
// 1. Os campos
// ---------------------------------------------------------------------------

const PARTNER = 'x_studio_partner_id';

// O nome técnico repete o de x_dizimista de propósito: a view de mapa se liga
// por esse nome, e duas telas com o mesmo conceito com nomes diferentes é
// dívida que ninguém lembra de pagar.
const CAMPOS = [
  { name: PARTNER, label: 'Endereço', ttype: 'many2one', relation: 'res.partner',
    ajuda: 'o parceiro que guarda o endereço — é o que o mapa lê' },
  { name: 'x_studio_rua',         label: 'Rua',                 ttype: 'char',      related: `${PARTNER}.street` },
  { name: 'x_studio_complemento', label: 'Complemento / Bairro', ttype: 'char',     related: `${PARTNER}.street2` },
  { name: 'x_studio_cidade',      label: 'Cidade',              ttype: 'char',      related: `${PARTNER}.city` },
  { name: 'x_studio_uf',          label: 'Estado',              ttype: 'many2one',  relation: 'res.country.state', related: `${PARTNER}.state_id` },
  { name: 'x_studio_cep',         label: 'CEP',                 ttype: 'char',      related: `${PARTNER}.zip` },
];

const [modelo] = await buscar('ir.model', [['model', '=', 'x_comunidade']], ['id'], { limit: 1 });
if (!modelo) {
  console.error('❌ modelo x_comunidade não encontrado.');
  process.exit(1);
}

console.log('── Campos em x_comunidade');
for (const c of CAMPOS) {
  const [existe] = await buscar('ir.model.fields',
    [['model', '=', 'x_comunidade'], ['name', '=', c.name]], ['id', 'ttype'], { limit: 1 });

  if (existe) {
    console.log(`   · ${c.name} já existe (${existe.ttype}) — não vou mexer`);
    continue;
  }
  if (!CONFIG.aplicar) {
    console.log(`   + ${c.name} (${c.ttype}${c.related ? ` ← ${c.related}` : ''}) seria CRIADO`
      + (c.ajuda ? ` — ${c.ajuda}` : ''));
    continue;
  }

  const payload = {
    model_id: modelo.id, model: 'x_comunidade',
    name: c.name, field_description: c.label, ttype: c.ttype, state: 'manual',
  };
  if (c.relation) payload.relation = c.relation;
  if (c.related) {
    payload.related = c.related;
    // Relacionado E editável: quem digita a rua na tela da comunidade escreve
    // no parceiro. Sem isto o campo nasce só-leitura e a tela vira vitrine.
    payload.readonly = false;
    payload.store = false;
  } else {
    payload.store = true;
  }

  const id = await rpc('ir.model.fields', 'create', [payload]);
  console.log(`   ✓ ${c.name} criado (id ${id})`);
}

// ---------------------------------------------------------------------------
// 2. A view de mapa
//
// Criada aqui, e não pelo baixar-views, porque aquele só REESCREVE arch de
// view existente — criar tela continua sendo decisão explícita. Depois do
// --aplicar, um --download a traz para o repositório como todas as outras.
// ---------------------------------------------------------------------------

console.log('\n── View de mapa');

const ARCH_MAPA = `<map res_partner="${PARTNER}">
  <field name="x_name" string="Comunidade"/>
  <field name="x_studio_coordenador" string="Coordenador"/>
</map>`;

const [mapa] = await buscar('ir.ui.view',
  [['model', '=', 'x_comunidade'], ['type', '=', 'map']], ['id', 'name'], { limit: 1 });

if (mapa) {
  console.log(`   · já existe (id ${mapa.id}, "${mapa.name}") — não vou mexer`);
  console.log(`     Para mudar o conteúdo dela, use o baixar-views --update.`);
} else if (!CONFIG.aplicar) {
  console.log('   + view de mapa seria CRIADA, ligada pelo parceiro');
} else {
  const id = await rpc('ir.ui.view', 'create', [{
    name: 'Default map view for x_comunidade',
    model: 'x_comunidade',
    type: 'map',
    arch: ARCH_MAPA,
    priority: 16,
  }]);
  console.log(`   ✓ criada (id ${id})`);
}

// ---------------------------------------------------------------------------
// 3. O mapa no menu
//
// View sem view_mode é tela que existe e ninguém alcança.
// ---------------------------------------------------------------------------

console.log('\n── Ação de Comunidade');

const [acao] = await buscar('ir.actions.act_window',
  [['res_model', '=', 'x_comunidade']], ['id', 'name', 'view_mode'], { limit: 1 });

if (!acao) {
  console.log('   ⚠️  não achei a ação de x_comunidade — acrescente `map` ao view_mode à mão');
} else if ((acao.view_mode || '').split(',').map((v) => v.trim()).includes('map')) {
  console.log(`   · "${acao.name}" já tem map no view_mode (${acao.view_mode})`);
} else {
  const novo = `${acao.view_mode},map`;
  if (!CONFIG.aplicar) {
    console.log(`   ~ view_mode iria de "${acao.view_mode}" para "${novo}"`);
  } else {
    await rpc('ir.actions.act_window', 'write', [[acao.id], { view_mode: novo }]);
    console.log(`   ✓ view_mode agora é "${novo}"`);
  }
}

// ---------------------------------------------------------------------------

if (CONFIG.aplicar) {
  console.log('\n✅ pronto.');
  console.log('');
  console.log('   ⚠️  O MAPA NASCE VAZIO. Criar o campo não preenche o campo:');
  console.log('       abra as 6 comunidades e informe o endereço em cada uma.');
  console.log('       É o mesmo motivo pelo qual o mapa de dizimista, que já');
  console.log('       existe há tempos, nunca mostrou nada.');
  console.log('');
  console.log('   Depois: node ferramentas/baixar-views.mjs --download');
  console.log('   para versionar a view nova e pôr os campos no formulário.\n');
} else {
  console.log('\n👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
}
