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
      case 'button':      this._rotearBotaoTemplate(from, message); break;
      default:
        console.log(`⚠️ Tipo de mensagem não tratado: ${tipo}`);
        MenuHandler.menuPrincipal(from);
    }
  },

  // ==========================================================================
  // RESPOSTA A TEMPLATE (botão de resposta rápida)
  // ==========================================================================

  /**
   * Trata a resposta a um template do WhatsApp (ex.: botão "Devolver agora" do
   * lembrete de devolução), que chega como mensagem do tipo 'button'.
   */
  _rotearBotaoTemplate(from, message) {
    const texto = String(message.button?.text || message.button?.payload || '').toLowerCase();
    console.log(`🔘 Resposta de template: "${texto}"`);

    if (texto.includes('devolver')) {
      DevolucaoHandler.iniciarDevolucao(from);
      return;
    }

    // Qualquer outra resposta ao template cai no menu principal.
    MenuHandler.menuPrincipal(from);
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

      // ── Família: seleção de quem devolver / de quem é o histórico ──────────
      if (itemId && itemId.indexOf('fam_') === 0) {
        DevolucaoHandler.processarSelecaoFamilia(from, itemId);
        return;
      }
      if (itemId && itemId.indexOf('hist_') === 0) {
        DevolucaoHandler.processarSelecaoHistorico(from, itemId);
        return;
      }

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

      // ── Falar com a Pastoral: seleção de comunidade (usuário sem cadastro) ──
      if (estado === ESTADOS.AGUARDANDO_COMUNIDADE_CONTATO) {
        MenuHandler.processarComunidadeContato(from, itemId, itemTitle);
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

    // ── Família: botões de seleção (ids dinâmicos fam_* / hist_*) ──────────
    if (buttonId && buttonId.indexOf('fam_') === 0) {
      DevolucaoHandler.processarSelecaoFamilia(from, buttonId);
      return;
    }
    if (buttonId && buttonId.indexOf('hist_') === 0) {
      DevolucaoHandler.processarSelecaoHistorico(from, buttonId);
      return;
    }

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
      if (ESTADOS_CADASTRO.includes(estado)) {
        StateManager.appendLog(from, botoesLogaveis[buttonId]);
      }
    }

    switch (buttonId) {
      // --- Cadastro ---
      case 'btn_ser_dizimista':      CadastroHandler.iniciar(from);              break;
      case 'btn_adicionar_membro':   CadastroHandler.iniciarCadastroMembro(from); break;
      case 'btn_numero_confirmar':   CadastroHandler.confirmarNumero(from);   break;
      case 'btn_numero_cancelar':    CadastroHandler.cancelar(from);          break;
      case 'btn_foto_sim':           CadastroHandler.solicitarFoto(from);     break;
      case 'btn_confirmar_cadastro': CadastroHandler.finalizar(from);         break;
      case 'btn_cancelar_cadastro':  CadastroHandler.cancelar(from);          break;

      // --- Cadastro de membro (família) ---
      case 'btn_end_mesmo':          CadastroHandler.usarEnderecoDoResponsavel(from); break;
      case 'btn_end_outro':          CadastroHandler.solicitarEnderecoDigitado(from); break;
      case 'btn_dia_mesmo':          CadastroHandler.usarDiaDoResponsavel(from);      break;
      case 'btn_dia_outro':          CadastroHandler.solicitarDiaDigitado(from);      break;
      case 'btn_foto_pular_membro':  CadastroHandler.pularFotoMembro(from);           break;

      // --- Devolução ---
      case 'btn_ja_sou_dizimista':   DevolucaoHandler.verificarDizimista(from); break;
      case 'btn_devolver_dizimo':    DevolucaoHandler.iniciarDevolucao(from);   break;
      case 'btn_dev_prosseguir':     DevolucaoHandler.prosseguirAposAviso(from); break;
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
    const texto      = message.text.body.trim();
    const estado     = StateManager.getEstado(from);
    const lower      = texto.toLowerCase();
    const emCadastro = ESTADOS_CADASTRO.includes(estado);
    console.log(`💬 Texto: "${texto}" | Estado: ${estado}`);

    // Família: "Escolher vários" → números digitados (ex.: "1,3"). Tratado antes
    // dos atalhos para não confundir os números com comandos.
    if (estado === ESTADOS.AGUARDANDO_SELECAO_FAMILIA) {
      DevolucaoHandler.processarNumerosFamilia(from, texto);
      return;
    }

    // Atalhos globais — desabilitados enquanto aguardamos código/mês de relatório
    if (estado !== ESTADOS.AGUARDANDO_CODIGO_RELATORIO &&
        estado !== ESTADOS.AGUARDANDO_MES_CUSTOMIZADO) {
      if (emCadastro) {
        // BL-10: durante o cadastro, só "menu" é atalho — e pede confirmação
        // antes de descartar. 'rel' e '0' NÃO são atalhos aqui, pois colidem
        // com entradas legítimas (apelido "Rel", dia/valor "0").
        if (lower === 'menu') {
          Utils.enviarMenu(from,
            '🤔 Deseja mesmo sair do cadastro?\n\nSeu progresso atual será descartado.',
            [
              { id: 'btn_sessao_sair',      title: '❌ Sim, sair' },
              { id: 'btn_sessao_continuar', title: '✅ Continuar'  }
            ]
          );
          return;
        }
      } else {
        // Fora do cadastro: atalhos completos.
        if (lower === 'menu' || texto === '0') {
          MenuHandler.menuPrincipal(from);
          return;
        }
        if (PALAVRAS_RELATORIO.includes(lower)) {
          StateManager.limparDados(from);
          RelatorioHandler.iniciar(from);
          return;
        }
      }
    }

    // Verifica expiração de sessão e appenda log durante fluxo de cadastro
    if (emCadastro) {
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
    } else if (estado === ESTADOS.AGUARDANDO_COMPROVANTE ||
               estado === ESTADOS.AGUARDANDO_COMPROVANTE_FAMILIA) {
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

    if (estado === ESTADOS.AGUARDANDO_COMPROVANTE ||
        estado === ESTADOS.AGUARDANDO_COMPROVANTE_FAMILIA) {
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