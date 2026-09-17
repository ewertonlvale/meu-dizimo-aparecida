#!/usr/bin/env node
/**
 * ============================================================================
 * SIMULA-CARGA.JS — teste de concorrência do webhook
 * ============================================================================
 *
 * Roda na SUA máquina, não no Apps Script. Isso não é conveniência: uma função
 * no editor do GAS é UMA execução, então um laço lá dentro roda em sequência e
 * NÃO reproduz corrida alguma. Só requisições paralelas de fora criam execuções
 * simultâneas de verdade.
 *
 * ⚠️ Dispara mensagens reais no bot, que grava no Odoo e tenta responder pelo
 * WhatsApp. Use apenas contra um ambiente descartável.
 *
 * USO
 *   node simula-carga.js --url "<URL>/exec" --token "<SECRET>" --modo teto --usuarios 20
 *   node simula-carga.js --url "<URL>/exec" --token "<SECRET>" --modo corrida --comunidade 3
 *
 * MODOS
 *   teto     N usuários distintos mandam uma mensagem ao mesmo tempo.
 *            Mede o teto de execuções simultâneas e a latência sob carga.
 *
 *   corrida  UM usuário, levado até o meio do cadastro, recebe N mensagens
 *            simultâneas. É o cenário de lost update: cada mensagem dispara
 *            um read-modify-write de `dados_<from>` em `salvarCampoEMudarEstado`.
 *
 *            ⚠️ A PREPARAÇÃO É ESSENCIAL. Disparar texto num usuário em estado
 *            MENU não escreve campo de cadastro nenhum — o Router só mostraria
 *            o menu, e o teste "passaria" sem ter exercitado a corrida. Por isso
 *            o modo corrida primeiro caminha, EM SEQUÊNCIA, até AGUARDANDO_NOME,
 *            e só então dispara a rajada.
 *
 *            Exige --comunidade com o id de uma comunidade real do Odoo.
 *
 * DEPOIS DE RODAR
 *   - Aqui: quantas requisições não voltaram 200 e a distribuição de latência.
 *   - Painel de execuções do Apps Script: quantas rodaram em paralelo e se
 *     houve "too many simultaneous invocations".
 *   - Odoo: no modo corrida, se o cadastro ficou com todos os campos; em
 *     qualquer modo, se houve x_contato_bot duplicado para o mesmo número.
 *
 * LIMPEZA
 *   Os números fictícios começam com 5599. O lixo em x_contato_bot sai com
 *   limparContatosTeste() no editor do Apps Script.
 */

const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const URL_WEBHOOK = opt('url');
const TOKEN       = opt('token');
const MODO        = opt('modo', 'teto');
const USUARIOS    = parseInt(opt('usuarios', '10'), 10);
const MENSAGENS   = parseInt(opt('mensagens', '5'), 10);
const COMUNIDADE  = opt('comunidade');

if (!URL_WEBHOOK || !TOKEN) {
  console.error('Faltou --url ou --token. Veja o cabeçalho do arquivo.');
  process.exit(1);
}
if (MODO === 'corrida' && !COMUNIDADE) {
  console.error('O modo corrida exige --comunidade <id de uma comunidade do Odoo>.');
  console.error('Sem ela não há como levar o usuário até o passo de cadastro que sofre a corrida.');
  process.exit(1);
}

const DDD_TESTE = '5599';
const espera = ms => new Promise(r => setTimeout(r, ms));

/**
 * O webhook deduplica por messageId (cache de 10 min). Sem id único, todas as
 * requisições menos a primeira seriam ignoradas em silêncio — e o teste
 * pareceria passar sem ter processado nada.
 */
function idUnico(indice) {
  return `wamid.TESTE_${Date.now()}_${indice}_${Math.random().toString(36).slice(2, 10)}`;
}

function envelope(from, indice, mensagemParcial) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'TESTE',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '0', phone_number_id: '0' },
          messages: [Object.assign({
            from,
            id: idUnico(indice),
            timestamp: String(Math.floor(Date.now() / 1000))
          }, mensagemParcial)]
        }
      }]
    }]
  };
}

const comoTexto  = texto => ({ type: 'text', text: { body: texto } });
const comoBotao  = (id, title) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const comoLista  = (id, title) => ({ type: 'interactive', interactive: { type: 'list_reply',   list_reply:   { id, title } } });

async function enviar(from, mensagemParcial, indice) {
  const inicio = Date.now();
  const url = `${URL_WEBHOOK}?token=${encodeURIComponent(TOKEN)}`;

  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope(from, indice, mensagemParcial))
    });
    const corpo = await resposta.text();
    return { ok: resposta.status === 200, status: resposta.status, ms: Date.now() - inicio, corpo: corpo.slice(0, 80) };
  } catch (e) {
    return { ok: false, status: 'ERRO', ms: Date.now() - inicio, corpo: e.message };
  }
}

/**
 * Leva o usuário, EM SEQUÊNCIA, de zero até AGUARDANDO_NOME — o primeiro
 * estado em que uma mensagem de texto grava campo do cadastro.
 */
async function prepararCadastro(from) {
  const passos = [
    ['primeiro contato',      comoTexto('menu')],
    ['abrir cadastro',        comoBotao('btn_ser_dizimista', 'Ser Dizimista')],
    ['escolher comunidade',   comoLista(`com_${COMUNIDADE}`, 'Comunidade de Teste')]
  ];

  for (let i = 0; i < passos.length; i++) {
    const [rotulo, msg] = passos[i];
    const r = await enviar(from, msg, `prep${i}`);
    console.log(`  preparação · ${rotulo}: ${r.ok ? 'ok' : 'FALHOU ' + r.status} (${r.ms}ms)`);
    if (!r.ok) {
      console.error('\nA preparação falhou — a rajada não testaria a corrida. Abortando.');
      process.exit(1);
    }
    // Espaço para o bot processar e mudar de estado antes do próximo passo.
    await espera(2500);
  }
}

function relatorio(resultados, segundos) {
  const ok     = resultados.filter(r => r.ok).length;
  const falhas = resultados.filter(r => !r.ok);
  const ms     = resultados.map(r => r.ms).sort((a, b) => a - b);
  const p = q => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];

  console.log('\n─────────── Resultado da rajada ───────────');
  console.log(`Requisições:   ${resultados.length}`);
  console.log(`200 OK:        ${ok}`);
  console.log(`Falhas:        ${falhas.length}`);
  console.log(`Tempo total:   ${segundos}s`);
  console.log(`Latência:      mín ${ms[0]}ms · mediana ${p(0.5)}ms · p90 ${p(0.9)}ms · máx ${ms[ms.length - 1]}ms`);

  if (falhas.length) {
    console.log('\nFalhas (até 10):');
    falhas.slice(0, 10).forEach(f => console.log(`  status ${f.status} — ${f.corpo}`));
    console.log('\nStatus não-200 costuma ser saturação do pool de execuções.');
  }
}

async function main() {
  if (MODO === 'corrida') {
    const from = `${DDD_TESTE}900000001`;
    console.log(`Modo CORRIDA — número ${from}, comunidade ${COMUNIDADE}.`);
    console.log('Preparando o cadastro até AGUARDANDO_NOME…\n');

    await prepararCadastro(from);

    console.log(`\nDisparando ${MENSAGENS} mensagens simultâneas de texto.`);
    console.log('Cada uma grava campo do cadastro — é aqui que o lost update apareceria.\n');

    const inicio = Date.now();
    const resultados = await Promise.all(
      Array.from({ length: MENSAGENS }, (_, i) => enviar(from, comoTexto(`Nome Teste ${i + 1}`), i))
    );
    relatorio(resultados, ((Date.now() - inicio) / 1000).toFixed(1));

    console.log('\nAgora confira no Odoo / nos logs:');
    console.log('  - o cadastro manteve todos os campos, ou algum se perdeu?');
    console.log('  - houve mais de um x_contato_bot para este número?');
    console.log('  - nos logs do GAS: "Lock não obtido" indica a corrida acontecendo.');

  } else {
    console.log(`Modo TETO — ${USUARIOS} usuários distintos disparando ao mesmo tempo.\n`);
    const inicio = Date.now();
    const resultados = await Promise.all(
      Array.from({ length: USUARIOS }, (_, i) =>
        enviar(`${DDD_TESTE}${String(900000100 + i)}`, comoTexto('menu'), i))
    );
    relatorio(resultados, ((Date.now() - inicio) / 1000).toFixed(1));

    console.log('\nConfira no painel de execuções do Apps Script quantas rodaram');
    console.log('em paralelo e se houve "too many simultaneous invocations".');
  }

  console.log('\nLimpeza: limparContatosTeste() no editor do Apps Script.');
}

main();
