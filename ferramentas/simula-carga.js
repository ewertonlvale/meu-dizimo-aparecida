#!/usr/bin/env node
/**
 * ============================================================================
 * SIMULA-CARGA.JS — teste de concorrência do webhook
 * ============================================================================
 *
 * Roda na SUA máquina, não no Apps Script. Isso não é detalhe de conveniência:
 * uma função no editor do GAS é UMA execução, então um laço lá dentro roda em
 * sequência e NÃO reproduz as corridas que queremos testar (contenção de lock,
 * lost update do cadastro, duplicação de primeiro contato). Só requisições
 * paralelas de fora criam execuções simultâneas de verdade.
 *
 * ⚠️ Dispara mensagens reais no bot, que grava no Odoo configurado e tenta
 * responder pelo WhatsApp. Use apenas contra um ambiente descartável.
 *
 * USO
 *   node simula-carga.js --url "<URL>/exec" --token "<WEBHOOK_SECRET>" --modo teto --usuarios 20
 *   node simula-carga.js --url "<URL>/exec" --token "<WEBHOOK_SECRET>" --modo corrida --mensagens 6
 *
 * MODOS
 *   teto     N usuários distintos mandam uma mensagem ao mesmo tempo.
 *            Mede o teto de execuções simultâneas e a latência sob carga.
 *
 *   corrida  UM usuário manda N mensagens ao mesmo tempo. É o cenário do
 *            lost update no cadastro: o read-modify-write de `dados_<from>`
 *            sem lock efetivo. Confira depois, no Odoo, se o cadastro ficou
 *            com todos os campos.
 *
 * O QUE OLHAR DEPOIS
 *   - A saída aqui: quantas requisições não voltaram 200 e a distribuição de
 *     latência.
 *   - O painel de execuções do Apps Script: quantas rodaram em paralelo e se
 *     alguma falhou com "too many simultaneous invocations".
 *   - O Odoo: registros duplicados ou cadastros com campo faltando.
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

if (!URL_WEBHOOK || !TOKEN) {
  console.error('Faltou --url ou --token. Veja o cabeçalho do arquivo para o uso.');
  process.exit(1);
}

// Prefixo de número fictício, para a massa gerada ser reconhecível no Odoo.
const DDD_TESTE = '5599';

/** Monta um payload igual ao que a Meta envia, com id único por mensagem. */
function montarPayload(from, texto, indice) {
  // O webhook deduplica por messageId (cache de 10 min). Sem id único, todas
  // as requisições menos a primeira seriam ignoradas em silêncio — e o teste
  // pareceria passar sem ter processado nada.
  const messageId = `wamid.TESTE_${Date.now()}_${indice}_${Math.random().toString(36).slice(2, 10)}`;

  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'TESTE',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '0', phone_number_id: '0' },
          messages: [{
            from,
            id: messageId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: texto }
          }]
        }
      }]
    }]
  };
}

async function enviar(from, texto, indice) {
  const inicio = Date.now();
  const url = `${URL_WEBHOOK}?token=${encodeURIComponent(TOKEN)}`;

  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(montarPayload(from, texto, indice))
    });
    const corpo = await resposta.text();
    return { ok: resposta.status === 200, status: resposta.status, ms: Date.now() - inicio, corpo: corpo.slice(0, 80) };
  } catch (e) {
    return { ok: false, status: 'ERRO', ms: Date.now() - inicio, corpo: e.message };
  }
}

function relatorio(resultados, segundos) {
  const ok     = resultados.filter(r => r.ok).length;
  const falhas = resultados.filter(r => !r.ok);
  const ms     = resultados.map(r => r.ms).sort((a, b) => a - b);
  const p = q => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];

  console.log('\n─────────── Resultado ───────────');
  console.log(`Requisições:   ${resultados.length}`);
  console.log(`200 OK:        ${ok}`);
  console.log(`Falhas:        ${falhas.length}`);
  console.log(`Tempo total:   ${segundos}s`);
  console.log(`Latência:      mín ${ms[0]}ms · mediana ${p(0.5)}ms · p90 ${p(0.9)}ms · máx ${ms[ms.length - 1]}ms`);

  if (falhas.length) {
    console.log('\nFalhas (até 10):');
    falhas.slice(0, 10).forEach(f => console.log(`  status ${f.status} — ${f.corpo}`));
    console.log('\nStatus não-200 costuma ser saturação do pool de execuções.');
    console.log('Confirme no painel de execuções do Apps Script.');
  }

  console.log('\nAgora confira no Odoo:');
  console.log('  - registros duplicados (x_contato_bot do mesmo número)');
  console.log('  - no modo corrida, se o cadastro ficou com todos os campos');
}

async function main() {
  const inicio = Date.now();
  let disparos;

  if (MODO === 'corrida') {
    const from = `${DDD_TESTE}900000001`;
    console.log(`Modo CORRIDA: ${MENSAGENS} mensagens simultâneas do MESMO número (${from}).`);
    console.log('Cenário de lost update no cadastro.\n');
    disparos = Array.from({ length: MENSAGENS }, (_, i) =>
      enviar(from, `Teste corrida ${i + 1}`, i));

  } else {
    console.log(`Modo TETO: ${USUARIOS} usuários distintos disparando ao mesmo tempo.`);
    console.log('Cenário de saturação do pool de execuções.\n');
    disparos = Array.from({ length: USUARIOS }, (_, i) =>
      enviar(`${DDD_TESTE}${String(900000100 + i)}`, 'menu', i));
  }

  // Promise.all dispara tudo junto: é daqui que vem o paralelismo real.
  const resultados = await Promise.all(disparos);
  relatorio(resultados, ((Date.now() - inicio) / 1000).toFixed(1));
}

main();
