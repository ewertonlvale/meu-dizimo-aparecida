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
      // BL-24: OCR é análise pura, sem efeito colateral — seguro repetir.
      const response = Utils.fetchComRetry(
        `${cfg.ENDPOINT}?key=${cfg.API_KEY}`,
        {
          method:      'post',
          contentType: 'application/json',
          payload:     JSON.stringify(payload),
          muteHttpExceptions: true
        },
        { idempotente: true, rotulo: 'Vision imagem' }
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

      // Não logar o conteúdo do OCR (contém dados financeiros/pessoais — LGPD)
      console.log(`✅ [VisionService] Texto extraído (${textoCompleto.length} chars)`);

      const dadosExtraidos = this._extrairDados(textoCompleto);
      this._logResumoExtracao(dadosExtraidos);

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
      // BL-24: OCR é análise pura, sem efeito colateral — seguro repetir.
      const response = Utils.fetchComRetry(
        `${cfg.ENDPOINT_FILES}?key=${cfg.API_KEY}`,
        {
          method:      'post',
          contentType: 'application/json',
          payload:     JSON.stringify(payload),
          muteHttpExceptions: true
        },
        { idempotente: true, rotulo: 'Vision PDF' }
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

      // Não logar o conteúdo do OCR (contém dados financeiros/pessoais — LGPD)
      console.log(`✅ [VisionService] Texto extraído do PDF (${textoCompleto.length} chars)`);

      const dadosExtraidos = this._extrairDados(textoCompleto);
      this._logResumoExtracao(dadosExtraidos);

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
      recebedor:    this._extrairRecebedor(texto),
      tipo:         this._extrairTipoTransacao(texto),
      textoCompleto: texto
    };

    return dados;
  },

  /**
   * Loga apenas a PRESENÇA dos campos extraídos (sim/não), nunca os valores.
   * Evita expor valores, datas e chaves PIX nos logs (LGPD).
   * @private
   */
  _logResumoExtracao(dados) {
    if (!dados) return;
    console.log('📊 [VisionService] Resumo da extração: ' +
      `valor=${dados.valor != null ? 'sim' : 'não'}, ` +
      `data=${dados.data ? 'sim' : 'não'}, ` +
      `tipo=${dados.tipo}, ` +
      `banco=${dados.banco ? 'sim' : 'não'}, ` +
      `chavePix=${dados.chavePix ? 'sim' : 'não'}`);
  },

  _extrairValor(texto) {
    // Converte "1.234,56" → 1234.56 (remove separador de milhar, vírgula vira ponto)
    const norm   = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
    const valido = v => !isNaN(v) && v > 0;

    // 1) Valor ancorado por rótulo forte — mais confiável que "o primeiro R$"
    //    (o primeiro R$ do comprovante pode ser tarifa, saldo ou limite).
    const rotulos = [
      /valor\s*(?:pago|da\s*transa[çc][ãa]o|do\s*pix|enviado|total)?\s*[:\-]?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i,
      /total\s*[:\-]?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i
    ];
    for (const padrao of rotulos) {
      const match = texto.match(padrao);
      if (match) {
        const valor = norm(match[1]);
        if (valido(valor)) { console.log('   ✓ Valor encontrado (rótulo)'); return valor; }
      }
    }

    // 2) Sem rótulo: coletar todos os valores monetários (com centavos) e usar
    //    o MAIOR — o valor transferido costuma ser o maior; tarifas são menores.
    //    Ignora linhas de saldo/tarifa/limite para não pegar o número errado.
    const candidatos = [];
    for (const linha of texto.split(/[\n\r]+/)) {
      if (/saldo|tarifa|limite|dispon[íi]vel/i.test(linha)) continue;
      let m;
      const reRs = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
      while ((m = reRs.exec(linha)) !== null) {
        const v = norm(m[1]);
        if (valido(v)) candidatos.push(v);
      }
    }
    if (candidatos.length > 0) {
      console.log('   ✓ Valor encontrado (maior valor monetário)');
      return Math.max.apply(null, candidatos);
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
        console.log('   ✓ Data encontrada');
        return match[0];
      }
    }
    console.log('   ✗ Data não encontrada');
    return null;
  },

  _extrairChavePix(texto) {
    // 1) Preferir a chave ancorada pelo rótulo "Chave Pix: ..." (a mais confiável).
    const rotulo = texto.match(/chave\s*pix[:\s]*([^\n\r]+)/i);
    if (rotulo) {
      const chave = this._detectarFormatoChave(rotulo[1]);
      if (chave) { console.log('   ✓ Chave PIX encontrada (rótulo)'); return chave; }
    }

    // 2) Varrer linha a linha, PULANDO linhas de identificadores de transação
    //    (foi aqui que a versão antiga confundiu o ID da transação com a chave:
    //     "E43394419202604052103..." → "4339441920260").
    for (const linha of texto.split(/[\n\r]+/)) {
      if (/id\s*da\s*transa|identificad|autentica[çc][ãa]o|e2e|comprovante\s*n[ºo]/i.test(linha)) continue;
      const chave = this._detectarFormatoChave(linha);
      if (chave) { console.log('   ✓ Chave PIX encontrada'); return chave; }
    }

    console.log('   ✗ Chave PIX não encontrada');
    return null;
  },

  /**
   * Detecta uma chave PIX em um trecho de texto, testando os formatos válidos.
   * As fronteiras (?<!\d)/(?!\d) impedem casar dentro de um número longo
   * (ex.: o ID da transação), causa do bug corrigido no BL-14.
   * @private
   */
  _detectarFormatoChave(txt) {
    const padroes = [
      /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,                                                 // e-mail (aceita domínio multinível, ex: .org.br)
      /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/,                                       // CPF formatado
      /(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?!\d)/,                                // CNPJ formatado
      /(?<![\w-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w-])/i, // aleatória (UUID)
      /(?<!\d)\+?55\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}(?!\d)/                          // telefone BR (+55)
    ];
    for (const padrao of padroes) {
      const match = txt.match(padrao);
      if (match) return match[0].trim();
    }
    return null;
  },

  /**
   * Nome e instituição de QUEM RECEBEU (BL-46).
   *
   * POR QUE NÃO DÁ PARA USAR `_extrairBanco` NEM VARRER O TEXTO INTEIRO.
   * Num comprovante aparecem DOIS bancos e DOIS nomes — o de quem paga e o de
   * quem recebe. `_extrairBanco` devolve o primeiro que encontra, que é quase
   * sempre o app de quem pagou, no topo da tela. Comparar aquilo com a conta
   * da paróquia reprovaria quase todo comprovante legítimo.
   *
   * Então ancoramos: procuramos o rótulo que abre o bloco do recebedor e só
   * lemos DALI PARA A FRENTE, parando no bloco do pagador. É o mesmo caminho
   * que `_extrairChavePix` já fazia com "Chave Pix:".
   *
   * Devolve `{ nome: null, banco: null }` quando não reconhece o layout — e
   * isso é um resultado legítimo, não uma falha. A diversidade de modelos é
   * grande demais para prometer sempre achar; quem chama trata a ausência
   * como "não sei", nunca como "não confere".
   *
   * @returns {{nome: string|null, banco: string|null}}
   * @private
   */
  _extrairRecebedor(texto) {
    const linhas = String(texto || '').split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

    const ABRE  = /^(para|destino|destinat[áa]rio|recebedor|benefici[áa]rio|quem recebeu|dados de quem recebeu|institui[çc][ãa]o de destino|cr[ée]dito)\b/i;
    const FECHA = /^(de|origem|pagador|quem pagou|dados de quem pagou|debitado|d[ée]bito|remetente)\b/i;

    const inicio = linhas.findIndex(l => ABRE.test(l));
    if (inicio < 0) return { nome: null, banco: null };

    // Do rótulo até o bloco do pagador, ou 8 linhas — o que vier antes. O
    // limite existe porque em alguns layouts o bloco do pagador não é rotulado
    // e a varredura invadiria o resto do comprovante.
    const bloco = [];
    for (let i = inicio; i < linhas.length && bloco.length < 8; i++) {
      if (i > inicio && FECHA.test(linhas[i])) break;
      bloco.push(linhas[i]);
    }

    return {
      nome:  this._nomeNoBloco(bloco),
      banco: this._extrairBanco(bloco.join('\n'))
    };
  },

  /**
   * O primeiro texto do bloco que se parece com nome de pessoa ou instituição.
   *
   * Descarta rótulo, valor, data, documento e chave — tudo o que num bloco de
   * recebedor NÃO é o nome. Exige duas palavras: "Paróquia" sozinho não
   * identifica ninguém, e um falso positivo aqui vira acusação contra alguém
   * que pagou certo.
   * @private
   */
  _nomeNoBloco(bloco) {
    const LIXO = /r\$|\d{2}\/\d{2}|cpf|cnpj|chave|ag[êe]ncia|conta|institui|tipo|valor|data|id\s*da|autentica/i;

    for (const bruto of bloco) {
      // Tira o rótulo quando nome e rótulo dividem a linha ("Para: Fulano").
      const linha = bruto.replace(/^[^:]{0,30}:\s*/, '').trim();
      if (!linha || LIXO.test(linha)) continue;
      if (/\d/.test(linha)) continue;                       // nome não tem dígito
      if (linha.split(/\s+/).length < 2) continue;          // uma palavra não basta
      if (linha.length < 5 || linha.length > 80) continue;
      if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\s'-]+$/.test(linha)) continue;
      return linha;
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