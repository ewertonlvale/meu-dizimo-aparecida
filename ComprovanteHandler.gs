/**
 * ============================================================================
 * COMPROVANTEHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Processa comprovantes de pagamento enviados pelo usuário (imagem ou PDF).
 *
 * Fluxo:
 *   1. Receber arquivo (imagem ou documento) do Router
 *   2. Detectar tipo (imagem / PDF)
 *   3. Baixar arquivo via MediaService
 *   4. Analisar conteúdo via VisionService (OCR)
 *      - Imagem → VisionService.analisarComprovante  (images:annotate)
 *      - PDF    → VisionService.analisarPDF           (files:annotate)
 *   5. Validar se é comprovante legítimo
 *   6. Registrar devolução no Odoo via OdooService
 *   7. Responder ao usuário
 *
 * Versão: 11.0  (PDF nativo via Vision API — removido _converterPdfParaImagem)
 * Data: Fevereiro 2026
 */

const ComprovanteHandler = {

  // ==========================================================================
  // PONTO DE ENTRADA ÚNICO
  // ==========================================================================

  /**
   * @param {string} from
   * @param {Object} arquivo
   * @param {string} [messageId] - `id` da mensagem recebida, para o indicador
   *   de "digitando" (BL-37). Sem ele, o aviso de progresso volta a ser texto.
   */
  processar(from, arquivo, messageId) {
    console.log('📄 Iniciando processamento de comprovante de:', from);

    const tipo = this._detectarTipo(arquivo);

    if (!tipo) {
      Utils.enviarSimples(from,
        '❌ *Tipo de arquivo não suportado*\n\n' +
        'Envie:\n• Foto (JPG, PNG, WebP)\n• PDF\n\nDigite *menu* para voltar.'
      );
      return;
    }

    // BL-37: o "⏳ Analisando comprovante..." era uma mensagem cobrada para
    // dizer "estou trabalhando". O indicador de digitação diz o mesmo de graça
    // — e melhor, porque é um balão vivo em vez de uma linha parada. Só quando
    // ele não sai é que o texto volta: o OCR leva segundos, e silêncio total
    // parece travamento.
    if (!Utils.sinalizarProcessando(messageId)) {
      Utils.enviarSimples(from,
        `⏳ *Analisando ${tipo === 'pdf' ? 'PDF' : 'comprovante'}...*\n\nAguarde um momento.`);
    }

    const resultado = this._processarArquivo(from, arquivo, tipo);
    this._tratarResultado(from, resultado);
  },

  // ==========================================================================
  // DETECÇÃO DE TIPO
  // ==========================================================================

  _detectarTipo(arquivo) {
    const mime = arquivo.mime_type || '';

    if (mime.startsWith('image/'))                       return 'imagem';
    if (mime === 'application/pdf')                      return 'pdf';
    if (arquivo.filename?.toLowerCase().endsWith('.pdf')) return 'pdf';
    if (Object.prototype.hasOwnProperty.call(arquivo, 'sha256')) return 'imagem';

    return null;
  },

  // ==========================================================================
  // PROCESSAMENTO
  // ==========================================================================

  _processarArquivo(from, arquivo, tipo) {
    const resultado = {
      sucesso: false,
      ehComprovante: false,
      dados: null,
      validacao: null,
      erro: null,
      pdfIlegivel: false,
      tipo,
      arquivoOriginalBase64: null
    };

    try {
      // 1. Baixar arquivo
      const arquivoBaixado = MediaService.baixarArquivo(arquivo.id);
      if (!arquivoBaixado) {
        resultado.erro = 'Erro ao baixar arquivo';
        return resultado;
      }

      // 2. Guardar arquivo original
      resultado.arquivoOriginalBase64 = arquivoBaixado.base64;

      // 3. Analisar com Vision API (endpoint adequado ao tipo)
      let analise;

      if (tipo === 'imagem') {
        analise = VisionService.analisarComprovante(arquivoBaixado.base64);
      } else {
        // PDF: enviar direto via files:annotate (sem conversão)
        console.log('📄 Enviando PDF diretamente para Vision API...');
        analise = VisionService.analisarPDF(arquivoBaixado.base64);

        // BL-27: PDF sem texto extraível (protegido, escaneado ruim, corrompido
        // — ou que simplesmente não é um comprovante). Aceitar aqui criaria uma
        // devolução de R$ 0,00 sem chave para conferir, contornando a validação
        // de destinatário do BL-26. Pede reenvio em vez de registrar.
        if (!analise) {
          console.warn('⚠️ Vision API não extraiu texto do PDF — pedindo reenvio');
          resultado.pdfIlegivel = true;
          resultado.erro = 'PDF sem texto extraível';
          return resultado;
        }
      }

      if (!analise) {
        resultado.erro = 'Erro na análise do comprovante';
        return resultado;
      }

      // 4. Validar
      const validacao = VisionService.validarComprovante(analise);

      resultado.sucesso = true;
      resultado.ehComprovante = validacao.ehComprovante;
      resultado.dados = analise;
      resultado.validacao = validacao;

    } catch (error) {
      console.error('❌ Erro ao processar comprovante:', error);
      resultado.erro = error.message;
    }

    return resultado;
  },

  // ==========================================================================
  // CONFERÊNCIA DE CHAVE (BL-26)
  // ==========================================================================

  /**
   * Confere se a chave PIX extraída do comprovante corresponde à chave da
   * comunidade do dizimista.
   * @param {string|null} extraida - Chave lida do comprovante (VisionService)
   * @param {string|null} esperada - Chave PIX cadastrada na comunidade
   * @returns {{conferido: boolean, motivo: string}}
   *          motivo: 'ok' | 'divergente' | 'ausente' | 'sem_referencia'
   * @private
   */
  _conferirChave(extraida, esperada) {
    if (!esperada) return { conferido: false, motivo: 'sem_referencia' };
    if (!extraida) return { conferido: false, motivo: 'ausente' };

    // E-mail: compara em minúsculas. Demais tipos (CPF/CNPJ/telefone/aleatória):
    // compara só os dígitos, tolerando o DDI 55 via sufixo.
    const norm = k => {
      k = String(k).trim().toLowerCase();
      return k.indexOf('@') >= 0 ? k : k.replace(/\D/g, '');
    };
    const a = norm(extraida);
    const b = norm(esperada);
    if (!a || !b) return { conferido: false, motivo: 'ausente' };

    let iguais;
    if (a.indexOf('@') >= 0 || b.indexOf('@') >= 0) {
      iguais = a === b;
    } else {
      iguais = a === b ||
        (a.length >= 11 && b.length >= 11 && (a.endsWith(b) || b.endsWith(a)));
    }

    return { conferido: iguais, motivo: iguais ? 'ok' : 'divergente' };
  },

  // ==========================================================================
  // TRATAMENTO DO RESULTADO — FAMÍLIA (N devoluções)
  // ==========================================================================

  /**
   * Contexto de família: cria UMA devolução por membro selecionado (cada uma
   * com o valor mensal do membro e o MESMO comprovante anexado). A validação de
   * chave (BL-26) é feita uma vez, contra a comunidade do responsável.
   * @private
   */
  _tratarResultadoFamilia(from, resultado, lote, blocoDados) {
    console.log(`🎯 [Família] Registrando devolução em lote (${lote.length} membro(s))...`);

    let responsavel = null;
    let erroOdoo = false;
    try {
      responsavel = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      erroOdoo = true;
      console.error('❌ [Família] Erro ao buscar responsável:', e.message);
    }

    // Conferência de chave (uma vez, contra a comunidade do responsável).
    let conferido   = false;
    let conferencia = '';
    if (responsavel) {
      let chaveEsperada = null;
      try {
        const comunidade = OdooService.buscarDadosPagamentoComunidade(responsavel);
        chaveEsperada = comunidade && comunidade.x_studio_chave_pix;
      } catch (e) {
        console.warn('⚠️ [Família] Não obtive a chave da comunidade:', e.message);
      }
      const conf  = this._conferirChave(resultado.dados.chavePix, chaveEsperada);
      conferido   = conf.conferido;
      conferencia = conf.motivo;
    }

    // Cria uma devolução por membro (valor = valor do membro).
    const tipoComprovante = resultado.tipo === 'pdf' ? 'pdf' : 'imagem';
    const registrados = [];
    if (responsavel) {
      for (const m of lote) {
        try {
          const dadosMembro = {
            valor: m.valor || 0,
            data:  resultado.dados && resultado.dados.data,
            tipo:  resultado.dados && resultado.dados.tipo
          };
          const devId = OdooService.registrarDevolucao(
            m.id, dadosMembro, resultado.arquivoOriginalBase64, tipoComprovante, conferencia
          );
          if (devId) registrados.push(m.nome);
        } catch (e) {
          erroOdoo = true;
          console.error(`❌ [Família] Falha ao registrar membro id=${m.id} (${m.nome}): ${e.message}`);
        }
      }
    }

    // Sucesso (ao menos uma criada): encerra a sessão.
    if (registrados.length > 0) {
      StateManager.limparDados(from);
      const base  = `✅ *Comprovante recebido!*\n\n${blocoDados || ''}` +
                    `Registrei ${registrados.length} devolução(ões): ${registrados.join(', ')}.`;
      const fecho = '\n\n🙏 Obrigado pela sua fidelidade! Deus abençoe!';
      Utils.enviarComBotaoMenu(from, conferido
        ? `${base}\n\nSerá confirmada em breve.${fecho}`
        : `${base}\n\nPassará por *conferência da secretaria* antes de ser confirmada.${fecho}`);
      return;
    }

    // Falha (Odoo/instabilidade): MANTÉM o estado para o usuário reenviar.
    if (erroOdoo || !responsavel) {
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui registrar as devoluções agora.*\n\n' + (blocoDados || '') +
        'Seu comprovante foi recebido, mas houve uma falha ao salvar. ' +
        'Por favor, *reenvie o comprovante* em alguns minutos ou fale com a secretaria. 🙏'
      );
      return;
    }

    StateManager.limparDados(from);
    Utils.enviarComBotaoMenu(from, '⚠️ Não consegui registrar as devoluções. Tente novamente.');
  },

  /**
   * Comprovante de uma OFERTA (BL-41).
   *
   * Diferente do dízimo em dois pontos que importam:
   *   - pode não haver dizimista, e isso é normal — a comunidade vem da
   *     escolha da pessoa, e o telefone fica no registro para a secretaria
   *     conseguir falar com quem ofertou;
   *   - o valor informado prevalece sobre o que o OCR leu. A pessoa disse
   *     quanto ia ofertar; se o OCR discordar, quem erra é o OCR (BL-14), e
   *     não faz sentido gravar um valor que ninguém escolheu.
   * @private
   */
  _tratarResultadoOferta(from, resultado, blocoDados) {
    const comunidadeId = StateManager.getCampo(from, 'ofertaComunidadeId');
    const valorEscolhido = StateManager.getCampo(from, 'ofertaValor');
    const dizimistaId = StateManager.getCampo(from, 'ofertaDizimistaId') || null;

    const dados = Object.assign({}, resultado.dados);
    if (valorEscolhido) dados.valor = valorEscolhido;

    // O bloco exibido tem de refletir o que será GRAVADO. Montado antes desta
    // correção, ele mostraria o valor do OCR enquanto o Odoo receberia o valor
    // escolhido — a pessoa leria "R$ 50,00" num registro de R$ 20,00 e não teria
    // como saber qual dos dois vale.
    blocoDados = this._blocoDados(dados);

    let chaveEsperada = null;
    try {
      const com = OdooService.buscarDadosPagamentoComunidade({ x_studio_comunidade: [comunidadeId] });
      chaveEsperada = com && com.x_studio_chave_pix;
    } catch (e) {
      console.warn('⚠️ [Oferta] Não obtive a chave da comunidade:', e.message);
    }
    const conf = this._conferirChave(resultado.dados.chavePix, chaveEsperada);

    let id = null;
    try {
      id = OdooService.registrarDevolucao(
        dizimistaId, dados, resultado.arquivoOriginalBase64,
        resultado.tipo === 'pdf' ? 'pdf' : 'imagem', conf.motivo,
        { comunidadeId: comunidadeId, tipo: 'oferta', telefoneOfertante: from }
      );
    } catch (e) {
      console.error('❌ [Oferta] Falha ao registrar:', e.message);
    }

    if (!id) {
      // MANTÉM o estado, para a pessoa reenviar sem refazer o fluxo.
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui registrar sua oferta agora.*\n\n' + blocoDados +
        'Li o comprovante, mas houve uma falha ao salvar — ele *ainda não foi ' +
        'registrado*. Por favor, reenvie em alguns minutos ou fale com a ' +
        'secretaria informando os dados acima.\n\nPeço desculpas pelo transtorno. 🙏'
      );
      return;
    }

    StateManager.limparDados(from);
    Utils.enviarComBotaoMenu(from,
      '🎁 *Oferta recebida!*\n\n' + blocoDados +
      (conf.conferido
        ? 'Sua oferta foi registrada e será confirmada em breve.'
        : 'Sua oferta foi registrada e passará por *conferência da secretaria*.') +
      '\n\n🙏 Que Deus abençoe sua generosidade!'
    );
  },

  /**
   * Monta o resumo do que o OCR leu. Vai prefixado à mensagem de resultado
   * (BL-37) — não é enviado por conta própria.
   * @private
   */
  _blocoDados(dados) {
    let t = '━━━━━━━━━━━━━━━━━━━━\n📊 *DADOS IDENTIFICADOS*\n━━━━━━━━━━━━━━━━━━━━\n\n';

    t += (dados.valor && dados.valor > 0)
      ? `💰 *Valor:* ${Utils.formatarValor(dados.valor)}\n`
      : '💰 *Valor:* Não identificado\n';

    t += dados.data ? `📅 *Data:* ${dados.data}\n` : '📅 *Data:* Não identificada\n';

    if (dados.tipo && dados.tipo !== 'Desconhecido') t += `💳 *Tipo:* ${dados.tipo}\n`;
    if (dados.banco)    t += `🏦 *Banco:* ${dados.banco}\n`;
    if (dados.chavePix) t += `🔑 *Chave PIX:* ${dados.chavePix}\n`;

    return t + '\n━━━━━━━━━━━━━━━━━━━━\n\n';
  },

  // ==========================================================================
  // TRATAMENTO DO RESULTADO
  // ==========================================================================

  _tratarResultado(from, resultado) {
    console.log('🎯 [_tratarResultado] Iniciando...');
    
    if (!resultado.sucesso) {
      console.log('🎯 [_tratarResultado] FALHOU - Não teve sucesso');

      // BL-27: PDF ilegível — mantém o estado AGUARDANDO_COMPROVANTE para o
      // usuário reenviar, e deixa claro que nada foi registrado.
      if (resultado.pdfIlegivel) {
        Utils.enviarMenu(from,
          '📄 *Não consegui ler este PDF*\n\n' +
          'Recebi o arquivo, mas não consegui extrair os dados dele — por isso ' +
          'sua devolução *ainda não foi registrada*.\n\n' +
          'Por favor, envie:\n' +
          '• Uma *foto* (ou print) do comprovante, ou\n' +
          '• O PDF original do aplicativo do banco, sem senha\n\n' +
          'Se o problema continuar, fale com a secretaria. 🙏',
          [{ id: 'btn_menu', title: '🔙 Menu' }]
        );
        return;
      }

      MenuHandler.erro(from,
        `Não consegui processar o comprovante.\n\n_Motivo: ${resultado.erro || 'Erro desconhecido'}_\n\n` +
        'Tente novamente ou entre em contato com a secretaria.'
      );
      return;
    }

    if (!resultado.ehComprovante) {
      console.log('🎯 [_tratarResultado] FALHOU - Não é comprovante válido');
      Utils.enviarMenu(from,
        '🤔 Não identifiquei este arquivo como um comprovante de pagamento.\n\n' +
        'Por favor, envie o comprovante do PIX ou transferência.',
        [{ id: 'btn_menu', title: '🔙 Menu' }]
      );
      return;
    }

    const dados = resultado.dados;

    console.log('🎯 [_tratarResultado] Comprovante VÁLIDO');

    // BL-37: os dados extraídos NÃO são mais uma mensagem própria.
    //
    // Eram enviados aqui, seguidos de "⏳ Registrando sua devolução...", e logo
    // depois vinha o resultado — que repetia valor e data. Duas mensagens
    // cobradas para o mesmo conteúdo, separadas por alguns segundos de Odoo.
    // Agora o bloco vai NA mensagem de resultado, que sai de qualquer forma.
    //
    // A pessoa continua vendo o que o OCR leu, que é o que importa: a extração
    // de valor é reconhecidamente frágil (BL-14), e é olhando esse bloco que
    // alguém percebe um valor errado. Só vê junto com o desfecho, em vez de
    // antes dele.
    const blocoDados = this._blocoDados(dados);

    // ===== CONTEXTO DE OFERTA (BL-41) =====
    // Precisa vir ANTES da busca por dizimista: a oferta pode ser de quem o bot
    // nunca viu, e o caminho normal responderia "não encontrei seu cadastro" —
    // depois de a pessoa já ter pagado.
    if (StateManager.getCampo(from, 'ofertaComunidadeId')) {
      return this._tratarResultadoOferta(from, resultado, blocoDados);
    }

    // ===== CONTEXTO DE FAMÍLIA: uma devolução por membro selecionado =====
    const lote = StateManager.getCampo(from, 'devolucaoLote');
    if (lote && lote.length) {
      return this._tratarResultadoFamilia(from, resultado, lote, blocoDados);
    }

    // ===== REGISTRAR NO ODOO =====
    console.log('🎯 [_tratarResultado] Registrando no Odoo...');

    // Três desfechos distintos — nunca declarar sucesso sem registro real:
    //   devolucaoId != null          → devolução criada com sucesso
    //   erroOdoo === true            → Odoo indisponível/falhou (nada gravado)
    //   dizimista == null sem erro   → número realmente não cadastrado
    let devolucaoId = null;
    let dizimista   = null;
    let erroOdoo    = false;
    let conferido   = false;   // BL-26: chave do comprovante confere com a da comunidade?

    try {
      dizimista = OdooService.buscarDizimistaPorWhatsapp(from);
      console.log('🎯 [_tratarResultado] Dizimista:', dizimista ? dizimista.id : 'NULL');
    } catch (e) {
      erroOdoo = true;
      console.error('🎯 [_tratarResultado] ❌ ERRO ao buscar dizimista no Odoo:', e.message);
      console.error('🎯 [_tratarResultado] Stack:', e.stack);
    }

    if (dizimista) {
      try {
        const tipoComprovante = resultado.tipo === 'pdf' ? 'pdf' : 'imagem';

        // BL-26: conferir se o comprovante foi feito para a chave PIX da comunidade.
        // Se não bater (ou não houver chave legível), registra mesmo assim, porém
        // marcado para conferência manual — nunca confirmamos como verificado.
        let chaveEsperada = null;
        try {
          const comunidade = OdooService.buscarDadosPagamentoComunidade(dizimista);
          chaveEsperada = comunidade && comunidade.x_studio_chave_pix;
        } catch (eCom) {
          console.warn('⚠️ [_tratarResultado] Não obtive a chave da comunidade:', eCom.message);
        }

        const conf = this._conferirChave(resultado.dados.chavePix, chaveEsperada);
        conferido = conf.conferido;
        console.log(`🎯 [_tratarResultado] Conferência de chave: ${conferido ? 'OK' : 'PENDENTE'} (${conf.motivo})`);

        devolucaoId = OdooService.registrarDevolucao(
          dizimista.id,
          resultado.dados,
          resultado.arquivoOriginalBase64,
          tipoComprovante,
          conf.motivo
        );
        console.log('🎯 [_tratarResultado] ✅ Devolução registrada! ID:', devolucaoId);
      } catch (e) {
        erroOdoo = true;
        console.error('🎯 [_tratarResultado] ❌ ERRO ao registrar no Odoo:', e.message);
        console.error('🎯 [_tratarResultado] Stack:', e.stack);
      }
    }

    // ===== RESPOSTA FINAL — honesta quanto ao que realmente aconteceu =====
    // BL-37: `blocoDados` entra em todos os desfechos. Antes havia um
    // `dadosResumo` reduzido só para o caso de falha, e o bloco completo ia
    // numa mensagem separada — dois formatos do mesmo conteúdo.

    // 1) Sucesso real: devolução criada. Encerra a sessão.
    if (devolucaoId) {
      StateManager.limparDados(from);
      if (conferido) {
        // Chave do comprovante confere com a da comunidade.
        Utils.enviarComBotaoMenu(from,
          '✅ *Comprovante recebido com sucesso!*\n\n' + blocoDados +
          'Sua devolução foi registrada e será confirmada em breve.\n\n' +
          '🙏 Obrigado pela sua fidelidade! Deus abençoe!'
        );
      } else {
        // BL-26: chave divergente ou não identificada — não prometer confirmação.
        Utils.enviarComBotaoMenu(from,
          '✅ *Comprovante recebido!*\n\n' + blocoDados +
          'Sua devolução foi registrada e passará por *conferência da secretaria* ' +
          'antes de ser confirmada.\n\n' +
          '🙏 Obrigado pela sua fidelidade! Deus abençoe!'
        );
      }
      return;
    }

    // 2) Falha transitória (Odoo indisponível). MANTÉM o estado
    //    AGUARDANDO_COMPROVANTE para o usuário reenviar sem refazer o fluxo.
    if (erroOdoo) {
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui registrar sua devolução agora.*\n\n' + blocoDados +
        'Li o comprovante, mas estamos com uma instabilidade temporária — então ' +
        'ele *ainda não foi registrado*. Por favor, *reenvie o comprovante* em ' +
        'alguns minutos, ou fale com a secretaria informando os dados acima.\n\n' +
        'Peço desculpas pelo transtorno. 🙏'
      );
      return;
    }

    // 3) Número realmente não cadastrado. Nada foi registrado; volta ao menu.
    StateManager.limparDados(from);
    Utils.enviarMenu(from,
      '⚠️ *Não encontrei seu cadastro* para registrar a devolução.\n\n' + blocoDados +
      'Por isso, seu comprovante *ainda não foi registrado*. Para concluir, ' +
      'faça seu cadastro como dizimista ou entre em contato com a secretaria.',
      [
        { id: 'btn_ser_dizimista', title: '🙏 Ser Dizimista' },
        { id: 'btn_menu',          title: '🔙 Menu' }
      ]
    );
  }
};