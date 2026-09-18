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

  // Teto baixo de propósito: cada espera consome o orçamento de 6 min por
  // execução do Apps Script, e o fluxo de comprovante já faz ~6-8 chamadas
  // externas por mensagem (ver BL-21).
  RETRY_MAX_TENTATIVAS: 3,
  RETRY_BASE_MS:        1000,

  // Orçamento TOTAL da chamada, somando tentativas e esperas.
  //
  // Limitar só o número de tentativas não basta: uma requisição que *trava* —
  // em vez de falhar rápido — vira três travadas. Foi o que aconteceu num teste
  // real: uma consulta ao Odoo pendurou e a execução levou 162s, porque cada
  // repetição pendurou de novo. Sob lentidão do serviço, que é justamente
  // quando o retry deveria ajudar, ele triplicava a duração da execução e
  // consumia o teto de 6 min e o pool de execuções simultâneas mais rápido.
  RETRY_ORCAMENTO_MS: 30000,

  // ── BL-25: consumo da cota diária de UrlFetch ───────────────────────────
  // Ordem de grandeza do teto: ~20 mil chamadas/dia em conta gratuita e
  // ~100 mil em Workspace. Confirme no painel de cotas do projeto e ajuste.
  URLFETCH_COTA_DIARIA: 20000,
  URLFETCH_PREFIXO:     'uso_urlfetch_',
  URLFETCH_SHARDS:      5,

  // ── Mensagens entregues ao WhatsApp (custo) ─────────────────────────────
  // Desde 01/10/2026 a Meta cobra as mensagens de serviço acima de uma
  // franquia mensal por número. Contamos separado dos demais acessos HTTP
  // porque só mensagem entregue é cobrada — chamada ao Odoo, OCR, upload de
  // mídia e download não são.
  //
  // Serviço e template são contados à parte: a franquia vale para serviço;
  // template tem tarifa própria.
  MSG_PREFIXO:          'msgs_',
  MSG_FRANQUIA_SERVICO: 1000,
  MSG_MESES_GUARDADOS:  6,

  // Contadores da execução atual. Cada execução do Apps Script roda num
  // contexto JS próprio, então isto zera sozinho a cada disparo — é por
  // execução, não global.
  _chamadasExternas:  0,
  _mensagensServico:  0,
  _mensagensTemplate: 0,

  /**
   * `UrlFetchApp.fetch` com backoff exponencial para falhas transitórias (BL-24).
   *
   * Só reenvia quando é comprovadamente seguro:
   *   - **429** (throttling): a requisição foi recusada *antes* de ser
   *     executada, então repetir nunca duplica nada. Vale para qualquer chamada.
   *   - **5xx e exceções de rede**: o servidor pode ter processado a requisição
   *     antes de falhar. Só repete quando `idempotente` é true.
   *
   * Por isso um `create` no Odoo passa `idempotente: false`: repetir um 5xx
   * poderia gravar a mesma devolução duas vezes — pior que a falha original.
   *
   * @param {string} url
   * @param {Object} options              - Opções do UrlFetchApp.fetch
   * @param {Object} [cfg]
   * @param {boolean} [cfg.idempotente]   - Repetir com segurança em 5xx/rede?
   * @param {string}  [cfg.rotulo]        - Nome do serviço, para os logs
   * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse} Última resposta obtida
   * @throws Propaga a exceção de rede se todas as tentativas falharem
   */
  fetchComRetry(url, options, cfg = {}) {
    const idempotente = cfg.idempotente === true;
    const rotulo      = cfg.rotulo || 'HTTP';

    const inicio = Date.now();
    let resposta = null;
    let excecao  = null;

    for (let tentativa = 1; tentativa <= this.RETRY_MAX_TENTATIVAS; tentativa++) {
      resposta = null;
      excecao  = null;

      try {
        this._chamadasExternas++;   // BL-25: conta cada tentativa real
        resposta = UrlFetchApp.fetch(url, options);
      } catch (e) {
        excecao = e;
      }

      const code = resposta ? resposta.getResponseCode() : null;

      // Só conta ENTREGA aceita (HTTP 200): é o que a Meta cobra. Tentativa
      // recusada ou repetida não gera cobrança, então não entra na conta.
      if (cfg.mensagem && code === 200) {
        if (cfg.mensagem === 'template') this._mensagensTemplate++;
        else                             this._mensagensServico++;
      }

      const repetir = code === 429 || ((excecao || code >= 500) && idempotente);

      if (!repetir) break;

      // Falha rápido em vez de insistir numa chamada que já consumiu o
      // orçamento — ver o comentário em RETRY_ORCAMENTO_MS.
      const decorrido = Date.now() - inicio;
      if (decorrido >= this.RETRY_ORCAMENTO_MS) {
        console.warn(`⏱️ [${rotulo}] Orçamento de ${this.RETRY_ORCAMENTO_MS}ms esgotado ` +
                     `(${decorrido}ms na tentativa ${tentativa}) — desisto sem repetir.`);
        break;
      }

      if (tentativa < this.RETRY_MAX_TENTATIVAS) {
        const espera = this.RETRY_BASE_MS * Math.pow(2, tentativa - 1);
        console.warn(`⏳ [${rotulo}] Falha transitória ` +
                     `(${excecao ? excecao.message : 'HTTP ' + code}) — ` +
                     `tentativa ${tentativa}/${this.RETRY_MAX_TENTATIVAS}, aguardando ${espera}ms`);
        Utilities.sleep(espera);
      } else {
        console.error(`❌ [${rotulo}] Esgotadas as ${this.RETRY_MAX_TENTATIVAS} tentativas.`);
      }
    }

    if (excecao) throw excecao;
    return resposta;
  },

  /**
   * Acumula o consumo desta execução no total do dia (BL-25).
   *
   * Chamado UMA vez ao fim da execução, nunca a cada requisição: pagar uma
   * escrita em Properties por chamada externa somaria tempo de execução
   * justamente no que o BL-21 tenta enxugar.
   *
   * O contador é distribuído em `URLFETCH_SHARDS` chaves escolhidas ao acaso.
   * Não é uma soma exata — sem compare-and-swap, duas execuções que leiam o
   * mesmo shard ao mesmo tempo perdem um incremento —, e os shards reduzem
   * muito essa chance sem recorrer a lock. O número serve para dar ordem de
   * grandeza e disparar alerta com folga, não para auditoria.
   */
  registrarConsumoExterno() {
    const chamadas = this._chamadasExternas;
    const servico  = this._mensagensServico;
    const template = this._mensagensTemplate;

    this._chamadasExternas  = 0;
    this._mensagensServico  = 0;
    this._mensagensTemplate = 0;

    if (!chamadas && !servico && !template) return;

    try {
      const props = PropertiesService.getScriptProperties();
      const shard = Math.floor(Math.random() * this.URLFETCH_SHARDS);
      const mes   = this._mesAtual();

      if (chamadas) this._somar(props, `${this.URLFETCH_PREFIXO}${this._hoje()}_${shard}`, chamadas);
      // Mensagens são agregadas por MÊS, não por dia: a franquia da Meta é mensal.
      if (servico)  this._somar(props, `${this.MSG_PREFIXO}${mes}_servico_${shard}`,  servico);
      if (template) this._somar(props, `${this.MSG_PREFIXO}${mes}_template_${shard}`, template);

      console.log(`📊 [Cota] ${chamadas} chamada(s) externa(s)` +
                  (servico || template
                    ? ` · ${servico} mensagem(ns) de serviço, ${template} template(s)`
                    : '') +
                  ' nesta execução');
    } catch (e) {
      console.warn('⚠️ [Cota] Não consegui registrar o consumo:', e.message);
    }
  },

  /** Soma `quanto` ao contador da chave. @private */
  _somar(props, chave, quanto) {
    const atual = parseInt(props.getProperty(chave), 10) || 0;
    props.setProperty(chave, String(atual + quanto));
  },

  /**
   * Soma as mensagens do mês corrente e alerta ao se aproximar da franquia.
   * Roda de carona na trigger de sessões, junto com `verificarCotaUrlFetch`.
   * Também descarta os contadores de meses antigos.
   * @returns {{servico: number, template: number}|null}
   */
  verificarCotaMensagens() {
    try {
      const props = PropertiesService.getScriptProperties();
      const todas = props.getProperties();
      const mes   = this._mesAtual();
      const corte = this._mesAtual(new Date(Date.now() - this.MSG_MESES_GUARDADOS * 31 * 86400000));

      let servico = 0;
      let template = 0;

      Object.keys(todas).forEach(chave => {
        if (chave.indexOf(this.MSG_PREFIXO) !== 0) return;

        const mesDaChave = chave.slice(this.MSG_PREFIXO.length, this.MSG_PREFIXO.length + 7);
        if (mesDaChave < corte) { props.deleteProperty(chave); return; }   // ISO ordena como texto
        if (mesDaChave !== mes) return;

        const valor = parseInt(todas[chave], 10) || 0;
        if (chave.indexOf('_template_') >= 0) template += valor;
        else                                  servico  += valor;
      });

      const pct = Math.round((servico / this.MSG_FRANQUIA_SERVICO) * 100);
      const msg = `${servico} de serviço (~${pct}% da franquia de ${this.MSG_FRANQUIA_SERVICO}) ` +
                  `e ${template} template(s) em ${mes}`;

      if (pct >= 90)      console.error(`🚨 [Mensagens] ${msg} — acima da franquia a Meta cobra por entrega.`);
      else if (pct >= 70) console.warn(`⚠️ [Mensagens] ${msg}`);
      else                console.log(`📊 [Mensagens] ${msg}`);

      return { servico, template };
    } catch (e) {
      console.warn('⚠️ [Mensagens] Falha ao verificar:', e.message);
      return null;
    }
  },

  /** Mês em America/Sao_Paulo no formato yyyy-MM. @private */
  _mesAtual(data) {
    return Utilities.formatDate(data || new Date(), 'America/Sao_Paulo', 'yyyy-MM');
  },

  /**
   * Soma os shards do dia, alerta ao se aproximar da cota e descarta contadores
   * com mais de 7 dias. Chamado pela trigger de sessões, que já roda a cada
   * 5 min — não precisa de agendamento próprio.
   * @returns {number|null} total estimado de hoje
   */
  verificarCotaUrlFetch() {
    try {
      const props = PropertiesService.getScriptProperties();
      const todas = props.getProperties();
      const hoje  = this._hoje();
      const corte = this._hoje(new Date(Date.now() - 7 * 86400000));

      let total = 0;
      Object.keys(todas).forEach(chave => {
        if (!chave.startsWith(this.URLFETCH_PREFIXO)) return;
        const dia = chave.slice(this.URLFETCH_PREFIXO.length, this.URLFETCH_PREFIXO.length + 10);
        if (dia === hoje)      total += parseInt(todas[chave], 10) || 0;
        else if (dia < corte)  props.deleteProperty(chave);   // ISO ordena como texto
      });

      const pct = Math.round((total / this.URLFETCH_COTA_DIARIA) * 100);
      const msg = `${total} chamada(s) externa(s) hoje (~${pct}% de ${this.URLFETCH_COTA_DIARIA})`;

      if (pct >= 80)      console.error(`🚨 [Cota] ${msg} — risco de bloqueio de chamadas externas hoje.`);
      else if (pct >= 60) console.warn(`⚠️ [Cota] ${msg}`);
      else                console.log(`📊 [Cota] ${msg}`);

      return total;
    } catch (e) {
      console.warn('⚠️ [Cota] Falha ao verificar:', e.message);
      return null;
    }
  },

  /** Data em America/Sao_Paulo no formato yyyy-MM-dd. @private */
  _hoje(data) {
    return Utilities.formatDate(data || new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  },

  /**
   * Posta um payload no endpoint /messages do WhatsApp e verifica o resultado.
   * Centraliza o envio (antes duplicado em enviarSimples/enviarMenu/enviarLista)
   * e — importante — checa o status code, que antes era ignorado: falhas de
   * envio (token expirado, janela de 24h fechada) passavam despercebidas.
   * @param {Object} payload - Corpo já montado da mensagem WhatsApp
   * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse|null}
   * @private
   */
  _post(payload) {
    const config = getConfig();
    try {
      // BL-24: não idempotente — reenviar um 5xx poderia entregar a mesma
      // mensagem duas vezes ao usuário. Só o 429 (throttling) é repetido, que
      // é justamente o caso em que a mensagem não chegou.
      const response = this.fetchComRetry(
        getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
        {
          method:      'post',
          contentType: 'application/json',
          headers:     { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          payload:     JSON.stringify(payload),
          muteHttpExceptions: true
        },
        { idempotente: false, rotulo: 'WhatsApp', mensagem: 'servico' }
      );

      const code = response.getResponseCode();
      if (code !== 200) {
        console.error(`❌ [WhatsApp] Envio falhou (HTTP ${code}):`, response.getContentText());
      } else {
        this._conferirDestinatario(payload.to, response);
      }
      return response;
    } catch (e) {
      console.error('❌ [WhatsApp] Exceção ao enviar mensagem:', e.message);
      return null;
    }
  },

  /**
   * Avisa quando a Meta resolve o número para um `wa_id` diferente do enviado.
   *
   * BL-32 — O NONO DÍGITO. No Brasil, o WhatsApp de muitos celulares é o número
   * SEM o 9 depois do DDD, mesmo que o número de telefone o tenha. A Meta
   * aceita os dois formatos no envio e devolve HTTP 200 nos dois: só o
   * `wa_id` da resposta diz qual conta realmente recebeu. Enviar para o
   * formato errado é aceito e nunca chega — sem erro nenhum.
   *
   * Números que chegam pelo webhook já vêm canônicos, então o cadastro pelo
   * bot é seguro. O risco está em número DIGITADO: propriedade de teste,
   * contato preenchido à mão no Odoo, lembrete mensal para esse contato.
   *
   * Só registra — não corrige. Descobrir se o 9 sobra ou falta exige os dados
   * reais, e adivinhar aqui quebraria os números em que o 9 está certo.
   *
   * @private
   */
  _conferirDestinatario(enviadoPara, response) {
    if (!enviadoPara) return;
    try {
      const corpo   = JSON.parse(response.getContentText() || '{}');
      const contato = (corpo.contacts || [])[0];
      if (!contato || !contato.wa_id) return;

      if (String(contato.wa_id) !== String(enviadoPara)) {
        console.warn(`⚠️ [WhatsApp] Número ajustado pela Meta: enviado ${enviadoPara}, ` +
                     `entregue a ${contato.wa_id}. Guarde o segundo — ver BL-32.`);
      }
    } catch (e) {
      // Resposta sem JSON esperado não é motivo para falhar um envio bem-sucedido.
    }
  },

  /**
   * Envia mensagem de texto simples.
   * @param {string} to    - Número do destinatário
   * @param {string} texto - Corpo da mensagem
   */
  enviarSimples(to, texto) {
    return this._post({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'text',
      text:              { body: texto }
    });
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

    return this._post(payload);
  },

  /**
   * Envia lista interativa com seções e itens.
   * @param {string} to       - Número do destinatário
   * @param {string} titulo   - Corpo da mensagem
   * @param {Array}  secoes   - [{ title, rows: [{ id, title, description }] }]
   * @param {Object} opcoes   - { textoBotao?, footer?, header? }
   */
  enviarLista(to, titulo, secoes, opcoes = {}) {
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

    return this._post(payload);
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