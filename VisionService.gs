/**
 * ============================================================================
 * VISIONSERVICE.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Integração com a Google Cloud Vision API.
 * Versão: 8.1 - Com tratamento de erros aprimorado
 */

const VisionService = {

  /**
   * Envia a imagem para a Vision API e retorna os dados extraídos.
   * @param {string} imagemBase64 - Imagem em base64 (sem prefixo data:)
   * @returns {Object|null} Dados estruturados ou null em caso de erro
   */
  analisarComprovante(imagemBase64) {
    console.log('🔍 [VisionService] Iniciando análise de comprovante...');
    
    // Validação de entrada
    if (!imagemBase64 || imagemBase64.length < 100) {
      console.error('❌ [VisionService] Imagem base64 inválida ou muito pequena');
      return null;
    }

    let cfg;
    try {
      cfg = getVisionConfig();
      console.log('✅ [VisionService] Configuração carregada');
    } catch (error) {
      console.error('❌ [VisionService] Erro ao carregar config:', error.message);
      return null;
    }

    const payload = {
      requests: [{
        image:    { content: imagemBase64 },
        features: [{ type: 'TEXT_DETECTION', maxResults: 1 }]
      }]
    };

    console.log('📤 [VisionService] Enviando requisição para Vision API...');

    try {
      const response = UrlFetchApp.fetch(
        `${cfg.ENDPOINT}?key=${cfg.API_KEY}`,
        {
          method:      'post',
          contentType: 'application/json',
          payload:     JSON.stringify(payload),
          muteHttpExceptions: true
        }
      );

      const statusCode = response.getResponseCode();
      console.log(`📥 [VisionService] Resposta recebida - Status: ${statusCode}`);

      if (statusCode !== 200) {
        const errorBody = response.getContentText();
        console.error('❌ [VisionService] Vision API error:', statusCode);
        console.error('❌ [VisionService] Body:', errorBody);
        return null;
      }

      const result = JSON.parse(response.getContentText());
      
      // Verificar se há erro na resposta
      if (result.responses?.[0]?.error) {
        console.error('❌ [VisionService] Erro na resposta da API:', result.responses[0].error);
        return null;
      }

      const textoCompleto = result.responses?.[0]?.fullTextAnnotation?.text || '';

      if (!textoCompleto || textoCompleto.trim().length === 0) {
        console.warn('⚠️ [VisionService] Nenhum texto detectado na imagem');
        return null;
      }

      console.log(`✅ [VisionService] Texto extraído (${textoCompleto.length} chars):`);
      console.log(textoCompleto.substring(0, 300) + '...');
      
      const dadosExtraidos = this._extrairDados(textoCompleto);
      console.log('📊 [VisionService] Dados extraídos:', JSON.stringify(dadosExtraidos, null, 2));
      
      return dadosExtraidos;

    } catch (error) {
      console.error('❌ [VisionService] Exceção durante chamada:', error.message);
      console.error('❌ [VisionService] Stack:', error.stack);
      return null;
    }
  },

  /**
   * Envia um PDF para a Vision API via files:annotate.
   * Endpoint correto para documentos PDF/TIFF (diferente de images:annotate).
   *
   * @param {string} pdfBase64 - PDF em base64 (sem prefixo data:)
   * @returns {Object|null} Dados estruturados ou null em caso de erro
   */
  analisarPDF(pdfBase64) {
    console.log('📄 [VisionService] Iniciando análise de PDF...');

    if (!pdfBase64 || pdfBase64.length < 100) {
      console.error('❌ [VisionService] PDF base64 inválido ou muito pequeno');
      return null;
    }

    let cfg;
    try {
      cfg = getVisionConfig();
    } catch (error) {
      console.error('❌ [VisionService] Erro ao carregar config:', error.message);
      return null;
    }

    const payload = {
      requests: [{
        inputConfig: {
          content:  pdfBase64,
          mimeType: 'application/pdf'
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        pages:    [1]
      }]
    };

    console.log('📤 [VisionService] Enviando PDF para Vision API (files:annotate)...');

    try {
      const response = UrlFetchApp.fetch(
        `${cfg.ENDPOINT_FILES}?key=${cfg.API_KEY}`,
        {
          method:      'post',
          contentType: 'application/json',
          payload:     JSON.stringify(payload),
          muteHttpExceptions: true
        }
      );

      const statusCode = response.getResponseCode();
      console.log(`📥 [VisionService] Resposta PDF - Status: ${statusCode}`);

      if (statusCode !== 200) {
        const errorBody = response.getContentText();
        console.error('❌ [VisionService] Vision API (files) error:', statusCode);
        console.error('❌ [VisionService] Body:', errorBody);
        return null;
      }

      const result = JSON.parse(response.getContentText());

      // Estrutura de files:annotate é aninhada um nível a mais:
      // responses[0].responses[0].fullTextAnnotation.text
      const pageResponse = result.responses?.[0]?.responses?.[0];

      if (pageResponse?.error) {
        console.error('❌ [VisionService] Erro na resposta (page):', pageResponse.error);
        return null;
      }

      const textoCompleto = pageResponse?.fullTextAnnotation?.text || '';

      if (!textoCompleto || textoCompleto.trim().length === 0) {
        console.warn('⚠️ [VisionService] Nenhum texto detectado no PDF');
        return null;
      }

      console.log(`✅ [VisionService] Texto extraído do PDF (${textoCompleto.length} chars):`);
      console.log(textoCompleto.substring(0, 300) + '...');

      const dadosExtraidos = this._extrairDados(textoCompleto);
      console.log('📊 [VisionService] Dados extraídos do PDF:', JSON.stringify(dadosExtraidos, null, 2));

      return dadosExtraidos;

    } catch (error) {
      console.error('❌ [VisionService] Exceção durante chamada (PDF):', error.message);
      console.error('❌ [VisionService] Stack:', error.stack);
      return null;
    }
  },

  /**
   * Extrai dados estruturados do texto bruto retornado pelo OCR.
   */
  _extrairDados(texto) {
    console.log('🔎 [VisionService] Extraindo dados do texto...');
    
    const dados = {
      valor:        this._extrairValor(texto),
      data:         this._extrairData(texto),
      chavePix:     this._extrairChavePix(texto),
      banco:        this._extrairBanco(texto),
      tipo:         this._extrairTipoTransacao(texto),
      textoCompleto: texto
    };
    
    console.log(`   Valor: ${dados.valor || 'não encontrado'}`);
    console.log(`   Data: ${dados.data || 'não encontrada'}`);
    console.log(`   Tipo: ${dados.tipo}`);
    console.log(`   Banco: ${dados.banco || 'não encontrado'}`);
    
    return dados;
  },

  _extrairValor(texto) {
    const padroes = [
      /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i,
      /valor[:\s]+R?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i,
      /(\d{1,3}(?:\.\d{3})*,\d{2})/
    ];

    for (const padrao of padroes) {
      const match = texto.match(padrao);
      if (match) {
        const valorStr = match[1].replace(/\./g, '').replace(',', '.');
        const valor = parseFloat(valorStr);
        if (!isNaN(valor) && valor > 0) {
          console.log(`   ✓ Valor encontrado: R$ ${valor}`);
          return valor;
        }
      }
    }
    console.log('   ✗ Valor não encontrado');
    return null;
  },

  _extrairData(texto) {
    const padroes = [
      /(\d{2}\/\d{2}\/\d{4})/,
      /(\d{4}-\d{2}-\d{2})/,
      /(\d{2})\s+de\s+\w+\s+de\s+(\d{4})/i
    ];

    for (const padrao of padroes) {
      const match = texto.match(padrao);
      if (match) {
        console.log(`   ✓ Data encontrada: ${match[0]}`);
        return match[0];
      }
    }
    console.log('   ✗ Data não encontrada');
    return null;
  },

  _extrairChavePix(texto) {
    const padroes = [
      /\+?\d{2}\s*\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/,
      /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
      /\d{3}\.\d{3}\.\d{3}-\d{2}/,
      /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/,
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    ];

    for (const padrao of padroes) {
      const match = texto.match(padrao);
      if (match) return match[0];
    }
    return null;
  },

  _extrairBanco(texto) {
    const bancos = [
      'Nubank', 'Bradesco', 'Itaú', 'Santander', 'Caixa', 'Banco do Brasil',
      'Inter', 'C6 Bank', 'BTG', 'Sicredi', 'Sicoob', 'Neon', 'PicPay',
      'Mercado Pago', 'PagBank', 'Original', 'Next', 'Safra', 'XP'
    ];

    for (const banco of bancos) {
      if (texto.toLowerCase().includes(banco.toLowerCase())) return banco;
    }
    return null;
  },

  _extrairTipoTransacao(texto) {
    const textoLower = texto.toLowerCase();
    if (textoLower.includes('pix'))           return 'PIX';
    if (textoLower.includes('transferência')) return 'TED/DOC';
    if (textoLower.includes('ted'))           return 'TED';
    if (textoLower.includes('doc'))           return 'DOC';
    if (textoLower.includes('boleto'))        return 'Boleto';
    return 'Desconhecido';
  },

  /**
   * Verifica se os dados extraídos caracterizam um comprovante de pagamento.
   */
  validarComprovante(dados) {
    console.log('✔️ [VisionService] Validando comprovante...');
    
    if (!dados) {
      console.log('   ❌ Sem dados para validar');
      return { ehComprovante: false, motivo: 'Sem dados', confianca: 0 };
    }

    let pontos = 0;
    const motivos = [];

    if (dados.valor && dados.valor > 0)    { pontos += 40; motivos.push('valor encontrado');        }
    if (dados.data)                         { pontos += 20; motivos.push('data encontrada');          }
    if (dados.tipo !== 'Desconhecido')      { pontos += 20; motivos.push(`tipo: ${dados.tipo}`);      }
    if (dados.banco)                        { pontos += 10; motivos.push(`banco: ${dados.banco}`);    }
    if (dados.chavePix)                     { pontos += 10; motivos.push('chave PIX identificada');   }

    const palavrasChave = ['comprovante', 'pagamento', 'transferência', 'pix', 'recebido', 'confirmado'];
    const textoLower = (dados.textoCompleto || '').toLowerCase();
    if (palavrasChave.some(p => textoLower.includes(p))) {
      pontos += 20;
      motivos.push('palavras-chave encontradas');
    }

    const ehComprovante = pontos >= 50;

    console.log(`📊 [VisionService] Validação: ${pontos} pontos → ${ehComprovante ? '✅ VÁLIDO' : '❌ INVÁLIDO'}`);
    console.log(`   Motivos: ${motivos.join(', ')}`);

    return {
      ehComprovante,
      motivo:    motivos.join(', '),
      confianca: pontos
    };
  }

};