/**
 * armazenamento-upstash.mjs — cache, propriedades e trava no Redis da Upstash.
 *
 * PELA API REST, não por cliente Redis. A Upstash aceita cada comando como um
 * POST com o comando em JSON (`["SET","k","v"]`). Assim isto roda pela MESMA
 * ponte síncrona do `http.fetch` — sem dependência, sem conexão persistente para
 * cuidar, e sem async no caminho.
 *
 * O desenho das chaves:
 *   c:<chave>   cache, com TTL (SET ... EX)
 *   p           propriedades, num HASH só (HGETALL devolve tudo — é a varredura
 *               por prefixo que o código faz com getProperties())
 *   t:<chave>   trava por chave (SET ... NX PX), liberada só pelo dono
 *
 * ⚠️ CUSTO: o plano gratuito da Upstash tem teto de comandos por dia. Cada
 * `cacheGet` é um comando. Ver "Limites gratuitos" em MIGRACAO-NIVEL-1.md.
 */

const TTL_PADRAO_S = 600;
const TTL_MAXIMO_S = 21600;

// Libera a trava só se ela ainda for de quem pede. Sem isto, uma execução que
// demorou além do PX apagaria a trava que OUTRA execução já pegou.
const LIBERAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * @param {Object} op
 * @param {string} op.url    - UPSTASH_REDIS_REST_URL
 * @param {string} op.token  - UPSTASH_REDIS_REST_TOKEN
 * @param {Object} op.http   - o `Plataforma.http` (síncrono)
 */
export function criarArmazenamentoUpstash({ url, token, http }) {
  if (!url || !token) throw new Error('Upstash: faltam UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN');
  const base = url.replace(/\/+$/, '');
  const opcoes = (corpo) => ({
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${token}` }, payload: JSON.stringify(corpo),
  });

  const comando = (...args) => {
    const r = http.fetch(base, opcoes(args.map(String)));
    const j = JSON.parse(r.getContentText() || '{}');
    if (r.getResponseCode() !== 200 || j.error) throw new Error(`Upstash ${args[0]}: ${j.error || 'HTTP ' + r.getResponseCode()}`);
    return j.result;
  };
  const lote = (comandos) => {
    if (!comandos.length) return [];
    const r = http.fetch(`${base}/pipeline`, opcoes(comandos.map((c) => c.map(String))));
    const j = JSON.parse(r.getContentText() || '[]');
    if (r.getResponseCode() !== 200 || !Array.isArray(j)) throw new Error(`Upstash pipeline: HTTP ${r.getResponseCode()}`);
    const erro = j.find((x) => x && x.error);
    if (erro) throw new Error(`Upstash pipeline: ${erro.error}`);
    return j.map((x) => x.result);
  };
  const ttl = (s) => Math.min(Math.max(Number(s) || TTL_PADRAO_S, 1), TTL_MAXIMO_S);

  return {
    nome: 'upstash',
    compartilhado: true,

    cacheGet: (k) => comando('GET', `c:${k}`),
    cacheGetAll(ks) {
      if (!ks.length) return {};
      const vs = comando('MGET', ...ks.map((k) => `c:${k}`));
      return Object.fromEntries(ks.map((k, i) => [k, vs[i]]).filter(([, v]) => v !== null));
    },
    cachePut: (k, v, s) => { comando('SET', `c:${k}`, v, 'EX', ttl(s)); },
    cachePutAll: (obj, s) => { lote(Object.entries(obj).map(([k, v]) => ['SET', `c:${k}`, v, 'EX', ttl(s)])); },
    cacheRemove: (k) => { comando('DEL', `c:${k}`); },
    cacheRemoveAll: (ks) => { if (ks.length) comando('DEL', ...ks.map((k) => `c:${k}`)); },

    propGet: (k) => comando('HGET', 'p', k),
    propGetAll() {
      const plano = comando('HGETALL', 'p') || [];
      const obj = {};
      for (let i = 0; i < plano.length; i += 2) obj[plano[i]] = plano[i + 1];
      return obj;
    },
    propSet: (k, v) => { comando('HSET', 'p', k, v); },
    propSetAll: (obj) => { const pares = Object.entries(obj).flat(); if (pares.length) comando('HSET', 'p', ...pares); },
    propDelete: (k) => { comando('HDEL', 'p', k); },

    travaTentar: (chave, dono, ms) => comando('SET', `t:${chave}`, dono, 'NX', 'PX', ms) === 'OK',
    travaLiberar: (chave, dono) => { comando('EVAL', LIBERAR, 1, `t:${chave}`, dono); },
  };
}
