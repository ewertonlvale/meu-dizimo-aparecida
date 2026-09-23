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
   * Código do erro lançado por `criarDizimista` quando o número já tem cadastro.
   * Os chamadores comparam contra ele em vez de olhar a mensagem — mensagem é
   * texto para humano e muda; código não.
   */
  ERRO_JA_CADASTRADO: 'JA_CADASTRADO',

  /**
   * Cria um novo dizimista a partir dos dados coletados no cadastro.
   *
   * BL-39 — POR QUE A VERIFICAÇÃO MORA AQUI, E NÃO NO HANDLER.
   * O cadastro já conferia se o número existia ao *começar* (`iniciar`), mas
   * não ao *terminar*. Entre um e outro cabe muita coisa: tocar num formulário
   * de meses atrás (a mensagem continua na conversa), tocar duas vezes em
   * "Confirmar", ou completar o cadastro por conversa num aparelho enquanto o
   * formulário de outro já gravou. Qualquer um desses criava um SEGUNDO
   * `x_dizimista` com o mesmo telefone — e `buscarDizimistaPorWhatsapp`
   * devolve `registros[0]`, então devoluções e lembretes passavam a cair num
   * registro e o histórico no outro, em silêncio.
   *
   * Pôr a guarda no handler consertaria os caminhos de hoje e não os de
   * amanhã. Aqui, é o ponto por onde todo cadastro obrigatoriamente passa —
   * conversa e formulário.
   *
   * @param {Object} dados - Dados temporários do StateManager
   * @returns {number} ID criado
   * @throws {Error} com `.codigo === ERRO_JA_CADASTRADO` e `.dizimista` quando
   *   o número já está cadastrado
   */
  criarDizimista(dados) {
    // O lock fecha a janela do toque duplo: duas execuções do Apps Script
    // chegando com 400 ms de diferença passariam as duas pela busca antes de
    // qualquer uma criar. É o mesmo padrão de `StateManager.ehPrimeiroContato`.
    const lock = LockService.getScriptLock();
    let travado = false;
    try {
      lock.waitLock(10000);
      travado = true;
    } catch (e) {
      // Sem o lock ainda vale conferir: pega o caso comum (formulário antigo),
      // só não protege contra a corrida.
      console.warn('⚠️ [criarDizimista] Lock não obtido, seguindo sem serializar:', e.message);
    }

    try {
      const existente = this.buscarDizimistaPorWhatsapp(dados.whatsapp);
      if (existente) {
        const erro = new Error(
          `Já existe dizimista para este número (id ${existente.id})`
        );
        erro.codigo    = this.ERRO_JA_CADASTRADO;
        erro.dizimista = existente;
        throw erro;
      }

      return this._criarDizimista(dados);
    } finally {
      if (travado) lock.releaseLock();
    }
  },

  /**
   * A gravação em si, sem a guarda. Separada para que `criarDizimista` fique
   * com uma responsabilidade legível e para que a guarda não tenha como ser
   * pulada por engano — nada fora daqui chama este método.
   * @private
   */
  _criarDizimista(dados) {
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

    return { comunidade: com.x_name || null, contatos: this._comWaId(contatos) };
  },

  /**
   * Acrescenta a cada contato o `wa_id` REAL, quando ele é conhecido.
   *
   * O PROBLEMA. Celular brasileiro tem duas formas — com e sem o nono dígito —
   * e o `wa_id` de uma conta antiga costuma ser a de 8 dígitos. O cartão de
   * contato só abre a conversa se o `wa_id` bater exatamente; com a forma
   * errada, o WhatsApp mostra "Salvar" em vez de "Conversar".
   *
   * POR QUE NÃO USAR O PALPITE. `Utils.variantesNumeroBR` devolve um
   * `provavel`, mas o próprio comentário dele avisa: é heurística por DDD, e
   * uma conta criada depois da mudança mantém o 9 mesmo fora da lista. Aplicar
   * como regra consertaria uns e quebraria outros.
   *
   * O QUE FAZEMOS. Procuramos as DUAS formas em `x_contato_bot`, onde ficam os
   * números que já escreveram ao bot. Ali o `x_name` é o `wa_id` de verdade —
   * foi o WhatsApp que o entregou, não nós que o deduzimos. Quem não está lá
   * fica sem `wa_id`, e o cartão trata disso à sua maneira.
   *
   * Uma consulta só para todos os contatos.
   * @private
   */
  _comWaId(contatos) {
    if (!contatos.length) return contatos;

    // Todas as formas possíveis, de todos os contatos, numa busca só.
    const formas = [];
    const porContato = contatos.map(c => {
      const v = Utils.variantesNumeroBR(Utils._e164(c.whatsapp));
      if (v) formas.push(v.comNove, v.semNove);
      return v;
    });
    if (!formas.length) return contatos;

    let achados = [];
    try {
      achados = this.searchRead('x_contato_bot', ['x_name'],
                                [['x_name', 'in', formas]], { limit: 50 }) || [];
    } catch (e) {
      // Sem o wa_id o cartão ainda sai; falhar aqui seria trocar um contato
      // imperfeito por contato nenhum.
      console.warn('⚠️ [OdooService] Falha ao resolver wa_id dos contatos:', e.message);
      return contatos;
    }

    const conhecidos = {};
    achados.forEach(a => { conhecidos[String(a.x_name)] = true; });

    return contatos.map((c, i) => {
      const v = porContato[i];
      if (!v) return c;
      const waId = conhecidos[v.comNove] ? v.comNove
                 : conhecidos[v.semNove] ? v.semNove
                 : null;
      return waId ? Object.assign({}, c, { waId }) : c;
    });
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

  /**
   * O campo existe **e pode ser gravado**? (com cache, como `campoExiste`)
   *
   * BL-41 — POR QUE `campoExiste` NÃO BASTA AQUI.
   * `x_studio_comunidade` sempre existiu. O que muda na migração é ele deixar
   * de ser `related` (espelho do dizimista, readonly) e virar gravável. Um
   * `campoExiste` responderia "sim" nos dois casos, e o bot tentaria gravar
   * num campo readonly — o Odoo recusa a escrita inteira, e a devolução se
   * perde. Numa mensagem por onde passa dinheiro, isso é inaceitável.
   *
   * Então a pergunta certa é "posso escrever?", e a resposta é: existe, não é
   * `related` e não é `readonly`.
   *
   * @param {string} model
   * @param {string} nome
   * @returns {boolean}
   */
  campoGravavel(model, nome) {
    const chave = `campo_grav_${model}_${nome}`;

    this._camposGravaveis = this._camposGravaveis || {};
    if (chave in this._camposGravaveis) return this._camposGravaveis[chave];

    const cache    = CacheService.getScriptCache();
    const cacheado = cache.get(chave);
    if (cacheado) {
      this._camposGravaveis[chave] = cacheado === '1';
      return this._camposGravaveis[chave];
    }

    let gravavel = false;
    try {
      const campos = this.searchRead(
        'ir.model.fields', ['id', 'related', 'readonly'],
        [['model', '=', model], ['name', '=', nome]],
        { limit: 1 }
      );
      const c = campos && campos[0];
      gravavel = !!c && !c.related && !c.readonly;
    } catch (e) {
      console.warn(`⚠️ [OdooService] Não consegui verificar se ${model}.${nome} é gravável:`, e.message);
    }

    // TTL curto quando ainda não é gravável, para passar a valer logo após a
    // migração — mesma regra do `campoExiste`.
    cache.put(chave, gravavel ? '1' : '0', gravavel ? 21600 : 300);
    this._camposGravaveis[chave] = gravavel;
    return gravavel;
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
  /**
   * Acrescenta o filtro por tipo de contribuição a um domínio, quando faz sentido.
   *
   * BL-41 — POR QUE ISTO EXISTE, E POR QUE CADA CHAMADOR ESCOLHE.
   * Depois que a oferta passou a morar no mesmo modelo do dízimo, toda consulta
   * a `x_devolucao` devolve os dois. Não há um padrão bom para todas: o aviso de
   * duplicata e o relatório do coordenador querem só dízimo; a fila de
   * conferência da secretaria quer os dois, porque comprovante de oferta também
   * precisa ser conferido. Um default silencioso acertaria uns e mentiria nos
   * outros — e relatório errado não falha, só mente.
   *
   * Antes da migração o campo não existe; filtrar por ele faria o search_read
   * inteiro falhar, o que é pior que trazer registros a mais. Por isso o
   * `campoExiste`.
   *
   * @param {Array} dominio
   * @param {string|null} tipo - 'dizimo' | 'oferta' | null (não filtra)
   * @returns {Array}
   * @private
   */
  _comTipo(dominio, tipo) {
    if (!tipo) return dominio;
    if (!this.campoExiste('x_devolucao', 'x_studio_tipo_contribuicao')) return dominio;
    return dominio.concat([['x_studio_tipo_contribuicao', '=', tipo]]);
  },

  /**
   * @param {number|null} dizimistaId - null numa OFERTA de quem não é cadastrado
   * @param {Object} dadosAnalise
   * @param {string} [comprovanteBase64]
   * @param {string} [tipoComprovante]
   * @param {string} [conferencia]
   * @param {Object} [extras] - BL-41:
   *   `comunidadeId` (obrigatório quando não há dizimista),
   *   `tipo` ('dizimo' | 'oferta', padrão 'dizimo'),
   *   `telefoneOfertante`
   * @throws {Error} se não houver como determinar a comunidade
   */
  registrarDevolucao(dizimistaId, dadosAnalise, comprovanteBase64 = null, tipoComprovante = 'imagem', conferencia = '', extras = {}) {
    const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');

    // O `split('/')` só faz sentido em dd/mm/aaaa, e precisa CONFERIR que é
    // isso: com qualquer outro formato ele não lança erro — devolve um pedaço
    // só, e a data sai `undefined-undefined-24 JUL 2026`. O try/catch daqui
    // nunca via nada, porque nada era lançado. Desde o BL-52 o VisionService
    // normaliza, mas o registro no Odoo é o último lugar onde dá para
    // perceber, e ele não depende de confiança.
    let dataOdoo = hoje;
    if (dadosAnalise?.data) {
      const m = String(dadosAnalise.data).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        dataOdoo = `${m[3]}-${m[2]}-${m[1]}`;
        console.log(`📅 Data convertida: ${dadosAnalise.data} → ${dataOdoo}`);
      } else {
        console.warn(`⚠️ Data fora do formato dd/mm/aaaa ("${dadosAnalise.data}") — usando hoje`);
      }
    }

    // BL-26: o resultado da conferência da chave PIX vai num campo estruturado
    // (filtrável pelo coordenador) e, como redundância visível, no nome do registro.
    const aviso = (CONFERENCIA[conferencia] || {}).avisoRegistro || '';

    const rotulo = (extras.tipo === 'oferta') ? 'Oferta' : 'Devolução';
    // O nome entra na descrição porque é ela que aparece na LISTA do Odoo.
    // Uma oferta de não cadastrado sem nome chega à secretaria como um
    // telefone solto, e ela não tem como saber de quem é sem abrir o registro.
    const de = extras.nomeOfertante ? ` de ${extras.nomeOfertante}` : '';
    let descricao = `${rotulo}${de} - R$ ${dadosAnalise?.valor || 0} - ${dadosAnalise?.data || hoje}`;
    if (aviso) descricao += ` — ${aviso}`;

    const tipo = extras.tipo || 'dizimo';

    // ── BL-41: a COMUNIDADE ─────────────────────────────────────────────────
    // Antes da migração ela era `related` ao dizimista: o bot nunca a gravava,
    // e o Odoo a espelhava sozinho. Depois da migração o espelho some, e quem
    // não gravar deixa o campo vazio — em silêncio, porque nada falha.
    //
    // É por isso que aqui se EXIGE a comunidade em vez de deixá-la opcional:
    // uma devolução sem comunidade é uma linha que ninguém concilia e que some
    // dos relatórios do coordenador, sem nenhum sinal de erro.
    let comunidadeId = extras.comunidadeId || null;

    if (!comunidadeId && dizimistaId) {
      // Dízimo: a comunidade é a do dizimista, como sempre foi. Buscar aqui
      // custa uma leitura, e é o preço de a garantia valer para todo chamador
      // em vez de depender de cada um lembrar de passar.
      try {
        const d = this.searchRead('x_dizimista', ['x_studio_comunidade'],
          [['id', '=', dizimistaId]], { limit: 1 });
        const rel = d && d[0] && d[0].x_studio_comunidade;
        if (rel) comunidadeId = Array.isArray(rel) ? rel[0] : rel;
      } catch (e) {
        console.warn('⚠️ [Devolução] Não consegui ler a comunidade do dizimista:', e.message);
      }
    }

    if (!comunidadeId) {
      throw new Error(
        'Devolução sem comunidade: ' +
        (dizimistaId ? `dizimista ${dizimistaId} está sem comunidade no Odoo`
                     : 'oferta sem comunidade informada')
      );
    }

    const dados = {
      x_name:                        descricao,
      x_studio_dizimista:            dizimistaId || false,
      x_studio_data_da_devolucao:    dataOdoo,
      x_studio_value:                dadosAnalise?.valor || 0,
      // BL-51: o status nasce da conferência. Era sempre 'Pendente', e o
      // coordenador decidia tudo — inclusive o que o bot já sabia responder.
      x_studio_status:               statusDaDevolucao(conferencia),
      x_studio_tipo_comprovante:     tipoComprovante
    };

    // BL-62/BL-57: a COMPETÊNCIA, que é o mês a que a devolução se refere.
    // O campo existia desde sempre e o bot só o LIA — por isso o agrupamento
    // "Mês Referencia" caía num balde "Nenhum" para tudo que vinha do WhatsApp.
    // É ela também que dá sentido ao "A devolver": um em aberto com competência
    // anterior ao mês corrente é uma dívida, e é assim que a lista de atrasados
    // passa a existir.
    const competencia = `${dataOdoo.slice(0, 7)}-01`;
    if (this.campoExiste('x_devolucao', 'x_studio_competencia')) {
      dados.x_studio_competencia = competencia;
    }

    // Só grava a comunidade quando o campo já aceita escrita. Enquanto for
    // `related`, o Odoo recusaria a escrita INTEIRA e a devolução se perderia
    // — pior que o campo ficar espelhado, que é o que ele já faz sozinho.
    if (this.campoGravavel('x_devolucao', 'x_studio_comunidade')) {
      dados.x_studio_comunidade = comunidadeId;
    }

    if (this.campoExiste('x_devolucao', 'x_studio_tipo_contribuicao')) {
      dados.x_studio_tipo_contribuicao = tipo;
    }

    if (extras.telefoneOfertante && this.campoExiste('x_devolucao', 'x_studio_telefone_ofertante')) {
      dados.x_studio_telefone_ofertante = String(extras.telefoneOfertante);
    }

    if (extras.nomeOfertante && this.campoExiste('x_devolucao', 'x_studio_nome_ofertante')) {
      dados.x_studio_nome_ofertante = String(extras.nomeOfertante);
    }

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

    console.log(`📊 [OdooService] Registrando devolução (tipo: ${tipoComprovante}):`,
      JSON.stringify({...dados, x_studio_comprovante: comprovanteBase64 ? `[${comprovanteBase64.length} chars]` : null}, null, 2));

    // ── BL-62: PREENCHER o mês em aberto, em vez de criar um segundo ────────
    //
    // Se já existe um "A devolver" desta pessoa para ESTA competência, ele é a
    // linha que estava esperando este pagamento. Criar outro deixaria o mês com
    // dois registros: um previsto que nunca fecha e um pago.
    //
    // Só quando a competência BATE. Pagamento que chega em dezembro para um
    // aberto de setembro é outro caso — precisa perguntar a que mês se refere,
    // e essa pergunta ainda não existe. Até lá o aberto antigo fica aberto, que
    // é a verdade: aquele mês continua devendo.
    const aberto = this._aDevolverDaCompetencia(dizimistaId, competencia, tipo);
    let id;
    if (aberto) {
      this.write('x_devolucao', aberto, dados);
      id = aberto;
      console.log(`✅ [Devolução] Preenchi o "A devolver" ${aberto} da competência ${competencia}`);
    } else {
      id = this.create('x_devolucao', dados);
    }

    // ── E abre o mês seguinte ───────────────────────────────────────────────
    //
    // Depois do registro, e num try próprio, de propósito: isto é
    // previsibilidade, e previsibilidade não pode derrubar o registro de um
    // pagamento que já aconteceu. Se falhar, a devolução está gravada e o pior
    // que acontece é o mês seguinte não aparecer — o que a próxima devolução
    // conserta sozinha.
    try {
      this._abrirMesSeguinte(dizimistaId, comunidadeId, competencia, tipo);
    } catch (e) {
      console.warn(`⚠️ [Devolução] Não consegui abrir o mês seguinte: ${e.message}`);
    }

    return id;
  },

  /**
   * A quais meses este pagamento PODE se referir? (BL-70)
   *
   * Do mês seguinte à última devolução paga até o mês que acabou de ser
   * registrado. Um só na lista quer dizer que não há dúvida.
   *
   * POR QUE O INTERVALO, E NÃO O "MÊS EM ABERTO"
   *   A versão anterior só perguntava quando existia um registro `A devolver`
   *   para oferecer. Só que a corrente abre um mês por vez: quem pagou julho e
   *   voltou em setembro tem agosto sem registro NENHUM — e o bot gravava
   *   setembro calado, sem nunca mencionar agosto.
   *
   *   E preencher agosto sozinho seria pior: há quem devolva a cada dois ou
   *   três meses por hábito, e para essa pessoa agosto não é dívida, é o
   *   ritmo dela. Quem sabe a que mês o dinheiro se refere é ela.
   *
   * SEM DEVOLUÇÃO ANTERIOR, NÃO HÁ INTERVALO. Primeira devolução da vida não
   * gera pergunta — não há de onde contar.
   *
   * @returns {string[]} competências 'aaaa-mm-01', da mais antiga à registrada
   */
  mesesCandidatos(dizimistaId, competenciaRegistrada, tipo = 'dizimo') {
    if (!dizimistaId || tipo === 'oferta') return [competenciaRegistrada];
    if (!this.campoExiste('x_devolucao', 'x_studio_competencia')) return [competenciaRegistrada];

    let ultima = null;
    try {
      const regs = this.searchRead('x_devolucao', ['x_studio_competencia'], [
        ['x_studio_dizimista',   '=',  dizimistaId],
        ['x_studio_status',      '!=', STATUS_A_DEVOLVER],
        ['x_studio_competencia', '<',  competenciaRegistrada]
      ], { order: 'x_studio_competencia desc', limit: 1 });
      ultima = regs && regs[0] && regs[0].x_studio_competencia;
    } catch (e) {
      console.warn(`⚠️ [Competência] Não consegui ver a última devolução: ${e.message}`);
      return [competenciaRegistrada];
    }
    if (!ultima) return [competenciaRegistrada];

    const meses = [];
    let [ano, mes] = String(ultima).split('-').map(Number);
    for (let i = 0; i < 240; i++) {          // teto físico: 20 anos
      if (++mes > 12) { mes = 1; ano++; }
      const c = `${ano}-${String(mes).padStart(2, '0')}-01`;
      meses.push(c);
      if (c >= competenciaRegistrada) break;
    }

    // Quem some por anos geraria uma lista impossível de ler. Os seis mais
    // recentes cobrem o ritmo mais espaçado que a paróquia descreveu — de dois
    // em dois, de três em três meses — com folga.
    return meses.length > 6 ? meses.slice(-6) : meses;
  },

  /**
   * Passa a devolução para a competência escolhida pela pessoa. (BL-70)
   *
   * Se já existe um `A devolver` daquele mês, TROCA as competências entre os
   * dois: o mês escolhido fica pago e o que estava pago volta a ficar aberto.
   * Se não existe, só grava — não há nada para reabrir, e inventar um `A
   * devolver` seria decidir pela pessoa que ela deve aquele mês.
   *
   * @returns {boolean}
   */
  definirCompetencia(idPago, competencia, dizimistaId) {
    const abertos = this.searchRead('x_devolucao', ['id'], [
      ['x_studio_dizimista',   '=', dizimistaId],
      ['x_studio_status',      '=', STATUS_A_DEVOLVER],
      ['x_studio_competencia', '=', competencia]
    ], { limit: 1 });

    if (abertos && abertos.length) return this.trocarCompetencia(idPago, abertos[0].id);

    this.write('x_devolucao', idPago, { x_studio_competencia: competencia });
    console.log(`📅 [Devolução] ${idPago} passou a valer para ${competencia}`);
    return true;
  },

  /**
   * Há um mês em aberto DIFERENTE do que acabou de ser registrado? (BL-62)
   *
   * Quando alguém paga em dezembro e tem setembro em aberto, o bot não tem como
   * saber de qual mês é o pagamento. A resposta honesta é registrar dezembro e
   * deixar setembro aberto — e então PERGUNTAR, em vez de adivinhar.
   *
   * Perguntar ANTES de registrar não cabe: obrigaria a segurar o comprovante em
   * sessão enquanto se espera a resposta, e comprovante é base64 de 100 KB a
   * 1 MB, contra 100 KB por chave no CacheService e 9 KB por valor no
   * PropertiesService. Além de criar um caminho em que a pessoa some no meio e
   * o pagamento se perde. Registrar primeiro tira o dinheiro do ar.
   *
   * @returns {{id: number, competencia: string}|null}
   */
  mesEmAbertoDiferente(dizimistaId, competenciaRegistrada, tipo = 'dizimo') {
    if (!dizimistaId || tipo === 'oferta') return null;
    if (!this.campoExiste('x_devolucao', 'x_studio_competencia')) return null;
    try {
      // O QUE FAZ UM MÊS EM ABERTO VIRAR PERGUNTA: ele já ter passado.
      //
      // Duas versões erradas antes desta, e as duas por não separar "mês em
      // aberto" de "mês devido":
      //
      //   1ª — procurava mês ANTERIOR à competência registrada. A pessoa tinha
      //        maio em aberto e mandou um comprovante de abril; maio é
      //        posterior, então a pergunta nem foi considerada e o bot gravou
      //        abril calado.
      //
      //   2ª — passou a procurar qualquer competência DIFERENTE. Só que
      //        `registrarDevolucao` ABRE O MÊS SEGUINTE antes de isto rodar:
      //        a busca encontrava o mês que o próprio bot tinha acabado de
      //        criar, e TODA devolução passaria a perguntar, oferecendo um mês
      //        futuro como se fosse dívida.
      //
      // O critério certo não é a relação com a competência paga, e sim com
      // HOJE: um mês em aberto que ainda não terminou é compromisso, não
      // dívida — e é exatamente o que o bot acabou de abrir. Dívida é mês que
      // já passou e não foi devolvido.
      //
      // Quando há mais de uma, oferece a mais antiga.
      const mesCorrente = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM') + '-01';
      const regs = this.searchRead('x_devolucao', ['id', 'x_studio_competencia'], [
        ['x_studio_dizimista',   '=', dizimistaId],
        ['x_studio_status',      '=', STATUS_A_DEVOLVER],
        ['x_studio_competencia', '<',  mesCorrente],
        ['x_studio_competencia', '!=', competenciaRegistrada]
      ], { order: 'x_studio_competencia asc', limit: 1 });
      const r = regs && regs[0];
      return r ? { id: r.id, competencia: r.x_studio_competencia } : null;
    } catch (e) {
      console.warn(`⚠️ [Devolução] Não consegui procurar mês em aberto: ${e.message}`);
      return null;
    }
  },

  /**
   * Troca a competência entre o registro pago e o mês que estava em aberto.
   * (BL-62)
   *
   * TROCA, e não copia: se o pagamento era de setembro, setembro passa a ser o
   * mês pago e dezembro volta a ficar em aberto. Copiar deixaria dois registros
   * de setembro — um pago e um em aberto que nunca fecharia.
   *
   * @returns {boolean} true se a troca aconteceu
   */
  trocarCompetencia(idPago, idAberto) {
    const regs = this.searchRead('x_devolucao', ['id', 'x_studio_competencia'],
      [['id', 'in', [idPago, idAberto]]]);
    const pago   = (regs || []).find((r) => r.id === idPago);
    const aberto = (regs || []).find((r) => r.id === idAberto);
    if (!pago || !aberto) {
      console.warn('⚠️ [Devolução] Troca de competência: um dos registros sumiu');
      return false;
    }
    this.write('x_devolucao', idPago,   { x_studio_competencia: aberto.x_studio_competencia });
    this.write('x_devolucao', idAberto, { x_studio_competencia: pago.x_studio_competencia });
    console.log(`🔁 [Devolução] Competências trocadas: ${idPago} ↔ ${idAberto}`);
    return true;
  },

  /**
   * O "A devolver" desta pessoa para ESTA competência, se existir. (BL-62)
   *
   * @param {number} dizimistaId
   * @param {string} competencia - 'aaaa-mm-01'
   * @param {string} tipo        - só dízimo tem mês em aberto; oferta é avulsa
   * @returns {number|null} id do registro, ou null
   * @private
   */
  _aDevolverDaCompetencia(dizimistaId, competencia, tipo) {
    if (!dizimistaId || tipo === 'oferta') return null;
    if (!this.campoExiste('x_devolucao', 'x_studio_competencia')) return null;
    try {
      const regs = this.searchRead('x_devolucao', ['id'], [
        ['x_studio_dizimista', '=', dizimistaId],
        ['x_studio_status',    '=', STATUS_A_DEVOLVER],
        ['x_studio_competencia', '=', competencia]
      ], { limit: 1 });
      return (regs && regs[0] && regs[0].id) || null;
    } catch (e) {
      // Um erro aqui não pode impedir o registro do pagamento. Sem o aberto,
      // cria-se um registro novo — o mês fica com dois, que alguém concilia. É
      // muito melhor que perder a devolução.
      console.warn(`⚠️ [Devolução] Não consegui procurar o mês em aberto: ${e.message}`);
      return null;
    }
  },

  /**
   * Garante que o mês SEGUINTE ao que acabou de ser pago exista como
   * "A devolver". (BL-62)
   *
   * Nasce sem data, sem valor e sem comprovante — ver a nota do
   * STATUS_A_DEVOLVER em Config.gs: é a ausência de data que o torna invisível
   * para a classificação e para o lembrete mensal.
   *
   * Idempotente: se o mês seguinte já existir em qualquer estado, não faz nada.
   * Sem essa checagem, uma pessoa que devolve duas vezes no mesmo mês ganharia
   * dois abertos para o mês que vem.
   *
   * @private
   */
  _abrirMesSeguinte(dizimistaId, comunidadeId, competenciaPaga, tipo) {
    if (!dizimistaId || tipo === 'oferta') return null;
    if (!this.campoExiste('x_devolucao', 'x_studio_competencia')) return null;

    const [ano, mes] = competenciaPaga.split('-').map(Number);
    const proximo = mes === 12 ? `${ano + 1}-01-01`
                               : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

    const jaExiste = this.searchRead('x_devolucao', ['id'], [
      ['x_studio_dizimista',   '=', dizimistaId],
      ['x_studio_competencia', '=', proximo]
    ], { limit: 1 });
    if (jaExiste && jaExiste.length) return null;

    const dados = {
      x_name:                  `Dízimo a devolver - ${proximo.slice(5, 7)}/${ano + (mes === 12 ? 1 : 0)}`,
      x_studio_dizimista:      dizimistaId,
      x_studio_status:         STATUS_A_DEVOLVER,
      x_studio_competencia:    proximo,
      x_studio_value:          0,
      // Sem forma de pagamento: ninguém pagou ainda. O campo tem padrão no
      // Odoo, e sem esta linha a lista mostrava "Dinheiro" num mês que ninguém
      // devolveu — um dado inventado, na coluna que o coordenador lê.
      x_studio_forma_de_pagamento: false
      // Sem x_studio_data_da_devolucao, e isso NÃO é esquecimento: é a
      // invariante inteira deste item. Ver Config.gs, STATUS_A_DEVOLVER.
    };
    if (this.campoGravavel('x_devolucao', 'x_studio_comunidade') && comunidadeId) {
      dados.x_studio_comunidade = comunidadeId;
    }
    if (this.campoExiste('x_devolucao', 'x_studio_tipo_contribuicao')) {
      dados.x_studio_tipo_contribuicao = 'dizimo';
    }
    // Validação VAZIA. O campo tem padrão "A validar" (BL-60), e um mês que
    // ninguém pagou não tem o que validar: deixá-lo entrar na fila encheria a
    // tela do coordenador de meses futuros.
    if (this.campoExiste('x_devolucao', 'x_studio_validacao')) {
      dados.x_studio_validacao = false;
    }

    const id = this.create('x_devolucao', dados);
    console.log(`🗓️ [Devolução] Abri o mês ${proximo} como "${STATUS_A_DEVOLVER}" (id ${id})`);
    return id;
  },

  /**
   * Busca as últimas devoluções de um dizimista.
   * @param {number} dizimistaId - ID do dizimista
   * @param {number} limite      - Quantidade máxima de registros
   * @returns {Array}
   */
  /**
   * @param {string|null} [tipo] - BL-41. Padrão 'dizimo': quem chama isto é o
   *   histórico e a linha "sua última devolução", os dois dentro do fluxo de
   *   dízimo. Misturar oferta ali faria a pessoa achar que já devolveu o dízimo
   *   do mês quando na verdade tinha ofertado. Passe null para trazer tudo.
   */
  buscarDevolucoesDizimista(dizimistaId, limite = 10, tipo = 'dizimo') {
    return this.searchRead(
      'x_devolucao',
      ['id', 'x_studio_data_da_devolucao', 'x_studio_value', 'x_studio_status'],
      this._comTipo([['x_studio_dizimista', '=', dizimistaId]], tipo),
      { order: 'x_studio_data_da_devolucao desc', limit: limite }
    );
  },

  /**
   * Retorna as devoluções do dizimista no MÊS-CALENDÁRIO atual, com data e valor.
   * Usado no aviso de duplicata para detalhar quando/quanto já foi devolvido.
   * @param {number} dizimistaId
   * @returns {Array<{data: string, valor: number}>}  data em 'yyyy-MM-dd'
   */
  /**
   * @param {string|null} [tipo] - BL-41. Padrão 'dizimo', porque isto alimenta o
   *   aviso "você já tem devolução registrada neste mês". Quem deu uma oferta e
   *   depois for devolver o dízimo levaria o aviso indevidamente — e desistiria
   *   de devolver achando que já tinha devolvido.
   */
  devolucoesDoMes(dizimistaId, tipo = 'dizimo') {
    const hoje = new Date();
    const primeiro = Utilities.formatDate(new Date(hoje.getFullYear(), hoje.getMonth(), 1), TIMEZONE, 'yyyy-MM-dd');
    const ultimo   = Utilities.formatDate(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0), TIMEZONE, 'yyyy-MM-dd');
    const regs = this.searchRead(
      'x_devolucao',
      ['x_studio_data_da_devolucao', 'x_studio_value'],
      this._comTipo([
        ['x_studio_dizimista', '=', dizimistaId],
        ['x_studio_data_da_devolucao', '>=', primeiro],
        ['x_studio_data_da_devolucao', '<=', ultimo]
      ], tipo),
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
  /**
   * @param {string|null} [tipo] - BL-41. Padrão 'dizimo': isto alimenta o
   *   relatório do coordenador, e somar oferta no total do dízimo faria os
   *   números da paróquia mentirem sem nada falhar. Passe 'oferta' para o
   *   relatório de ofertas, ou null para o consolidado dos dois.
   */
  listarDevolucoesPorPeriodo(dataInicio, dataFim, tipo = 'dizimo') {
    return this.searchRead(
      'x_devolucao',
      ['id', 'x_studio_dizimista', 'x_studio_value', 'x_studio_data_da_devolucao', 'x_studio_status'],
      this._comTipo([
        ['x_studio_data_da_devolucao', '>=', dataInicio],
        ['x_studio_data_da_devolucao', '<=', dataFim]
      ], tipo),
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
    // BL-41: a fila da secretaria NÃO filtra por tipo — comprovante de oferta
    // também precisa ser conferido. Mas traz o campo, para a tela dizer o que é.
    if (this.campoExiste('x_devolucao', 'x_studio_tipo_contribuicao')) {
      campos.push('x_studio_tipo_contribuicao');
    }

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
    // BL-41: busca por id, então não há o que filtrar — mas a tela de detalhe
    // precisa dizer se aquilo é dízimo ou oferta.
    if (this.campoExiste('x_devolucao', 'x_studio_tipo_contribuicao')) {
      campos.push('x_studio_tipo_contribuicao');
    }

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
       'x_studio_secretaria_whatsapp',
       // BL-69: o limite de idade do comprovante. Se o campo ainda não
       // existir no Odoo, o searchRead INTEIRO falha — por isso ele só entra
       // quando o schema confirma que está lá.
       ].concat(this.campoExiste('x_parametros', 'x_studio_dias_comprovante')
                ? ['x_studio_dias_comprovante'] : []),
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