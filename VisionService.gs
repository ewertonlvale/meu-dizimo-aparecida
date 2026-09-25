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

    // BL-82: o número aceita milhar COM ponto ("1.234,56") ou SEM ("1234,56").
    // A versão anterior só tinha a primeira forma e não tinha âncora no fim:
    // "R$ 1234,56" casava só "123". Sem ponto, até 7 dígitos (R$ 9.999.999) —
    // o teto evita ler um CPF ou um ID de transação como valor.
    // O `(?!\d)` impede parar no meio do número.
    const NUM      = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{2})?|\\d{1,7}(?:,\\d{2})?)(?!\\d)';
    const NUM_CENT = '(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d{1,7},\\d{2})(?!\\d)';

    // 1) Valor ancorado por rótulo forte — mais confiável que "o primeiro R$"
    //    (o primeiro R$ do comprovante pode ser tarifa, saldo ou limite).
    const rotulos = [
      new RegExp('valor\\s*(?:pago|da\\s*transa[çc][ãa]o|do\\s*pix|enviado|total)?\\s*[:\\-]?\\s*R?\\$?\\s*' + NUM, 'i'),
      new RegExp('total\\s*[:\\-]?\\s*R?\\$?\\s*' + NUM, 'i')
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
      const reRs = new RegExp('R\\$\\s*' + NUM_CENT, 'gi');
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

  /**
   * A data do pagamento, SEMPRE em dd/mm/aaaa — BL-52.
   *
   * Normalizar aqui não é capricho de formato. Quem grava no Odoo faz
   * `dadosAnalise.data.split('/')` e remonta `ano-mes-dia`. Uma data em
   * qualquer outro formato NÃO quebra o split: ela sai
   * `undefined-undefined-24 JUL 2026`, que o Odoo recusa ou guarda torto, sem
   * erro nenhum na tela. Devolver texto cru era, na prática, devolver lixo.
   *
   * E os layouts reais não combinam entre si:
   *   Itú / BB / Inter   `24/07/2026`            — o único que a versão antiga lia
   *   Nubank              `24 JUL 2026 - 17:01:03`
   *   Google Pay          `domingo, 5 de abr., 18:03`   — SEM O ANO
   *
   * Daí o ID da transação entrar como fonte: o E2E do BACEN é
   * `E` + ISPB(8) + aaaammdd + hhmm, e carrega justamente o ano que falta na
   * tela do Google Pay.
   *
   * Ele entra por ÚLTIMO, e nunca na frente de uma data escrita: seu horário
   * é UTC, então um pagamento das 21h de Brasília aparece nele já como o dia
   * seguinte. Serve para completar o ano, não para contradizer o dia que o
   * comprovante mostra.
   */
  _extrairData(texto) {
    const t = String(texto || '');

    const doisDig = n => String(n).padStart(2, '0');
    const monta = (d, m, a) => (
      d >= 1 && d <= 31 && m >= 1 && m <= 12 && a >= 2000 && a <= 2100
        ? `${doisDig(d)}/${doisDig(m)}/${a}` : null
    );
    const achou = (valor, origem) => {
      console.log(`   ✓ Data encontrada (${origem})`);
      return valor;
    };

    // O ID da transação é lido do texto inteiro, mas as datas escritas só das
    // outras linhas: um E2E é uma tira de dígitos e letras, e dentro dele um
    // "20260405" qualquer pareceria data. Foi confundindo ID com dado que o
    // BL-14 nasceu.
    const ID_LINHA = /id\s*da\s*transa|identificad|autentica[çc][ãa]o|e2e|comprovante\s*n[ºo]/i;
    const limpo = t.split(/[\n\r]+/).filter(l => !ID_LINHA.test(l)).join('\n');

    const e2e = t.match(/(?<![A-Za-z0-9])E\d{8}(\d{4})(\d{2})(\d{2})\d{4}/);

    // 1) dd/mm/aaaa e dd/mm/aa — Itú, BB, Inter
    let m = limpo.match(/(?<!\d)(\d{1,2})[\/.](\d{1,2})[\/.](\d{4}|\d{2})(?!\d)/);
    if (m) {
      const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const r = monta(Number(m[1]), Number(m[2]), ano);
      if (r) return achou(r, 'dd/mm/aaaa');
    }

    // 2) aaaa-mm-dd
    m = limpo.match(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/);
    if (m) {
      const r = monta(Number(m[3]), Number(m[2]), Number(m[1]));
      if (r) return achou(r, 'aaaa-mm-dd');
    }

    // 3) mês por extenso ou abreviado, com ou sem ano:
    //    "24 JUL 2026", "24 de julho de 2026", "5 de abr.", "5 de abr., 18:03"
    const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
                    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
    const reMes = /(?<!\d)(\d{1,2})\s*(?:º|°)?\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?,?(?:\s+de)?\s*(\d{4})?(?!\d)/i;
    m = limpo.match(reMes);
    if (m) {
      const dia = Number(m[1]);
      const mes = MESES[m[2].toLowerCase()];

      if (m[3]) {
        const r = monta(dia, mes, Number(m[3]));
        if (r) return achou(r, 'mês por extenso');
      } else {
        // Sem ano na tela. O do E2E é o único que se sabe de fato; sem ele,
        // o ano corrente — e o anterior quando isso jogaria a data no futuro,
        // que um comprovante de pagamento já feito nunca tem.
        let ano = e2e ? Number(e2e[1]) : new Date().getFullYear();
        if (!e2e) {
          const hoje = new Date();
          const candidata = new Date(ano, mes - 1, dia);
          if (candidata.getTime() > hoje.getTime() + 24 * 60 * 60 * 1000) ano -= 1;
        }
        const r = monta(dia, mes, ano);
        if (r) return achou(r, e2e ? 'mês por extenso + ano do E2E' : 'mês por extenso');
      }
    }

    // 4) Só o E2E. Menos exato (a hora dele é UTC, e pagamento de fim de noite
    //    cai no dia seguinte), mas muito melhor que não ter data nenhuma.
    if (e2e) {
      const r = monta(Number(e2e[3]), Number(e2e[2]), Number(e2e[1]));
      if (r) return achou(r, 'ID da transação');
    }

    console.log('   ✗ Data não encontrada');
    return null;
  },

  _extrairChavePix(texto) {
    // BL-49: a chave é de QUEM RECEBEU. Procurar no comprovante inteiro fazia
    // o CNPJ da instituição, lá no rodapé, virar "a chave do recebedor" — no
    // Nubank, cujo bloco de destino não traz chave, saía
    // `18.236.120/0001-58` (Nu Pagamentos S.A.). Comparado com a chave da
    // comunidade dava divergência, e desde o BL-46 divergência AVISA A PESSOA
    // de que o pagamento dela parece errado. Acusação falsa, em cima de quem
    // pagou certo.
    const bloco = this._blocoDoRecebedor(texto);
    if (bloco.length) {
      const chave = this._chaveEmLinhas(bloco);
      if (chave) { console.log('   ✓ Chave PIX encontrada (bloco do recebedor)'); return chave; }

      // O bloco existe e não tem chave — como no Nubank. Isso é resposta:
      // "não há chave para conferir". Cair para o resto do comprovante seria
      // justamente voltar a pegar o rodapé.
      console.log('   ✗ Bloco do recebedor sem chave — não vou procurar no rodapé');
      return null;
    }

    // Sem bloco reconhecido, vale o comprovante inteiro: é o melhor que dá,
    // e o resultado só alimenta conferência, nunca alerta sozinho.
    const chave = this._chaveEmLinhas(texto.split(/[\n\r]+/));
    console.log(chave ? '   ✓ Chave PIX encontrada' : '   ✗ Chave PIX não encontrada');
    return chave;
  },

  /**
   * A chave PIX dentro de um conjunto de linhas (BL-49).
   *
   * O rótulo "Chave Pix" vem antes do valor, e nem sempre na mesma linha: o
   * Banco do Brasil quebra em duas. Por isso olhamos o resto da linha do
   * rótulo E a linha seguinte.
   *
   * Depois do rótulo, um número de 11 ou 14 dígitos sem pontuação é aceito
   * como chave — o BB escreve `08070690356`. Fora dali NÃO é: número de conta
   * também tem esse tamanho, e um palpite ali vira divergência falsa.
   * @private
   */
  _chaveEmLinhas(linhas) {
    for (let i = 0; i < linhas.length; i++) {
      const m = String(linhas[i]).match(/chave\s*(?:pix)?[:\s]*(.*)$/i);
      if (!m) continue;
      const candidatos = [m[1], linhas[i + 1] || ''];
      for (const c of candidatos) {
        const chave = this._detectarFormatoChave(c, true);
        if (chave) return chave;
      }
    }

    // Sem rótulo: reconhece só formatos inequívocos, e pula as linhas de
    // identificador — foi ali que o ID da transação já virou chave (BL-14).
    for (const linha of linhas) {
      if (/id\s*da\s*transa|identificad|autentica[çc][ãa]o|e2e|comprovante\s*n[ºo]|ag[êe]ncia|conta/i.test(linha)) continue;
      const chave = this._detectarFormatoChave(linha);
      if (chave) return chave;
    }
    return null;
  },

  /**
   * Detecta uma chave PIX em um trecho de texto, testando os formatos válidos.
   * As fronteiras (?<!\d)/(?!\d) impedem casar dentro de um número longo
   * (ex.: o ID da transação), causa do bug corrigido no BL-14.
   * @private
   */
  _detectarFormatoChave(txt, aposRotulo) {
    // Só depois do rótulo "Chave Pix": CPF/CNPJ sem pontuação. Número de conta
    // tem o mesmo tamanho, e aceitar em qualquer linha traria conta por chave.
    if (aposRotulo) {
      const nu = String(txt).match(/(?<!\d)(\d{11}|\d{14})(?!\d)/);
      if (nu) return nu[1];
    }

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
    const bloco = this._blocoDoRecebedor(texto);
    if (!bloco.length) return { nome: null, banco: null };
    return {
      nome:  this._nomeNoBloco(bloco),
      banco: this._extrairBanco(bloco.join('\n'))
    };
  },

  /**
   * As linhas do comprovante que falam de QUEM RECEBEU (BL-49).
   *
   * Do rótulo que abre o bloco até o que abre o do pagador. O teto de linhas
   * existe porque em alguns layouts o bloco do pagador não é rotulado, e a
   * varredura invadiria o rodapé — onde mora o CNPJ da instituição, que já foi
   * confundido com a chave PIX do recebedor.
   *
   * 14 linhas, e não 8: o comprovante do Banco do Brasil gasta Agência, Conta
   * e Tipo de conta ANTES da Chave Pix, e com o teto antigo o bloco acabava
   * cedo demais.
   * @private
   */
  _blocoDoRecebedor(texto) {
    const linhas = String(texto || '').split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

    const ABRE  = /^(para|destino|destinat[áa]rio|recebedor|benefici[áa]rio|quem recebeu|dados de quem recebeu|institui[çc][ãa]o de destino|cr[ée]dito)\b/i;
    const FECHA = /^(de|origem|pagador|quem pagou|dados de quem pagou|debitado|d[ée]bito|remetente)\b/i;

    const inicio = linhas.findIndex(l => ABRE.test(l));
    if (inicio < 0) return [];

    const bloco = [];
    for (let i = inicio; i < linhas.length && bloco.length < 14; i++) {
      if (i > inicio && FECHA.test(linhas[i])) break;
      bloco.push(linhas[i]);
    }
    return bloco;
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
      // Tira o rótulo quando ele divide a linha com o nome. Com dois-pontos
      // ("Para: Fulano") e sem ("Nome    THALLES BOITEUX VALE") — o Nubank usa
      // a segunda forma, e o rótulo vinha colado no nome.
      const linha = bruto
        .replace(/^[^:]{0,30}:\s*/, '')
        .replace(/^(nome|nome do favorecido|favorecido|recebedor|benefici[áa]rio)\s+/i, '')
        .trim();
      if (!linha || LIXO.test(linha)) continue;
      // O rótulo da seção também tem duas palavras e só letras: "Quem
      // recebeu" saía como se fosse o nome de quem recebeu.
      if (/^(quem\s+(recebeu|pagou)|destino|origem|recebedor|benefici[áa]rio|destinat[áa]rio|pagador|remetente|dados\s)/i.test(linha)) continue;
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