/**
 * ============================================================================
 * PLATAFORMA.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * O ÚNICO arquivo que fala com as APIs do Apps Script (BL-74, Fase 1).
 *
 * POR QUE EXISTE
 *   Para sair do Apps Script (Cloud Run + Redis, ver
 *   Documentação/MIGRACAO-NIVEL-1.md), o resto do código não pode citar
 *   `CacheService`, `PropertiesService`, `UrlFetchApp`, `Utilities`,
 *   `LockService`, `ContentService` nem `ScriptApp`. Tudo passa por aqui, e na
 *   Fase 2 este arquivo ganha uma implementação Node com a MESMA interface —
 *   sem tocar em quem chama.
 *
 *   O `conta-mensagens.js` reprova se qualquer outro `.gs` do deploy voltar a
 *   usar uma dessas APIs direto. É essa verificação que impede a fachada de
 *   vazar com o tempo.
 *
 * POR QUE A INTERFACE IMITA O APPS SCRIPT
 *   `Plataforma.cache.get(k)` e `Plataforma.propriedades.getProperty(k)` têm o
 *   mesmo nome e a mesma semântica de hoje, de propósito. Nesta fase o
 *   critério é NÃO MUDAR COMPORTAMENTO: com ~150 sítios de chamada, uma troca
 *   mecânica (`CacheService.getScriptCache()` → `Plataforma.cache`) é revisável
 *   linha a linha; uma API nova em cada sítio não seria.
 *
 * TUDO É RESOLVIDO NA HORA DA CHAMADA
 *   Nenhum método guarda o `CacheService` ou o `PropertiesService` numa
 *   variável ao carregar o arquivo. Assim a ordem de carga dos `.gs` não
 *   importa, e o harness pode trocar os stubs por cenário.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ
 *   Não decide nada. Não tem retry, não tem log, não tem política. Retry mora em
 *   `Utils.fetchComRetry`; a política de cada trava mora em quem a pede.
 */

const Plataforma = {

  // ==========================================================================
  // CACHE — chave/valor com TTL (hoje CacheService; na Fase 3, Redis)
  // ==========================================================================
  // ⚠️ Não enumera chaves, pode despejar antes do prazo, TTL máximo de 6 h e
  // ~100 KB por valor. Ver ARQUITETURA.md, seção 1.
  cache: {
    get:       (chave)              => CacheService.getScriptCache().get(chave),
    getAll:    (chaves)             => CacheService.getScriptCache().getAll(chaves),
    put:       (chave, valor, ttlS) => CacheService.getScriptCache().put(chave, valor, ttlS),
    putAll:    (valores, ttlS)      => CacheService.getScriptCache().putAll(valores, ttlS),
    remove:    (chave)              => CacheService.getScriptCache().remove(chave),
    removeAll: (chaves)             => CacheService.getScriptCache().removeAll(chaves)
  },

  // ==========================================================================
  // PROPRIEDADES — configuração E estado persistente, no mesmo store
  // ==========================================================================
  // O plano original separava `config` (~25 chaves fixas) de `estado` (5
  // mutáveis). A revisão de 24/09 achou famílias dinâmicas lidas por varredura
  // de prefixo (`sessao_ativa_*`, `bloqueado_*`, `media_id_*`, `uso_urlfetch_*`
  // …), então a separação fica para a Fase 2, por prefixo, dentro daqui.
  propriedades: {
    getProperty:    (chave)        => PropertiesService.getScriptProperties().getProperty(chave),
    getProperties:  ()             => PropertiesService.getScriptProperties().getProperties(),
    setProperty:    (chave, valor) => PropertiesService.getScriptProperties().setProperty(chave, valor),
    deleteProperty: (chave)        => PropertiesService.getScriptProperties().deleteProperty(chave),

    // SÓ MESCLA. O segundo argumento do Apps Script (`deleteAllOthers`)
    // apagaria sessões, contadores e credenciais junto — e por isso não é
    // repassado, nem que alguém o passe.
    setProperties:  (valores)      => PropertiesService.getScriptProperties().setProperties(valores)
  },

  // ==========================================================================
  // CONTADOR — somar a contadores guardados nas propriedades (BL-74, Fase 3)
  // ==========================================================================
  // Os contadores de uso do BL-25 (`uso_urlfetch_*`, `msgs_*`) fazem ler →
  // somar → gravar. No Apps Script isso é o que dá para fazer, e é o que já se
  // fazia: uma leitura e uma escrita, em shards para diluir a corrida. No Node
  // vira HINCRBY no Redis, que é ATÔMICO — com várias instâncias do Cloud Run,
  // ler-somar-gravar perderia incrementos e a conta sairia sempre para menos.
  contador: {
    /** @param {Object<string, number>} somas - chave → quanto somar */
    somar(somas) {
      const props = PropertiesService.getScriptProperties();
      const atuais = props.getProperties();
      const lote = {};
      Object.keys(somas).forEach(k => {
        lote[k] = String((parseInt(atuais[k], 10) || 0) + somas[k]);
      });
      props.setProperties(lote);
    }
  },

  // ==========================================================================
  // HTTP — síncrono, devolvendo o HTTPResponse do Apps Script
  // ==========================================================================
  // Na Fase 2 vira `sync-fetch` dentro de uma worker thread. Ao portar,
  // preservar: `muteHttpExceptions`, payload-objeto com Blob virando
  // multipart (MediaService), `getContent()`/`getBlob()` e redirecionamento.
  http: {
    fetch: (url, opcoes) => UrlFetchApp.fetch(url, opcoes)
  },

  // ==========================================================================
  // RELÓGIO
  // ==========================================================================
  relogio: {
    // ⚠️ `formato` segue os padrões do Java ('yyyy-MM-dd', 'H', 'd'), não os do
    // Intl. A Fase 2 precisa de um tradutor com teste próprio: a janela do
    // BL-73 lê a hora com 'H' e o Odoo recebe campos `date` com 'yyyy-MM-dd'.
    formatar: (data, fuso, formato) => Utilities.formatDate(data, fuso, formato),
    dormir:   (ms)                  => Utilities.sleep(ms)
  },

  // ==========================================================================
  // BYTES — base64, blob e identificadores
  // ==========================================================================
  bytes: {
    paraBase64: (bytes)             => Utilities.base64Encode(bytes),
    deBase64:   (texto)             => Utilities.base64Decode(texto),
    blob:       (bytes, mime, nome) => Utilities.newBlob(bytes, mime, nome),
    uuid:       ()                  => Utilities.getUuid()
  },

  // ==========================================================================
  // TRAVA — exclusão mútua
  // ==========================================================================
  trava: {
    /**
     * Executa `fn` com a trava `chave`.
     *
     * A CHAVE É IGNORADA NO APPS SCRIPT, que só tem trava global — todas as
     * execuções rodam como o mesmo usuário (ARQUITETURA.md, seção 3). Ela já
     * é pedida para que a Fase 3 tenha trava POR USUÁRIO (`SET NX PX` no Redis)
     * sem tocar em quem chama.
     *
     * Se a trava não vier em `esperaMs`, quem decide é `aoFalhar(erro)`: o
     * projeto tem políticas opostas, de propósito, e elas não cabem aqui.
     *   - seguir sem trava: `(e) => { console.warn(...); return fn(); }`
     *   - desistir:         `(e) => { console.warn(...); return false; }`
     * Sem `aoFalhar`, o erro sobe.
     *
     * @param {string}   chave
     * @param {number}   esperaMs
     * @param {Function} fn
     * @param {Function} [aoFalhar]
     */
    comTrava(chave, esperaMs, fn, aoFalhar) {
      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(esperaMs);
      } catch (e) {
        if (aoFalhar) return aoFalhar(e);
        throw e;
      }
      try {
        return fn();
      } finally {
        try { lock.releaseLock(); } catch (ignore) {}
      }
    }
  },

  // ==========================================================================
  // GATILHOS E IDENTIDADE DO DEPLOY (hoje ScriptApp; na Fase 4, Cloud Scheduler)
  // ==========================================================================
  gatilhos: {
    /** Instala `funcao` para rodar de `horas` em `horas`. */
    aCadaHoras: (funcao, horas) =>
      ScriptApp.newTrigger(funcao).timeBased().everyHours(horas).create(),

    /** Instala `funcao` para rodar de `minutos` em `minutos`. */
    aCadaMinutos: (funcao, minutos) =>
      ScriptApp.newTrigger(funcao).timeBased().everyMinutes(minutos).create(),

    /** Remove todo gatilho que chama `funcao`. Devolve quantos removeu. */
    removerDe(funcao) {
      let removidos = 0;
      ScriptApp.getProjectTriggers().forEach(t => {
        if (t.getHandlerFunction() === funcao) {
          ScriptApp.deleteTrigger(t);
          removidos++;
        }
      });
      return removidos;
    },

    /** Exercita o OAuth — a execução por gatilho falha cedo se ele caducou. */
    exercitarAutorizacao: () => ScriptApp.getOAuthToken(),

    /** URL `/exec` do deployment que está rodando. */
    urlDoServico: () => ScriptApp.getService().getUrl()
  },

  // ==========================================================================
  // RESPOSTA HTTP dos pontos de entrada (doGet/doPost)
  // ==========================================================================
  // ⚠️ O Apps Script responde 200 a tudo, inclusive a 'Forbidden' — e a Meta
  // não reenvia o que recebeu com 200. Ao portar (Fase 5), trocar para 403 é
  // mudança de comportamento, não detalhe de implementação.
  // O tipo é o padrão do `createTextOutput`, texto puro — o mesmo que o único
  // sítio que o fixava explicitamente pedia.
  resposta: {
    texto: (conteudo) => ContentService.createTextOutput(conteudo)
  }
};
