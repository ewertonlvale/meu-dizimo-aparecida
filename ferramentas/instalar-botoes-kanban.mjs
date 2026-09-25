/**
 * instalar-botoes-kanban.mjs — Os botões "Validado" e "Não recebido" no card
 * do kanban de devolução (BL-64).
 *
 * POR QUE ISTO NÃO É SÓ UMA MUDANÇA DE VIEW
 *   Botão de kanban que FAZ alguma coisa chama uma `ir.actions.server` por ID
 *   numérico. Esse ID nasce quando a ação é criada nesta instância — não existe
 *   antes, e não é o mesmo em outra base. Um arquivo versionado não tem como
 *   carregá-lo, e escrever um número às cegas produz botão que aponta para o
 *   nada.
 *
 *   Então o caminho é: este script cria as duas ações, descobre os IDs, e
 *   substitui o comentário MARCADOR-BOTOES-VALIDACAO do arch pelo bloco de
 *   botões já com os números certos. Um `baixar-views --download` depois traz o
 *   resultado para o repositório, e a view volta a percorrer o caminho normal.
 *
 * POR QUE NÃO O WIDGET state_selection, QUE SERIA UMA LINHA
 *   Porque na saas-19.3 ele não colore. O mapa de cores está cravado no código
 *   do widget — {blocked: "red", done: "green"} — e qualquer outro valor cai em
 *   cinza. Com A validar / Validado / Não recebido, os três pontinhos ficariam
 *   iguais, e um kanban que não se varre com o olho não serve para nada.
 *
 * ⚠️ RODE DEPOIS DO --update, NUNCA ANTES
 *   Ele procura o marcador no arch que está NO ODOO. Se a view de lá ainda for
 *   a antiga, o marcador não existe e o script para sem fazer nada.
 *
 *   E, uma vez que ele rode, o `--update` passa a PULAR esta view: o arch do
 *   Odoo deixa de bater com a impressão digital guardada no índice, que é
 *   exatamente a trava nº 3 do baixar-views. Não é problema — é a trava fazendo
 *   o trabalho dela. Rode o `--download` para religar os dois.
 *
 * COMO RODAR
 *     node ferramentas/baixar-views.mjs --update           (primeiro!)
 *     node ferramentas/instalar-botoes-kanban.mjs          (simula)
 *     node ferramentas/instalar-botoes-kanban.mjs --aplicar
 *     node ferramentas/baixar-views.mjs --download         (e faça o push)
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
// 0. O campo precisa existir, senão o botão grava no nada
// ---------------------------------------------------------------------------

const [campo] = await buscar('ir.model.fields',
  [['model', '=', 'x_devolucao'], ['name', '=', 'x_studio_validacao']], ['id'], { limit: 1 });
if (!campo) {
  console.error('❌ x_studio_validacao não existe em x_devolucao.');
  console.error('   Rode antes: node ferramentas/instalar-validacao-devolucao.mjs --aplicar');
  process.exit(1);
}

const [modelo] = await buscar('ir.model', [['model', '=', 'x_devolucao']], ['id'], { limit: 1 });
if (!modelo) {
  console.error('❌ modelo x_devolucao não encontrado.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. As duas ações
// ---------------------------------------------------------------------------

console.log('── Ações de servidor');

const ACOES = [
  { nome: 'Meu Dízimo: marcar devolução como Validada',    valor: 'validado' },
  { nome: 'Meu Dízimo: marcar devolução como Não recebida', valor: 'nao_recebido' },
];

const ids = {};
for (const a of ACOES) {
  const [existe] = await buscar('ir.actions.server', [['name', '=', a.nome]], ['id'], { limit: 1 });
  if (existe) {
    ids[a.valor] = existe.id;
    console.log(`   · "${a.nome}" já existe (id ${existe.id})`);
    continue;
  }
  if (!CONFIG.aplicar) {
    console.log(`   + "${a.nome}" seria CRIADA`);
    continue;
  }
  // `records` é o recordset que o botão do kanban entrega — um registro só,
  // o do card clicado.
  ids[a.valor] = await rpc('ir.actions.server', 'create', [{
    name: a.nome,
    model_id: modelo.id,
    state: 'code',
    code: `records.write({'x_studio_validacao': '${a.valor}'})`,
  }]);
  console.log(`   ✓ criada (id ${ids[a.valor]})`);
}

// ---------------------------------------------------------------------------
// 2. Os botões no arch
// ---------------------------------------------------------------------------

console.log('\n── Card do kanban');

const MARCADOR = 'MARCADOR-BOTOES-VALIDACAO';

const [vista] = await buscar('ir.ui.view',
  [['model', '=', 'x_devolucao'], ['type', '=', 'kanban']], ['id', 'name', 'arch_db'],
  { limit: 1, order: 'priority asc, id asc' });

if (!vista) {
  console.error('❌ não achei a view de kanban de x_devolucao.');
  process.exit(1);
}

const arch = vista.arch_db || '';
const jaTem = arch.includes('type="action"') && arch.includes('x_studio_validacao');
const temMarcador = arch.includes(MARCADOR);

if (!temMarcador && jaTem) {
  console.log(`   · os botões já estão no arch da view ${vista.id} — não vou mexer`);
  console.log('     Para refazer, apague-os no Odoo e rode o baixar-views –update de novo.');
  process.exit(0);
}
if (!temMarcador) {
  console.error(`   ❌ não achei o comentário ${MARCADOR} no arch da view ${vista.id}.`);
  console.error('      Isso quer dizer que o Odoo ainda está com a view antiga.');
  console.error('      Rode antes: node ferramentas/baixar-views.mjs --update');
  process.exit(1);
}

if (!CONFIG.aplicar) {
  console.log(`   ~ o marcador ${MARCADOR} seria trocado pelos dois botões`);
  console.log(`     na view ${vista.id} ("${vista.name}")`);
  console.log('     IDs das ações ainda não existem — eles nascem no --aplicar.');
  console.log('\n👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
  process.exit(0);
}

if (!ids.validado || !ids.nao_recebido) {
  console.error('❌ faltou o ID de uma das ações — não vou escrever botão pela metade.');
  process.exit(1);
}

// Um botão some quando o registro já está no estado que ele aplica: oferecer
// "Validado" no que já está validado é convidar a um clique que não faz nada.
const BOTOES = `<div class="mt-2 d-flex gap-1">
          <button name="${ids.validado}" type="action" class="btn btn-sm btn-outline-success"
                  invisible="x_studio_validacao == 'validado'">Validado</button>
          <button name="${ids.nao_recebido}" type="action" class="btn btn-sm btn-outline-danger"
                  invisible="x_studio_validacao == 'nao_recebido'">Não recebido</button>
        </div>`;

// O comentário inteiro sai, não só a palavra do marcador: deixar o texto
// explicativo ali depois de ele ter deixado de ser verdade é pior que não
// haver comentário nenhum.
const novoArch = arch.replace(new RegExp(`<!--\\s*${MARCADOR}[\\s\\S]*?-->`), BOTOES);
if (novoArch === arch) {
  console.error('❌ achei o marcador mas não consegui substituí-lo. Nada foi gravado.');
  process.exit(1);
}

await rpc('ir.ui.view', 'write', [[vista.id], { arch_db: novoArch }]);
console.log(`   ✓ botões inseridos na view ${vista.id}`);

console.log('\n✅ pronto.');
console.log('');
console.log('   Agora: node ferramentas/baixar-views.mjs --download');
console.log('   Sem isso o repositório continua com o marcador, e o próximo');
console.log('   --update devolveria a view sem botão. (Na prática ele vai PULAR');
console.log('   esta view, porque o arch do Odoo deixou de bater com o índice —');
console.log('   é a trava nº 3 do baixar-views funcionando. Mesmo assim, baixe.)');
console.log('');
