/**
 * ============================================================================
 * RELATORIOHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Módulo de Relatório v2 – Relatórios para admins e coordenadores.
 *
 * Perfis de acesso:
 *   Admin       → cadastrado em x_parametros_line_c498a
 *                 (x_studio_whatsapp = telefone | x_studio_chave_acesso = código)
 *                 Vê todas as comunidades.
 *   Coordenador → cadastrado em x_comunidade
 *                 (x_studio_chave_acesso = código, telefone identificado pelo
 *                  campo x_studio_whatsapp_coordenador — ver OdooService)
 *                 Vê apenas a comunidade vinculada.
 *
 * Fluxo:
 *   1. Usuário digita "relatório"
 *   2. Sistema verifica se o número está autorizado (admin ou coord)
 *   3. Se autorizado → solicita código de acesso
 *   4. Usuário digita o código → sistema valida
 *   5. Se válido → exibe menu (Resumo Consolidado | Listar Dizimistas)
 *   6. Usuário escolhe opção e prossegue
 *
 * Regra de segurança de mensagens:
 *   Nenhuma mensagem excede ~3.800 caracteres.
 *   Conteúdo maior é automaticamente dividido em múltiplas mensagens.
 *
 * API do StateManager utilizada:
 *   salvarCampoEMudarEstado(from, campo, valor, novoEstado)
 *   getCampo(from, campo)
 *   limparDados(from)
 *   setEstado(from, estado)
 *
 * Versão: 2.0
 * Data: Fevereiro 2026
 */

const RelatorioHandler = {

  // Limite seguro de caracteres por mensagem WhatsApp
  LIMITE_CHARS: 3800,

  // ==========================================================================
  // 1. VERIFICAÇÃO DE NÚMERO AUTORIZADO
  // ==========================================================================

  /**
   * Verifica se o número está na lista de autorizados (admin ou coordenador).
   * NÃO valida o código — apenas confirma que o número pode tentar acessar.
   *
   * @param {string} from - Número do remetente
   * @returns {{
   *   autorizado: boolean,
   *   tipoAcesso: 'admin'|'coordenador'|null,
   *   registroId: number|null,
   *   chaveAcesso: string|null,
   *   comunidadeId: number|null,
   *   comunidadeNome: string|null
   * }}
   */
  _verificarNumeroAutorizado(from) {
    const numero = from.replace('@c.us', '');

    // 1) Verificar admins em x_parametros_line_c498a
    try {
      const admins = OdooService.buscarNumerosPrivilegiados();
      for (const admin of admins) {
        if (this._numerosIguais(numero, admin.x_studio_whatsapp)) {
          console.log(`✅ Número admin reconhecido: ${numero}`);
          return {
            autorizado:    true,
            tipoAcesso:    'admin',
            registroId:    admin.id,
            chaveAcesso:   String(admin.x_studio_chave_acesso || ''),
            comunidadeId:  null,
            comunidadeNome: null
          };
        }
      }
    } catch (e) {
      console.error('❌ Erro ao verificar admins:', e.message);
    }

    // 2) Verificar coordenadores em x_comunidade
    try {
      const comunidades = OdooService.listarComunidades();
      for (const com of comunidades) {
        // O WhatsApp do coordenador está em x_studio_whatsapp_coordenador
        if (com.x_studio_whatsapp_coordenador &&
            this._numerosIguais(numero, com.x_studio_whatsapp_coordenador)) {
          console.log(`✅ Número coordenador reconhecido: ${numero} → ${com.x_name}`);
          return {
            autorizado:    true,
            tipoAcesso:    'coordenador',
            registroId:    com.id,
            chaveAcesso:   String(com.x_studio_chave_acesso || ''),
            comunidadeId:  com.id,
            comunidadeNome: com.x_name
          };
        }
      }
    } catch (e) {
      console.error('❌ Erro ao verificar coordenadores:', e.message);
    }

    console.log(`🚫 Número não autorizado: ${numero}`);
    return { autorizado: false, tipoAcesso: null, registroId: null,
             chaveAcesso: null, comunidadeId: null, comunidadeNome: null };
  },

  /**
   * Compara dois números ignorando formatação e DDI (últimos 11 dígitos).
   * @private
   */
  _numerosIguais(a, b) {
    if (!a || !b) return false;
    const limpar = n => String(n).replace(/\D/g, '');
    return limpar(a).slice(-11) === limpar(b).slice(-11);
  },

  // ==========================================================================
  // 2. INICIAR FLUXO (chamado pelo Router)
  // ==========================================================================

  /**
   * Ponto de entrada. Verifica bloqueio, verifica número, e solicita código.
   * Implementa rate limiting: 3 tentativas, bloqueio de 30 minutos.
   * @param {string} from
   */
  iniciar(from) {
    // ── Rate limiting: verificar bloqueio ───────────────────────────
    const cache    = CacheService.getScriptCache();
    const bloqueio = cache.get(`bloqueio_relatorio_${from}`);

    if (bloqueio) {
      const minRestantes = Math.ceil((parseInt(bloqueio) - Date.now()) / 60000);
      Utils.enviarSimples(from,
        `🔒 *Acesso temporariamente bloqueado*\n\n` +
        `Muitas tentativas incorretas.\n\n` +
        `Tente novamente em aproximadamente *${Math.max(minRestantes, 1)} minuto(s)*.`
      );
      return;
    }
    // ────────────────────────────────────────────────────────────────

    const candidato = this._verificarNumeroAutorizado(from);

    if (!candidato.autorizado) {
      Utils.enviarSimples(from,
        `⛔ *Acesso restrito*\n\n` +
        `Esta funcionalidade é exclusiva para administradores e coordenadores.\n\n` +
        `Se precisar de acesso, entre em contato com a secretaria. 🙏`
      );
      return;
    }

    // Salva dados do candidato e aguarda o código
    StateManager.salvarCampoEMudarEstado(
      from,
      'relatorio_candidato',
      candidato,
      ESTADOS.AGUARDANDO_CODIGO_RELATORIO
    );

    // Informar tentativas restantes se já errou antes
    const tentativas = parseInt(cache.get(`tentativas_relatorio_${from}`) || '0');
    const restantes  = 3 - tentativas;

    let mensagem = `🔐 *Acesso ao Relatório*\n\n` +
                   `Olá! Seu número foi reconhecido.\n\n` +
                   `Por favor, informe seu *código de acesso* para continuar:`;

    if (tentativas > 0) {
      mensagem += `\n\n⚠️ Você tem *${restantes}* tentativa(s) restante(s).`;
    }

    Utils.enviarSimples(from, mensagem);
  },

  // ==========================================================================
  // 2. VALIDAR CÓDIGO DE ACESSO (chamado pelo Router via texto)
  // ==========================================================================

  /**
   * Valida o código digitado pelo usuário.
   * @param {string} from
   * @param {string} codigoDigitado
   */
  handleAuthCode(from, codigoDigitado) {
    const candidato = StateManager.getCampo(from, 'relatorio_candidato');

    if (!candidato) {
      // Sessão expirada
      StateManager.limparDados(from);
      Utils.enviarSimples(from,
        '⏱️ Sua sessão expirou. Por favor, envie *relatório* para tentar novamente.'
      );
      return;
    }

    const codigoEsperado = String(candidato.chaveAcesso || '').trim();
    const codigoFornecido = String(codigoDigitado || '').trim();

    if (!codigoEsperado) {
      // Nenhum código cadastrado → bloquear por segurança
      console.warn(`⚠️ Nenhum código cadastrado para o registro ${candidato.registroId}`);
      StateManager.limparDados(from);
      Utils.enviarSimples(from,
        `⚠️ Não há código de acesso configurado para este usuário.\n\n` +
        `Entre em contato com a secretaria para regularizar. 🙏`
      );
      return;
    }

    if (codigoFornecido.toLowerCase() !== codigoEsperado.toLowerCase()) {
      console.log(`🔒 Código inválido para ${from}. Fornecido: "${codigoFornecido}"`);
      // Limpa tudo por segurança — não dá nova tentativa
      StateManager.limparDados(from);
      Utils.enviarSimples(from,
        `❌ *Código inválido.*\n\n` +
        `O acesso foi negado. Se precisar de ajuda, entre em contato com a secretaria.`
      );
      return;
    }

    // Código correto → montar perfil definitivo e mostrar menu
    const acesso = {
      tipoAcesso:    candidato.tipoAcesso,
      comunidadeId:  candidato.comunidadeId,
      comunidadeNome: candidato.comunidadeNome
    };

    StateManager.salvarCampoEMudarEstado(
      from,
      'relatorio_acesso',
      acesso,
      ESTADOS.AGUARDANDO_OPCAO_RELATORIO
    );

    console.log(`✅ Autenticação bem-sucedida: ${from} → ${acesso.tipoAcesso}`);
    this._exibirMenuRelatorio(from, acesso);
  },

  // ==========================================================================
  // 3. MENU PRINCIPAL DO RELATÓRIO
  // ==========================================================================
  /**
   * Exibe o menu de opções do relatório (lista interativa).
   * @private
   */
  _exibirMenuRelatorio(from, acesso) {
    const escopoTexto = acesso.tipoAcesso === 'admin'
      ? '🏛️ Todas as comunidades'
      : `⛪ ${acesso.comunidadeNome}`;

    const rows = [
      { id: 'rel_consolidado', title: '📊 Resumo Consolidado',     description: 'Comparativo mensal de devoluções' },
      { id: 'rel_lista',       title: '📋 Listar Dizimistas',      description: 'Lista de dizimistas cadastrados'  },
      { id: 'rel_pendentes',   title: '⏳ Devoluções Pendentes',   description: 'Gerenciar baixas de comprovantes' },
      { id: 'rel_voltar',      title: '🔙 Voltar ao Menu',         description: '' }
    ];

    Utils.enviarLista(from,
      `📊 *MENU DE RELATÓRIOS*\n\n` +
      `🗂️ Escopo: ${escopoTexto}\n\n` +
      `Escolha o tipo de relatório desejado:`,
      [{ title: 'Opções disponíveis', rows }],
      { textoBotao: 'Ver opções' }
    );
  },

  // ==========================================================================
  // 4. OPÇÃO 1 – RESUMO CONSOLIDADO
  // ==========================================================================

  /**
   * Inicia o fluxo do resumo consolidado: solicita seleção do período.
   * Chamado pelo Router (btn_relatorio_consolidado).
   * @param {string} from
   */
  iniciarConsolidado(from) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    // Muda para estado de aguardo de período
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_PERIODO_CONSOLIDADO);

    const secoes = [{
      title: 'Selecione o período',
      rows: [
        { id: 'rel_mes_atual',    title: '📅 Mês atual',      description: this._labelMesAtual()   },
        { id: 'rel_mes_passado',  title: '📅 Mês anterior',   description: this._labelMesPassado() },
        { id: 'rel_outro_mes',    title: '✏️ Outro mês',      description: 'Informar manualmente'  }
      ]
    }];

    Utils.enviarLista(from,
      `📊 *RESUMO CONSOLIDADO*\n\nSelecione o período desejado:`,
      secoes,
      { textoBotao: 'Ver períodos' }
    );
  },

  /**
   * Processa a seleção de período na lista.
   * Chamado pelo Router (list_reply no estado AGUARDANDO_PERIODO_CONSOLIDADO).
   * @param {string} from
   * @param {string} itemId
   */
  processarPeriodoConsolidado(from, itemId) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    if (itemId === 'rel_outro_mes') {
      StateManager.setEstado(from, ESTADOS.AGUARDANDO_MES_CUSTOMIZADO);
      Utils.enviarSimples(from,
        `✏️ *Informe o mês desejado*\n\n` +
        `Digite no formato: *MM/AAAA*\n` +
        `Exemplo: *03/2025*`
      );
      return;
    }

    const periodo = this._calcularPeriodo(itemId);
    if (!periodo) {
      Utils.enviarSimples(from, '❌ Período inválido. Tente novamente.');
      return this.iniciarConsolidado(from);
    }

    this._gerarRelatorioConsolidado(from, acesso, periodo);
  },

  /**
   * Processa mês digitado manualmente (formato MM/AAAA).
   * Chamado pelo Router (texto no estado AGUARDANDO_MES_CUSTOMIZADO).
   * @param {string} from
   * @param {string} texto
   */
  processarMesCustomizado(from, texto) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    // Validar formato MM/AAAA
    const regex = /^(\d{1,2})\/(\d{4})$/;
    const match = texto.trim().match(regex);

    if (!match) {
      Utils.enviarSimples(from,
        `❌ Formato inválido.\n\n` +
        `Por favor, informe no formato *MM/AAAA*\n` +
        `Exemplo: *03/2025*`
      );
      return;
    }

    const mes = parseInt(match[1], 10);
    const ano = parseInt(match[2], 10);

    if (mes < 1 || mes > 12) {
      Utils.enviarSimples(from, `❌ Mês inválido (use 01 a 12). Tente novamente:`);
      return;
    }

    const m   = mes - 1; // 0-based
    const periodo = {
      dataInicio: this._iso(ano, m, 1),
      dataFim:    this._iso(ano, m + 1, 0),
      label:      `${this._nomeMes(m)} de ${ano}`,
      mesAnteriorInicio: this._iso(m === 0 ? ano - 1 : ano, m === 0 ? 11 : m - 1, 1),
      mesAnteriorFim:    this._iso(m === 0 ? ano - 1 : ano, m === 0 ? 12 : m, 0),
      labelAnterior:     `${this._nomeMes(m === 0 ? 11 : m - 1)} de ${m === 0 ? ano - 1 : ano}`
    };

    // Retorna ao estado de menu do relatório após geração
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_OPCAO_RELATORIO);

    this._gerarRelatorioConsolidado(from, acesso, periodo);
  },

  // ==========================================================================
  // 5. GERAR RELATÓRIO CONSOLIDADO
  // ==========================================================================

  /**
   * Orquestra a geração e envio do relatório consolidado.
   * @private
   */
  _gerarRelatorioConsolidado(from, acesso, periodo) {
    // Garante retorno ao menu do relatório
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_OPCAO_RELATORIO);

    Utils.enviarSimples(from, '⏳ Gerando relatório, aguarde um momento...');

    try {
      const todasComunidades = OdooService.listarComunidades();
      const todosDizimistas  = OdooService.listarTodosDizimistas();
      const todasDevolucoes  = OdooService.listarDevolucoesPorPeriodo(
        periodo.dataInicio, periodo.dataFim
      );

      // Buscar período anterior para comparativo
      const devolucoesAnt = OdooService.listarDevolucoesPorPeriodo(
        periodo.mesAnteriorInicio || this._mesAnteriorInicio(periodo.dataInicio),
        periodo.mesAnteriorFim    || this._mesAnteriorFim(periodo.dataInicio)
      );

      // Filtrar por escopo
      const comunidades = acesso.tipoAcesso === 'admin'
        ? todasComunidades
        : todasComunidades.filter(c => c.id === acesso.comunidadeId);

      const dizimistas = acesso.tipoAcesso === 'admin'
        ? todosDizimistas
        : todosDizimistas.filter(d => this._comunidadeId(d) === acesso.comunidadeId);

      const idsEscopo   = new Set(dizimistas.map(d => d.id));
      const devolucoes  = todasDevolucoes.filter(dev => idsEscopo.has(this._dizimistaId(dev)));
      const devAnt      = devolucoesAnt.filter(dev => idsEscopo.has(this._dizimistaId(dev)));

      // ── Mensagem 1: Cabeçalho ──────────────────────────────────────────────
      const agora = Utilities.formatDate(new Date(), 'America/Fortaleza', 'dd/MM/yyyy HH:mm');
      const escopoTexto = acesso.tipoAcesso === 'admin'
        ? '🏛️ Todas as Comunidades'
        : `⛪ ${acesso.comunidadeNome}`;

      Utils.enviarSimples(from,
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *RELATÓRIO CONSOLIDADO*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🗂️ Escopo: ${escopoTexto}\n` +
        `📅 Período: ${periodo.label}\n` +
        `🕐 Gerado: ${agora}`
      );

      // ── Mensagem 2: Visão Geral (apenas ADMIN) ou Resumo do coord ──────────
      if (acesso.tipoAcesso === 'admin') {
        Utils.enviarSimples(from,
          this._blocoVisaoGeral(dizimistas, devolucoes, devAnt, periodo)
        );
      }

      // ── Mensagem 3: Detalhe por comunidade ────────────────────────────────
      // Pode ser múltiplas mensagens se ultrapassar limite
      const blocoComunidades = this._blocoDetalhesComunidades(
        comunidades, dizimistas, devolucoes
      );
      this._enviarComLimite(from, blocoComunidades);

      // ── Mensagem final: botões de ação ────────────────────────────────────
      Utils.enviarMenu(from,
        `✅ Relatório gerado com sucesso!`,
        [
          { id: 'btn_relatorio_consolidado', title: '🔄 Novo período' },
          { id: 'btn_relatorio_lista',       title: '📋 Listar Dizimistas' },
          { id: 'btn_menu',                  title: '🔙 Menu' }
        ]
      );

    } catch (e) {
      console.error('❌ Erro ao gerar relatório consolidado:', e.message);
      console.error(e.stack);
      Utils.enviarMenu(from,
        `❌ Ocorreu um erro ao gerar o relatório.\n\nTente novamente em instantes.`,
        [
          { id: 'btn_relatorio_consolidado', title: '🔄 Tentar novamente' },
          { id: 'btn_menu',                  title: '🔙 Menu' }
        ]
      );
    }
  },

  // ==========================================================================
  // 6. BLOCOS DO RELATÓRIO CONSOLIDADO
  // ==========================================================================

  /**
   * Bloco de visão geral (exibido apenas para ADMIN).
   * @private
   */
  _blocoVisaoGeral(dizimistas, devolucoes, devolucoesAnteriores, periodo) {
    const totalAtivos  = dizimistas.length;
    const totalDevol   = new Set(devolucoes.map(d => this._dizimistaId(d))).size;
    const semDevolucao = totalAtivos - totalDevol;
    const participacao = totalAtivos > 0 ? Math.round((totalDevol / totalAtivos) * 100) : 0;
    const totalValor   = devolucoes.reduce((s, d) => s + (d.x_studio_value || 0), 0);
    const ticketMedio  = totalDevol > 0 ? totalValor / totalDevol : 0;
    const valorAnt     = devolucoesAnteriores.reduce((s, d) => s + (d.x_studio_value || 0), 0);
    const crescimento  = valorAnt > 0
      ? (((totalValor - valorAnt) / valorAnt) * 100).toFixed(1)
      : null;
    const iconCresc    = crescimento === null ? '' : parseFloat(crescimento) >= 0 ? '📈' : '📉';
    const sinalCresc   = crescimento !== null && parseFloat(crescimento) >= 0 ? '+' : '';

    let msg =
      `📌 *VISÃO GERAL*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👥 Dizimistas ativos: ${totalAtivos}\n` +
      `✅ Devoluções realizadas: ${totalDevol}\n` +
      `❌ Sem devolução: ${semDevolucao}\n` +
      `📊 Participação: ${participacao}%\n` +
      `💵 Total devolvido: ${this._reais(totalValor)}\n` +
      `💰 Ticket médio: ${this._reais(ticketMedio)}\n`;

    if (crescimento !== null) {
      const labelAnt = periodo.labelAnterior ||
        this._nomeMesAno(this._mesAnteriorInicio(periodo.dataInicio));
      msg +=
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `${iconCresc} *COMPARATIVO MENSAL*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${labelAnt.toUpperCase()}: ${this._reais(valorAnt)}\n` +
        `${periodo.label.toUpperCase()}: ${this._reais(totalValor)}\n` +
        `${iconCresc} Crescimento: ${sinalCresc}${crescimento}%`;
    }

    return msg;
  },

  /**
   * Bloco de detalhe por comunidade.
   * Retorna a string completa (pode ser dividida por _enviarComLimite).
   * @private
   */
  _blocoDetalhesComunidades(comunidades, dizimistas, devolucoes) {
    let msg = `📍 *DETALHE POR COMUNIDADE*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const com of comunidades) {
      const dizCom    = dizimistas.filter(d => this._comunidadeId(d) === com.id);
      const idsCom    = new Set(dizCom.map(d => d.id));
      const devCom    = devolucoes.filter(dev => idsCom.has(this._dizimistaId(dev)));
      const totalAtiv = dizCom.length;
      const totalDev  = new Set(devCom.map(d => this._dizimistaId(d))).size;
      const totalVal  = devCom.reduce((s, d) => s + (d.x_studio_value || 0), 0);
      const ticket    = totalDev > 0 ? totalVal / totalDev : 0;
      const partic    = totalAtiv > 0 ? Math.round((totalDev / totalAtiv) * 100) : 0;
      const icon      = partic >= 80 ? '🟢' : partic >= 50 ? '🟡' : '🔴';

      msg +=
        `${icon} *${com.x_name}*\n` +
        `   👥 Devoluções: ${totalDev}\n` +
        `   💵 Devolvido: ${this._reais(totalVal)}\n` +
        `   💰 Ticket médio: ${this._reais(ticket)}\n` +
        `   📊 Participação: ${partic}%\n\n`;
    }

    return msg.trimEnd();
  },

  // ==========================================================================
  // 7. OPÇÃO 2 – LISTAR DIZIMISTAS
  // ==========================================================================

  /**
   * Inicia o fluxo de listagem de dizimistas.
   * Admin: solicita seleção de comunidade.
   * Coordenador: vai direto para a geração.
   * Chamado pelo Router (btn_relatorio_lista).
   * @param {string} from
   */
  iniciarListaDizimistas(from) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    // Coordenador: comunidade já definida
    if (acesso.tipoAcesso === 'coordenador') {
      this._gerarListaDizimistas(from, acesso, acesso.comunidadeId, acesso.comunidadeNome);
      return;
    }

    // Admin: solicitar seleção de comunidade
    try {
      const comunidades = OdooService.listarComunidades();

      if (comunidades.length === 0) {
        Utils.enviarSimples(from, '⚠️ Nenhuma comunidade cadastrada no sistema.');
        return;
      }

      // WhatsApp permite no máximo 10 rows por seção na lista interativa
      const rows = comunidades.slice(0, 10).map(com => ({
        id:          `com_${com.id}`,
        title:       com.x_name.substring(0, 24),
        description: ''
      }));

      StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMUNIDADE_RELATORIO);

      Utils.enviarLista(from,
        `📋 *LISTAR DIZIMISTAS*\n\nSelecione a comunidade:`,
        [{ title: 'Comunidades disponíveis', rows }],
        { textoBotao: 'Ver comunidades' }
      );

    } catch (e) {
      console.error('❌ Erro ao listar comunidades:', e.message);
      Utils.enviarSimples(from, '❌ Erro ao carregar comunidades. Tente novamente.');
    }
  },

  /**
   * Processa a seleção de comunidade pelo admin.
   * Chamado pelo Router (list_reply no estado AGUARDANDO_COMUNIDADE_RELATORIO).
   * @param {string} from
   * @param {string} itemId    - Ex: "com_5"
   * @param {string} itemTitle - Nome da comunidade
   */
  processarComunidadeLista(from, itemId, itemTitle) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    // Extrair ID numérico do prefixo "com_"
    const comunidadeId = parseInt(itemId.replace('com_', ''), 10);
    if (isNaN(comunidadeId)) {
      Utils.enviarSimples(from, '❌ Seleção inválida. Tente novamente.');
      return this.iniciarListaDizimistas(from);
    }

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_OPCAO_RELATORIO);
    this._gerarListaDizimistas(from, acesso, comunidadeId, itemTitle);
  },

  /**
   * Gera e envia a lista de dizimistas de uma comunidade.
   * Respeita limite de 3800 chars por mensagem.
   * @private
   */
  _gerarListaDizimistas(from, acesso, comunidadeId, comunidadeNome) {
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_OPCAO_RELATORIO);

    Utils.enviarSimples(from, '⏳ Gerando lista, aguarde...');

    try {
      const dizimistas = OdooService.getDizimistasByCommunity(comunidadeId);

      const cabecalho =
        `📋 *LISTA DE DIZIMISTAS*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⛪ Comunidade: ${comunidadeNome}\n` +
        `👥 Total cadastrados: ${dizimistas.length}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n`;

      if (dizimistas.length === 0) {
        Utils.enviarMenu(from,
          cabecalho + `Nenhum dizimista cadastrado nesta comunidade.`,
          [
            { id: 'btn_relatorio_lista', title: '🔄 Outra comunidade' },
            { id: 'btn_menu',            title: '🔙 Menu' }
          ]
        );
        return;
      }

      // Montar linhas numeradas
      const linhas = dizimistas.map((d, i) => `${i + 1}. ${d.x_name}`);
      const corpo  = linhas.join('\n');
      const msgCompleta = cabecalho + corpo;

      // Enviar com divisão automática
      this._enviarComLimite(from, msgCompleta);

      // Botões finais
      Utils.enviarMenu(from,
        `✅ Lista enviada com sucesso!`,
        [
          { id: 'btn_relatorio_lista',       title: '🔄 Outra comunidade' },
          { id: 'btn_relatorio_consolidado', title: '📊 Consolidado'      },
          { id: 'btn_menu',                  title: '🔙 Menu'             }
        ]
      );

    } catch (e) {
      console.error('❌ Erro ao gerar lista de dizimistas:', e.message);
      Utils.enviarMenu(from,
        `❌ Erro ao gerar a lista. Tente novamente.`,
        [
          { id: 'btn_relatorio_lista', title: '🔄 Tentar novamente' },
          { id: 'btn_menu',            title: '🔙 Menu' }
        ]
      );
    }
  },

  // ==========================================================================
  // OPÇÃO 8 – DEVOLUÇÕES PENDENTES
  // ==========================================================================

  /**
   * Inicia o fluxo de devoluções pendentes.
   * Admin: solicita seleção de comunidade primeiro.
   * Coordenador: vai direto para a listagem.
   * @param {string} from
   */
  iniciarPendentes(from) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    // Coordenador: comunidade já definida
    if (acesso.tipoAcesso === 'coordenador') {
      this._listarPendentes(from, acesso, acesso.comunidadeId, acesso.comunidadeNome);
      return;
    }

    // Admin: solicitar seleção de comunidade
    try {
      const comunidades = OdooService.listarComunidades();

      if (comunidades.length === 0) {
        Utils.enviarSimples(from, '⚠️ Nenhuma comunidade cadastrada no sistema.');
        return;
      }

      const rows = comunidades.slice(0, 10).map(com => ({
        id:          `pendcom_${com.id}`,
        title:       com.x_name.substring(0, 24),
        description: ''
      }));

      StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMUNIDADE_PENDENTES);

      Utils.enviarLista(from,
        `⏳ *DEVOLUÇÕES PENDENTES*\n\nSelecione a comunidade:`,
        [{ title: 'Comunidades disponíveis', rows }],
        { textoBotao: 'Ver comunidades' }
      );

    } catch (e) {
      console.error('❌ Erro ao listar comunidades para pendentes:', e.message);
      Utils.enviarSimples(from, '❌ Erro ao carregar comunidades. Tente novamente.');
    }
  },

  /**
   * Processa a seleção de comunidade pelo admin (fluxo pendentes).
   * @param {string} from
   * @param {string} itemId    - Ex: "pendcom_5"
   * @param {string} itemTitle - Nome da comunidade
   */
  processarComunidadePendentes(from, itemId, itemTitle) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    const comunidadeId = parseInt(itemId.replace('pendcom_', ''), 10);
    if (isNaN(comunidadeId)) {
      Utils.enviarSimples(from, '❌ Seleção inválida. Tente novamente.');
      return this.iniciarPendentes(from);
    }

    this._listarPendentes(from, acesso, comunidadeId, itemTitle);
  },

  /**
   * Busca e exibe as devoluções pendentes de uma comunidade.
   * @private
   */
  _listarPendentes(from, acesso, comunidadeId, comunidadeNome) {
    Utils.enviarSimples(from, '⏳ Buscando devoluções pendentes...');

    try {
      const pendentes = OdooService.buscarDevolucoesPendentes(comunidadeId);

      if (!pendentes || pendentes.length === 0) {
        Utils.enviarMenu(from,
          `✅ *Nenhuma devolução pendente!*\n\n` +
          `⛪ Comunidade: ${comunidadeNome}\n\n` +
          `Todas as devoluções foram processadas. 🙏`,
          [
            { id: 'btn_novo_relatorio', title: '📊 Outro relatório' },
            { id: 'btn_menu',           title: '🔙 Menu' }
          ]
        );
        return;
      }

      // Salvar contexto (comunidade selecionada) no cache
      StateManager.salvarMultiplosCampos(from, {
        pendentes_comunidade_id:   comunidadeId,
        pendentes_comunidade_nome: comunidadeNome
      });

      // Montar lista interativa (máximo 10 itens)
      const rows = pendentes.map(dev => {
        const dizimistaName = Array.isArray(dev.x_studio_dizimista)
          ? dev.x_studio_dizimista[1]
          : 'Dizimista';
        const valor = `R$ ${(dev.x_studio_value || 0).toFixed(2).replace('.', ',')}`;
        const data  = Utils.formatarDataOdoo(dev.x_studio_data_da_devolucao);

        return {
          id:          `pend_${dev.id}`,
          title:       `${dizimistaName}`.substring(0, 24),
          description: `${valor} — ${data}`
        };
      });

      StateManager.setEstado(from, ESTADOS.AGUARDANDO_SELECAO_PENDENTE);

      Utils.enviarLista(from,
        `⏳ *DEVOLUÇÕES PENDENTES*\n\n` +
        `⛪ Comunidade: ${comunidadeNome}\n` +
        `📋 Total: ${pendentes.length} devolução(ões)\n\n` +
        `Selecione uma para ver os detalhes:`,
        [{ title: 'Devoluções pendentes', rows }],
        { textoBotao: 'Ver devoluções' }
      );

    } catch (e) {
      console.error('❌ Erro ao buscar pendentes:', e.message);
      Utils.enviarSimples(from, '❌ Erro ao carregar devoluções. Tente novamente.');
    }
  },

  /**
   * Processa a seleção de uma devolução pendente.
   * Busca detalhes completos e envia para o coordenador.
   * @param {string} from
   * @param {string} itemId - Ex: "pend_42"
   */
  processarSelecaoPendente(from, itemId) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    const devolucaoId = parseInt(itemId.replace('pend_', ''), 10);
    if (isNaN(devolucaoId)) {
      Utils.enviarSimples(from, '❌ Seleção inválida.');
      return;
    }

    Utils.enviarSimples(from, '⏳ Carregando detalhes...');

    try {
      const dev = OdooService.buscarDevolucaoDetalhada(devolucaoId);

      if (!dev) {
        Utils.enviarSimples(from, '❌ Devolução não encontrada.');
        return;
      }

      // Verificar se ainda está pendente
      if (dev.x_studio_status !== 'Pendente') {
        Utils.enviarMenu(from,
          `⚠️ Esta devolução já foi processada.\n\nStatus atual: *${dev.x_studio_status}*`,
          [
            { id: 'btn_voltar_pendentes', title: '🔙 Voltar à lista' },
            { id: 'btn_menu',             title: '🔙 Menu' }
          ]
        );
        return;
      }

      // Extrair nome do dizimista
      const dizimistaName = Array.isArray(dev.x_studio_dizimista)
        ? dev.x_studio_dizimista[1]
        : 'Dizimista';

      // Extrair nome da comunidade
      const comunidadeNome = Array.isArray(dev.x_studio_comunidade)
        ? dev.x_studio_comunidade[1]
        : '—';

      const valor = `R$ ${(dev.x_studio_value || 0).toFixed(2).replace('.', ',')}`;
      const data  = Utils.formatarDataOdoo(dev.x_studio_data_da_devolucao);

      // Montar mensagem de detalhes
      let detalhe =  `━━━━━━━━━━━━━━━━━━━━\n`;
          detalhe += `📄 *DETALHES DA DEVOLUÇÃO*\n`;
          detalhe += `━━━━━━━━━━━━━━━━━━━━\n\n`;
          detalhe += `👤 *Dizimista:* ${dizimistaName}\n`;
          detalhe += `⛪ *Comunidade:* ${comunidadeNome}\n`;
          detalhe += `📅 *Data:* ${data}\n`;
          detalhe += `💰 *Valor:* ${valor}\n`;
          detalhe += `📌 *Status:* Pendente\n`;

      if (dev.x_studio_forma_de_pagamento) {
        detalhe += `💳 *Forma:* ${dev.x_studio_forma_de_pagamento}\n`;
      }

      detalhe += `\n━━━━━━━━━━━━━━━━━━━━`;

      Utils.enviarSimples(from, detalhe);

      // Enviar comprovante (se existir)
      if (dev.x_studio_comprovante) {
        Utilities.sleep(1000);
        this._enviarComprovante(from, dev);
      } else {
        Utils.enviarSimples(from, '📎 _Sem comprovante anexado._');
      }

      // Salvar ID da devolução em contexto para ação
      StateManager.salvarCampoEMudarEstado(
        from,
        'pendente_devolucao_id',
        devolucaoId,
        ESTADOS.AGUARDANDO_ACAO_PENDENTE
      );

      // Botões de ação
      Utilities.sleep(1500);
      Utils.enviarMenu(from,
        `O que deseja fazer com esta devolução?`,
        [
          { id: 'btn_confirmar_baixa', title: '✅ Confirmar' },
          { id: 'btn_rejeitar_baixa',  title: '❌ Rejeitar'  },
          { id: 'btn_voltar_pendentes', title: '🔙 Voltar'   }
        ]
      );

    } catch (e) {
      console.error('❌ Erro ao buscar detalhe da devolução:', e.message);
      Utils.enviarSimples(from, '❌ Erro ao carregar detalhes. Tente novamente.');
    }
  },

  /**
   * Envia o comprovante ao coordenador (imagem ou PDF).
   * @private
   */
  _enviarComprovante(from, dev) {
    try {
      const tipo = dev.x_studio_tipo_comprovante || 'imagem';
      const base64 = dev.x_studio_comprovante;
      const nomeArquivo = dev.x_studio_nome_arquivo || `comprovante_${dev.id}`;

      if (tipo === 'pdf') {
        MediaService.enviarDocumento(
          from,
          base64,
          'application/pdf',
          nomeArquivo.endsWith('.pdf') ? nomeArquivo : `${nomeArquivo}.pdf`,
          '📄 Comprovante em PDF'
        );
      } else {
        MediaService.enviarImagemBase64(from, base64, '📸 Comprovante');
      }
    } catch (e) {
      console.error('❌ Erro ao enviar comprovante:', e.message);
      Utils.enviarSimples(from, '⚠️ _Não foi possível enviar o comprovante._');
    }
  },

  /**
   * Confirma a baixa de uma devolução (status → Confirmado).
   * @param {string} from
   */
  confirmarBaixa(from) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    const devolucaoId = StateManager.getCampo(from, 'pendente_devolucao_id');
    if (!devolucaoId) {
      Utils.enviarSimples(from, '❌ Devolução não encontrada na sessão.');
      return;
    }

    try {
      OdooService.atualizarStatusDevolucao(devolucaoId, 'Confirmado');
      console.log(`✅ Devolução ${devolucaoId} confirmada por ${from}`);

      Utils.enviarMenu(from,
        `✅ *Devolução confirmada com sucesso!*\n\n` +
        `ID: #${devolucaoId}\nStatus: *Confirmado* ✅`,
        [
          { id: 'btn_voltar_pendentes', title: '⏳ Mais pendentes' },
          { id: 'btn_novo_relatorio',   title: '📊 Relatórios'    },
          { id: 'btn_menu',             title: '🔙 Menu'          }
        ]
      );

    } catch (e) {
      console.error('❌ Erro ao confirmar devolução:', e.message);
      Utils.enviarSimples(from, '❌ Erro ao confirmar. Tente novamente.');
    }
  },

  /**
   * Rejeita uma devolução (status → Rejeitado).
   * @param {string} from
   */
  rejeitarBaixa(from) {
    const acesso = StateManager.getCampo(from, 'relatorio_acesso');
    if (!acesso) return this._sessaoExpirada(from);

    const devolucaoId = StateManager.getCampo(from, 'pendente_devolucao_id');
    if (!devolucaoId) {
      Utils.enviarSimples(from, '❌ Devolução não encontrada na sessão.');
      return;
    }

    try {
      OdooService.atualizarStatusDevolucao(devolucaoId, 'Rejeitado');
      console.log(`❌ Devolução ${devolucaoId} rejeitada por ${from}`);

      Utils.enviarMenu(from,
        `❌ *Devolução rejeitada.*\n\n` +
        `ID: #${devolucaoId}\nStatus: *Rejeitado* ❌`,
        [
          { id: 'btn_voltar_pendentes', title: '⏳ Mais pendentes' },
          { id: 'btn_novo_relatorio',   title: '📊 Relatórios'    },
          { id: 'btn_menu',             title: '🔙 Menu'          }
        ]
      );

    } catch (e) {
      console.error('❌ Erro ao rejeitar devolução:', e.message);
      Utils.enviarSimples(from, '❌ Erro ao rejeitar. Tente novamente.');
    }
  },

  /**
   * Volta à listagem de pendentes da mesma comunidade.
   * @param {string} from
   */
  voltarPendentes(from) {
    const acesso       = StateManager.getCampo(from, 'relatorio_acesso');
    const comunidadeId = StateManager.getCampo(from, 'pendentes_comunidade_id');
    const comunidadeNm = StateManager.getCampo(from, 'pendentes_comunidade_nome');

    if (!acesso || !comunidadeId) {
      return this.iniciarPendentes(from);
    }

    this._listarPendentes(from, acesso, comunidadeId, comunidadeNm);
  },

  // ==========================================================================
  // 9. UTILITÁRIO: ENVIO COM LIMITE DE CARACTERES
  // ==========================================================================

  /**
   * Envia texto respeitando o limite de ~3800 chars por mensagem.
   * Divide por linhas — nunca trunca no meio de uma linha.
   * @param {string} from
   * @param {string} texto
   */
  _enviarComLimite(from, texto) {
    if (texto.length <= this.LIMITE_CHARS) {
      Utils.enviarSimples(from, texto);
      return;
    }

    const linhas  = texto.split('\n');
    let   chunk   = '';
    let   parte   = 1;

    for (const linha of linhas) {
      const candidato = chunk ? chunk + '\n' + linha : linha;

      if (candidato.length > this.LIMITE_CHARS) {
        // Envia o chunk atual e começa novo
        if (chunk) {
          Utils.enviarSimples(from, chunk);
          parte++;
        }
        chunk = linha;
      } else {
        chunk = candidato;
      }
    }

    // Envia o último chunk restante
    if (chunk) {
      Utils.enviarSimples(from, chunk);
    }
  },

  // ==========================================================================
  // 10. UTILITÁRIOS DE DATA E FORMATAÇÃO
  // ==========================================================================

  _calcularPeriodo(itemId) {
    const now = new Date();
    const a   = now.getFullYear();
    const m   = now.getMonth(); // 0-based

    if (itemId === 'rel_mes_atual') {
      const mp = m === 0 ? 11 : m - 1;
      const ap = m === 0 ? a - 1 : a;
      return {
        dataInicio:        this._iso(a, m, 1),
        dataFim:           this._iso(a, m + 1, 0),
        label:             `${this._nomeMes(m)} de ${a}`,
        mesAnteriorInicio: this._iso(ap, mp, 1),
        mesAnteriorFim:    this._iso(ap, mp + 1, 0),
        labelAnterior:     `${this._nomeMes(mp)} de ${ap}`
      };
    }

    if (itemId === 'rel_mes_passado') {
      const mp  = m === 0 ? 11 : m - 1;
      const ap  = m === 0 ? a - 1 : a;
      const mp2 = mp === 0 ? 11 : mp - 1;
      const ap2 = mp === 0 ? ap - 1 : ap;
      return {
        dataInicio:        this._iso(ap, mp, 1),
        dataFim:           this._iso(ap, mp + 1, 0),
        label:             `${this._nomeMes(mp)} de ${ap}`,
        mesAnteriorInicio: this._iso(ap2, mp2, 1),
        mesAnteriorFim:    this._iso(ap2, mp2 + 1, 0),
        labelAnterior:     `${this._nomeMes(mp2)} de ${ap2}`
      };
    }

    return null;
  },

  _mesAnteriorInicio(dataInicio) {
    // dataInicio = 'YYYY-MM-DD'
    const d  = new Date(dataInicio + 'T12:00:00');
    const mp = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
    const ap = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    return this._iso(ap, mp, 1);
  },

  _mesAnteriorFim(dataInicio) {
    const d  = new Date(dataInicio + 'T12:00:00');
    const mp = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
    const ap = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    return this._iso(ap, mp + 1, 0);
  },

  _nomeMesAno(dataISO) {
    const d = new Date(dataISO + 'T12:00:00');
    return `${this._nomeMes(d.getMonth())} de ${d.getFullYear()}`;
  },

  _iso(ano, mes, dia) {
    const d  = new Date(ano, mes, dia);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  },

  _nomeMes(m) {
    return ['janeiro','fevereiro','março','abril','maio','junho',
            'julho','agosto','setembro','outubro','novembro','dezembro'][m] || '?';
  },

  _labelMesAtual() {
    const d = new Date();
    return `${this._nomeMes(d.getMonth())}/${d.getFullYear()}`;
  },

  _labelMesPassado() {
    const d = new Date();
    const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
    const a = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    return `${this._nomeMes(m)}/${a}`;
  },

  _reais(valor) {
    return 'R$ ' + Number(valor || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  },

  _comunidadeId(dizimista) {
    const c = dizimista.x_studio_comunidade;
    if (!c) return null;
    return Array.isArray(c) ? c[0] : c;
  },

  _dizimistaId(devolucao) {
    const d = devolucao.x_studio_dizimista;
    if (!d) return null;
    return Array.isArray(d) ? d[0] : d;
  },

  // ==========================================================================
  // 11. HELPERS INTERNOS
  // ==========================================================================

  _sessaoExpirada(from) {
    StateManager.limparDados(from);
    Utils.enviarSimples(from,
      '⏱️ Sua sessão expirou. Por favor, envie *relatório* para iniciar novamente.'
    );
  }

};