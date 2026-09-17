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
 *   corrida  UM usuário, levado até o meio do cadastro, recebe as respostas
 *            do cadastro com POUCO intervalo entre si (--intervalo, padrão
 *            400ms). Como cada execução leva ~2,5s, elas se sobrepõem: é o
 *            cenário de lost update no read-modify-write de `dados_<from>`.
 *
 *            O intervalo é essencial. Disparadas no mesmo instante, todas
 *            cairiam no mesmo passo e gravariam o mesmo campo — a perda ficaria
 *            indistinguível. Com intervalo, cada uma cai num passo diferente e
 *            um campo faltando no fim denuncia a perda.
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
const INTERVALO   = parseInt(opt('intervalo', '400'), 10);

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
  // Esta sequência ESPELHA o fluxo real do CadastroHandler, estado por estado.
  // Cada passo só é aceito no estado que o anterior deixou; mandar um passo
  // fora de ordem faz o Router descartá-lo e voltar o estado para MENU — e daí
  // a rajada cairia em MENU sem tocar no cadastro, dando um teste vazio.
  //
  // Se o fluxo de cadastro mudar, esta lista precisa mudar junto.
  const passos = [
    ['primeiro contato',    comoTexto('menu'),                                    'MENU'],
    ['abrir cadastro',      comoBotao('btn_ser_dizimista', 'Ser Dizimista'),      'AGUARDANDO_CONFIRMACAO_NUMERO'],
    ['confirmar número',    comoBotao('btn_numero_confirmar', 'Confirmar'),       'AGUARDANDO_COMUNIDADE'],
    ['escolher comunidade', comoLista(`com_${COMUNIDADE}`, 'Comunidade de Teste'), 'AGUARDANDO_NOME']
  ];

  for (let i = 0; i < passos.length; i++) {
    const [rotulo, msg, estadoEsperado] = passos[i];
    const r = await enviar(from, msg, `prep${i}`);
    console.log(`  preparação · ${rotulo.padEnd(20)} ${r.ok ? 'ok' : 'FALHOU ' + r.status} ` +
                `(${r.ms}ms) → estado esperado: ${estadoEsperado}`);
    if (!r.ok) {
      console.error('\nA preparação falhou — a rajada não testaria a corrida. Abortando.');
      process.exit(1);
    }
    // Espaço para o bot processar e mudar de estado antes do próximo passo.
    await espera(2500);
  }

  console.log('\n  ⚠️ Confira no Cloud Logging que os "📊 Estado de ..." batem com a coluna acima.');
  console.log('     Se algum passo aparecer com estado MENU, a preparação saiu do trilho');
  console.log('     e o resultado da rajada não significa nada.');
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

    // As respostas seguem a ordem real do cadastro, e cada uma é VÁLIDA para o
    // passo em que deveria cair. Isso é o que torna a perda visível: se tudo
    // correr bem, o cadastro termina com os cinco campos preenchidos; se uma
    // gravação sobrescrever outra, um campo fica faltando.
    //
    // Mandar as cinco no mesmo instante NÃO serve: todas cairiam no mesmo passo
    // e gravariam o mesmo campo, e a perda ficaria indistinguível. Por isso o
    // intervalo — curto o bastante para as execuções se sobreporem (cada uma
    // leva ~2,5s), longo o bastante para o estado avançar entre elas.
    const respostas = [
      ['nome',           'Joao da Silva Teste'],
      ['nomeUsual',      'Joao Teste'],
      ['dataNascimento', '15/05/1980'],
      ['endereco',       'Rua de Teste, 100 - Centro'],
      ['valorMensal',    '50']
    ];

    const quantas = Math.min(MENSAGENS, respostas.length);
    console.log(`\nDisparando ${quantas} mensagens com ${INTERVALO}ms de intervalo.`);
    console.log('Cada execução leva ~2,5s, então elas se sobrepõem — é aí que a corrida ocorre.\n');
    respostas.slice(0, quantas).forEach(([campo, texto]) => console.log(`  ${campo.padEnd(15)} → "${texto}"`));
    console.log('');

    const inicio = Date.now();
    const disparos = [];
    for (let i = 0; i < quantas; i++) {
      disparos.push(enviar(from, comoTexto(respostas[i][1]), i));
      if (i < quantas - 1) await espera(INTERVALO);
    }
    const resultados = await Promise.all(disparos);
    relatorio(resultados, ((Date.now() - inicio) / 1000).toFixed(1));

    console.log('\n─────────── Como interpretar ───────────');
    console.log('No Odoo, procure o dizimista "Joao Teste" (ou o cadastro pela metade):');
    console.log('  TODOS os campos preenchidos  → nenhuma perda nesta rodada');
    console.log('  algum campo vazio/faltando   → LOST UPDATE confirmado');
    console.log('');
    console.log('Nos logs (Cloud Logging), filtre por:');
    console.log('  "Lock não obtido"  → houve contenção: a proteção do BL-20 cedeu');
    console.log('  "Estado de 5599"   → mostra em que passo cada mensagem caiu');
    console.log('');
    console.log('Se o cadastro completou sem falhas, repita com --intervalo menor');
    console.log('(ex.: 150) para estreitar a janela e forçar mais sobreposição.');

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
