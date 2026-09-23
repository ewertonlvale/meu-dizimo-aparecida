/**
 * instalar-escalonamento-notificacao.mjs — Os quatro números do disparo (BL-73).
 *
 * CRIA QUATRO CAMPOS em x_parametros, todos inteiros:
 *
 *   x_studio_notif_hora_inicio   a partir de que hora se pode tocar o telefone
 *   x_studio_notif_hora_fim      até que hora (EXCLUSIVO: 17 = último às 15h,
 *                                com intervalo 2; ponha 18 para incluir 17h)
 *   x_studio_notif_intervalo     de quantas em quantas horas sai um lote
 *   x_studio_notif_lote          quantos lembretes por lote
 *
 * POR QUE ESCALONAR
 *   O envio nunca foi o gargalo — ele já é sequencial, com 2 s entre mensagens.
 *   O gargalo é a ONDA DE VOLTA: quem recebe o lembrete responde nos minutos
 *   seguintes, cada resposta é uma execução do webhook, e o Apps Script tem
 *   teto de ~30 simultâneas (BL-21). Notificar 500 pessoas de uma vez não
 *   trava o envio; trava a conversa de todo mundo depois dele.
 *
 * POR QUE PARÂMETRO E NÃO NÚMERO NO CÓDIGO
 *   Mesma razão do x_studio_dias_comprovante (BL-69): quem sabe se 20 por vez
 *   é muito ou pouco é a paróquia. E, neste caso, há um motivo a mais — o
 *   acionador do Apps Script continua de hora em hora, e é a rotina que lê
 *   estes números a cada execução. Mudar aqui vale no disparo seguinte, sem
 *   ninguém abrir o editor do Apps Script.
 *
 * ENQUANTO OS CAMPOS NÃO EXISTIREM, o bot usa o padrão de fábrica
 * (NOTIFICACAO_PADRAO, em Config.gs): 9h–17h, a cada 2h, 20 por disparo.
 * O escalonamento JÁ VALE sem isto. Este instalador serve para AJUSTAR.
 *
 *     node ferramentas/instalar-escalonamento-notificacao.mjs            (simula)
 *     node ferramentas/instalar-escalonamento-notificacao.mjs --aplicar  (grava)
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

// Os padrões e as faixas TÊM QUE BATER com NOTIFICACAO_PADRAO e
// NOTIFICACAO_LIMITES, em Config.gs. São a mesma decisão escrita duas vezes,
// em linguagens diferentes — o harness (conta-mensagens.js) compara as duas
// listas e reprova se divergirem, porque a descrição do campo é o único lugar
// onde a paróquia lê a faixa antes de digitar um número fora dela.
const CAMPOS = [
  { nome: 'x_studio_notif_hora_inicio',
    rotulo: 'Notificação · hora inicial',
    padrao: 9, min: 0, max: 23,
    ajuda: 'A partir de que hora o bot pode enviar lembretes.' },
  { nome: 'x_studio_notif_hora_fim',
    rotulo: 'Notificação · hora final',
    padrao: 17, min: 1, max: 24,
    ajuda: 'Até que hora — EXCLUSIVO: 17 significa que o último disparo é antes das 17h. Para incluir a hora das 17h, use 18.' },
  { nome: 'x_studio_notif_intervalo',
    rotulo: 'Notificação · intervalo (horas)',
    padrao: 2, min: 1, max: 12,
    ajuda: 'De quantas em quantas horas sai um lote. Com início 9h e intervalo 2h: 9h, 11h, 13h, 15h.' },
  { nome: 'x_studio_notif_lote',
    rotulo: 'Notificação · lembretes por disparo',
    padrao: 20, min: 1, max: 200,
    ajuda: 'Quantos lembretes cada disparo envia. O resto fica para o disparo seguinte — ninguém é perdido, só adiado.' },
];

const [modelo] = await buscar('ir.model', [['model', '=', 'x_parametros']], ['id'], { limit: 1 });
if (!modelo) { console.error('❌ modelo x_parametros não encontrado.'); process.exit(1); }

const existentes = await buscar('ir.model.fields',
  [['model', '=', 'x_parametros'], ['name', 'in', CAMPOS.map((c) => c.nome)]],
  ['name', 'ttype']);
const porNome = new Map(existentes.map((f) => [f.name, f]));

let criados = 0;
for (const campo of CAMPOS) {
  const ja = porNome.get(campo.nome);

  if (ja) {
    const ok = ja.ttype === 'integer';
    console.log(`${ok ? '·' : '⚠️'} ${campo.nome} já existe (${ja.ttype})`
      + (ok ? ' — não vou mexer' : ' — esperava integer, NÃO vou mexer'));
    continue;
  }

  if (!CONFIG.aplicar) {
    console.log(`+ ${campo.nome} (integer) seria CRIADO`);
    console.log(`  ${campo.ajuda}`);
    console.log(`  Em branco, vale o padrão de fábrica: ${campo.padrao}.`);
    console.log(`  Fora de ${campo.min}..${campo.max} o bot ignora e volta ao padrão.`);
    continue;
  }

  const id = await rpc('ir.model.fields', 'create', [{
    model_id: modelo.id, model: 'x_parametros', name: campo.nome,
    field_description: campo.rotulo,
    ttype: 'integer', state: 'manual', store: true,
  }]);
  console.log(`✓ ${campo.nome} criado (id ${id})`);
  criados++;
}

console.log('');
if (!CONFIG.aplicar) {
  console.log('👀 nada foi gravado. Repita com --aplicar quando quiser valer.\n');
} else {
  console.log(`✅ pronto (${criados} campo(s) criado(s)).`);
  console.log('   Deixe em branco para manter o padrão de fábrica: 9h–17h, a cada 2h, 20 por disparo.');
  console.log('   Os campos ainda precisam ser ARRASTADOS para o formulário de Parâmetros');
  console.log('   no Studio — criar o campo não o coloca na tela.');
  console.log("   Para conferir o efeito: no editor do Apps Script, Executar → previsaoEscalonamento.\n");
}
