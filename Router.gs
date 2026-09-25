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
      default:            this._tipoNaoTratado(from, tipo);
    }
  },

  /**
   * BL-79: tipos que o bot não entende NÃO mexem na conversa.
   *
   * Antes caíam em `menuPrincipal`, que grava o estado MENU. Um 👍 numa
   * mensagem do bot, no meio do cadastro ou logo antes de mandar o
   * comprovante, desfazia o passo em andamento — e a foto seguinte ouvia
   * "Não estou esperando uma imagem".
   *
   * - `reaction`: é um gesto, não um pedido. Silêncio, e nenhuma mensagem
   *   cobrada.
   * - `system` e `ephemeral`: avisos do próprio WhatsApp, não da pessoa.
   * - o resto (figurinha, áudio, vídeo, localização, contato, `unsupported`):
   *   um aviso curto, e o estado continua onde estava.
   * @private
   */
  _tipoNaoTratado(from, tipo) {
    console.log(`⚠️ Tipo de mensagem não tratado: ${tipo} — estado mantido`);
    if (tipo === 'reaction' || tipo === 'system' || tipo === 'ephemeral') return;

    Utils.enviarSimples(from,
      '🤔 Ainda não consigo entender esse tipo de mensagem.\n\n' +
      'Pode me escrever, ou enviar o comprovante como *foto* ou *PDF*. ' +
      'Para ver as opções, digite *menu*.'
    );
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

    // Resposta de um WhatsApp Flow. Chega como um subtipo próprio, então sem
    // este ramo ela cairia no `menuPrincipal` do fim da função e o formulário
    // inteiro seria descartado em silêncio.
    if (subTipo === 'nfm_reply') {
      FlowHandler.processar(from, message.interactive.nfm_reply);
      return;
    }

    if (subTipo === 'list_reply') {
      const itemId    = message.interactive.list_reply?.id;
      const itemTitle = message.interactive.list_reply?.title;
      console.log(`📋 Lista selecionada: ${itemId} - ${itemTitle}`);

      const estado = StateManager.getEstado(from);

      // ── BL-41: o submenu "Outras opções" ──────────────────────────────────
      // Roteia por id, não por estado: estes itens são sempre válidos, e uma
      // lista antiga na conversa continua funcionando.
      if (itemId && itemId.indexOf('opt_') === 0) {
        switch (itemId) {
          case 'opt_membro':    CadastroHandler.iniciarCadastroMembro(from); return;
          case 'opt_historico': DevolucaoHandler.exibirHistorico(from);      return;
          case 'opt_contato':   MenuHandler.infoSecretaria(from);            return;
          case 'opt_convidar':  MenuHandler.convidar(from);                  return;
          default:              MenuHandler.menuPrincipal(from);             return;
        }
      }

      // ── BL-41: comunidade escolhida para a oferta ─────────────────────────
      if (itemId && itemId.indexOf('ofc_') === 0) {
        OfertaHandler.processarComunidade(from, itemId, itemTitle);
        return;
      }

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

      // BL-28: cair aqui significa que a seleção não valia para o estado atual
      // — quase sempre um toque numa lista ANTIGA, que o WhatsApp mantém
      // clicável. Mandar para o menu apagaria um cadastro em andamento sem
      // uma palavra. Se há cadastro, avisamos e repetimos a pergunta.
      this._interativoForaDeContexto(from, `lista "${itemId}"`);
      return;
    }

    // BL-79: subtipo que o bot não conhece era descartado sem resposta.
    this._tipoNaoTratado(from, `interactive/${subTipo}`);
  },

  /**
   * Trata uma resposta interativa que não valia para o estado atual.
   *
   * Com cadastro em andamento, o cadastro VENCE: o toque é descartado e o
   * passo atual é repetido. Sem cadastro, é o menu de sempre.
   *
   * @private
   */
  _interativoForaDeContexto(from, oQue) {
    const estado = StateManager.getEstado(from);

    if (ESTADOS_CADASTRO.includes(estado)) {
      console.log(`↩️ [BL-28] ${oQue} fora de contexto em ${estado} — cadastro preservado`);
      Utils.enviarSimples(from,
        'Essa opção era de uma etapa anterior. 😊\n\n' +
        'Seu cadastro continua de onde parou — é só responder à pergunta abaixo.'
      );
      if (CadastroHandler.reapresentarPasso(from)) return;
    }

    MenuHandler.menuPrincipal(from);
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

    // ── BL-81: baixa de pendente — a devolução viaja NO ID do botão ────────
    // Mesmo raciocínio do BL-62 logo abaixo. Com o id fixo e o alvo na sessão,
    // tocar "Confirmar" numa mensagem antiga agia sobre a ÚLTIMA pendente
    // aberta, não sobre a que a mensagem mostrava.
    const baixa = buttonId && buttonId.match(/^btn_(confirmar|rejeitar)_baixa_(\d+)$/);
    if (baixa) {
      const id = parseInt(baixa[2], 10);
      if (baixa[1] === 'confirmar') RelatorioHandler.confirmarBaixa(from, id);
      else                          RelatorioHandler.rejeitarBaixa(from, id);
      return;
    }

    // ── BL-62: correção do mês de referência ───────────────────────────────
    // Os ids do registro pago e do mês em aberto viajam DENTRO do id do botão,
    // não em sessão. Por isso isto funciona mesmo horas depois, e mesmo se a
    // sessão já tiver expirado — que é o caso comum, já que a devolução foi
    // encerrada antes de a pergunta sair.
    if (buttonId && (buttonId.indexOf('comp_') === 0 || buttonId.indexOf('compm_') === 0)) {
      ComprovanteHandler.corrigirMes(from, buttonId);
      return;
    }

    // Log de botões relevantes ao cadastro
    const botoesLogaveis = {
      'btn_numero_confirmar':   'Confirmar número',
      'btn_numero_cancelar':    'Cancelar número',
      'btn_foto_sim':           'Enviar foto: Sim',
      'btn_confirmar_cadastro': 'Confirmar cadastro',
      'btn_cancelar_cadastro':  'Corrigir cadastro',
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
      // O botão diz "❌ Corrigir" — e até o BL-45 chamava `cancelar`, que
      // apagava os sete campos preenchidos. O id ficou como estava de
      // propósito: mensagens antigas na conversa ainda carregam esse valor, e
      // renomear faria elas pararem de responder.
      case 'btn_cancelar_cadastro':  CadastroHandler.corrigir(from);          break;

      // --- Cadastro de membro (família) ---
      case 'btn_end_mesmo':          CadastroHandler.usarEnderecoDoResponsavel(from); break;
      case 'btn_end_outro':          CadastroHandler.solicitarEnderecoDigitado(from); break;
      case 'btn_dia_mesmo':          CadastroHandler.usarDiaDoResponsavel(from);      break;
      case 'btn_dia_outro':          CadastroHandler.solicitarDiaDigitado(from);      break;
      case 'btn_foto_pular_membro':  CadastroHandler.pularFotoMembro(from);           break;
      case 'btn_foto_pular':         CadastroHandler.pularFoto(from);                 break;

      // --- Devolução ---
      // Os dois ids abaixo saíram dos menus, mas continuam vivos aqui: as
      // mensagens antigas seguem na conversa das pessoas e o toque nelas chega
      // ao webhook como sempre. Remover os `case` transformaria um botão antigo
      // em silêncio.
      case 'btn_ja_sou_dizimista':   DevolucaoHandler.verificarDizimista(from); break;
      case 'btn_devolver_dizimo':    DevolucaoHandler.iniciarDevolucao(from);   break;
      case 'btn_dev_prosseguir':     DevolucaoHandler.prosseguirAposAviso(from); break;
      case 'btn_minhas_devolucoes':  DevolucaoHandler.exibirHistorico(from);    break;

      // --- Oferta (BL-41) ---
      case 'btn_oferta':             OfertaHandler.iniciar(from);           break;
      case 'ofv_10':
      case 'ofv_20':
      case 'ofv_outro':              OfertaHandler.processarBotaoValor(from, buttonId); break;
      case 'btn_outras_opcoes':      MenuHandler.menuOutrasOpcoes(from);    break;

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
      // Botões de antes do BL-81, sem a devolução no id: não há como saber a
      // qual se referem, então não agem — reabrem a lista.
      case 'btn_confirmar_baixa':
      case 'btn_rejeitar_baixa':    RelatorioHandler.baixaSemAlvo(from);     break;
      case 'btn_voltar_pendentes':  RelatorioHandler.voltarPendentes(from);  break;

      default:
        // BL-28: mesmo raciocínio do list_reply. Um botão desconhecido quase
        // sempre é um botão ANTIGO, de uma etapa que já passou.
        console.log(`⚠️ Botão desconhecido: ${buttonId}`);
        this._interativoForaDeContexto(from, `botão "${buttonId}"`);
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
    // BL-80: o CONTEÚDO não vai para o log. Era a linha que registrava o código
    // de acesso ao relatório (anulando o cuidado de RelatorioHandler), e também
    // endereço, nascimento e valores digitados no cadastro. Tamanho e estado
    // bastam para seguir uma conversa no log sem guardar o que a pessoa disse.
    console.log(`💬 Texto (${texto.length} caracteres) | Estado: ${estado}`);

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
        // O histórico saiu do menu (3 botões é o teto do WhatsApp) e virou
        // contexto no início da devolução. Este atalho é a porta para quem
        // quer só consultar, sem começar uma devolução.
        if (lower === 'historico' || lower === 'histórico') {
          DevolucaoHandler.exibirHistorico(from);
          return;
        }
      }
    }

    // Verifica expiração de sessão e appenda log durante fluxo de cadastro
    if (emCadastro) {
      StateManager.verificarExpiracaoSessao(from, estado);
      StateManager.appendLog(from, texto);
    }

    // BL-33: quem recebeu o formulário e escreveu em vez de preencher. Pode
    // ter desistido, pode estar num aparelho que não o renderiza, pode não ter
    // visto o botão. Não é caso de menu: a pessoa pediu para se cadastrar e
    // continua querendo — só não pelo formulário. Segue por conversa.
    if (estado === ESTADOS.AGUARDANDO_FLOW_CADASTRO) {
      // O mesmo estado serve aos dois formulários; quem diz QUAL está em curso
      // é a sessão. Retomar o cadastro de um dizimista quando a pessoa estava
      // adicionando um familiar seria pior que o menu.
      const ehMembro = !!StateManager.getCampo(from, 'cadastrandoMembro');
      console.log(`↩️ [Flow] ${from} escreveu em vez de preencher ` +
                  `(${ehMembro ? 'membro' : 'cadastro'}) — caindo para a conversa`);

      // BL-44: com o cadastro por conversa desligado, escrever aqui não
      // derruba mais ninguém no passo a passo de 19 mensagens. A pessoa fica
      // ONDE ESTAVA — o formulário continua aberto e clicável na conversa —
      // e recebe um lembrete com as duas portas que não exigem cadastro.
      //
      // O gatilho antigo não distinguia "não consegui abrir" de "quanto é o
      // dízimo?", e tratava os dois como desistência (BL-34). Lembrar em vez
      // de decidir não chuta a intenção de ninguém.
      //
      // Vale para os DOIS formulários — cadastro e membro. São a mesma coisa:
      // cadastrar gente perguntando campo por campo, 19 e 14 mensagens contra
      // 4 do formulário.
      if (!CadastroHandler.conversaAtiva()) {
        MenuHandler.lembrarCadastroPendente(from, ehMembro
          ? '🙏 *Falta pouco para adicionar seu familiar!*\n\n' +
            'Toque em *Preencher cadastro*, na mensagem do formulário aqui na ' +
            'conversa. Leva menos de um minuto. 💛\n\n' +
            'Se preferir, dá para fazer isto agora:'
          : '🙏 *Falta pouco para concluir seu cadastro!*\n\n' +
            'Toque em *Preencher cadastro*, na mensagem do formulário aqui na ' +
            'conversa. Leva menos de um minuto. 💛\n\n' +
            'Se preferir, dá para fazer isto agora:');
        return;
      }

      Utils.enviarSimples(from,
        'Sem problema, podemos fazer por aqui mesmo, passo a passo. 💛'
      );

      if (ehMembro) {
        Utils.enviarSimples(from, '📝 *Nome Completo*\n\nDigite o nome completo do familiar:');
        StateManager.setEstado(from, ESTADOS.AGUARDANDO_NOME);
      } else {
        CadastroHandler.confirmarNumero(from);
      }
      return;
    }

    switch (estado) {
      // ── Oferta (BL-41) ────────────────────────────────────────────────────
      case ESTADOS.AGUARDANDO_NOME_OFERTA:
        OfertaHandler.processarNome(from, texto);
        break;

      case ESTADOS.AGUARDANDO_VALOR_OFERTA:
        OfertaHandler.processarValorDigitado(from, texto);
        break;

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

      // ── BL-85: texto enquanto o bot espera o comprovante ────────────────
      // Caía no `default` → menu → estado MENU. Um "👍", "já paguei" ou "ok"
      // logo depois dos dados de pagamento desfazia a devolução, e o
      // comprovante seguinte ouvia "Não estou esperando uma imagem" — foi
      // exatamente o que aconteceu no teste de 24/09. Lembra o que falta e
      // mantém o estado; "menu" continua saindo, pelo atalho lá em cima.
      case ESTADOS.AGUARDANDO_COMPROVANTE:
      case ESTADOS.AGUARDANDO_COMPROVANTE_FAMILIA:
      case ESTADOS.AGUARDANDO_COMPROVANTE_OFERTA:
        Utils.enviarComBotaoMenu(from,
          '📎 Estou aguardando o *comprovante* do pagamento.\n\n' +
          'Pode enviar como *foto* ou *PDF*. Se preferir desistir, toque em Menu.'
        );
        break;

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
               estado === ESTADOS.AGUARDANDO_COMPROVANTE_FAMILIA ||
               estado === ESTADOS.AGUARDANDO_COMPROVANTE_OFERTA) {
      // BL-37: o `message.id` vai junto porque é ele que o indicador de
      // "digitando" precisa marcar como lido — o aviso de progresso que
      // substituiu a mensagem "⏳ Analisando comprovante...".
      ComprovanteHandler.processar(from, message.image, message.id);
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
        estado === ESTADOS.AGUARDANDO_COMPROVANTE_FAMILIA ||
        estado === ESTADOS.AGUARDANDO_COMPROVANTE_OFERTA) {
      ComprovanteHandler.processar(from, message.document, message.id);
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