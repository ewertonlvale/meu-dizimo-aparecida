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

function executar({ tipo, nome, evento }) {
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
