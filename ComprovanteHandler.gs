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

  processar(from, arquivo) {
    console.log('📄 Iniciando processamento de comprovante de:', from);

    const tipo = this._detectarTipo(arquivo);

    if (!tipo) {
      Utils.enviarSimples(from,
        '❌ *Tipo de arquivo não suportado*\n\n' +
        'Envie:\n• Foto (JPG, PNG, WebP)\n• PDF\n\nDigite *menu* para voltar.'
      );
      return;
    }

    Utils.enviarSimples(from, `⏳ *Analisando ${tipo === 'pdf' ? 'PDF' : 'comprovante'}...*\n\nAguarde um momento.`);

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

        // Fallback: Vision API não conseguiu extrair texto do PDF
        // (protegido, escaneado com qualidade muito baixa, corrompido)
        if (!analise) {
          console.warn('⚠️ Vision API não extraiu dados do PDF — ativando fallback');
          resultado.sucesso = true;
          resultado.ehComprovante = true;
          resultado.dados = {
            valor: 0,
            data: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy'),
            tipo: 'PDF',
            banco: 'A confirmar',
            chavePix: null,
            textoCompleto: 'PDF recebido - análise manual necessária'
          };
          resultado.validacao = {
            ehComprovante: true,
            motivo: 'PDF aceito sem análise automática',
            confianca: 50
          };
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
  // TRATAMENTO DO RESULTADO
  // ==========================================================================

  _tratarResultado(from, resultado) {
    console.log('🎯 [_tratarResultado] Iniciando...');
    
    if (!resultado.sucesso) {
      console.log('🎯 [_tratarResultado] FALHOU - Não teve sucesso');
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

    // ===== VERIFICAR SE É PDF EM MODO FALLBACK =====
    const isPdfFallback = resultado.dados.tipo === 'PDF' && resultado.dados.valor === 0;
    const dados = resultado.dados;

    // ===== EXIBIR DADOS EXTRAÍDOS =====
    console.log('🎯 [_tratarResultado] Comprovante VÁLIDO');
    
    if (isPdfFallback) {
      Utils.enviarSimples(from,
        '📄 *Comprovante PDF recebido!*\n\n' +
        'Não consegui extrair os dados automaticamente deste PDF.\n\n' +
        'Os dados serão confirmados manualmente pela secretaria.\n\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        '⏳ Registrando sua devolução...'
      );
    } else {
      let mensagemDados = '✅ *Comprovante analisado com sucesso!*\n\n';
      mensagemDados += '━━━━━━━━━━━━━━━━━━━━\n';
      mensagemDados += '📊 *DADOS IDENTIFICADOS*\n';
      mensagemDados += '━━━━━━━━━━━━━━━━━━━━\n\n';
      
      if (dados.valor && dados.valor > 0) {
        mensagemDados += `💰 *Valor:* R$ ${dados.valor.toFixed(2).replace('.', ',')}\n`;
      } else {
        mensagemDados += `💰 *Valor:* Não identificado\n`;
      }
      
      if (dados.data) {
        mensagemDados += `📅 *Data:* ${dados.data}\n`;
      } else {
        mensagemDados += `📅 *Data:* Não identificada\n`;
      }
      
      if (dados.tipo && dados.tipo !== 'Desconhecido') {
        mensagemDados += `💳 *Tipo:* ${dados.tipo}\n`;
      }
      
      if (dados.banco) {
        mensagemDados += `🏦 *Banco:* ${dados.banco}\n`;
      }
      
      if (dados.chavePix) {
        mensagemDados += `🔑 *Chave PIX:* ${dados.chavePix}\n`;
      }
      
      mensagemDados += '\n━━━━━━━━━━━━━━━━━━━━\n';
      mensagemDados += `⏳ Registrando sua devolução...`;
      
      Utils.enviarSimples(from, mensagemDados);
    }
    
    Utilities.sleep(2000);

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

        const observacao = conferido ? '' :
          (conf.motivo === 'divergente'
            ? '⚠️ CONFERIR: chave do comprovante diverge da comunidade'
            : '⚠️ CONFERIR: chave não identificada no comprovante');

        devolucaoId = OdooService.registrarDevolucao(
          dizimista.id,
          resultado.dados,
          resultado.arquivoOriginalBase64,
          tipoComprovante,
          observacao
        );
        console.log('🎯 [_tratarResultado] ✅ Devolução registrada! ID:', devolucaoId);
      } catch (e) {
        erroOdoo = true;
        console.error('🎯 [_tratarResultado] ❌ ERRO ao registrar no Odoo:', e.message);
        console.error('🎯 [_tratarResultado] Stack:', e.stack);
      }
    }

    // ===== RESPOSTA FINAL — honesta quanto ao que realmente aconteceu =====
    const dadosResumo =
      (dados.valor > 0 ? `• Valor: R$ ${dados.valor.toFixed(2).replace('.', ',')}\n` : '') +
      (dados.data     ? `• Data: ${dados.data}\n` : '');

    // 1) Sucesso real: devolução criada. Encerra a sessão.
    if (devolucaoId) {
      StateManager.limparDados(from);
      if (conferido) {
        // Chave do comprovante confere com a da comunidade.
        Utils.enviarComBotaoMenu(from,
          '✅ *Comprovante recebido com sucesso!*\n\n' +
          'Sua devolução foi registrada e será confirmada em breve.\n\n' +
          '🙏 Obrigado pela sua fidelidade! Deus abençoe!'
        );
      } else {
        // BL-26: chave divergente ou não identificada — não prometer confirmação.
        Utils.enviarComBotaoMenu(from,
          '✅ *Comprovante recebido!*\n\n' +
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
        '⚠️ *Não consegui registrar sua devolução agora.*\n\n' +
        'Estamos com uma instabilidade temporária, então seu comprovante ' +
        '*ainda não foi registrado*. Por favor, *reenvie o comprovante* em ' +
        'alguns minutos ou fale com a secretaria' +
        (dadosResumo ? ' informando:\n' + dadosResumo : '.') +
        '\nPeço desculpas pelo transtorno. 🙏'
      );
      return;
    }

    // 3) Número realmente não cadastrado. Nada foi registrado; volta ao menu.
    StateManager.limparDados(from);
    Utils.enviarMenu(from,
      '⚠️ *Não encontrei seu cadastro* para registrar a devolução.\n\n' +
      'Por isso, seu comprovante *ainda não foi registrado*. Para concluir, ' +
      'faça seu cadastro como dizimista ou entre em contato com a secretaria.',
      [
        { id: 'btn_ser_dizimista', title: '🙏 Ser Dizimista' },
        { id: 'btn_menu',          title: '🔙 Menu' }
      ]
    );
  }
};