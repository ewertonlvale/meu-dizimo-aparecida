/**
 * ============================================================================
 * DEVOLUCAOHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Gerencia o fluxo de devolução de dízimo.
 * Responsabilidades:
 * - Verificar se o usuário é dizimista cadastrado
 * - Enviar dados de pagamento (PIX/banco)
 * - Exibir histórico de devoluções
 * - Aguardar e encaminhar comprovante para ComprovanteHandler
 *
 * Versão: 8.0
 * Data: Fevereiro 2026
 */

const DevolucaoHandler = {

  // ==========================================================================
  // VERIFICAR DIZIMISTA
  // ==========================================================================

  /**
   * Verifica se o usuário tem cadastro e exibe as opções de devolução.
   * Ponto de entrada via botão 'btn_ja_sou_dizimista'.
   */
  verificarDizimista(from) {
    Utils.enviarSimples(from, '🔍 Buscando seu cadastro...');

    const dizimista = OdooService.buscarDizimistaPorWhatsapp(from);

    if (!dizimista) {
      Utils.enviarMenu(from,
        '😕 Não encontrei seu cadastro em nosso sistema.\n\n' +
        'Para acessar as opções de dizimista, primeiro você precisa se cadastrar.',
        [
          { id: 'btn_ser_dizimista', title: '🙏 Ser Dizimista' },
          { id: 'btn_menu',          title: '🔙 Menu'           }
        ]
      );
      return;
    }

    Utils.enviarSimples(from, `✅ *Olá, ${dizimista.x_name}!*\n\nSeu cadastro foi encontrado! 😊`);
    Utilities.sleep(1000);

    Utils.enviarMenu(from,
      'O que você gostaria de fazer?',
      [
        { id: 'btn_devolver_dizimo',   title: '💰 Devolver dízimo'  },
        { id: 'btn_minhas_devolucoes', title: '📊 Meu histórico'    },
        { id: 'btn_menu',              title: '🔙 Menu'              }
      ]
    );
  },

  // ==========================================================================
  // INICIAR DEVOLUÇÃO
  // ==========================================================================

  /**
   * Busca os dados do dizimista e envia as informações de pagamento.
   * Coloca a conversa em modo AGUARDANDO_COMPROVANTE.
   */
  iniciarDevolucao(from) {
    let responsavel;
    try {
      responsavel = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      console.error('❌ [DevolucaoHandler] Erro ao buscar dizimista no Odoo:', e.message);
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Estamos com uma instabilidade temporária.*\n\n' +
        'Não consegui acessar seu cadastro agora. Por favor, tente novamente em alguns minutos. 🙏'
      );
      return;
    }

    if (!responsavel) {
      Utils.enviarSimples(from, '❌ Você ainda não está cadastrado.\n\nDigite *menu* para se cadastrar.');
      return;
    }

    // Monta a família (responsável + membros).
    let familia;
    try {
      familia = OdooService.listarFamilia(responsavel.id);
    } catch (e) {
      console.error('❌ [DevolucaoHandler] Erro ao listar família:', e.message);
      familia = [responsavel];   // fallback: trata como individual
    }

    // 1 pessoa → fluxo individual.
    if (!familia || familia.length <= 1) {
      // Aviso (não bloqueia) se já houver devolução neste mês.
      let jaDevs = [];
      try { jaDevs = OdooService.devolucoesDoMes(responsavel.id); } catch (e) {}
      if (jaDevs.length > 0) {
        StateManager.salvarMultiplosCampos(from, { duplicataContexto: 'individual' });
        StateManager.setEstado(from, ESTADOS.AGUARDANDO_CONFIRMA_DUPLICATA);
        Utils.enviarMenu(from,
          `⚠️ *Atenção*\n\nVocê já tem devolução registrada em *${this._nomeMesAtual()}*:\n` +
          this._listaDevolucoes(jaDevs) +
          `\n\nDeseja registrar outra assim mesmo?`,
          [
            { id: 'btn_dev_prosseguir', title: '✅ Sim, registrar' },
            { id: 'btn_menu',           title: '🔙 Voltar'         }
          ]
        );
        return;
      }
      // BL-07: só aguarda comprovante se os dados de pagamento foram enviados.
      if (this._enviarDadosPagamento(from, responsavel)) {
        StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMPROVANTE);
      }
      return;
    }

    // 2+ → pergunta de quem é a devolução; guarda a família (leve) no contexto.
    const familiaLeve = familia.map(f => ({ id: f.id, nome: f.x_name || '—', valor: f.x_studio_value || 0 }));
    StateManager.salvarMultiplosCampos(from, { familia: familiaLeve });
    this._perguntarQuemDevolve(from, familiaLeve);
  },

  /**
   * Pergunta de quem é a devolução (Opção B: 2 pessoas → botões; 3+ → lista).
   * @private
   */
  _perguntarQuemDevolve(from, familia) {
    const total = familia.reduce((s, f) => s + (f.valor || 0), 0);
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_SELECAO_FAMILIA);

    if (familia.length === 2) {
      Utils.enviarMenu(from,
        '👨‍👩‍👧 *De quem é a devolução?*',
        familia.map(f => ({ id: `fam_${f.id}`, title: f.nome.substring(0, 20) }))
          .concat([{ id: 'fam_todos', title: '👨‍👩‍👧 Todos' }])
      );
      return;
    }

    const rows = [{ id: 'fam_todos', title: '✅ Todos', description: `Total ${this._reais(total)}` }];
    familia.slice(0, 7).forEach((f, i) => {
      rows.push({ id: `fam_${f.id}`, title: `${i + 1}. ${f.nome}`.substring(0, 24), description: this._reais(f.valor) });
    });
    rows.push({ id: 'fam_escolher', title: '✏️ Escolher vários…', description: 'Digitar os números (ex.: 1,3)' });
    rows.push({ id: 'fam_menu', title: '🔙 Menu', description: 'Voltar ao menu' });

    Utils.enviarLista(from, '👨‍👩‍👧 *De quem é a devolução?*', [{ title: 'Família', rows }], { textoBotao: 'Ver família' });
  },

  /** Toque num item da seleção de família (fam_todos | fam_<id> | fam_escolher). */
  processarSelecaoFamilia(from, id) {
    if (id === 'fam_menu') {
      StateManager.limparDados(from);
      MenuHandler.menuPrincipal(from);
      return;
    }
    const familia = StateManager.getCampo(from, 'familia') || [];
    if (!familia.length) return this._selecaoExpirada(from);

    if (id === 'fam_escolher') {
      Utils.enviarSimples(from, '✏️ Digite os *números* das pessoas separados por vírgula (ex.: *1,3*):');
      return;   // permanece em AGUARDANDO_SELECAO_FAMILIA (agora aguardando o texto)
    }
    if (id === 'fam_todos') {
      return this._prepararPagamentoLote(from, familia);
    }
    const alvoId = parseInt(String(id).replace('fam_', ''), 10);
    const sel = familia.filter(f => f.id === alvoId);
    if (!sel.length) return this._selecaoExpirada(from);
    return this._prepararPagamentoLote(from, sel);
  },

  /** Números digitados após "Escolher vários" (ex.: "1,3"). */
  processarNumerosFamilia(from, texto) {
    // Escape por texto (o estado intercepta o texto para pegar os números).
    const t = String(texto).trim().toLowerCase();
    if (t === 'menu' || t === 'cancelar' || t === 'voltar' || t === 'sair') {
      StateManager.limparDados(from);
      MenuHandler.menuPrincipal(from);
      return;
    }

    const familia = StateManager.getCampo(from, 'familia') || [];
    if (!familia.length) return this._selecaoExpirada(from);

    const indices = String(texto).split(/[^\d]+/).filter(Boolean).map(n => parseInt(n, 10));
    const sel = [];
    const vistos = {};
    indices.forEach(n => {
      const f = familia[n - 1];   // "1" = primeiro da lista exibida
      if (f && !vistos[f.id]) { vistos[f.id] = true; sel.push(f); }
    });

    if (!sel.length) {
      Utils.enviarSimples(from, '❌ Não entendi. Digite os números da lista separados por vírgula (ex.: *1,3*):');
      return;
    }
    return this._prepararPagamentoLote(from, sel);
  },

  /**
   * Mostra os dados de pagamento (total) e coloca em AGUARDANDO_COMPROVANTE_FAMILIA.
   * @private
   */
  _prepararPagamentoLote(from, selecionados) {
    // Separa quem já devolveu neste mês (com detalhes) de quem ainda falta.
    const jaDevolveram = [];   // [{ nome, devs: [{data, valor}] }]
    const idsJa = {};
    try {
      selecionados.forEach(f => {
        const devs = OdooService.devolucoesDoMes(f.id);
        if (devs.length > 0) { jaDevolveram.push({ nome: f.nome, devs }); idsJa[f.id] = true; }
      });
    } catch (e) { console.warn('⚠️ [Família] Falha ao checar duplicata:', e.message); }

    // Ninguém devolveu ainda → segue direto com todos os selecionados.
    if (jaDevolveram.length === 0) {
      this._enviarLoteEAguardar(from, selecionados);
      return;
    }

    const faltam = selecionados.filter(f => !idsJa[f.id]);

    // Cabeçalho do aviso: lista quem já devolveu (com datas/valores).
    let msg = `⚠️ *Atenção*\n\nJá há devolução registrada em *${this._nomeMesAtual()}*:\n`;
    jaDevolveram.forEach(m => { msg += `\n*${m.nome}*\n` + this._listaDevolucoes(m.devs); });

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_CONFIRMA_DUPLICATA);

    if (faltam.length > 0) {
      // Caso misto: registra APENAS quem ainda não devolveu.
      const totalFaltam = faltam.reduce((s, f) => s + (f.valor || 0), 0);
      msg += `\n\n➡️ Vou registrar *apenas quem ainda não devolveu*:\n`;
      faltam.forEach(f => { msg += `• ${f.nome}: ${this._reais(f.valor)}\n`; });
      msg += `\n🧮 *Total:* ${this._reais(totalFaltam)}\n\nConfirmar?`;
      StateManager.salvarMultiplosCampos(from, { duplicataContexto: 'lote', loteSelecionado: faltam });
      Utils.enviarMenu(from, msg, [
        { id: 'btn_dev_prosseguir', title: '✅ Registrar' },
        { id: 'btn_menu',           title: '🔙 Voltar'   }
      ]);
      return;
    }

    // Todos os selecionados já devolveram → só registra se confirmar mesmo assim.
    msg += `\n\nTodos os selecionados já devolveram este mês. Deseja registrar assim mesmo?`;
    StateManager.salvarMultiplosCampos(from, { duplicataContexto: 'lote', loteSelecionado: selecionados });
    Utils.enviarMenu(from, msg, [
      { id: 'btn_dev_prosseguir', title: '✅ Sim, registrar' },
      { id: 'btn_menu',           title: '🔙 Voltar'         }
    ]);
  },

  /** Envia os dados de pagamento do lote e passa a aguardar o comprovante. */
  _enviarLoteEAguardar(from, selecionados) {
    const responsavel = OdooService.buscarDizimistaPorWhatsapp(from);
    if (!responsavel) return this._selecaoExpirada(from);

    if (this._enviarDadosPagamentoLote(from, responsavel, selecionados)) {
      StateManager.salvarMultiplosCampos(from, { devolucaoLote: selecionados });
      StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMPROVANTE_FAMILIA);
    }
  },

  /** Usuário confirmou registrar mesmo já tendo devolução no mês. */
  prosseguirAposAviso(from) {
    const contexto = StateManager.getCampo(from, 'duplicataContexto');

    if (contexto === 'lote') {
      const selecionados = StateManager.getCampo(from, 'loteSelecionado') || [];
      if (!selecionados.length) return this._selecaoExpirada(from);
      this._enviarLoteEAguardar(from, selecionados);
      return;
    }

    // Individual.
    const responsavel = OdooService.buscarDizimistaPorWhatsapp(from);
    if (!responsavel) {
      Utils.enviarComBotaoMenu(from, '❌ Cadastro não encontrado. Digite *menu*.');
      return;
    }
    if (this._enviarDadosPagamento(from, responsavel)) {
      StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMPROVANTE);
    }
  },

  /** Nome do mês/ano atual (ex.: "setembro/2026"). */
  _nomeMesAtual() {
    const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                   'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const d = new Date();
    return `${meses[d.getMonth()]}/${d.getFullYear()}`;
  },

  /**
   * Dados de pagamento para uma devolução em lote (vários membros, um PIX só).
   * @private
   */
  _enviarDadosPagamentoLote(from, responsavel, selecionados) {
    const comunidade = OdooService.buscarDadosPagamentoComunidade(responsavel);
    if (!comunidade || !comunidade.x_studio_chave_pix) {
      Utils.enviarSimples(from, '❌ Erro: dados de pagamento não configurados.\n\nEntre em contato com a secretaria.');
      return false;
    }

    const total = selecionados.reduce((s, f) => s + (f.valor || 0), 0);

    let msg = `━━━━━━━━━━━━━━━━━━━━\n💰 *DEVOLUÇÃO DA FAMÍLIA*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `Você vai devolver o dízimo de:\n`;
    selecionados.forEach(f => { msg += `• ${f.nome}: ${this._reais(f.valor)}\n`; });
    msg += `\n🧮 *Total:* ${this._reais(total)}\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n💳 *DADOS PARA PAGAMENTO*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (comunidade.x_studio_banco)         msg += `🏦 *Banco:* ${comunidade.x_studio_banco}\n\n`;
    if (comunidade.x_studio_titular_conta) msg += `👤 *Titular:* ${comunidade.x_studio_titular_conta}\n\n`;
    msg += `🔑 *Chave PIX:* \`${comunidade.x_studio_chave_pix}\`\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n📸 *Faça um único pagamento do total e envie o comprovante aqui.*\n\nAceito: imagem (foto) ou PDF.`;

    Utils.enviarSimples(from, msg);
    try {
      MediaService.enviarQrCode(from, comunidade.x_studio_chave_pix, total, comunidade.x_studio_titular_conta);
    } catch (e) {
      console.warn('⚠️ QR Code PIX (lote) não pôde ser gerado:', e.message);
    }
    return true;
  },

  _selecaoExpirada(from) {
    StateManager.limparDados(from);
    Utils.enviarComBotaoMenu(from, '⏱️ A seleção expirou. Toque em *Devolver dízimo* para recomeçar.');
  },

  /** Formata número em Real (R$ 1.234,56 → simples). */
  _reais(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  },

  /**
   * Rótulo amigável do status para o dizimista. O valor "Pendente" no Odoo é
   * status de CONFERÊNCIA (a secretaria ainda vai validar o comprovante), não de
   * "falta devolver" — por isso não mostramos "Pendente" cru ao usuário.
   */
  _rotuloStatus(status) {
    switch (status) {
      case 'Confirmado': return 'Status: Confirmada';
      case 'Rejeitado':  return 'Status: Não aceita — fale com a secretaria';
      default:           return 'Status: Em análise pela pastoral do dízimo';
    }
  },

  /** Formata 'yyyy-MM-dd' → 'dd/MM/yyyy'. Retorna '' se vazio/ inválido. */
  _formatarDataBr(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  },

  /** Monta as linhas "• dd/MM/yyyy — R$ x,yy" de uma lista de devoluções. */
  _listaDevolucoes(devs) {
    return (devs || []).map(d => {
      const data = this._formatarDataBr(d.data);
      return `• ${data ? data + ' — ' : ''}${this._reais(d.valor)}`;
    }).join('\n');
  },

  // ==========================================================================
  // HISTÓRICO
  // ==========================================================================

  /**
   * Histórico. Com 1 cadastro → direto. Com família (2+) → pergunta de quem
   * (Opção B: 2–3 → botões; 4+ → lista; SEM "Todos") e mostra o individual.
   */
  exibirHistorico(from) {
    let responsavel;
    try {
      responsavel = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      Utils.enviarComBotaoMenu(from, '⚠️ Instabilidade temporária. Tente novamente em instantes. 🙏');
      return;
    }
    if (!responsavel) {
      Utils.enviarSimples(from, '❌ Cadastro não encontrado.');
      return;
    }

    let familia;
    try { familia = OdooService.listarFamilia(responsavel.id); }
    catch (e) { familia = [responsavel]; }

    if (!familia || familia.length <= 1) {
      return this._mostrarHistoricoDe(from, responsavel.id, responsavel.x_name);
    }

    const familiaLeve = familia.map(f => ({ id: f.id, nome: f.x_name || '—' }));
    StateManager.salvarMultiplosCampos(from, { familiaHist: familiaLeve });
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_SELECAO_HISTORICO);

    // 2 pessoas → botões [A][B][🔙 Menu]. 3+ → lista (com linha "Menu"),
    // pois com 3 botões não sobra espaço para o "Voltar".
    if (familiaLeve.length <= 2) {
      Utils.enviarMenu(from, '📊 *De quem é o histórico?*',
        familiaLeve.map(f => ({ id: `hist_${f.id}`, title: f.nome.substring(0, 20) }))
          .concat([{ id: 'hist_menu', title: '🔙 Menu' }]));
      return;
    }
    const rows = familiaLeve.slice(0, 9).map((f, i) => ({
      id: `hist_${f.id}`, title: `${i + 1}. ${f.nome}`.substring(0, 24), description: ''
    }));
    rows.push({ id: 'hist_menu', title: '🔙 Menu', description: 'Voltar ao menu' });
    Utils.enviarLista(from, '📊 *De quem é o histórico?*', [{ title: 'Família', rows }], { textoBotao: 'Ver família' });
  },

  /** Escolha do membro para histórico (hist_<id>). */
  processarSelecaoHistorico(from, id) {
    if (id === 'hist_menu') {
      StateManager.limparDados(from);
      MenuHandler.menuPrincipal(from);
      return;
    }
    const familia = StateManager.getCampo(from, 'familiaHist') || [];
    const alvoId = parseInt(String(id).replace('hist_', ''), 10);
    const sel = familia.filter(f => f.id === alvoId)[0];
    if (!sel) return this._selecaoExpirada(from);
    StateManager.limparDados(from);
    this._mostrarHistoricoDe(from, sel.id, sel.nome);
  },

  /**
   * Exibe o histórico individual de um dizimista.
   * @private
   */
  _mostrarHistoricoDe(from, dizimistaId, nome) {
    Utils.enviarSimples(from, '📊 Buscando histórico...');

    const devolucoes = OdooService.buscarDevolucoesDizimista(dizimistaId, 10);

    if (!devolucoes || devolucoes.length === 0) {
      // BL-21: sem espera — a consulta ao Odoo acima já separa esta mensagem
      // do "Buscando histórico..." enviado antes dela.
      Utils.enviarMenu(from,
        `📭 *${nome}* ainda não tem devoluções registradas.`,
        [
          { id: 'btn_devolver_dizimo', title: '💰 Devolver dízimo' },
          { id: 'btn_menu',            title: '🔙 Menu'             }
        ]
      );
      return;
    }

    let mensagem = `📊 *HISTÓRICO DE DEVOLUÇÕES*\n\n`;
    mensagem += `*${nome}* — últimas ${devolucoes.length}:\n\n`;

    devolucoes.forEach((dev, index) => {
      const data   = Utils.formatarDataOdoo(dev.x_studio_data_da_devolucao);
      const valor  = Utils.formatarValor(dev.x_studio_value);
      const status = dev.x_studio_status || 'Pendente';
      const emoji  = status === 'Confirmado' ? '✅' : (status === 'Rejeitado' ? '❌' : '⏳');

      mensagem += `${emoji} *${data}* – ${valor}\n`;
      mensagem += `   ${this._rotuloStatus(status)}\n`;
      if (index < devolucoes.length - 1) mensagem += '\n';
    });

    mensagem += '\n━━━━━━━━━━━━━━━━━━━━\n🙏 Obrigado por sua fidelidade!\n';

    Utils.enviarSimples(from, mensagem);
    MenuHandler.menuPrincipal(from);
  },

  // ==========================================================================
  // DADOS DE PAGAMENTO (privado)
  // ==========================================================================

  /**
   * Monta e envia a mensagem com chave PIX e dados bancários.
   * @param {string} from       - Número do destinatário
   * @param {Object} dizimista  - Registro do dizimista no Odoo
   */
  _enviarDadosPagamento(from, dizimista) {
    const comunidade = OdooService.buscarDadosPagamentoComunidade(dizimista);

    if (!comunidade || !comunidade.x_studio_chave_pix) {
      Utils.enviarSimples(from,
        '❌ Erro: Dados de pagamento não configurados.\n\nEntre em contato com a secretaria.'
      );
      return false;
    }

    const nomeUsual    = dizimista.x_name;
    const valorMensal  = Utils.formatarValor(dizimista.x_studio_value);

    let mensagem = `━━━━━━━━━━━━━━━━━━━━\n`;
    mensagem    += `💰 *DEVOLUÇÃO DE DÍZIMO*\n`;
    mensagem    += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    mensagem    += `Olá, *${nomeUsual}*! 😊\n\n`;
    mensagem    += `Sua devolução mensal registrada é de *${valorMensal}*\n\n`;
    mensagem    += `💡 *Mas você pode contribuir com qualquer valor!*\n`;
    mensagem    += `Doe o que sentir confortável no momento. 💛\n\n`;
    mensagem    += `━━━━━━━━━━━━━━━━━━━━\n`;
    mensagem    += `💳 *DADOS PARA PAGAMENTO*\n`;
    mensagem    += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (comunidade.x_studio_banco)          mensagem += `🏦 *Banco:* ${comunidade.x_studio_banco}\n\n`;
    if (comunidade.x_studio_titular_conta)  mensagem += `👤 *Titular:* ${comunidade.x_studio_titular_conta}\n\n`;
    if (comunidade.x_studio_chave_pix)      mensagem += `🔑 *Chave PIX:* \`${comunidade.x_studio_chave_pix}\`\n\n`;

    mensagem += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    mensagem += `📸 *Após efetuar o pagamento, envie o comprovante aqui.*\n\n`;
    mensagem += `Aceito: imagem (foto) ou PDF.`;

    Utils.enviarSimples(from, mensagem);

    // Tentar enviar QR Code PIX via MediaService
    try {
      MediaService.enviarQrCode(from, comunidade.x_studio_chave_pix, dizimista.x_studio_value, comunidade.x_studio_titular_conta);
    } catch (e) {
      console.warn('⚠️ QR Code PIX não pôde ser gerado:', e.message);
    }

    return true;
  }

};