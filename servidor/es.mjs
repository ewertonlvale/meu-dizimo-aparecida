/**
 * es.mjs — a thread de E/S da ponte síncrona (BL-74, Fase 2).
 *
 * O código dos `.gs` é SÍNCRONO: `Utils.fetchComRetry(url)` devolve a resposta
 * na hora, e a linha seguinte a usa. O `fetch` do Node é assíncrono. Converter
 * 15 mil linhas para async/await era o maior risco do plano — um `await`
 * esquecido não dá erro, dá uma Promise onde se esperava um objeto.
 *
 * A saída: o código roda numa worker thread (o "processador") que PODE
 * bloquear. Para cada requisição, ele manda o pedido para esta thread e dorme
 * em `Atomics.wait`. Esta thread faz o `fetch` de verdade, devolve a resposta
 * pela porta e acorda o processador, que a lê com `receiveMessageOnPort`.
 *
 * Nenhuma dependência: só `worker_threads`. O pacote `sync-fetch`, que o plano
 * citava, não foi preciso.
 */

import { workerData } from 'node:worker_threads';

const { porta, sinal } = workerData;
const TEMPO_LIMITE_MS = 60000;   // o mesmo teto do UrlFetchApp

function corpo(pedido) {
  const c = pedido.corpo;
  if (!c) return undefined;
  if (c.tipo === 'texto') return c.valor;
  if (c.tipo === 'bytes') return c.valor;
  if (c.tipo === 'multipart') {
    const fd = new FormData();
    for (const campo of c.campos) {
      if (campo.bytes) fd.append(campo.nome, new Blob([campo.bytes], { type: campo.tipo }), campo.arquivo || 'arquivo');
      else fd.append(campo.nome, campo.valor);
    }
    return fd;
  }
  throw new Error(`corpo de tipo desconhecido: ${c.tipo}`);
}

porta.on('message', async (pedido) => {
  let resposta;
  try {
    const r = await fetch(pedido.url, {
      method: pedido.metodo,
      headers: pedido.cabecalhos,
      body: corpo(pedido),
      redirect: pedido.seguirRedirecionamento ? 'follow' : 'manual',
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const cabecalhos = {};
    r.headers.forEach((v, k) => { cabecalhos[k] = v; });
    resposta = { codigo: r.status, cabecalhos, bytes };
  } catch (e) {
    resposta = { erro: e.cause ? `${e.message} (${e.cause.code || e.cause.message})` : e.message };
  }
  porta.postMessage(resposta);
  Atomics.store(sinal, 0, 1);
  Atomics.notify(sinal, 0);
});
