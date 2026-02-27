/**
 * ============================================================================
 * UTILS.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Funções utilitárias usadas em todo o projeto.
 * Responsabilidades:
 * - Wrappers de envio de mensagens WhatsApp (texto, botões, listas)
 * - Formatadores de dados (valor, data, número)
 * - Helpers genéricos
 *
 * Versão: 8.0
 * Data: Fevereiro 2026
 */

// ============================================================================
// ENVIO DE MENSAGENS WHATSAPP
// ============================================================================

const Utils = {

  /**
   * Envia mensagem de texto simples.
   * @param {string} to    - Número do destinatário
   * @param {string} texto - Corpo da mensagem
   */
  enviarSimples(to, texto) {
    const config = getConfig();

    UrlFetchApp.fetch(
      getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
      {
        method:      'post',
        contentType: 'application/json',
        headers:     { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
        payload:     JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to,
          type:              'text',
          text:              { body: texto }
        }),
        muteHttpExceptions: true
      }
    );
  },

  /**
   * Envia mensagem com botão "🔙 Menu" e rodapé padrão.
   * @param {string} to    - Número do destinatário
   * @param {string} texto - Corpo da mensagem
   */
  enviarComBotaoMenu(to, texto) {
    this.enviarMenu(to, texto, [{ id: 'btn_menu', title: '🔙 Menu' }]);
  },

  /**
   * Envia mensagem com botões de confirmação (Sim/Não) configuráveis.
   * @param {string} to        - Número do destinatário
   * @param {string} texto     - Pergunta
   * @param {string} idSim     - ID do botão de confirmação
   * @param {string} idNao     - ID do botão de cancelamento
   * @param {string} txtSim    - Texto do botão Sim (padrão: '✅ Sim')
   * @param {string} txtNao    - Texto do botão Não (padrão: '❌ Não')
   */
  enviarConfirmar(to, texto, idSim, idNao, txtSim = '✅ Sim', txtNao = '❌ Não') {
    this.enviarMenu(to, texto, [
      { id: idSim, title: txtSim },
      { id: idNao, title: txtNao }
    ]);
  },

  /**
   * Envia mensagem interativa com até 3 botões.
   * @param {string} to      - Número do destinatário
   * @param {string} texto   - Corpo da mensagem
   * @param {Array}  botoes  - Array de { id, title }
   * @param {Object} opcoes  - { header?: string, footer?: string }
   */
  enviarMenu(to, texto, botoes, opcoes = {}) {
    if (botoes.length > 3) {
      console.warn('⚠️ WhatsApp permite no máximo 3 botões. Usando os 3 primeiros.');
      botoes = botoes.slice(0, 3);
    }

    const config  = getConfig();
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: texto },
        action: {
          buttons: botoes.map(btn => ({
            type:  'reply',
            reply: {
              id:    btn.id,
              title: btn.title.substring(0, 20) // limite WhatsApp
            }
          }))
        },
        footer: { text: opcoes.footer || 'Com carinho, Cidinha 💛' }
      }
    };

    if (opcoes.header) {
      payload.interactive.header = { type: 'text', text: opcoes.header };
    }

    UrlFetchApp.fetch(
      getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
      {
        method:      'post',
        contentType: 'application/json',
        headers:     { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
        payload:     JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );
  },

  /**
   * Envia lista interativa com seções e itens.
   * @param {string} to       - Número do destinatário
   * @param {string} titulo   - Corpo da mensagem
   * @param {Array}  secoes   - [{ title, rows: [{ id, title, description }] }]
   * @param {Object} opcoes   - { textoBotao?, footer?, header? }
   */
  enviarLista(to, titulo, secoes, opcoes = {}) {
    const config  = getConfig();
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: titulo },
        action: {
          button:   opcoes.textoBotao || 'Ver opções',
          sections: secoes
        },
        footer: { text: opcoes.footer || 'Com carinho, Cidinha 💛' }
      }
    };

    if (opcoes.header) {
      payload.interactive.header = { type: 'text', text: opcoes.header };
    }

    UrlFetchApp.fetch(
      getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
      {
        method:      'post',
        contentType: 'application/json',
        headers:     { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
        payload:     JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );
  },

  // ============================================================================
  // FORMATADORES
  // ============================================================================

  /**
   * Formata valor numérico para exibição em Real Brasileiro.
   * Ex: 150 → "R$ 150,00"
   * @param {number|string} valor
   * @returns {string}
   */
  formatarValor(valor) {
    const num = parseFloat(valor);
    if (isNaN(num)) return 'R$ 0,00';
    return 'R$ ' + num.toFixed(2).replace('.', ',');
  },

  /**
   * Formata data no padrão Odoo (YYYY-MM-DD) para exibição (DD/MM/AAAA).
   * @param {string} dataOdoo - Ex: "2025-03-15"
   * @returns {string} Ex: "15/03/2025"
   */
  formatarDataOdoo(dataOdoo) {
    if (!dataOdoo) return '—';
    const partes = dataOdoo.split('-');
    if (partes.length !== 3) return dataOdoo;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  },

  /**
   * Formata número de WhatsApp para exibição amigável.
   * Ex: 5586988521231 → "(86) 98852-1231"
   * @param {string} numero - Número com código de país (55)
   * @returns {string}
   */
  formatarNumeroExibicao(numero) {
    // Remove prefixo 55 (Brasil) se presente
    let num = numero;
    if (num.startsWith('55')) num = num.substring(2);

    // Formata: DDD + número
    if (num.length === 11) {
      return `(${num.substring(0, 2)}) ${num.substring(2, 7)}-${num.substring(7)}`;
    }
    if (num.length === 10) {
      return `(${num.substring(0, 2)}) ${num.substring(2, 6)}-${num.substring(6)}`;
    }

    return numero; // retorna original se não reconhecer
  }

};