/**
 * bytes.mjs — `Plataforma.bytes` no Node (BL-74, Fase 2).
 *
 * No Apps Script, bytes são arrays de inteiros COM SINAL (-128..127). Aqui são
 * `Uint8Array`. O código dos `.gs` só passa bytes de mão em mão — do download
 * para o base64, do base64 para o blob —, então a representação interna não
 * vaza; mas as duas formas são aceitas na entrada, por garantia.
 */

import { randomUUID } from 'node:crypto';

/** Qualquer forma de bytes → Uint8Array. */
export function comoBytes(b) {
  // `isView` e a etiqueta, não `instanceof`: bytes criados no contexto dos `.gs`
  // têm outro Uint8Array, e reprovariam o instanceof daqui.
  if (ArrayBuffer.isView(b)) return b instanceof Uint8Array ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (Object.prototype.toString.call(b) === '[object ArrayBuffer]') return new Uint8Array(b);
  if (Array.isArray(b)) return Uint8Array.from(b, (x) => x & 255);
  if (b && typeof b.getBytes === 'function') return comoBytes(b.getBytes());
  throw new Error(`bytes: não sei tratar ${Object.prototype.toString.call(b)} como bytes`);
}

/**
 * O Blob do Apps Script, nos métodos que o projeto usa. É também o que o
 * `http.fetch` reconhece, dentro de um payload-objeto, para montar multipart.
 */
export function blob(bytes, tipo = 'application/octet-stream', nome = null) {
  const dados = comoBytes(bytes);
  let nomeAtual = nome;
  let tipoAtual = tipo;
  return {
    __blob: true,
    getBytes: () => dados,
    getContentType: () => tipoAtual,
    setContentType: (t) => { tipoAtual = t; return undefined; },
    getName: () => nomeAtual,
    setName: (n) => { nomeAtual = n; return undefined; },
    getDataAsString: () => new TextDecoder().decode(dados),
  };
}

export const paraBase64 = (bytes) => Buffer.from(comoBytes(bytes)).toString('base64');
export const deBase64   = (texto) => new Uint8Array(Buffer.from(String(texto), 'base64'));
export const uuid       = () => randomUUID();
