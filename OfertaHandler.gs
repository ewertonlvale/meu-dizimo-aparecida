/**
 * ============================================================================
 * OFERTAHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * BL-41 — Oferta: contribuição avulsa, **sem exigir cadastro**.
 *
 * O QUE A DIFERENCIA DO DÍZIMO
 *   - Não tem valor mensal cadastrado: a pessoa informa.
 *   - Não tem comunidade derivada do cadastro: a pessoa escolhe (ou, se for
 *     dizimista, já vem a dela).
 *   - Pode vir de quem o bot nunca viu. É o primeiro fluxo do projeto que não
 *     passa por `x_dizimista` — o registro guarda a comunidade diretamente e o
 *     telefone em `x_studio_telefone_ofertante`.
 *
 * O QUE ELA COMPARTILHA
 *   Dali em diante é igual: card de pagamento do BL-40, comprovante, OCR e a
 *   mesma gravação em `x_devolucao`, só que com `tipo = 'oferta'`.
 *
 * Versão: 1.0
 * Data: Setembro 2026
 */

const OfertaHandler = {

  /** Valores oferecidos em botão. Cobrir os casos comuns evita digitação. */
  VALORES_RAPIDOS: [10, 20],

  // ==========================================================================
  // ENTRADA
  // ==========================================================================

  /**
   * Ponto de entrada do botão "🎁 Oferta". Vale para cadastrado e não cadastrado.
   */
  iniciar(from) {
    StateManager.limparDados(from);

    let dizimista = null;
    try {
      dizimista = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      // Sem cadastro conhecido o fluxo segue igual — só perde o atalho da
      // comunidade. Oferta não depende de estar cadastrado.
      console.warn('⚠️ [Oferta] Odoo indisponível na identificação:', e.message);
    }

    const rel = dizimista && dizimista.x_studio_comunidade;
    const comunidadeId = Array.isArray(rel) ? rel[0] : rel;

    // A comunidade é sempre ESCOLHIDA, nunca pré-selecionada.
    //
    // A pessoa pertence a uma comunidade, mas pode ofertar para outra — numa
    // festa, numa capela que visitou, numa obra específica. E como é a
    // comunidade que decide para onde o dinheiro vai, deixar uma marcada
    // convida a passar batido. A do cadastro fica guardada só para aparecer
    // como "Sua comunidade" na lista da conversa — marcação, não seleção.
    if (comunidadeId) {
      StateManager.salvarMultiplosCampos(from, {
        ofertaComunidadeId:   comunidadeId,
        ofertaComunidadeNome: Array.isArray(rel) ? rel[1] : '',
        ofertaNome:           dizimista.x_name || '',
        ofertaDizimistaId:    dizimista.id
      });
    }

    // BL-41 (A7/A8): o formulário resolve comunidade, nome e valor numa
    // submissão — três perguntas da conversa viram uma mensagem. Para quem é
    // dizimista, comunidade e nome já chegam preenchidos e sobra conferir.
    //
    // Devolve false com o interruptor desligado, sem FLOW_ID_OFERTA, sem
    // comunidade ativa ou se a Meta recusar. Em todos esses casos a conversa
    // abaixo continua valendo: ela NÃO é legado esperando remoção.
    if (FlowHandler.enviarFlowOferta(from, {
          nomePadrao: (dizimista && dizimista.x_name) || ''
        })) {
      console.log(`🎁 [Oferta] ${from} recebeu o formulário — conversa em espera`);
      return;
    }

    this._pedirComunidade(from);
  },

  /**
   * Manda o pagamento com o que já está na sessão. É por aqui que o
   * `FlowHandler` entra depois de o formulário devolver comunidade e valor.
   */
  enviarPagamentoDaSessao(from) {
    const valor = StateManager.getCampo(from, 'ofertaValor');
    if (!valor) return this._pedirValor(from);
    this._enviarPagamento(from, valor);
  },

  // ==========================================================================
  // COMUNIDADE
  // ==========================================================================

  /** @private */
  _pedirComunidade(from, pagina = 0) {
    let comunidades = [];
    try {
      comunidades = OdooService.listarComunidades() || [];
    } catch (e) {
      console.error('❌ [Oferta] Falha ao listar comunidades:', e.message);
    }

    if (!comunidades.length) {
      // Sem comunidade não há para onde mandar o dinheiro. Melhor dizer isso
      // agora do que depois de a pessoa informar o valor.
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui carregar as comunidades agora.*\n\n' +
        'Tente de novo em alguns minutos, ou fale com a secretaria. 🙏'
      );
      return;
    }

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMUNIDADE_OFERTA);

    // A comunidade do dizimista fica marcada, mas a lista traz todas: ele pode
    // ofertar para outra.
    const daPessoa = StateManager.getCampo(from, 'ofertaComunidadeId');

    // BL-84: paginada. O `slice(0, 9)` fazia a 10ª comunidade em diante sumir
    // da oferta — sem aviso, e sem jeito de ofertar para ela pela conversa.
    // Até 10 cabem numa lista; acima disso, 9 por página e a décima avança.
    const resto = comunidades.slice(pagina * 9);
    const linha = c => ({
      id:          `ofc_${c.id}`,
      title:       String(c.x_name || '').substring(0, 24),
      description: (daPessoa && c.id === daPessoa) ? 'Sua comunidade' : ''
    });
    const rows = resto.length <= 10
      ? resto.map(linha)
      : resto.slice(0, 9).map(linha).concat([{
          id: `ofc_pag_${pagina + 1}`, title: '➡️ Mais comunidades', description: `Mais ${resto.length - 9}`
        }]);

    Utils.enviarLista(from,
      '🎁 *Oferta*\n\nPara qual comunidade é a sua oferta?',
      [{ title: 'Comunidades', rows }],
      { textoBotao: 'Escolher' }
    );
  },

  /** Toque num item da lista de comunidades (`ofc_<id>`). */
  processarComunidade(from, itemId, itemTitle) {
    // BL-84: a linha "Mais comunidades" da lista paginada.
    if (String(itemId).indexOf('ofc_pag_') === 0) {
      return this._pedirComunidade(from, parseInt(String(itemId).replace('ofc_pag_', ''), 10) || 0);
    }
    const id = parseInt(String(itemId).replace('ofc_', ''), 10);
    if (!id) return this.iniciar(from);

    StateManager.salvarMultiplosCampos(from, {
      ofertaComunidadeId:   id,
      ofertaComunidadeNome: itemTitle || ''
    });

    // Quem é cadastrado já tem nome; quem não é precisa informar, senão a
    // oferta chega à secretaria como um telefone solto.
    if (!StateManager.getCampo(from, 'ofertaNome')) return this._pedirNome(from);
    this._pedirValor(from);
  },

  /** @private */
  _pedirNome(from) {
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_NOME_OFERTA);
    Utils.enviarSimples(from,
      '🎁 *Oferta*\n\nComo você se chama?\n\n' +
      '_Para a secretaria saber de quem foi a oferta._'
    );
  },

  /** Nome digitado, enquanto em AGUARDANDO_NOME_OFERTA. */
  processarNome(from, texto) {
    const nome = String(texto || '').trim();
    if (nome.length < 2) {
      Utils.enviarSimples(from, '❌ Não entendi. Digite seu nome, por favor.');
      return;
    }
    StateManager.salvarMultiplosCampos(from, { ofertaNome: nome.substring(0, 60) });
    this._pedirValor(from);
  },

  // ==========================================================================
  // VALOR
  // ==========================================================================

  /** @private */
  _pedirValor(from) {
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_VALOR_OFERTA);

    const botoes = this.VALORES_RAPIDOS
      .map(v => ({ id: `ofv_${v}`, title: `R$ ${v},00` }))
      .concat([{ id: 'ofv_outro', title: '✏️ Outro valor' }]);

    const comunidade = StateManager.getCampo(from, 'ofertaComunidadeNome');

    Utils.enviarMenu(from,
      '🎁 *Oferta*' + (comunidade ? `\nComunidade: *${comunidade}*` : '') +
      '\n\nQual o valor da sua oferta?',
      botoes
    );
  },

  /** Toque num botão de valor (`ofv_10`, `ofv_20`, `ofv_outro`). */
  processarBotaoValor(from, botaoId) {
    if (botaoId === 'ofv_outro') {
      Utils.enviarSimples(from, '✏️ Digite o valor da oferta.\n\n_Exemplo: 35 ou 35,50_');
      return;   // segue em AGUARDANDO_VALOR_OFERTA, agora esperando texto
    }

    const valor = parseFloat(String(botaoId).replace('ofv_', ''));
    if (!valor) return this._pedirValor(from);
    this._registrarValorESeguir(from, valor);
  },

  /** Valor digitado, enquanto em AGUARDANDO_VALOR_OFERTA. */
  processarValorDigitado(from, texto) {
    const valor = Utils.parseValorBR(texto);

    if (!valor || valor <= 0) {
      Utils.enviarSimples(from,
        '❌ Não entendi o valor.\n\nDigite só o número. _Exemplo: 35 ou 35,50_');
      return;
    }

    this._registrarValorESeguir(from, valor);
  },

  /** @private */
  _registrarValorESeguir(from, valor) {
    StateManager.salvarMultiplosCampos(from, { ofertaValor: valor });
    this._enviarPagamento(from, valor);
  },

  // ==========================================================================
  // PAGAMENTO
  // ==========================================================================

  /** @private */
  _enviarPagamento(from, valor) {
    const comunidadeId = StateManager.getCampo(from, 'ofertaComunidadeId');
    if (!comunidadeId) return this._pedirComunidade(from);

    let comunidade = null;
    try {
      // `buscarDadosPagamentoComunidade` espera um dizimista; aqui a comunidade
      // é conhecida direto, então monta-se o mínimo que ela lê.
      comunidade = OdooService.buscarDadosPagamentoComunidade(
        { x_studio_comunidade: [comunidadeId] }
      );
    } catch (e) {
      console.error('❌ [Oferta] Falha ao buscar dados de pagamento:', e.message);
    }

    if (!comunidade || !comunidade.x_studio_chave_pix) {
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Esta comunidade ainda não tem chave PIX cadastrada.*\n\n' +
        'Fale com a secretaria para concluir sua oferta. 🙏'
      );
      return;
    }

    let msg = '━━━━━━━━━━━━━━━━━━━━\n🎁 *OFERTA*\n━━━━━━━━━━━━━━━━━━━━\n\n';
    const quem = StateManager.getCampo(from, 'ofertaNome');
    if (quem) msg += `Ofertante: *${quem}*\n`;
    msg += `Comunidade: *${comunidade.x_name || StateManager.getCampo(from, 'ofertaComunidadeNome') || '—'}*\n`;
    msg += `Valor: *${Utils.formatarValor(valor)}*\n\n`;
    msg += 'Que Deus abençoe sua generosidade! 💛\n\n';
    msg += '━━━━━━━━━━━━━━━━━━━━\n💳 *DADOS PARA PAGAMENTO*\n━━━━━━━━━━━━━━━━━━━━\n\n';
    if (comunidade.x_studio_banco)         msg += `🏦 *Banco:* ${comunidade.x_studio_banco}\n\n`;
    if (comunidade.x_studio_titular_conta) msg += `👤 *Titular:* ${comunidade.x_studio_titular_conta}\n\n`;
    msg += `🔑 *Chave PIX:* \`${comunidade.x_studio_chave_pix}\`\n\n`;
    msg += '━━━━━━━━━━━━━━━━━━━━\n\n📸 *Após pagar, envie o comprovante aqui.*\n\nAceito: imagem (foto) ou PDF.';

    // Mesmo caminho do dízimo (BL-40): card nativo, com o copia e cola como reserva.
    const referencia = `oferta-${comunidadeId}-${Date.now()}`;
    let enviou = false;
    try {
      enviou = MediaService.enviarCardPix(from, comunidade, valor, msg, referencia);
    } catch (e) {
      console.warn('⚠️ [Oferta] Card PIX falhou:', e.message);
    }

    if (!enviou) {
      try {
        enviou = MediaService.enviarPixCopiaECola(from, comunidade.x_studio_chave_pix, valor,
          comunidade.x_studio_titular_conta, undefined, msg);
      } catch (e) {
        console.warn('⚠️ [Oferta] copia e cola também falhou:', e.message);
      }
    }
    if (!enviou) Utils.enviarSimples(from, msg);

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMPROVANTE_OFERTA);
  }
};
