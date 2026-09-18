/**
 * ============================================================================
 * ENVELOPE.JS — forma do webhook do WhatsApp, num lugar só
 * ============================================================================
 *
 * Módulo compartilhado por `simula-carga.js` e `simula-flow.js`. Não sobe para
 * o Apps Script (`ferramentas/**` está no `.claspignore`).
 *
 * Existe porque a estrutura do envelope e os construtores de mensagem estavam
 * copiados nos dois scripts, com o mesmo comentário repetido em cada um. Uma
 * mudança no `Webhook.gs` obrigava a achar os dois.
 */

/**
 * O webhook deduplica por messageId (cache de 10 min). Sem id único, todas as
 * requisições menos a primeira seriam ignoradas em SILÊNCIO — e o teste
 * pareceria passar sem ter processado nada.
 *
 * @param {string} prefixo - Identifica a origem no log ('TESTE', 'FLOW')
 * @param {string|number} [indice] - Distingue mensagens do mesmo disparo
 */
function idUnico(prefixo, indice = '') {
  const sufixo = Math.random().toString(36).slice(2, 10);
  return `wamid.${prefixo}_${Date.now()}_${indice}_${sufixo}`;
}

/**
 * Monta o POST que a Meta faria ao webhook.
 *
 * @param {string} from - Número do remetente, só dígitos
 * @param {Object} mensagemParcial - O que distingue esta mensagem (type + corpo)
 * @param {Object} [opcoes] - { prefixo, indice } para o messageId
 */
function envelope(from, mensagemParcial, opcoes = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'TESTE',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '0', phone_number_id: '0' },
          messages: [Object.assign({
            from,
            id: idUnico(opcoes.prefixo || 'TESTE', opcoes.indice),
            timestamp: String(Math.floor(Date.now() / 1000))
          }, mensagemParcial)]
        }
      }]
    }]
  };
}

// ── Construtores de mensagem, na forma que o Router espera ──────────────────

const comoTexto = texto => ({ type: 'text', text: { body: texto } });

const comoBotao = (id, title) => ({
  type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id, title } }
});

const comoLista = (id, title) => ({
  type: 'interactive',
  interactive: { type: 'list_reply', list_reply: { id, title } }
});

/**
 * Resposta de um Flow. O `response_json` é string mesmo: a Meta entrega o
 * payload do formulário como JSON serializado dentro do JSON da mensagem.
 */
const comoFlow = resposta => ({
  type: 'interactive',
  interactive: {
    type: 'nfm_reply',
    nfm_reply: {
      name: 'flow',
      body: 'Enviado',
      response_json: JSON.stringify(resposta)
    }
  }
});

module.exports = { idUnico, envelope, comoTexto, comoBotao, comoLista, comoFlow };
