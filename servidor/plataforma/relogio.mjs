/**
 * relogio.mjs — `Plataforma.relogio` no Node (BL-74, Fase 2).
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   `Utilities.formatDate` usa os padrões do Java (SimpleDateFormat): 'yyyy',
 *   'MM', 'H'. O `Intl` do JavaScript não entende nada disso. E os dois lugares
 *   que dependem do resultado erram EM SILÊNCIO:
 *     - a janela de disparo do BL-73 lê a hora com 'H' — errar o fuso faz o
 *       disparo das 9h virar 6h, sem erro nenhum;
 *     - o Odoo recebe campos `date` como 'yyyy-MM-dd' (quebrou uma vez no BL-01).
 *
 * POR ISSO: só os padrões que o projeto usa, e qualquer outra letra LANÇA. Um
 * padrão novo no código tem de passar por aqui e ganhar teste, em vez de sair
 * formatado errado em produção.
 *
 * O `dormir` é síncrono de verdade (`Atomics.wait`): só pode rodar numa worker
 * thread, que é onde o código dos `.gs` roda.
 */

// Letras do SimpleDateFormat que o projeto usa, e como obtê-las das partes do Intl.
const CAMPOS = {
  y: (p, n) => (n === 2 ? p.year.slice(-2) : p.year.padStart(n, '0')),
  M: (p, n) => (n >= 3 ? null : String(Number(p.month)).padStart(n, '0')),
  d: (p, n) => String(Number(p.day)).padStart(n, '0'),
  H: (p, n) => String(Number(p.hour)).padStart(n, '0'),
  m: (p, n) => String(Number(p.minute)).padStart(n, '0'),
  s: (p, n) => String(Number(p.second)).padStart(n, '0'),
};

const cacheIntl = new Map();
function partes(data, fuso) {
  let f = cacheIntl.get(fuso);
  if (!f) {
    // Lança RangeError para fuso inexistente — que é o que se quer.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    cacheIntl.set(fuso, f);
  }
  const p = {};
  for (const { type, value } of f.formatToParts(data)) p[type] = value;
  return p;
}

/**
 * Mesma assinatura e mesmo resultado do `Utilities.formatDate` do Apps Script,
 * para o subconjunto de padrões que o projeto usa.
 */
export function formatar(data, fuso, formato) {
  // NÃO `instanceof Date`: os `.gs` rodam noutro contexto do `vm`, com o seu
  // próprio `Date`, e a data que vem de lá reprovaria o instanceof daqui.
  if (Object.prototype.toString.call(data) !== '[object Date]' || isNaN(data.getTime())) {
    throw new Error(`formatar: data inválida (${data})`);
  }
  const p = partes(data, fuso);
  let saida = '';
  for (let i = 0; i < formato.length;) {
    const c = formato[i];
    if (c === "'") {                       // literal entre aspas: 'T'
      const fim = formato.indexOf("'", i + 1);
      if (fim < 0) throw new Error(`formatar: aspas sem fechar em "${formato}"`);
      saida += fim === i + 1 ? "'" : formato.slice(i + 1, fim);
      i = fim + 1;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let n = 1;
      while (formato[i + n] === c) n++;
      const campo = CAMPOS[c];
      const valor = campo && campo(p, n);
      if (valor == null) {
        throw new Error(`formatar: o padrão "${c.repeat(n)}" não é suportado no Node ` +
                        `(em "${formato}"). Acrescente-o em servidor/plataforma/relogio.mjs, com teste.`);
      }
      saida += valor;
      i += n;
      continue;
    }
    saida += c;
    i++;
  }
  return saida;
}

const trava = new Int32Array(new SharedArrayBuffer(4));

/** Espera síncrona de verdade — o `Utilities.sleep`. Só numa worker thread. */
export function dormir(ms) {
  if (ms > 0) Atomics.wait(trava, 0, 0, ms);
}
