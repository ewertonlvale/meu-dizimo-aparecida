/**
 * processador.mjs — a worker thread onde o código dos `.gs` roda (BL-74, Fase 2).
 *
 * Aqui BLOQUEAR é legítimo: cada pedido é uma unidade de trabalho, e o código
 * espera a rede com `Atomics.wait` (ver es.mjs). O processo principal nunca
 * bloqueia — ele só recebe HTTP e repassa.
 *
 * Um pedido por vez. A concorrência vem de ter vários processadores (e, no
 * Cloud Run, várias instâncias), não de intercalar pedidos no mesmo thread.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { compilar, novoContexto } from './carregador.mjs';
import { criarPonte, criarHttp } from './plataforma/http.mjs';
import { criarPlataforma } from './plataforma/index.mjs';
import { criarArmazenamentoMemoria } from './plataforma/armazenamento-memoria.mjs';
import { criarArmazenamentoUpstash } from './plataforma/armazenamento-upstash.mjs';

// Funções que um agendador pode chamar pelo nome. Lista fechada: o `/cron/:nome`
// não pode virar um jeito de executar qualquer função global dos `.gs`.
export const FUNCOES_AGENDADAS = ['executarNotificacoesDiarias', 'verificarSessoesAbandonadas'];

const env = workerData.env || process.env;
const http = criarHttp(criarPonte(), workerData.redirecionar || {});
const armazenamento = workerData.armazenamento === 'upstash'
  ? criarArmazenamentoUpstash({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN, http })
  : criarArmazenamentoMemoria();
const scripts = compilar();

const log = {
  log:   (...a) => console.log(...a),
  info:  (...a) => console.info(...a),
  warn:  (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
  debug: (...a) => console.debug(...a),
};

// ── Fase 3: uma mensagem por vez, POR PESSOA ────────────────────────────────
// Duas mensagens da mesma pessoa processadas ao mesmo tempo leem o mesmo
// estado da conversa e gravam no mesmo passo — é o atropelo do BL-29 e o lost
// update do BL-20. A trava é por remetente e cobre o processamento INTEIRO.
// Se ela estiver ocupada, o pedido volta "ocupado" e o Cloud Tasks tenta de
// novo em instantes: a fila vira a espera, sem ninguém bloqueado esperando.
// Pessoas DIFERENTES não se esperam — o que a trava global do Apps Script
// não permitia.
const TRAVA_PESSOA_MS = 300000;   // o teto de uma execução (timeout do Cloud Run)

function remetentes(corpo) {
  try {
    const quem = new Set();
    for (const e of JSON.parse(corpo).entry || []) {
      for (const c of e.changes || []) {
        for (const m of (c.value && c.value.messages) || []) if (m && m.from) quem.add(String(m.from));
      }
    }
    return [...quem].sort();   // ordem fixa: duas execuções nunca pegam em ordem trocada
  } catch (e) {
    return [];   // corpo inválido: o doPost trata, e não há pessoa a travar
  }
}

function comTravaDasPessoas(corpo, fn) {
  const dono = `${process.pid}-${Date.now()}-${Math.random()}`;
  const pegas = [];
  const soltar = () => pegas.forEach((p) => { try { armazenamento.travaLiberar(`pessoa_${p}`, dono); } catch (e) { /* expira sozinha */ } });
  for (const p of remetentes(corpo)) {
    if (!armazenamento.travaTentar(`pessoa_${p}`, dono, TRAVA_PESSOA_MS)) { soltar(); return { ocupado: true }; }
    pegas.push(p);
  }
  try { return fn(); } finally { soltar(); }
}

function executar({ tipo, nome, evento, corpo }) {
  if (tipo === 'doPostFila') {
    // Veio da fila: o webhook já autenticou. O `doPost` confere o segredo de
    // novo (é o código de sempre), então o segredo vai no evento.
    return comTravaDasPessoas(corpo, () => executar({ tipo: 'doPost', evento: {
      parameter: { token: env.WEBHOOK_SECRET }, postData: { contents: corpo, type: 'application/json' } } }));
  }

  const Plataforma = criarPlataforma({ armazenamento, http, env, log });
  const ctx = novoContexto(scripts, { Plataforma, console: log, Logger: { log: log.log } });

  let r;
  if (tipo === 'doGet' || tipo === 'doPost') {
    r = ctx[tipo](evento);
  } else if (tipo === 'funcao') {
    if (!FUNCOES_AGENDADAS.includes(nome)) throw new Error(`função não agendável: ${nome}`);
    r = ctx[nome]();
  } else {
    throw new Error(`tipo de pedido desconhecido: ${tipo}`);
  }
  return r && r.__resposta === 'texto' ? { texto: r.conteudo } : { texto: '' };
}

parentPort.on('message', (pedido) => {
  const t0 = Date.now();
  let resposta;
  try {
    resposta = { ok: true, ...executar(pedido) };
  } catch (e) {
    console.error(`💥 [processador] ${pedido.tipo}${pedido.nome ? ' ' + pedido.nome : ''}: ${e.stack || e.message}`);
    resposta = { ok: false, erro: e.message };
  }
  parentPort.postMessage({ id: pedido.id, ms: Date.now() - t0, ...resposta });
});

parentPort.postMessage({ pronto: true, arquivos: scripts.length, armazenamento: armazenamento.nome });
