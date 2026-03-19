/**
 * ============================================================================
 * ROUTER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Roteador central de mensagens.
 * Responsabilidades:
 * - Identificar o tipo da mensagem (botão, lista, texto, imagem, documento)
 * - Despachar para o handler correto com base no tipo e no estado atual
 * - Não conter lógica de negócio (só decisões de roteamento)
 *
 * Versão: 9.0  (módulo de relatório v2 – autenticação por código + menu)
 * Data: Fevereiro 2026
 */

const Router = {

  /**
   * Ponto de entrada único. Chamado pelo Webhook.gs para cada mensagem recebida.
   * @param {string} from    - Número do remetente
   * @param {Object} message - Objeto de mensagem do payload WhatsApp
   */
  rotear(from, message) {
    const tipo = message.type;

    switch (tipo) {
      case 'interactive': this._rotearInterativo(from, message); break;
      case 'text':        this._rotearTexto(from, message);      break;
      case 'image':       this._rotearImagem(from, message);     break;
      case 'document':    this._rotearDocumento(from, message);  break;
      default:
        console.log(`⚠️ Tipo de mensagem não tratado: ${tipo}`);
        MenuHandler.menuPrincipal(from);
    }
  },

  // ==========================================================================
  // MENSAGENS INTERATIVAS (BOTÕES E LISTAS)
  // ==========================================================================

  _rotearInterativo(from, message) {
    const subTipo = message.interactive?.type;

    if (subTipo === 'button_reply') {
      this._rotearBotao(from, message.interactive.button_reply?.id);
      return;
    }

    if (subTipo === 'list_reply') {
      const itemId    = message.interactive.list_reply?.id;
      const itemTitle = message.interactive.list_reply?.title;
      console.log(`📋 Lista selecionada: ${itemId} - ${itemTitle}`);

      const estado = StateManager.getEstado(from);

      // ── Relatório v2: seleção de período do consolidado ────────────────────
      if (estado === ESTADOS.AGUARDANDO_PERIODO_CONSOLIDADO) {
        RelatorioHandler.processarPeriodoConsolidado(from, itemId);
        return;
      }

      // ── Relatório v2: seleção de comunidade (admin – listar dizimistas) ────
      if (estado === ESTADOS.AGUARDANDO_COMUNIDADE_RELATORIO) {
        RelatorioHandler.processarComunidadeLista(from, itemId, itemTitle);
        return;
      }

      // ── Cadastro ───────────────────────────────────────────────────────────
      if (estado === ESTADOS.AGUARDANDO_COMUNIDADE) {
        StateManager.appendLog(from, `Comunidade: ${itemTitle}`);
        CadastroHandler.processarComunidade(from, itemId, itemTitle);
        return;
      }

      // ── Relatório v2: seleção de comunidade para pendentes (admin) ──────
      if (estado === ESTADOS.AGUARDANDO_COMUNIDADE_PENDENTES) {
        RelatorioHandler.processarComunidadePendentes(from, itemId, itemTitle);
        return;
      }

      // ── Relatório v2: seleção de devolução pendente ─────────────────────
      if (estado === ESTADOS.AGUARDANDO_SELECAO_PENDENTE) {
        RelatorioHandler.processarSelecaoPendente(from, itemId);
        return;
      }

      // ── Relatório v2: menu principal (agora é lista) ────────────────────
      if (estado === ESTADOS.AGUARDANDO_OPCAO_RELATORIO) {
        switch (itemId) {
          case 'rel_consolidado': RelatorioHandler.iniciarConsolidado(from);    return;
          case 'rel_lista':       RelatorioHandler.iniciarListaDizimistas(from); return;
          case 'rel_pendentes':   RelatorioHandler.iniciarPendentes(from);      return;
          case 'rel_voltar':      MenuHandler.menuPrincipal(from);              return;
        }
      }

      MenuHandler.menuPrincipal(from);
    }
  },

  _rotearBotao(from, buttonId) {
    console.log(`🔘 Botão clicado: ${buttonId}`);

    // Log de botões relevantes ao cadastro
    const botoesLogaveis = {
      'btn_numero_confirmar':   'Confirmar número',
      'btn_numero_cancelar':    'Cancelar número',
      'btn_foto_sim':           'Enviar foto: Sim',
      'btn_confirmar_cadastro': 'Confirmar cadastro',
      'btn_cancelar_cadastro':  'Cancelar cadastro',
      'btn_notificacao_sim':    'Notificação: Sim',
      'btn_notificacao_nao':    'Notificação: Não',
      'btn_sessao_continuar':   'Sessão: Continuar',
      'btn_sessao_sair':        'Sessão: Sair'
    };

    if (botoesLogaveis[buttonId]) {
      const estado = StateManager.getEstado(from);
      const estadosCadastro = [
        ESTADOS.AGUARDANDO_CONFIRMACAO_NUMERO,
        ESTADOS.AGUARDANDO_COMUNIDADE,
        ESTADOS.AGUARDANDO_NOME,
        ESTADOS.AGUARDANDO_NOME_USUAL,
        ESTADOS.AGUARDANDO_DATA_NASCIMENTO,
        ESTADOS.AGUARDANDO_ENDERECO,
        ESTADOS.AGUARDANDO_VALOR_MENSAL,
        ESTADOS.AGUARDANDO_NOTIFICACAO,
        ESTADOS.AGUARDANDO_DIA_PREFERIDO,
        ESTADOS.AGUARDANDO_FOTO_PERFIL
      ];

      if (estadosCadastro.includes(estado)) {
        StateManager.appendLog(from, botoesLogaveis[buttonId]);
      }
    }

    switch (buttonId) {
      // --- Cadastro ---
      case 'btn_ser_dizimista':      CadastroHandler.iniciar(from);           break;
      case 'btn_numero_confirmar':   CadastroHandler.confirmarNumero(from);   break;
      case 'btn_numero_cancelar':    CadastroHandler.cancelar(from);          break;
      case 'btn_foto_sim':           CadastroHandler.solicitarFoto(from);     break;
      case 'btn_confirmar_cadastro': CadastroHandler.finalizar(from);         break;
      case 'btn_cancelar_cadastro':  CadastroHandler.cancelar(from);          break;

      // --- Devolução ---
      case 'btn_ja_sou_dizimista':   DevolucaoHandler.verificarDizimista(from); break;
      case 'btn_devolver_dizimo':    DevolucaoHandler.iniciarDevolucao(from);   break;
      case 'btn_minhas_devolucoes':  DevolucaoHandler.exibirHistorico(from);    break;

      // --- Geral ---
      case 'btn_secretaria':         MenuHandler.infoSecretaria(from);  break;
      case 'btn_menu':               MenuHandler.menuPrincipal(from);   break;

      // --- Notificação ---
      case 'btn_notificacao_sim':    CadastroHandler.processarNotificacao(from, true);  break;
      case 'btn_notificacao_nao':    CadastroHandler.processarNotificacao(from, false); break;

      // --- Relatório v2: menu de opções ─────────────────────────────────────
      case 'btn_relatorio_consolidado':
        RelatorioHandler.iniciarConsolidado(from);
        break;

      case 'btn_relatorio_lista':
        RelatorioHandler.iniciarListaDizimistas(from);
        break;

      // --- Relatório v2: novo relatório (volta ao menu do relatório) ─────────
      case 'btn_novo_relatorio':
        StateManager.limparDados(from);
        RelatorioHandler.iniciar(from);
        break;
      
      // --- Sessão de cadastro ---
      case 'btn_sessao_continuar': this._continuarSessao(from);  break;
      case 'btn_sessao_sair':      this._encerrarSessao(from);   break;

      // --- Devoluções Pendentes ---
      case 'btn_confirmar_baixa':   RelatorioHandler.confirmarBaixa(from);   break;
      case 'btn_rejeitar_baixa':    RelatorioHandler.rejeitarBaixa(from);    break;
      case 'btn_voltar_pendentes':  RelatorioHandler.voltarPendentes(from);  break;

      default:
        console.log(`⚠️ Botão desconhecido: ${buttonId}`);
        MenuHandler.menuPrincipal(from);
    }
  },

  // ==========================================================================
  // MENSAGENS DE TEXTO
  // ==========================================================================

  _rotearTexto(from, message) {
    const texto  = message.text.body.trim();
    const estado = StateManager.getEstado(from);
    console.log(`💬 Texto: "${texto}" | Estado: ${estado}`);

    // Atalho global: menu (exceto quando aguardando código de relatório)
    if (estado !== ESTADOS.AGUARDANDO_CODIGO_RELATORIO &&
        estado !== ESTADOS.AGUARDANDO_MES_CUSTOMIZADO) {
      if (texto.toLowerCase() === 'menu' || texto === '0') {
        MenuHandler.menuPrincipal(from);
        return;
      }

      // Atalho global: relatório
      if (PALAVRAS_RELATORIO.includes(texto.toLowerCase())) {
        StateManager.limparDados(from);
        RelatorioHandler.iniciar(from);
        return;
      }
    }

    // Verifica expiração de sessão e appenda log durante fluxo de cadastro
    const estadosCadastro = [
      ESTADOS.AGUARDANDO_CONFIRMACAO_NUMERO,
      ESTADOS.AGUARDANDO_COMUNIDADE,
      ESTADOS.AGUARDANDO_NOME,
      ESTADOS.AGUARDANDO_NOME_USUAL,
      ESTADOS.AGUARDANDO_DATA_NASCIMENTO,
      ESTADOS.AGUARDANDO_ENDERECO,
      ESTADOS.AGUARDANDO_VALOR_MENSAL,
      ESTADOS.AGUARDANDO_NOTIFICACAO,
      ESTADOS.AGUARDANDO_DIA_PREFERIDO,
      ESTADOS.AGUARDANDO_FOTO_PERFIL
    ];

    if (estadosCadastro.includes(estado)) {
      StateManager.verificarExpiracaoSessao(from, estado);
      StateManager.appendLog(from, texto);
    }

    switch (estado) {
      // ── Relatório v2 ──────────────────────────────────────────────────────
      case ESTADOS.AGUARDANDO_CODIGO_RELATORIO:
        RelatorioHandler.handleAuthCode(from, texto);
        break;

      case ESTADOS.AGUARDANDO_MES_CUSTOMIZADO:
        RelatorioHandler.processarMesCustomizado(from, texto);
        break;

      // ── Cadastro ──────────────────────────────────────────────────────────
      case ESTADOS.AGUARDANDO_NOME:
        CadastroHandler.processarNome(from, texto);            break;
      case ESTADOS.AGUARDANDO_NOME_USUAL:
        CadastroHandler.processarNomeUsual(from, texto);       break;
      case ESTADOS.AGUARDANDO_DATA_NASCIMENTO:
        CadastroHandler.processarDataNascimento(from, texto);  break;
      case ESTADOS.AGUARDANDO_ENDERECO:
        CadastroHandler.processarEndereco(from, texto);        break;
      case ESTADOS.AGUARDANDO_VALOR_MENSAL:
        CadastroHandler.processarValorMensal(from, texto);     break;
      case ESTADOS.AGUARDANDO_DIA_PREFERIDO:
        CadastroHandler.processarDiaPreferido(from, message);  break;
      default:
        MenuHandler.menuPrincipal(from);
    }
  },

  // ==========================================================================
  // IMAGENS
  // ==========================================================================

  _rotearImagem(from, message) {
    console.log('🖼️ Imagem recebida');
    const estado = StateManager.getEstado(from);

    if (estado === ESTADOS.AGUARDANDO_FOTO_PERFIL) {
      CadastroHandler.processarFotoPerfil(from, message.image);
    } else if (estado === ESTADOS.AGUARDANDO_COMPROVANTE) {
      ComprovanteHandler.processar(from, message.image);
    } else {
      MenuHandler.erro(from, 'Não estou esperando uma imagem agora. Digite *menu* para voltar.');
    }
  },

  // ==========================================================================
  // DOCUMENTOS
  // ==========================================================================

  _rotearDocumento(from, message) {
    console.log('📄 Documento recebido');
    const estado = StateManager.getEstado(from);

    if (estado === ESTADOS.AGUARDANDO_COMPROVANTE) {
      ComprovanteHandler.processar(from, message.document);
    } else {
      MenuHandler.erro(from, 'Não estou esperando um documento agora. Digite *menu* para voltar.');
    }
  },

  // ==========================================================================
  // CONTROLE DE SESSÃO
  // ==========================================================================

  /**
   * Usuário confirmou que quer continuar o cadastro.
   * Renova a sessão e orienta a retomar de onde parou.
   */
  _continuarSessao(from) {
    const estado = StateManager.getEstado(from);

    // Se o cache já expirou, não há como recuperar
    if (!estado || estado === ESTADOS.MENU) {
      Utils.enviarComBotaoMenu(from,
        '😕 Poxa, sua sessão já expirou.\n\n' +
        'Mas não se preocupe! É só iniciar novamente. 💛'
      );
      return;
    }

    StateManager.renovarSessao(from);
    StateManager.appendLog(from, 'Sessão renovada pelo usuário');

    Utils.enviarSimples(from,
      '✅ *Sessão renovada!*\n\n' +
      'Você tem mais *60 minutos* para concluir.\n\n' +
      '💡 Continue de onde parou — estou aguardando sua resposta! 😊'
    );
  },

  /**
   * Usuário decidiu sair do cadastro.
   * Persiste o log e limpa a sessão.
   */
  _encerrarSessao(from) {
    StateManager.appendLog(from, 'Usuário encerrou a sessão');
    StateManager.persistirLogCadastro(from, false);
    StateManager.limparDados(from);

    Utils.enviarComBotaoMenu(from,
      '👋 Tudo bem! Seu progresso foi salvo.\n\n' +
      'Quando quiser retomar, é só digitar *menu* e escolher "Ser Dizimista". 💛'
    );
  }

};