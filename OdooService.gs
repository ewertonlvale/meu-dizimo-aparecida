/**
 * ============================================================================
 * ODOOSERVICE.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Camada única de acesso ao Odoo ERP via JSON-RPC.
 * Consolida OdooService.gs (funções genéricas) e OdooIntegration.gs (negócio).
 *
 * Modelos utilizados:
 *   - x_dizimista              → Cadastro do dizimista
 *   - x_comunidade             → Comunidades disponíveis
 *   - x_devolucao              → Devoluções registradas
 *   - x_parametros_line_c498a  → Números privilegiados (admins)
 *
 * Versão: 9.0  (adicionado getDizimistasByCommunity; listarComunidades agora
 *               inclui x_studio_whatsapp_coordenador para identificar coordenadores)
 * Data: Fevereiro 2026
 */

const OdooService = {

  // ==========================================================================
  // PRIMITIVOS JSON-RPC
  // ==========================================================================

  /**
   * Executa search_read no Odoo.
   * @param {string} model   - Nome do modelo
   * @param {Array}  fields  - Campos a retornar
   * @param {Array}  domain  - Filtros
   * @param {Object} options - { order, limit, offset }
   * @returns {Array} registros
   */
  searchRead(model, fields, domain = [], options = {}) {
    const cfg = getOdooConfig();

    const payload = {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        service: 'object',
        method:  'execute_kw',
        args: [
          cfg.database, cfg.uid, cfg.apiKey,
          model, 'search_read',
          [domain],
          {
            fields,
            order:  options.order || 'id asc',
            limit:  options.limit !== undefined ? options.limit : 100,
            offset: options.offset || 0
          }
        ]
      }
    };

    return this._rpc(cfg.url, payload);
  },

  /**
   * Cria um registro no Odoo.
   * @returns {number} ID do registro criado
   */
  create(model, data) {
    const cfg = getOdooConfig();

    const payload = {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        service: 'object',
        method:  'execute_kw',
        args: [cfg.database, cfg.uid, cfg.apiKey, model, 'create', [data]]
      }
    };

    return this._rpc(cfg.url, payload);
  },

  /**
   * Atualiza um registro existente no Odoo.
   * @returns {boolean} true se bem-sucedido
   */
  write(model, recordId, data) {
    const cfg = getOdooConfig();

    const payload = {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        service: 'object',
        method:  'execute_kw',
        args: [cfg.database, cfg.uid, cfg.apiKey, model, 'write', [[recordId], data]]
      }
    };

    return this._rpc(cfg.url, payload);
  },

  /**
   * Faz a chamada HTTP e retorna result ou lança erro.
   * @private
   */
  _rpc(baseUrl, payload) {
    console.log(`🔄 Odoo RPC → ${payload.params.args[3]} / ${payload.params.args[4]}`);

    const response = UrlFetchApp.fetch(`${baseUrl}/jsonrpc`, {
      method:      'post',
      contentType: 'application/json',
      payload:     JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());

    if (result.error) {
      const msg = result.error.data?.message || result.error.message || 'Erro Odoo';
      console.error('❌ Erro Odoo:', msg);
      throw new Error(msg);
    }

    console.log('✅ Odoo OK, registros:', Array.isArray(result.result) ? result.result.length : result.result);
    return result.result;
  },

  // ==========================================================================
  // DIZIMISTA
  // ==========================================================================

  CAMPOS_DIZIMISTA: [
    'id', 'x_name', 'x_studio_nome_completo', 'x_studio_partner_phone',
    'x_studio_partner_email', 'x_studio_cpf', 'x_studio_endereco',
    'x_studio_date', 'x_studio_value', 'x_studio_comunidade', 'x_active',
    'x_studio_notificacao_ativa',
    'x_studio_dia_preferido'
  ],

  /**
   * Busca dizimista pelo número de WhatsApp.
   * Tenta com e sem o 9º dígito automaticamente.
   * @param {string} whatsapp - Número no formato internacional (5586988521231)
   * @returns {Object|null}
   */
  buscarDizimistaPorWhatsapp(whatsapp) {
    console.log('🔍 Buscando dizimista:', whatsapp);

    let registros = this.searchRead(
      'x_dizimista',
      this.CAMPOS_DIZIMISTA,
      [['x_studio_partner_phone', '=', whatsapp]]
    );

    if (registros?.length > 0) return registros[0];

    // Busca inteligente: com/sem 9º dígito
    let whatsappAlt;
    if (whatsapp.length === 13) {
      whatsappAlt = whatsapp.substring(0, 4) + whatsapp.substring(5);
    } else if (whatsapp.length === 12) {
      whatsappAlt = whatsapp.substring(0, 4) + '9' + whatsapp.substring(4);
    }

    if (whatsappAlt) {
      registros = this.searchRead(
        'x_dizimista',
        this.CAMPOS_DIZIMISTA,
        [['x_studio_partner_phone', '=', whatsappAlt]]
      );

      if (registros?.length > 0) {
        this.atualizarDizimista(registros[0].id, { x_studio_partner_phone: whatsapp });
        return registros[0];
      }
    }

    console.log('ℹ️ Dizimista não encontrado');
    return null;
  },

  /**
   * Cria um novo dizimista a partir dos dados coletados no cadastro.
   * @param {Object} dados - Dados temporários do StateManager
   * @returns {number} ID criado
   */
  criarDizimista(dados) {
    const [dia, mes, ano] = dados.dataNascimento.split('/');
    const dataOdoo = `${ano}-${mes}-${dia}`;

    return this.create('x_dizimista', {
      x_studio_nome_completo:     dados.nome,
      x_name:                     dados.nomeUsual,
      x_studio_partner_phone:     dados.whatsapp,
      x_studio_endereco:          dados.endereco,
      x_studio_date:              dataOdoo,
      x_studio_value:             dados.valorMensal,
      x_studio_comunidade:        dados.comunidadeId,
      x_studio_notificacao_ativa: dados.notificacaoAtiva || false,
      x_studio_dia_preferido:     dados.diaPreferido || 10
    });
  },

  /**
   * Atualiza campos de um dizimista existente.
   * @param {number} id   - ID do dizimista
   * @param {Object} data - Campos a atualizar (chaves Odoo)
   */
  atualizarDizimista(id, data) {
    return this.write('x_dizimista', id, data);
  },

  /**
   * Salva a foto de perfil do dizimista.
   * @param {number} id          - ID do dizimista
   * @param {string} fotoBase64  - Imagem em base64
   */
  salvarFotoDizimista(id, fotoBase64) {
    return this.write('x_dizimista', id, { x_studio_image: fotoBase64 });
  },

  /**
   * Busca todos os dizimistas ativos.
   * Usado pelo RelatorioHandler para calcular esperado e detectar atrasos.
   * @returns {Array}
   */
  listarTodosDizimistas() {
    return this.searchRead(
      'x_dizimista',
      ['id', 'x_name', 'x_studio_comunidade', 'x_studio_value', 'x_active', 'create_date'],
      [['x_active', '=', true]],
      { limit: false }
    );
  },

  /**
   * Busca dizimistas de uma comunidade específica (apenas nome).
   * Usado pelo RelatorioHandler na opção "Listar Dizimistas".
   * Retorna apenas registros ativos, ordenados por nome.
   * @param {number} communityId - ID da comunidade
   * @returns {Array} [{ id, x_name }]
   */
  getDizimistasByCommunity(communityId) {
    console.log(`🔍 Buscando dizimistas da comunidade ${communityId}`);
    return this.searchRead(
      'x_dizimista',
      ['id', 'x_name'],
      [
        ['x_studio_comunidade', '=', communityId],
        ['x_active', '=', true]
      ],
      { order: 'x_name asc', limit: false }
    );
  },

  // ==========================================================================
  // COMUNIDADES
  // ==========================================================================

  /**
   * Retorna todas as comunidades ativas, ordenadas por nome.
   *
   * Campos relevantes para o módulo de relatório:
   *   - x_studio_chave_acesso          → Código de acesso (senha) do coordenador
   *   - x_studio_whatsapp_coordenador  → WhatsApp do coordenador (identificação por número)
   */
  listarComunidades() {
    return this.searchRead(
      'x_comunidade',
      [
        'id',
        'x_name',
        'x_studio_chave_acesso',           // Código de acesso (senha) do coordenador
        'x_studio_whatsapp_coordenador',   // WhatsApp do coordenador (identificação por número)
        'x_studio_chave_pix',
        'x_studio_banco',
        'x_studio_titular_conta'
      ],
      [['x_active', '=', true]],
      { order: 'x_name asc', limit: 50 }
    );
  },

  /**
   * Busca os dados de pagamento da comunidade do dizimista.
   * @param {Object} dizimista - Registro do dizimista
   * @returns {Object|null}
   */
  buscarDadosPagamentoComunidade(dizimista) {
    const comunidadeRel = dizimista.x_studio_comunidade;
    if (!comunidadeRel || comunidadeRel.length === 0) return null;

    const comunidadeId = Array.isArray(comunidadeRel[0])
      ? comunidadeRel[0][0]
      : comunidadeRel[0];

    const registros = this.searchRead(
      'x_comunidade',
      ['id', 'x_name', 'x_studio_chave_pix', 'x_studio_banco', 'x_studio_titular_conta'],
      [['id', '=', comunidadeId]]
    );

    return registros?.[0] || null;
  },

  // ==========================================================================
  // DEVOLUÇÕES
  // ==========================================================================

  /**
   * Registra uma devolução no Odoo com comprovante (imagem ou PDF).
   * @param {number}      dizimistaId        - ID do dizimista
   * @param {Object}      dadosAnalise       - Dados extraídos pela Vision API
   * @param {string|null} comprovanteBase64  - Arquivo original em base64
   * @param {string}      tipoComprovante    - 'imagem' ou 'pdf'
   * @returns {number} ID da devolução criada
   */
  registrarDevolucao(dizimistaId, dadosAnalise, comprovanteBase64 = null, tipoComprovante = 'imagem') {
    const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');

    let dataOdoo = hoje;
    if (dadosAnalise?.data) {
      try {
        const [dia, mes, ano] = dadosAnalise.data.split('/');
        dataOdoo = `${ano}-${mes}-${dia}`;
        console.log(`📅 Data convertida: ${dadosAnalise.data} → ${dataOdoo}`);
      } catch (e) {
        console.warn('⚠️ Erro ao converter data:', e.message);
        dataOdoo = hoje;
      }
    }

    const descricao = `Devolução de R$ ${dadosAnalise?.valor || 0} - ${dadosAnalise?.data || hoje}`;

    const dados = {
      x_name:                        descricao,
      x_studio_dizimista:            dizimistaId,
      x_studio_data_da_devolucao:    dataOdoo,
      x_studio_value:                dadosAnalise?.valor || 0,
      x_studio_status:               'Pendente',
      x_studio_tipo_comprovante:     tipoComprovante
    };

    if (comprovanteBase64) {
      dados.x_studio_comprovante = comprovanteBase64;
      // Nome amigável para download no Odoo
      const extensao = tipoComprovante === 'pdf' ? 'pdf' : 'png';
      dados.x_studio_nome_arquivo = `comprovante_${dataOdoo}.${extensao}`;
    }

    console.log(`📊 [OdooService] Criando devolução (tipo: ${tipoComprovante}):`,
      JSON.stringify({...dados, x_studio_comprovante: comprovanteBase64 ? `[${comprovanteBase64.length} chars]` : null}, null, 2));
    return this.create('x_devolucao', dados);
  },

  /**
   * Busca as últimas devoluções de um dizimista.
   * @param {number} dizimistaId - ID do dizimista
   * @param {number} limite      - Quantidade máxima de registros
   * @returns {Array}
   */
  buscarDevolucoesDizimista(dizimistaId, limite = 10) {
    return this.searchRead(
      'x_devolucao',
      ['id', 'x_studio_data_da_devolucao', 'x_studio_value', 'x_studio_status'],
      [['x_studio_dizimista', '=', dizimistaId]],
      { order: 'x_studio_data_da_devolucao desc', limit: limite }
    );
  },

  /**
   * Busca devoluções dentro de um intervalo de datas.
   * Usado pelo RelatorioHandler.
   * @param {string} dataInicio - Formato ISO: 'YYYY-MM-DD'
   * @param {string} dataFim    - Formato ISO: 'YYYY-MM-DD'
   * @returns {Array}
   */
  listarDevolucoesPorPeriodo(dataInicio, dataFim) {
    return this.searchRead(
      'x_devolucao',
      ['id', 'x_studio_dizimista', 'x_studio_value', 'x_studio_data_da_devolucao', 'x_studio_status'],
      [
        ['x_studio_data_da_devolucao', '>=', dataInicio],
        ['x_studio_data_da_devolucao', '<=', dataFim]
      ],
      { limit: false }
    );
  },

  /**
   * Busca devoluções com status "Pendente" de uma comunidade específica.
   * @param {number} comunidadeId - ID da comunidade
   * @param {number} limite       - Máximo de registros (padrão 10 = limite da lista WhatsApp)
   * @returns {Array}
   */
  buscarDevolucoesPendentes(comunidadeId, limite = 10) {
    return this.searchRead(
      'x_devolucao',
      [
        'id',
        'x_name',
        'x_studio_dizimista',
        'x_studio_data_da_devolucao',
        'x_studio_value',
        'x_studio_status'
      ],
      [
        ['x_studio_comunidade', '=', comunidadeId],
        ['x_studio_status',     '=', 'Pendente']
      ],
      { order: 'x_studio_data_da_devolucao desc', limit: limite }
    );
  },

  /**
   * Busca os dados completos de uma devolução, incluindo comprovante.
   * @param {number} devolucaoId - ID da devolução
   * @returns {Object|null}
   */
  buscarDevolucaoDetalhada(devolucaoId) {
    const registros = this.searchRead(
      'x_devolucao',
      [
        'id',
        'x_name',
        'x_studio_dizimista',
        'x_studio_comunidade',
        'x_studio_data_da_devolucao',
        'x_studio_value',
        'x_studio_status',
        'x_studio_comprovante',
        'x_studio_tipo_comprovante',
        'x_studio_nome_arquivo',
        'x_studio_forma_de_pagamento',
        'x_studio_competencia'
      ],
      [['id', '=', devolucaoId]],
      { limit: 1 }
    );
    return registros?.[0] || null;
  },

  /**
   * Atualiza o status de uma devolução (Confirmado ou Rejeitado).
   * @param {number} devolucaoId - ID da devolução
   * @param {string} novoStatus  - 'Confirmado' ou 'Rejeitado'
   * @returns {boolean}
   */
  atualizarStatusDevolucao(devolucaoId, novoStatus) {
    console.log(`📝 [OdooService] Atualizando devolução ${devolucaoId} → ${novoStatus}`);
    return this.write('x_devolucao', devolucaoId, {
      x_studio_status: novoStatus
    });
  },

  // ==========================================================================
  // NÚMEROS PRIVILEGIADOS (ADMINS)
  // ==========================================================================

  /**
   * Busca todos os registros da tabela de admins (x_parametros_line_c498a).
   *
   * Campos retornados:
   *   - x_studio_whatsapp     → Telefone do admin (para identificação por número)
   *   - x_studio_chave_acesso → Código de acesso (senha digitada pelo usuário)
   *
   * @returns {Array}
   */
  buscarNumerosPrivilegiados() {
    return this.searchRead(
      'x_parametros_line_c498a',
      ['id', 'x_name', 'x_studio_whatsapp', 'x_studio_chave_acesso'],
      [],
      { limit: false }
    );
  },

  // ==========================================================================
  // CONTATO BOT
  // ==========================================================================

  /**
   * Busca o registro de contato do bot pelo número WhatsApp.
   * @param {string} from - Número no formato internacional
   * @returns {Object|null}
   */
  buscarContatoBot(from) {
    const registros = this.searchRead(
      'x_contato_bot',
      ['id', 'x_name', 'x_studio_cadastrou', 'x_studio_etapa_abandono'],
      [['x_name', '=', from]],
      { limit: 1 }
    );
    return registros?.[0] || null;
  },

  /**
   * Cria um novo registro de contato bot.
   * @param {string} from - Número no formato internacional
   * @returns {number} ID criado
   */
  registrarContatoBot(from) {
    const agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd HH:mm:ss");
    return this.create('x_contato_bot', {
      x_name:                         from,
      x_studio_data_primeiro_contato: agora,
      x_studio_cadastrou:             false
    });
  },

  /**
   * Atualiza o registro de contato bot com log, etapa e status de cadastro.
   * @param {string}  from    - Número no formato internacional
   * @param {Object}  dados   - Campos a atualizar
   * @param {string}  [dados.x_studio_log_cadastro]   - Log acumulado
   * @param {string}  [dados.x_studio_etapa_abandono] - Etapa atual
   * @param {boolean} [dados.x_studio_cadastrou]      - Se finalizou
   */
  atualizarContatoBot(from, dados) {
    const contato = this.buscarContatoBot(from);
    if (!contato) {
      console.warn(`⚠️ x_contato_bot não encontrado para ${from}`);
      return;
    }
    return this.write('x_contato_bot', contato.id, dados);
  },

  // ==========================================================================
  // PARÂMETROS
  // ==========================================================================

  /**
   * Busca os parâmetros do sistema (avatar, horários, contatos).
   * @returns {Object|null}
   */
  buscarParametros() {
    console.log('🔍 Buscando parâmetros do sistema...');

    const registros = this.searchRead(
      'x_parametros',
      ['id', 'x_name', 'x_studio_avatar', 'x_studio_paroquia',
       'x_studio_horario_de', 'x_studio_secretaria_email',
       'x_studio_secretaria_whatsapp'],
      [['x_active', '=', true]],
      { limit: 1 }
    );

    if (registros && registros.length > 0) {
      console.log(`✅ Parâmetros encontrados: ${registros[0].x_name}`);
      return registros[0];
    }

    console.warn('⚠️ Nenhum parâmetro ativo encontrado');
    return null;
  },

  /**
   * Busca um parâmetro específico por chave.
   */
  buscarParametro(chave) {
    const resultado = this.searchRead(
      'x_parametros_line',
      ['x_studio_valor'],
      [['x_studio_chave', '=', chave]],
      { limit: 1 }
    );

    return resultado.length > 0 ? resultado[0].x_studio_valor : null;
  }

};