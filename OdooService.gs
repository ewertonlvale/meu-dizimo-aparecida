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
   * Conta registros que satisfazem o domínio (search_count).
   * @param {string} model  - Nome do modelo
   * @param {Array}  domain - Filtros
   * @returns {number} quantidade de registros
   */
  count(model, domain = []) {
    const cfg = getOdooConfig();

    const payload = {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        service: 'object',
        method:  'execute_kw',
        args: [cfg.database, cfg.uid, cfg.apiKey, model, 'search_count', [domain]]
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
   * Apaga registros. Exige a lista explícita de IDs e não aceita domínio, de
   * propósito: assim não há como varrer um modelo inteiro por engano.
   * @param {string}   model - Nome do modelo
   * @param {number[]} ids   - IDs a apagar
   * @returns {boolean} true se o Odoo confirmou
   */
  unlink(model, ids) {
    if (!Array.isArray(ids) || ids.length === 0) return false;

    const cfg = getOdooConfig();
    const payload = {
      jsonrpc: '2.0',
      method:  'call',
      params: {
        service: 'object',
        method:  'execute_kw',
        args: [cfg.database, cfg.uid, cfg.apiKey, model, 'unlink', [ids]]
      }
    };

    return this._rpc(cfg.url, payload);
  },

  // BL-24: métodos que NÃO podem ser repetidos após 5xx. `create` duplicaria o
  // registro; `unlink` falharia na segunda tentativa ("registro não existe"),
  // transformando uma exclusão bem-sucedida em erro no log.
  METODOS_NAO_IDEMPOTENTES: ['create', 'unlink'],

  /**
   * Faz a chamada HTTP e retorna result ou lança erro.
   * @private
   */
  _rpc(baseUrl, payload) {
    const metodo = payload.params.args[4];
    console.log(`🔄 Odoo RPC → ${payload.params.args[3]} / ${metodo}`);

    // BL-24: leituras e `write` (que só fixa valores) podem ser repetidas com
    // segurança; `create` e `unlink` não — ver METODOS_NAO_IDEMPOTENTES.
    const response = Utils.fetchComRetry(
      `${baseUrl}/jsonrpc`,
      {
        method:      'post',
        contentType: 'application/json',
        payload:     JSON.stringify(payload),
        muteHttpExceptions: true
      },
      {
        idempotente: this.METODOS_NAO_IDEMPOTENTES.indexOf(metodo) < 0,
        rotulo:      `Odoo ${metodo}`
      }
    );

    // Antes o corpo era parseado direto: um 5xx devolve HTML e estourava um
    // SyntaxError de JSON, escondendo a causa real.
    const code = response.getResponseCode();
    if (code !== 200) {
      console.error(`❌ [Odoo] HTTP ${code} em ${metodo}:`, response.getContentText().slice(0, 300));
      throw new Error(`Odoo respondeu HTTP ${code} em ${metodo}`);
    }

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

    // Busca com a outra forma do nono dígito (BL-32). A regra mora em
    // `Utils.variantesNumeroBR` — antes estava reescrita aqui por `length`, e as
    // duas versões já divergiam: esta aceitava qualquer número de 12 dígitos e
    // inventava um 9 no meio, então um TELEFONE FIXO disparava um segundo
    // search_read garantidamente vazio a cada mensagem.
    const variantes = Utils.variantesNumeroBR(whatsapp);
    const alternativo = variantes
      ? (whatsapp === variantes.comNove ? variantes.semNove : variantes.comNove)
      : null;

    if (alternativo) {
      registros = this.searchRead(
        'x_dizimista',
        this.CAMPOS_DIZIMISTA,
        [['x_studio_partner_phone', '=', alternativo]]
      );

      if (registros?.length > 0) {
        // BL-15: NÃO gravamos o telefone aqui. `x_studio_partner_phone` é related
        // e gravável (store+related, não readonly no Odoo 18), então um write
        // propagaria para `res.partner.phone` — efeito colateral indevido numa
        // função de leitura. A busca com/sem 9º dígito já encontra o registro;
        // se for preciso normalizar o número, faça em um ponto de escrita explícito.
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
   * Cria um MEMBRO da família, vinculado ao responsável.
   * Diferenças do cadastro normal: grava x_studio_responsavel, herda a
   * comunidade, NÃO grava telefone (membro não fala com o bot) e deixa as
   * notificações desligadas.
   * @param {Object} dados         - Dados temporários do cadastro do membro
   * @param {number} responsavelId - ID do dizimista responsável
   * @returns {number} ID criado
   */
  criarMembro(dados, responsavelId) {
    const [dia, mes, ano] = dados.dataNascimento.split('/');
    const dataOdoo = `${ano}-${mes}-${dia}`;

    return this.create('x_dizimista', {
      x_studio_nome_completo:     dados.nome,
      x_name:                     dados.nomeUsual,
      x_studio_endereco:          dados.endereco,
      x_studio_date:              dataOdoo,
      x_studio_value:             dados.valorMensal,
      x_studio_comunidade:        dados.comunidadeId,
      x_studio_responsavel:       responsavelId,
      x_studio_notificacao_ativa: false,
      x_studio_dia_preferido:     dados.diaPreferido || 10
      // sem x_studio_partner_phone: o membro não tem número próprio
    });
  },

  /**
   * Lista a família de um responsável: o próprio responsável + os membros
   * que apontam para ele (x_studio_responsavel), apenas ativos.
   * @param {number} responsavelId
   * @returns {Array} [{ id, x_name, x_studio_value, x_studio_comunidade, x_studio_responsavel }]
   */
  listarFamilia(responsavelId) {
    return this.searchRead(
      'x_dizimista',
      ['id', 'x_name', 'x_studio_value', 'x_studio_comunidade', 'x_studio_responsavel'],
      ['&', ['x_active', '=', true],
            '|', ['id', '=', responsavelId],
                 ['x_studio_responsavel', '=', responsavelId]],
      { order: 'id asc', limit: false }
    );
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

  /**
   * Retorna os contatos da pastoral do dízimo de uma comunidade.
   * Fonte primária: "Usuários Pastoral" (m2m `x_studio_usuarios` → res.users),
   * usando nome + telefone/celular de cada usuário. Fallback: o coordenador do
   * dízimo (campos `x_studio_coordenador_dizimo` / `x_studio_whatsapp_coordenador`).
   * @param {number} comunidadeId
   * @returns {{comunidade: string|null, contatos: Array<{nome: string, whatsapp: string}>}}
   */
  buscarContatosComunidade(comunidadeId) {
    const regs = this.searchRead(
      'x_comunidade',
      ['id', 'x_name', 'x_studio_usuarios',
       'x_studio_coordenador_dizimo', 'x_studio_whatsapp_coordenador'],
      [['id', '=', comunidadeId]],
      { limit: 1 }
    );
    const com = regs?.[0];
    if (!com) return { comunidade: null, contatos: [] };

    const contatos = [];

    // 1) Usuários Pastoral (many2many → res.users). No Odoo 18 o telefone fica em
    //    'phone' (o campo 'mobile' foi removido), e o res.users já o expõe.
    const userIds = Array.isArray(com.x_studio_usuarios) ? com.x_studio_usuarios : [];
    if (userIds.length) {
      let users = [];
      try {
        users = this.searchRead(
          'res.users',
          ['id', 'name', 'phone'],
          [['id', 'in', userIds]],
          { limit: 20 }
        ) || [];
      } catch (e) {
        console.warn('⚠️ [OdooService] Falha ao ler res.users (contatos):', e.message);
      }
      users.forEach(u => {
        if (u.phone) contatos.push({ nome: u.name || 'Pastoral do Dízimo', whatsapp: String(u.phone) });
      });
    }

    // 2) Fallback: coordenador do dízimo (campos texto da própria comunidade).
    if (!contatos.length && com.x_studio_whatsapp_coordenador) {
      contatos.push({
        nome:     com.x_studio_coordenador_dizimo || 'Coordenador do Dízimo',
        whatsapp: String(com.x_studio_whatsapp_coordenador)
      });
    }

    return { comunidade: com.x_name || null, contatos };
  },

  /**
   * Extrai o id da comunidade do dizimista e retorna seus contatos.
   * @param {Object} dizimista - Registro do dizimista
   * @returns {{comunidade: string|null, contatos: Array}}
   */
  contatosDoDizimista(dizimista) {
    const rel = dizimista && dizimista.x_studio_comunidade;
    if (!rel || !rel.length) return { comunidade: null, contatos: [] };
    const comunidadeId = Array.isArray(rel[0]) ? rel[0][0] : rel[0];
    return this.buscarContatosComunidade(comunidadeId);
  },

  // ==========================================================================
  // DEVOLUÇÕES
  // ==========================================================================

  /**
   * BL-26: `x_studio_conferencia_pix` é criado por `criarCampoConferenciaPix()`
   * (SetupCamposFamilia.gs). Enquanto ele não existir no Odoo, gravá-lo — ou
   * pedi-lo num searchRead — faria a chamada inteira falhar, e uma devolução
   * perdida é pior que um aviso ausente. Checa uma vez e cacheia o resultado.
   * @returns {boolean} true se o campo existe no schema
   * @private
   */
  /**
   * Existe este campo customizado no modelo? (com cache)
   *
   * Generalizado de `_temCampoConferenciaPix`: a pergunta "o setup já criou
   * este campo?" aparece sempre que um campo é opcional, e o `SetupCamposFamilia`
   * tende a criar mais. Sem isto, cada novo campo copia as mesmas ~20 linhas,
   * inclusive a chave de cache e a regra de TTL.
   *
   * Três níveis, do mais barato ao mais caro:
   *   1. memória da execução — o laço de família chama isto uma vez por membro
   *      e a resposta não muda dentro da mesma execução;
   *   2. CacheService;
   *   3. um search_read em `ir.model.fields`.
   *
   * TTL curto quando ausente, para o campo passar a valer logo após o setup.
   *
   * @param {string} model - Ex.: 'x_devolucao'
   * @param {string} nome  - Ex.: 'x_studio_conferencia_pix'
   * @returns {boolean}
   */
  campoExiste(model, nome) {
    const chave = `campo_${model}_${nome}`;

    this._camposConhecidos = this._camposConhecidos || {};
    if (chave in this._camposConhecidos) return this._camposConhecidos[chave];

    const cache    = CacheService.getScriptCache();
    const cacheado = cache.get(chave);
    if (cacheado) {
      this._camposConhecidos[chave] = cacheado === '1';
      return this._camposConhecidos[chave];
    }

    let existe = false;
    try {
      const campos = this.searchRead(
        'ir.model.fields', ['id'],
        [['model', '=', model], ['name', '=', nome]],
        { limit: 1 }
      );
      existe = !!(campos && campos.length);
    } catch (e) {
      console.warn(`⚠️ [OdooService] Não consegui verificar ${model}.${nome}:`, e.message);
    }

    cache.put(chave, existe ? '1' : '0', existe ? 21600 : 300);
    this._camposConhecidos[chave] = existe;
    return existe;
  },

  /** @private @deprecated Use `campoExiste`. Mantido pelos chamadores do BL-26. */
  _temCampoConferenciaPix() {
    return this.campoExiste('x_devolucao', 'x_studio_conferencia_pix');
  },

  /**
   * Texto de alerta correspondente a cada resultado de conferência (BL-26).
   * Usado no nome do registro; a fonte filtrável é `x_studio_conferencia_pix`.
   */
  AVISO_CONFERENCIA: {
    divergente:     '⚠️ CONFERIR: chave do comprovante diverge da comunidade',
    ausente:        '⚠️ CONFERIR: chave não identificada no comprovante',
    sem_referencia: '⚠️ CONFERIR: comunidade sem chave PIX cadastrada'
  },

  /**
   * Registra uma devolução no Odoo com comprovante (imagem ou PDF).
   * @param {number}      dizimistaId        - ID do dizimista
   * @param {Object}      dadosAnalise       - Dados extraídos pela Vision API
   * @param {string|null} comprovanteBase64  - Arquivo original em base64
   * @param {string}      tipoComprovante    - 'imagem' ou 'pdf'
   * @param {string}      conferencia        - Resultado da conferência da chave
   *        PIX (BL-26): 'ok' | 'divergente' | 'ausente' | 'sem_referencia'
   * @returns {number} ID da devolução criada
   */
  registrarDevolucao(dizimistaId, dadosAnalise, comprovanteBase64 = null, tipoComprovante = 'imagem', conferencia = '') {
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

    // BL-26: o resultado da conferência da chave PIX vai num campo estruturado
    // (filtrável pelo coordenador) e, como redundância visível, no nome do registro.
    const aviso = this.AVISO_CONFERENCIA[conferencia] || '';

    let descricao = `Devolução de R$ ${dadosAnalise?.valor || 0} - ${dadosAnalise?.data || hoje}`;
    if (aviso) descricao += ` — ${aviso}`;

    const dados = {
      x_name:                        descricao,
      x_studio_dizimista:            dizimistaId,
      x_studio_data_da_devolucao:    dataOdoo,
      x_studio_value:                dadosAnalise?.valor || 0,
      x_studio_status:               'Pendente',
      x_studio_tipo_comprovante:     tipoComprovante
    };

    if (conferencia && this._temCampoConferenciaPix()) {
      dados.x_studio_conferencia_pix = conferencia;
    }

    // Forma de pagamento: mapear o tipo detectado pelo OCR para o campo
    // selection do Odoo (valores existentes: 'Pix' | 'Dinheiro'). Só definimos
    // quando há mapeamento seguro (PIX); nos demais casos deixamos o padrão do
    // Odoo. (Antes ficava sempre 'Dinheiro' num comprovante, o que é incorreto.)
    const FORMA_PAGAMENTO = { 'PIX': 'Pix' };
    const forma = FORMA_PAGAMENTO[dadosAnalise?.tipo];
    if (forma) dados.x_studio_forma_de_pagamento = forma;

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
   * Retorna as devoluções do dizimista no MÊS-CALENDÁRIO atual, com data e valor.
   * Usado no aviso de duplicata para detalhar quando/quanto já foi devolvido.
   * @param {number} dizimistaId
   * @returns {Array<{data: string, valor: number}>}  data em 'yyyy-MM-dd'
   */
  devolucoesDoMes(dizimistaId) {
    const hoje = new Date();
    const primeiro = Utilities.formatDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1), TIMEZONE, 'yyyy-MM-dd');
    const ultimo   = Utilities.formatDate(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0), TIMEZONE, 'yyyy-MM-dd');
    const regs = this.searchRead(
      'x_devolucao',
      ['x_studio_data_da_devolucao', 'x_studio_value'],
      [
        ['x_studio_dizimista', '=', dizimistaId],
        ['x_studio_data_da_devolucao', '>=', primeiro],
        ['x_studio_data_da_devolucao', '<=', ultimo]
      ],
      { order: 'x_studio_data_da_devolucao asc' }
    );
    return (regs || []).map(r => ({
      data:  r.x_studio_data_da_devolucao || '',
      valor: r.x_studio_value || 0
    }));
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
    const campos = [
      'id',
      'x_name',
      'x_studio_dizimista',
      'x_studio_data_da_devolucao',
      'x_studio_value',
      'x_studio_status'
    ];
    if (this._temCampoConferenciaPix()) campos.push('x_studio_conferencia_pix');

    return this.searchRead(
      'x_devolucao',
      campos,
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
    const campos = [
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
    ];
    if (this._temCampoConferenciaPix()) campos.push('x_studio_conferencia_pix');

    const registros = this.searchRead(
      'x_devolucao',
      campos,
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
   * Busca um parâmetro específico por chave em x_parametros_line.
   * Defensivo: se o modelo/campo não existir no Odoo, retorna null em vez de
   * lançar — assim um parâmetro opcional não derruba quem chama.
   * @returns {string|null}
   */
  buscarParametro(chave) {
    try {
      const resultado = this.searchRead(
        'x_parametros_line',
        ['x_studio_valor'],
        [['x_studio_chave', '=', chave]],
        { limit: 1 }
      );
      return resultado.length > 0 ? resultado[0].x_studio_valor : null;
    } catch (e) {
      console.warn(`⚠️ [OdooService] buscarParametro('${chave}') indisponível: ${e.message}`);
      return null;
    }
  }

};