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
    
    try {
      const dizimista = OdooService.buscarDizimistaPorWhatsapp(from);
      console.log('🎯 [_tratarResultado] Dizimista:', dizimista ? dizimista.id : 'NULL');
      
      if (dizimista) {
        const tipoComprovante = resultado.tipo === 'pdf' ? 'pdf' : 'imagem';
        
        const devolucaoId = OdooService.registrarDevolucao(
          dizimista.id, 
          resultado.dados, 
          resultado.arquivoOriginalBase64,
          tipoComprovante
        );
        
        console.log('🎯 [_tratarResultado] ✅ Devolução registrada! ID:', devolucaoId);
      } else {
        console.error('🎯 [_tratarResultado] ❌ Dizimista não encontrado!');
      }
    } catch (e) {
      console.error('🎯 [_tratarResultado] ❌ ERRO ao registrar no Odoo:', e.message);
      console.error('🎯 [_tratarResultado] Stack:', e.stack);
      
      Utils.enviarSimples(from,
        '⚠️ Houve um problema ao registrar sua devolução.\n\n' +
        'Por favor, entre em contato com a secretaria informando:\n' +
        (dados.valor > 0 ? `• Valor: R$ ${dados.valor}\n` : '') +
        (dados.data ? `• Data: ${dados.data}\n` : '') +
        '\nSeu comprovante foi recebido e será processado manualmente.'
      );
    }

    StateManager.limparDados(from);

    Utils.enviarComBotaoMenu(from,
      '✅ *Comprovante recebido com sucesso!*\n\n' +
      'Sua devolução foi registrada e será confirmada em breve.\n\n' +
      '🙏 Obrigado pela sua fidelidade! Deus abençoe!'
    );
  }
};