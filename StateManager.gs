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
   * Helper: salva um único campo e muda o estado em uma única chamada.
   */
  salvarCampoEMudarEstado(from, campo, valor, novoEstado) {
    const dados = this.getDadosTemporarios(from);
    dados[campo] = valor;
    this.setDadosTemporarios(from, dados);
    this.setEstado(from, novoEstado);
  },

  /**
   * Helper: mescla múltiplos campos de uma vez nos dados temporários.
   */
  salvarMultiplosCampos(from, campos) {
    const dados = this.getDadosTemporarios(from);
    Object.assign(dados, campos);
    this.setDadosTemporarios(from, dados);
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
    if (minutosDecorridos < 10) return false;

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

    // Cache hit → já conhecido, sem chamada HTTP
    //if (cache.get(cacheKey)) return false;

    try {
      const contato = OdooService.buscarContatoBot(from);

      if (contato) {
        // Existe no Odoo → cachear e retornar false
        //cache.put(cacheKey, '1', 21600); // 6 horas
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
    }
  },

  // ==========================================================================
  // SESSÕES ATIVAS (usado pela trigger de limpeza)
  // ==========================================================================

  /**
   * Registra o número na lista de sessões ativas de cadastro.
   * Usada pela trigger para identificar sessões que podem ter sido abandonadas.
   * Armazenada no CacheService com TTL de 70 min (margem sobre a sessão de 60 min).
   */
  registrarSessaoAtiva(from) {
    const cache = CacheService.getScriptCache();
    const lista = JSON.parse(cache.get('sessoes_cadastro_ativas') || '[]');

    if (!lista.includes(from)) {
      lista.push(from);
      cache.put('sessoes_cadastro_ativas', JSON.stringify(lista), 4200); // 70 min
    }
  },

  /**
   * Remove um número da lista de sessões ativas.
   */
  removerSessaoAtiva(from) {
    const cache = CacheService.getScriptCache();
    const lista = JSON.parse(cache.get('sessoes_cadastro_ativas') || '[]');
    const novaLista = lista.filter(n => n !== from);

    if (novaLista.length > 0) {
      cache.put('sessoes_cadastro_ativas', JSON.stringify(novaLista), 4200);
    } else {
      cache.remove('sessoes_cadastro_ativas');
    }
  },

  /**
   * Retorna a lista de sessões ativas de cadastro.
   * @returns {string[]} Números com sessão ativa
   */
  getSessoesAtivas() {
    const cache = CacheService.getScriptCache();
    return JSON.parse(cache.get('sessoes_cadastro_ativas') || '[]');
  }

};