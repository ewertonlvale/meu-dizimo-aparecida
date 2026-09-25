/**
 * http.mjs — `Plataforma.http` no Node: o `UrlFetchApp.fetch`, síncrono (BL-74, Fase 2).
 *
 * Imita o Apps Script no que o projeto usa, e nada além:
 *   opções   method, headers, contentType, payload, muteHttpExceptions,
 *            followRedirects
 *   payload  texto (com contentType) · objeto com Blob → multipart (é o upload
 *            de mídia do MediaService) · objeto sem Blob → form-urlencoded
 *   resposta getResponseCode, getContentText, getContent, getBlob,
 *            getHeaders, getAllHeaders
 *
 * DIFERENÇA QUE IMPORTA: sem `muteHttpExceptions: true`, o UrlFetchApp LANÇA em
 * 4xx/5xx. O `fetch` nunca lança por código. Esquecer isso mudaria o caminho de
 * erro em silêncio — então está aqui, e tem teste.
 */

import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { blob, comoBytes } from './bytes.mjs';

/**
 * Cria a ponte síncrona: uma thread de E/S e a função que bloqueia esperando.
 * Chamar UMA vez por processador.
 */
export function criarPonte() {
  const { port1, port2 } = new MessageChannel();
  const sinal = new Int32Array(new SharedArrayBuffer(4));
  const es = new Worker(new URL('../es.mjs', import.meta.url),
    { workerData: { porta: port2, sinal }, transferList: [port2] });
  es.unref();
  port1.unref();

  return function fetchSincrono(pedido) {
    Atomics.store(sinal, 0, 0);
    port1.postMessage(pedido);
    Atomics.wait(sinal, 0, 0);
    const recebido = receiveMessageOnPort(port1);
    if (!recebido) throw new Error('ponte de E/S: acordou sem resposta');
    return recebido.message;
  };
}

const ehBlob = (v) => v && v.__blob === true;

/** Opções do UrlFetchApp → pedido serializável para a thread de E/S. */
export function montarPedido(url, opcoes = {}) {
  const cabecalhos = {};
  for (const [k, v] of Object.entries(opcoes.headers || {})) cabecalhos[k] = String(v);

  let corpo = null;
  const p = opcoes.payload;
  if (p !== undefined && p !== null) {
    if (typeof p === 'string') {
      corpo = { tipo: 'texto', valor: p };
      cabecalhos['content-type'] = opcoes.contentType || 'application/x-www-form-urlencoded';
    } else if (ArrayBuffer.isView(p) || Array.isArray(p)) {
      corpo = { tipo: 'bytes', valor: comoBytes(p) };
      if (opcoes.contentType) cabecalhos['content-type'] = opcoes.contentType;
    } else if (ehBlob(p)) {
      corpo = { tipo: 'bytes', valor: p.getBytes() };
      cabecalhos['content-type'] = opcoes.contentType || p.getContentType();
    } else if (typeof p === 'object') {
      const campos = Object.entries(p);
      if (campos.some(([, v]) => ehBlob(v))) {
        // Como o UrlFetchApp: objeto com Blob vira multipart, e o boundary é
        // da biblioteca — por isso NÃO se põe content-type à mão.
        corpo = { tipo: 'multipart', campos: campos.map(([nome, v]) => (ehBlob(v)
          ? { nome, bytes: v.getBytes(), tipo: v.getContentType(), arquivo: v.getName() }
          : { nome, valor: String(v) })) };
      } else {
        corpo = { tipo: 'texto', valor: new URLSearchParams(campos.map(([k, v]) => [k, String(v)])).toString() };
        cabecalhos['content-type'] = 'application/x-www-form-urlencoded';
      }
    }
  } else if (opcoes.contentType) {
    cabecalhos['content-type'] = opcoes.contentType;
  }

  return {
    url,
    metodo: String(opcoes.method || 'get').toUpperCase(),
    cabecalhos,
    corpo,
    seguirRedirecionamento: opcoes.followRedirects !== false,
  };
}

/** Resposta da thread de E/S → HTTPResponse do Apps Script. */
export function montarResposta(url, r) {
  const texto = () => new TextDecoder().decode(r.bytes);
  const tipo = String(r.cabecalhos['content-type'] || 'application/octet-stream').split(';')[0].trim();
  const nome = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || null;
  return {
    getResponseCode: () => r.codigo,
    getContentText: () => texto(),
    getContent: () => r.bytes,
    getBlob: () => blob(r.bytes, tipo, nome),
    getHeaders: () => ({ ...r.cabecalhos }),
    getAllHeaders: () => ({ ...r.cabecalhos }),
  };
}

/**
 * @param {Function} fetchSincrono - de `criarPonte()`
 * @param {Object<string,string>} [redirecionar] - SÓ PARA TESTE: troca a origem
 *   de uma URL (ex.: graph.facebook.com → um servidor falso em 127.0.0.1).
 */
export function criarHttp(fetchSincrono, redirecionar = {}) {
  for (const destino of Object.values(redirecionar)) {
    const host = new URL(destino).hostname;
    // Uma variável de ambiente trocada não pode mandar o token do WhatsApp
    // para um servidor de fora. Redirecionar é só para 127.0.0.1.
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`http: redirecionamento só para 127.0.0.1 — recusado "${destino}"`);
    }
  }
  const reescrever = (url) => {
    for (const [origem, destino] of Object.entries(redirecionar)) {
      if (url.startsWith(origem)) return destino + url.slice(origem.length);
    }
    return url;
  };

  return {
    fetch(url, opcoes = {}) {
      const alvo = reescrever(String(url));
      const r = fetchSincrono(montarPedido(alvo, opcoes));
      // O UrlFetchApp lança em erro de rede, com ou sem muteHttpExceptions.
      if (r.erro) throw new Error(`Falha de rede em ${url}: ${r.erro}`);
      const resposta = montarResposta(alvo, r);
      if (!opcoes.muteHttpExceptions && r.codigo >= 400) {
        throw new Error(`Request failed for ${url} returned code ${r.codigo}. ` +
          `Truncated server response: ${resposta.getContentText().slice(0, 200)} ` +
          '(use muteHttpExceptions option to examine full response)');
      }
      return resposta;
    },
  };
}
