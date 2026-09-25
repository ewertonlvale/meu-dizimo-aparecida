/**
 * armazenamento-memoria.mjs — cache, propriedades e trava na memória do processo.
 *
 * PARA DESENVOLVIMENTO E TESTE. Vale só com UM processador: dois processos (ou
 * duas instâncias do Cloud Run) teriam memórias diferentes — o cache de um não
 * existiria para o outro, e a trava não travaria nada. O `index.mjs` recusa
 * subir com mais de um processador neste modo.
 *
 * Mesma semântica do CacheService no que importa: TTL em segundos, padrão de
 * 10 min, teto de 6 h, e `put` renova o prazo.
 */

const TTL_PADRAO_S = 600;
const TTL_MAXIMO_S = 21600;

export function criarArmazenamentoMemoria({ agora = () => Date.now() } = {}) {
  const cache = new Map();          // chave → { valor, expira }
  const props = new Map();
  const travas = new Map();         // chave → { dono, expira }

  const vivo = (k) => {
    const e = cache.get(k);
    if (!e) return null;
    if (e.expira <= agora()) { cache.delete(k); return null; }
    return e.valor;
  };
  const ttl = (s) => Math.min(Math.max(Number(s) || TTL_PADRAO_S, 1), TTL_MAXIMO_S);

  return {
    nome: 'memoria',
    compartilhado: false,

    cacheGet: (k) => vivo(k),
    cacheGetAll: (ks) => Object.fromEntries(ks.map((k) => [k, vivo(k)]).filter(([, v]) => v !== null)),
    cachePut: (k, v, s) => { cache.set(k, { valor: String(v), expira: agora() + ttl(s) * 1000 }); },
    cachePutAll: (obj, s) => { for (const [k, v] of Object.entries(obj)) cache.set(k, { valor: String(v), expira: agora() + ttl(s) * 1000 }); },
    cacheRemove: (k) => { cache.delete(k); },
    cacheRemoveAll: (ks) => { ks.forEach((k) => cache.delete(k)); },

    propGet: (k) => (props.has(k) ? props.get(k) : null),
    propGetAll: () => Object.fromEntries(props),
    propSet: (k, v) => { props.set(k, String(v)); },
    propSetAll: (obj) => { for (const [k, v] of Object.entries(obj)) props.set(k, String(v)); },
    propDelete: (k) => { props.delete(k); },
    // Soma atômica — numa thread só, trivialmente.
    propSomar(somas) {
      for (const [k, n] of Object.entries(somas)) props.set(k, String((parseInt(props.get(k), 10) || 0) + Number(n)));
    },

    travaTentar(chave, dono, ms) {
      const t = travas.get(chave);
      if (t && t.expira > agora() && t.dono !== dono) return false;
      travas.set(chave, { dono, expira: agora() + ms });
      return true;
    },
    travaLiberar(chave, dono) {
      const t = travas.get(chave);
      if (t && t.dono === dono) travas.delete(chave);
    },
  };
}
