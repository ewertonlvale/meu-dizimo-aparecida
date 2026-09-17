/**
 * ============================================================================
 * STATEMANAGER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Gerencia o estado da conversa e dados temporários por usuário.
 * Responsabilidades:
 * - Ler/gravar estado atual no CacheService (TTL 1 hora)
 * - Ler/gravar dados temporários do cadastro no CacheService
 * - Controlar primeiro contato via Odoo (x_contato_bot)
 * - Controlar tempo de sessão para alerta de expiração
 *
 * Versão: 10.0
 * Data: Fevereiro 2026
 */

const StateManager = {

  // ==========================================================================
  // ESTADO
  // ==========================================================================

  /** Retorna o estado atual da conversa. Padrão: ESTADOS.MENU */
  getEstado(from) {
    const estado = CacheService.getScriptCache().get(`estado_${from}`) || ESTADOS.MENU;
    console.log(`📊 Estado de ${from}: ${estado}`);
    return estado;
  },

  /** Grava um novo estado. Expira em 1 hora. */
  setEstado(from, estado) {
    CacheService.getScriptCache().put(`estado_${from}`, estado, 3600);
    console.log(`📝 Estado de ${from} → ${estado}`);
  },

  // ==========================================================================
  // DADOS TEMPORÁRIOS
  // ==========================================================================

  /** Retorna os dados temporários do usuário. Retorna {} se não existirem. */
  getDadosTemporarios(from) {
    const dados = CacheService.getScriptCache().get(`dados_${from}`);
    return dados ? JSON.parse(dados) : {};
  },

  /** Salva dados temporários. Expira em 1 hora. */
  setDadosTemporarios(from, dados) {
    CacheService.getScriptCache().put(`dados_${from}`, JSON.stringify(dados), 3600);
  },

  /**
   * BL-20: executa uma seção crítica sob LockService, protegendo o
   * read-modify-write de `dados_${from}` contra mensagens concorrentes do
   * mesmo usuário (o cache não é transacional).
   *
   * Limitação: o Apps Script só oferece lock global (não por usuário), então
   * isto serializa brevemente as gravações de todos os usuários. É uma
   * mitigação aceitável no volume atual — a solução definitiva é processar o
   * webhook de forma assíncrona (ver BL-21). Best-effort: se o lock não for
   * obtido no tempo limite, a operação segue mesmo assim (melhor gravar sem
   * lock do que perder o dado).
   * @private
   */
  _comLock(fn) {
    const lock = LockService.getScriptLock();
    let locked = false;
    try {
      lock.waitLock(3000);
      locked = true;
    } catch (e) {
      console.warn('⚠️ [StateManager] Lock não obtido, seguindo sem lock:', e.message);
    }
    try {
      return fn();
    } finally {
      if (locked) { try { lock.releaseLock(); } catch (ignore) {} }
    }
  },

  /**
   * Helper: salva um único campo e muda o estado em uma única chamada.
   */
  salvarCampoEMudarEstado(from, campo, valor, novoEstado) {
    this._comLock(() => {
      const dados = this.getDadosTemporarios(from);
      dados[campo] = valor;
      this.setDadosTemporarios(from, dados);
      this.setEstado(from, novoEstado);
    });
  },

  /**
   * Helper: mescla múltiplos campos de uma vez nos dados temporários.
   */
  salvarMultiplosCampos(from, campos) {
    this._comLock(() => {
      const dados = this.getDadosTemporarios(from);
      Object.assign(dados, campos);
      this.setDadosTemporarios(from, dados);
    });
  },

  /**
   * Helper: obtém um campo específico dos dados temporários.
   */
  getCampo(from, campo) {
    return this.getDadosTemporarios(from)[campo];
  },

  // ==========================================================================
  // LIMPEZA
  // ==========================================================================

 // ==========================================================================
  // PERSISTÊNCIA DE LOG DE CADASTRO
  // ==========================================================================

  /**
   * Persiste o log de cadastro e a etapa de abandono no Odoo (x_contato_bot).
   * Deve ser chamado APENAS em contextos de cadastro (finalizar ou cancelar).
   * @param {string}  from       - Número do WhatsApp
   * @param {boolean} finalizou  - Se o cadastro foi concluído com sucesso
   */
  persistirLogCadastro(from, finalizou) {
    try {
      const cache  = CacheService.getScriptCache();
      const estado = this.getEstado(from);
      const log    = cache.get(`log_cadastro_${from}`);

      const payload = { x_studio_cadastrou: finalizou };
      if (log) payload.x_studio_log_cadastro = log;
      if (!finalizou && estado) payload.x_studio_etapa_abandono = estado;

      OdooService.atualizarContatoBot(from, payload);
      console.log(`📋 Log de cadastro persistido (finalizou: ${finalizou})`);
    } catch (e) {
      console.warn('⚠️ Erro ao persistir log de cadastro:', e.message);
    }
  },

  // ==========================================================================
  // LIMPEZA
  // ==========================================================================

  /**
   * Remove estado, dados temporários e sessão do cache.
   * Função pura de limpeza — não faz chamadas HTTP.
   * @param {string} from - Número do WhatsApp
   */
 limparDados(from) {
    const cache = CacheService.getScriptCache();
    cache.remove(`estado_${from}`);
    cache.remove(`dados_${from}`);
    cache.remove(`log_cadastro_${from}`);
    cache.remove(`sessao_inicio_${from}`);
    cache.remove(`aviso_sessao_${from}`);
    this.removerSessaoAtiva(from);
    console.log(`🗑️ Dados limpos para ${from}`);
  },

  // ==========================================================================
  // LOG DE CADASTRO
  // ==========================================================================

  /**
   * Appenda uma linha ao log de cadastro no CacheService.
   * Chamado a cada mensagem recebida durante o fluxo de cadastro.
   * @param {string} from  - Número do WhatsApp
   * @param {string} texto - Mensagem digitada pelo usuário
   */
  appendLog(from, texto) {
    const cache     = CacheService.getScriptCache();
    const logAtual  = cache.get(`log_cadastro_${from}`) || '';
    const agora     = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'HH:mm');
    const novaLinha = `[${agora}] ${texto}\n`;
    // CacheService tem limite de 100KB por entrada — trunca se necessário
    const novoLog   = (logAtual + novaLinha).slice(-90000);
    cache.put(`log_cadastro_${from}`, novoLog, 3600);
  },

  // ==========================================================================
  // CONTROLE DE SESSÃO
  // ==========================================================================

  /**
   * Registra o início de uma sessão de cadastro.
   * Chamado quando o usuário inicia o fluxo de cadastro.
   */
  iniciarSessaoCadastro(from) {
    const agora = Date.now().toString();
    CacheService.getScriptCache().put(`sessao_inicio_${from}`, agora, 3600);
    console.log(`⏱️ Sessão de cadastro iniciada para ${from}`);
  },
  
  /**
   * Verifica se a sessão está prestes a expirar (≥ 50 minutos).
   * Se sim, persiste o log no Odoo e pergunta se o usuário ainda está ativo.
   * Envia a pergunta apenas uma vez (controlado por aviso_sessao_).
   * @param {string} from   - Número do WhatsApp
   * @param {string} estado - Estado atual da conversa
   * @returns {boolean} true se a pergunta foi enviada agora
   */
  verificarExpiracaoSessao(from, estado) {
    const cache     = CacheService.getScriptCache();
    const inicio    = cache.get(`sessao_inicio_${from}`);
    const jaAvisado = cache.get(`aviso_sessao_${from}`);

    if (!inicio || jaAvisado) return false;

    const minutosDecorridos = (Date.now() - parseInt(inicio)) / 60000;
    if (minutosDecorridos < 50) return false;   // BL-03: avisa a 50 min (10 min antes de expirar em 60)

    console.log(`⚠️ Sessão de ${from} prestes a expirar (${Math.floor(minutosDecorridos)} min)`);

    // Persiste log e etapa atual no Odoo (backup preventivo)
    this.persistirLogCadastro(from, false);

    // Marca que a pergunta já foi enviada (TTL 10 min — tempo restante da sessão)
    cache.put(`aviso_sessao_${from}`, '1', 600);

    // Pergunta se o usuário ainda está ativo
    Utils.enviarMenu(from,
      '⏰ *Você ainda está aí?*\n\n' +
      'Sua sessão de cadastro expira em aproximadamente *10 minutos*.\n\n' +
      'Deseja continuar de onde parou?',
      [
        { id: 'btn_sessao_continuar', title: '✅ Sim, continuar' },
        { id: 'btn_sessao_sair',      title: '❌ Não, sair' }
      ]
    );

    return true;
  },

  /**
   * Renova a sessão de cadastro por mais 60 minutos.
   * Chamado quando o usuário responde "Sim, continuar".
   * @param {string} from - Número do WhatsApp
   */
  renovarSessao(from) {
    const cache = CacheService.getScriptCache();
    const estado = this.getEstado(from);

    // Renova o timestamp de início da sessão
    cache.put(`sessao_inicio_${from}`, Date.now().toString(), 3600);

    // Remove o flag de aviso para permitir novo aviso no futuro
    cache.remove(`aviso_sessao_${from}`);

    // Renova também o TTL do estado e dados temporários
    const dadosStr = cache.get(`dados_${from}`);
    if (dadosStr) cache.put(`dados_${from}`, dadosStr, 3600);
    if (estado)   cache.put(`estado_${from}`, estado, 3600);

    // Renova o log
    const log = cache.get(`log_cadastro_${from}`);
    if (log) cache.put(`log_cadastro_${from}`, log, 3600);

    console.log(`🔄 Sessão renovada para ${from} (+60 min)`);
  },

  // ==========================================================================
  // PRIMEIRO CONTATO
  // ==========================================================================

 /**
   * Verifica se é o primeiro contato do número.
   * Usa CacheService como camada rápida e Odoo (x_contato_bot) como fonte de verdade.
   * @param {string} from - Número do WhatsApp
   * @returns {boolean} true apenas na primeira mensagem
   */
  ehPrimeiroContato(from) {
    const cache = CacheService.getScriptCache();
    const cacheKey = `contato_${from}`;

    // Cache hit → já conhecido, sem lock e sem chamada HTTP ao Odoo.
    // Reativado: evita um search_read no Odoo a CADA mensagem recebida.
    if (cache.get(cacheKey)) return false;

    // BL-23: o read-modify-write abaixo (buscar → criar → cachear) não é
    // atômico. Duas mensagens simultâneas de um número novo passavam as duas
    // pela busca sem encontrar nada e criavam DOIS `x_contato_bot`, com duas
    // boas-vindas. Pior: `atualizarContatoBot` escreve só no primeiro registro
    // que encontra, então o log de cadastro passava a cair num registro
    // arbitrário. O lock só é disputado no cache miss — contato novo ou cache
    // expirado (6 h) — e não pesa no fluxo normal de mensagens.
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(5000);
    } catch (e) {
      // Sem serializar, preferimos pular a boas-vindas a arriscar duplicar o
      // registro: a próxima mensagem do usuário refaz a verificação.
      console.warn('⚠️ [ehPrimeiroContato] Lock não obtido, pulando verificação:', e.message);
      return false;
    }

    try {
      // Dupla checagem: outra execução pode ter registrado enquanto esperávamos.
      if (cache.get(cacheKey)) return false;

      const contato = OdooService.buscarContatoBot(from);

      if (contato) {
        // Existe no Odoo → cachear e retornar false
        cache.put(cacheKey, '1', 21600); // 6 horas
        return false;
      }

      // Primeiro contato → registrar no Odoo e cachear
      OdooService.registrarContatoBot(from);
      cache.put(cacheKey, '1', 21600);
      console.log(`🆕 Primeiro contato registrado no Odoo: ${from}`);
      return true;

    } catch (e) {
      console.error('❌ Erro ao verificar primeiro contato no Odoo:', e.message);
      // Fallback: não bloqueia o fluxo em caso de erro
      return false;
    } finally {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  },

  // ==========================================================================
  // SESSÕES ATIVAS (usado pela trigger de limpeza)
  // ==========================================================================

  // BL-22: antes isto era UMA chave de cache (`sessoes_cadastro_ativas`) com um
  // array JSON, lido-modificado-gravado sob lock GLOBAL. Todo cadastro
  // simultâneo disputava o mesmo lock e, sob contenção, alguns estouravam os
  // 5 s e não registravam/removiam a sessão.
  //
  // Agora cada sessão é uma propriedade própria: cada execução escreve só a SUA
  // chave, então não existe mais read-modify-write compartilhado e nenhum lock
  // é necessário.
  //
  // Por que PropertiesService e não CacheService: a trigger precisa *enumerar*
  // as sessões, e o CacheService não lista chaves — só lê por chave conhecida.
  // `getProperties()` devolve tudo, o que torna a varredura por prefixo viável.
  PREFIXO_SESSAO: 'sessao_ativa_',

  /**
   * Marca o número como tendo uma sessão de cadastro em andamento.
   * Usada pela trigger para identificar sessões que podem ter sido abandonadas.
   * O valor é o timestamp de início (útil para inspeção manual das propriedades).
   */
  registrarSessaoAtiva(from) {
    try {
      PropertiesService.getScriptProperties()
        .setProperty(this.PREFIXO_SESSAO + from, Date.now().toString());
    } catch (e) {
      console.warn('⚠️ Erro ao registrar sessão ativa:', e.message);
    }
  },

  /**
   * Remove a marca de sessão ativa do número.
   */
  removerSessaoAtiva(from) {
    try {
      PropertiesService.getScriptProperties()
        .deleteProperty(this.PREFIXO_SESSAO + from);
    } catch (e) {
      console.warn('⚠️ Erro ao remover sessão ativa:', e.message);
    }
  },

  /**
   * Retorna os números com sessão de cadastro ativa.
   * @returns {string[]} Números com sessão ativa
   */
  getSessoesAtivas() {
    try {
      const todas = PropertiesService.getScriptProperties().getProperties();
      return Object.keys(todas)
        .filter(chave => chave.startsWith(this.PREFIXO_SESSAO))
        .map(chave => chave.slice(this.PREFIXO_SESSAO.length));
    } catch (e) {
      console.warn('⚠️ Erro ao listar sessões ativas:', e.message);
      return [];
    }
  }

};