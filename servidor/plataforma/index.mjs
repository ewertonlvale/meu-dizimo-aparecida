/**
 * plataforma/index.mjs — a `Plataforma` do runtime Node (BL-74, Fase 2).
 *
 * A MESMA INTERFACE do `Plataforma.gs`. Os `.gs` não sabem em que runtime
 * estão: chamam `Plataforma.cache.get(k)` e recebem a resposta. A
 * `ferramentas/prova-runtime.mjs` reprova se um método de lá faltar aqui.
 *
 * Uma Plataforma nova POR EXECUÇÃO (cada mensagem, cada disparo de cron), como
 * o Apps Script faz. O armazenamento é compartilhado; o que é da execução — as
 * travas que ela segura — não.
 */

import * as relogio from './relogio.mjs';
import * as bytes from './bytes.mjs';

/**
 * Chaves de configuração que podem vir de variável de ambiente (no Cloud Run,
 * do Secret Manager). Valem como PADRÃO: se o código gravou a chave no
 * armazenamento (ex.: `configurarSegredoWebhook`), a gravada vence.
 *
 * Lista fechada de propósito: `getProperties()` devolve isto ao código, e o
 * ambiente do processo tem coisas que não são da conta dele.
 */
export const CHAVES_DE_CONFIG = [
  'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_PIN', 'WHATSAPP_NUMERO_EXIBICAO',
  'VERIFY_TOKEN', 'WEBHOOK_SECRET',
  'ODOO_URL', 'ODOO_DATABASE', 'ODOO_UID', 'ODOO_API_KEY',
  'GOOGLE_VISION_API_KEY',
  'NOTIFICACOES_ATIVAS', 'NUMERO_TESTE', 'MODO_TESTE',
  'FLOW_ID_CADASTRO', 'FLOW_ID_MEMBRO', 'FLOW_ID_OFERTA',
  'LIMITE_MSG_MINUTO', 'LIMITE_MSG_HORA', 'AVATAR_URL',
];

// Quanto a trava vive se a execução morrer segurando-a. O Apps Script solta a
// trava no fim da execução; aqui ela expira sozinha. Folgado de propósito: a
// trava do cadastro fica segura durante chamadas ao Odoo (BL-84, item 7).
const TRAVA_VIDA_MS = 120000;
const TRAVA_PASSO_MS = 100;

/**
 * @param {Object} op
 * @param {Object} op.armazenamento - memória ou Upstash
 * @param {Object} op.http          - de `criarHttp`
 * @param {Object} [op.env]         - variáveis de ambiente
 * @param {Object} [op.log]         - console
 */
export function criarPlataforma({ armazenamento: a, http, env = process.env, log = console }) {
  const doAmbiente = () => Object.fromEntries(
    CHAVES_DE_CONFIG.filter((k) => env[k] !== undefined && env[k] !== '').map((k) => [k, env[k]]));

  const segurando = new Set();

  return {
    cache: {
      get:       (k) => a.cacheGet(k),
      getAll:    (ks) => a.cacheGetAll(ks),
      put:       (k, v, ttl) => a.cachePut(k, v, ttl),
      putAll:    (obj, ttl) => a.cachePutAll(obj, ttl),
      remove:    (k) => a.cacheRemove(k),
      removeAll: (ks) => a.cacheRemoveAll(ks),
    },

    propriedades: {
      getProperty(k) {
        const gravada = a.propGet(k);
        if (gravada !== null && gravada !== undefined) return gravada;
        return CHAVES_DE_CONFIG.includes(k) && env[k] ? env[k] : null;
      },
      getProperties: () => ({ ...doAmbiente(), ...a.propGetAll() }),
      setProperty:    (k, v) => a.propSet(k, v),
      deleteProperty: (k) => a.propDelete(k),
      // Só mescla — o `true` do Apps Script que apagaria o resto não existe aqui.
      setProperties:  (obj) => a.propSetAll(obj),
    },

    http: { fetch: (url, opcoes) => http.fetch(url, opcoes) },

    relogio: { formatar: relogio.formatar, dormir: relogio.dormir },

    bytes: {
      paraBase64: bytes.paraBase64,
      deBase64:   bytes.deBase64,
      blob:       bytes.blob,
      uuid:       bytes.uuid,
    },

    trava: {
      /**
       * Trava POR CHAVE, de verdade — o que o Apps Script não tinha. Mesma
       * assinatura e mesmas políticas de falha do `Plataforma.gs`.
       */
      comTrava(chave, esperaMs, fn, aoFalhar) {
        // Reentrante dentro da mesma execução, como o LockService.
        if (segurando.has(chave)) return fn();

        const dono = bytes.uuid();
        const inicio = Date.now();
        while (!a.travaTentar(chave, dono, TRAVA_VIDA_MS)) {
          if (Date.now() - inicio >= esperaMs) {
            const erro = new Error(`Lock timeout: outra execução segura "${chave}"`);
            if (aoFalhar) return aoFalhar(erro);
            throw erro;
          }
          relogio.dormir(TRAVA_PASSO_MS);
        }
        segurando.add(chave);
        try {
          return fn();
        } finally {
          segurando.delete(chave);
          try { a.travaLiberar(chave, dono); } catch (e) { log.warn(`⚠️ [trava] não liberei "${chave}": ${e.message}`); }
        }
      },
    },

    // No Node, agendamento é do Cloud Scheduler (Fase 4), configurado fora do
    // código. Instalar gatilho aqui não faz nada — e diz isso, em vez de fingir.
    gatilhos: {
      aCadaHoras(funcao, horas) {
        log.warn(`⚠️ [gatilhos] runtime Node: "${funcao}" a cada ${horas}h é job do Cloud Scheduler — nada instalado.`);
      },
      aCadaMinutos(funcao, minutos) {
        log.warn(`⚠️ [gatilhos] runtime Node: "${funcao}" a cada ${minutos} min é job do Cloud Scheduler — nada instalado.`);
      },
      removerDe: () => 0,
      exercitarAutorizacao: () => undefined,
      urlDoServico: () => env.URL_SERVICO || null,
    },

    // O servidor HTTP converte isto em resposta — sempre 200, como o Apps
    // Script, até a Fase 5 decidir o contrário (ver Plataforma.gs).
    resposta: { texto: (conteudo) => ({ __resposta: 'texto', conteudo: String(conteudo) }) },
  };
}
