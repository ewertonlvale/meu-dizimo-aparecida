/**
 * ============================================================================
 * FLOWHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Recebe e valida a resposta de um WhatsApp Flow (formulário nativo).
 *
 * POR QUE ISTO EXISTE
 *   O cadastro conversacional gasta ~15 mensagens e é onde a corrida do BL-29
 *   aparece: cada resposta é uma execução separada, e execuções fora de ordem
 *   gravam no campo errado. Um Flow coleta os mesmos campos em UMA submissão:
 *   uma execução, uma gravação, nenhuma corrida — e 2 mensagens no lugar de 15.
 *
 * MODO SEM ENDPOINT (o único viável aqui)
 *   O modo com endpoint exige decifrar RSA-OAEP-SHA256 + AES-128-GCM a cada
 *   tela. O Apps Script só oferece `Utilities.computeRsaSha256Signature` (que
 *   assina, não decifra), então esse modo está fora. Sem endpoint o Flow roda
 *   inteiro no aparelho e devolve tudo de uma vez ao apertar "Enviar".
 *
 *   Consequência que manda no código abaixo: as validações do Flow JSON rodam
 *   NO CLIENTE. O que chega aqui é dado de fora, não verificado. Por isso
 *   `_normalizar` revalida tudo, com as mesmas regras do CadastroHandler.
 *
 * O QUE O FLOW **NÃO** FAZ
 *   - Foto de perfil: fica fora do formulário. Quem vier pelo Flow cai direto
 *     no resumo, sem foto. É proposital — foto por Flow exigiria tratar o
 *     upload de mídia, e o ganho do Flow está em cortar mensagens de texto.
 *   - Devolução: o fluxo caro no dia a dia é a devolução, e ela depende de
 *     comprovante (imagem/PDF). O Flow não ajuda lá.
 *
 * Versão: 1.0
 * Data: Setembro 2026
 */

const FlowHandler = {

  /** Prefixo do flow_token que identifica o Flow de cadastro. */
  TOKEN_CADASTRO: 'cadastro:',

  // ==========================================================================
  // ENTRADA
  // ==========================================================================

  /**
   * Trata o `nfm_reply` — a resposta de um Flow enviada pelo aparelho.
   * @param {string} from     - Número do remetente
   * @param {Object} nfmReply - message.interactive.nfm_reply
   */
  processar(from, nfmReply) {
    let resposta;
    try {
      resposta = JSON.parse(nfmReply?.response_json || '{}');
    } catch (e) {
      console.error('❌ [Flow] response_json inválido:', e.message);
      MenuHandler.erro(from, 'Não consegui ler os dados do formulário. Vamos tentar pelo menu.');
      return;
    }

    const token = String(resposta.flow_token || '');
    console.log(`📝 [Flow] Resposta recebida — token "${token}", ${Object.keys(resposta).length} campo(s)`);

    if (token.indexOf(this.TOKEN_CADASTRO) === 0) {
      this._processarCadastro(from, resposta);
      return;
    }

    console.warn(`⚠️ [Flow] flow_token não reconhecido: "${token}"`);
    MenuHandler.menuPrincipal(from);
  },

  // ==========================================================================
  // CADASTRO
  // ==========================================================================

  /**
   * Converte a resposta do Flow em `dados_<from>` e mostra o resumo.
   * Reaproveita `CadastroHandler.mostrarResumo`, então o botão "✅ Confirmar"
   * cai no `finalizar` de sempre — o Flow troca a COLETA, não a gravação.
   * @private
   */
  _processarCadastro(from, resposta) {
    const { dados, erros } = this._normalizar(from, resposta);

    if (erros.length) {
      // Sem endpoint não dá para devolver o erro para dentro do Flow: ele já
      // fechou. Então o conserto é por conversa, como sempre foi.
      console.warn('⚠️ [Flow] Cadastro recusado:', erros.join(' | '));
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui aproveitar o formulário.*\n\n' +
        erros.map(e => `• ${e}`).join('\n') +
        '\n\nPodemos fazer o cadastro pelo menu, passo a passo. 💛'
      );
      return;
    }

    StateManager.salvarMultiplosCampos(from, dados);
    StateManager.appendLog(from, `Cadastro via Flow (${Object.keys(dados).length} campos)`);

    console.log(`✅ [Flow] Cadastro de ${from} montado em 1 execução — indo ao resumo`);
    CadastroHandler.mostrarResumo(from);
  },

  /**
   * Valida e converte os campos do Flow para o formato de `dados_<from>`.
   *
   * As regras são as MESMAS do CadastroHandler (nome ≥ 3, apelido ≥ 2, data
   * real e não futura, endereço ≥ 5, valor > 0, dia entre 1 e 28). Elas estão
   * repetidas aqui, e não reaproveitadas, porque lá cada validação já envia a
   * mensagem de erro e muda o estado — comportamento que não serve para um
   * formulário que chega inteiro.
   *
   * @returns {{dados: Object, erros: string[]}}
   * @private
   */
  _normalizar(from, r) {
    const erros = [];
    const dados = { whatsapp: from };

    // ── Comunidade ─────────────────────────────────────────────────────────
    const comunidadeId = parseInt(r.comunidade_id, 10);
    if (!comunidadeId) {
      erros.push('Comunidade não informada.');
    } else {
      dados.comunidadeId   = comunidadeId;
      dados.comunidadeNome = String(r.comunidade_nome || '').trim() ||
                             this._nomeDaComunidade(comunidadeId);
    }

    // ── Nome e apelido ─────────────────────────────────────────────────────
    const nome = String(r.nome || '').trim();
    if (nome.length < 3) erros.push('Nome completo muito curto.');
    else dados.nome = nome;

    const nomeUsual = String(r.nome_usual || '').trim();
    if (nomeUsual.length < 2) erros.push('Apelido muito curto.');
    else dados.nomeUsual = nomeUsual;

    // ── Data de nascimento ─────────────────────────────────────────────────
    const data = this._data(r.data_nascimento);
    if (!data) erros.push('Data de nascimento inválida ou no futuro.');
    else dados.dataNascimento = data;

    // ── Endereço ───────────────────────────────────────────────────────────
    const endereco = String(r.endereco || '').trim();
    if (endereco.length < 5) erros.push('Endereço muito curto.');
    else dados.endereco = endereco;

    // ── Valor mensal ───────────────────────────────────────────────────────
    const valor = this._valor(r.valor_mensal);
    if (valor === null) erros.push('Valor mensal inválido.');
    else dados.valorMensal = valor;

    // ── Notificação e dia ──────────────────────────────────────────────────
    // O Flow manda string ("sim"/"nao" ou "true"/"false"), nunca boolean.
    const querNotificacao = ['sim', 'true', '1'].indexOf(
      String(r.notificacao || '').toLowerCase()
    ) >= 0;
    dados.notificacaoAtiva = querNotificacao;

    if (querNotificacao) {
      const dia = parseInt(r.dia_preferido, 10);
      if (isNaN(dia) || dia < 1 || dia > 28) erros.push('Dia do lembrete deve ficar entre 1 e 28.');
      else dados.diaPreferido = dia;
    }

    return { dados, erros };
  },

  /**
   * Devolve sempre "DD/MM/AAAA", que é o formato gravado hoje.
   *
   * Aceita quatro entradas porque o formato depende do componente usado no
   * Flow JSON, e trocar o componente não pode quebrar o cadastro:
   *   - "1990-03-15"   CalendarPicker
   *   - "637372800000" DatePicker (epoch em MILISSEGUNDOS, como string)
   *   - "15/03/1990"   TextInput
   *   - "15031990"     TextInput sem máscara
   *
   * O epoch é distinguido pelo comprimento: 10 dígitos ou mais. "15031990"
   * tem 8, então não há ambiguidade com a data digitada.
   *
   * @returns {string|null} null se a data não existir ou for futura.
   * @private
   */
  _data(entrada) {
    const texto = String(entrada || '').trim();
    if (!texto) return null;

    let dia, mes, ano;

    if (/^\d{10,}$/.test(texto)) {
      const d = new Date(parseInt(texto, 10));
      if (isNaN(d.getTime())) return null;
      // Getters em UTC, não locais: o DatePicker manda meia-noite UTC e este
      // projeto roda em America/Sao_Paulo (UTC-3). Com getDate() toda data
      // voltaria um dia — "15/03" viraria "14/03" em todo cadastro por Flow.
      dia = ('0' + d.getUTCDate()).slice(-2);
      mes = ('0' + (d.getUTCMonth() + 1)).slice(-2);
      ano = String(d.getUTCFullYear());
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      [ano, mes, dia] = texto.split('-');
    } else {
      const so = texto.replace(/\D/g, '');
      if (so.length !== 8) return null;
      dia = so.substring(0, 2);
      mes = so.substring(2, 4);
      ano = so.substring(4, 8);
    }

    const nDia = parseInt(dia, 10);
    const nMes = parseInt(mes, 10);
    const nAno = parseInt(ano, 10);
    const d    = new Date(nAno, nMes - 1, nDia);

    const existe = d.getFullYear() === nAno && d.getMonth() === nMes - 1 && d.getDate() === nDia;
    if (!existe || nAno < 1900 || d > new Date()) return null;

    return `${dia}/${mes}/${ano}`;
  },

  /**
   * Mesma regra de milhar do `processarValorMensal` (BL-06).
   * @returns {number|null}
   * @private
   */
  _valor(entrada) {
    let t = String(entrada || '').replace(/[^\d.,]/g, '');
    if (t.indexOf(',') >= 0) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (/\.\d{3}(\.\d{3})*$/.test(t)) {
      t = t.replace(/\./g, '');
    }
    const valor = parseFloat(t);
    return (isNaN(valor) || valor <= 0) ? null : valor;
  },

  /**
   * O Flow devolve só o id da comunidade escolhida. O nome é usado no resumo,
   * então buscamos no Odoo quando o formulário não mandou junto.
   * @private
   */
  _nomeDaComunidade(id) {
    try {
      const achada = (OdooService.listarComunidades() || [])
        .filter(c => c.id === id)[0];
      return achada ? achada.x_name : `Comunidade ${id}`;
    } catch (e) {
      console.warn('⚠️ [Flow] Não consegui buscar o nome da comunidade:', e.message);
      return `Comunidade ${id}`;
    }
  },

  // ==========================================================================
  // ENVIO
  // ==========================================================================

  /**
   * Envia o Flow de cadastro.
   *
   * Exige a propriedade FLOW_ID_CADASTRO (o id do Flow criado na Meta).
   * Sem ela devolve `false` e quem chamou segue pelo cadastro conversacional —
   * é o que permite publicar este código antes de existir Flow nenhum.
   *
   * @param {string}  from
   * @param {boolean} [rascunho] - true envia a versão em RASCUNHO (`mode:
   *   'draft'`), que é o que permite abrir o formulário num aparelho de
   *   verdade antes de publicar o Flow. O WhatsApp mostra um aviso de que é
   *   rascunho, e só números com papel na conta da Meta conseguem abrir.
   * @returns {boolean} true se o Flow foi enviado.
   */
  enviarFlowCadastro(from, rascunho) {
    const flowId = PropertiesService.getScriptProperties().getProperty('FLOW_ID_CADASTRO');
    if (!flowId) {
      console.log('ℹ️ [Flow] FLOW_ID_CADASTRO não configurado — seguindo pelo cadastro por conversa');
      return false;
    }

    // A lista de comunidades vai junto, no payload: sem endpoint, o Flow não
    // tem como consultar o Odoo sozinho.
    let comunidades;
    try {
      comunidades = (OdooService.listarComunidades() || [])
        .map(c => ({ id: String(c.id), title: String(c.x_name).substring(0, 30) }));
    } catch (e) {
      console.error('❌ [Flow] Falha ao listar comunidades:', e.message);
      return false;
    }
    if (!comunidades.length) return false;

    const resposta = Utils._post({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to:                from,
      type:              'interactive',
      interactive: {
        type:   'flow',
        header: { type: 'text', text: '💛 Cadastro de Dizimista' },
        body:   { text: 'Preencha seus dados de uma vez só. Leva menos de um minuto. 💛' },
        footer: { text: 'Com carinho, Cidinha 💛' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            // Volta em response_json — é por ele que `processar` sabe que Flow é.
            flow_token:   `${this.TOKEN_CADASTRO}${from}:${Date.now()}`,
            flow_id:      flowId,
            flow_cta:     'Preencher cadastro',
            flow_action:  'navigate',
            // 'draft' abre a versão não publicada; ausente equivale a
            // 'published'. É o que torna possível testar num aparelho real
            // antes de publicar o Flow.
            mode:         rascunho ? 'draft' : 'published',
            flow_action_payload: {
              screen: 'CADASTRO',
              data:   { comunidades }
            }
          }
        }
      }
    });

    const enviou = !!resposta && resposta.getResponseCode() === 200;
    console.log(`📤 [Flow] Envio do cadastro para ${from} ` +
                `(${rascunho ? 'RASCUNHO' : 'publicado'}, ${comunidades.length} comunidades): ` +
                `${enviou ? 'ok' : 'falhou'}`);
    if (enviou) {
      StateManager.setEstado(from, ESTADOS.AGUARDANDO_FLOW_CADASTRO);
      StateManager.salvarMultiplosCampos(from, { whatsapp: from });
    }
    return enviou;
  }

};
