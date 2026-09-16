/**
 * ============================================================================
 * MediaService.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Gerencia mídia e geração de QR Code PIX via WhatsApp API.
 * Consolida MediaManager.gs.
 *
 * Responsabilidades:
 * - Enviar imagens (base64 → upload → mensagem)
 * - Baixar mídias do WhatsApp (media_id → URL → base64)
 * - Baixar arquivos genéricos (retorna { base64, blob })
 * - Validar tipos MIME suportados
 * - Gerar e enviar QR Code PIX (via API externa ou imagem estática)
 *
 * Versão: 8.0
 * Data: Fevereiro 2026
 */

const MediaService = {

  TIPOS_SUPORTADOS: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],

  // ==========================================================================
  // ENVIO DE IMAGEM
  // ==========================================================================

  /**
   * Envia uma imagem base64 para um número do WhatsApp.
   * Fluxo: base64 → upload /media → mensagem com media_id
   *
   * @param {string} to          - Número do destinatário
   * @param {string} base64Data  - Imagem em base64 (sem prefixo data:)
   * @param {string} caption     - Legenda (opcional)
   * @returns {Object|null}
   */
  /**
   * Envia uma imagem para um número do WhatsApp via URL pública do Drive.
   * Mais confiável que upload + media_id para arquivos do Google Drive.
   *
   * @param {string} to         - Número do destinatário
   * @param {string} driveFileId - ID do arquivo no Google Drive (compartilhado publicamente)
   * @param {string} caption    - Legenda (opcional)
   * @returns {Object|null}
   */
  enviarImagemDrive(to, driveFileId, caption = '') {
    console.log('🖼️ Enviando imagem do Drive para:', to);
    const config = getConfig();

    try {
      const imageUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
      
      console.log('imageUrl: ', imageUrl);

      const response = UrlFetchApp.fetch(
        getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
        {
          method:      'post',
          contentType: 'application/json',
          headers:     { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          payload:     JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'image',
            image: { link: imageUrl, caption }
          }),
          muteHttpExceptions: true
        }
      );

      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code === 200) {
        console.log('✅ Imagem enviada com sucesso via URL do Drive');
        return response;
      }

      console.error(`❌ Erro ao enviar imagem (HTTP ${code}):`, body);
      return null;

    } catch (error) {
      console.error('❌ Exceção ao enviar imagem:', error.message);
      return null;
    }
  },

  enviarImagemBase64(to, base64Data, caption = '') {
    console.log('🖼️ Enviando imagem (base64) para:', to);
    const config = getConfig();

    try {
      const imageBytes = Utilities.base64Decode(base64Data);
      const blob       = Utilities.newBlob(imageBytes, 'image/png', 'image.png');

      const uploadResponse = UrlFetchApp.fetch(
        getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/media`),
        {
          method:  'post',
          headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          payload: { messaging_product: 'whatsapp', type: 'image/png', file: blob },
          muteHttpExceptions: true
        }
      );

      const uploadResult = JSON.parse(uploadResponse.getContentText());

      if (!uploadResult.id) {
        console.error('❌ Falha no upload da imagem:', uploadResult);
        return null;
      }

      console.log(`✅ Upload concluído. Media ID: ${uploadResult.id}`);
      Utilities.sleep(3000);

      const resultado = this._enviarMensagemMidia(to, 'image', { id: uploadResult.id, caption }, config);
      console.log('📤 Resposta envio imagem:', resultado ? resultado.getContentText() : 'null');
      return resultado;

    } catch (error) {
      console.error('❌ Exceção ao enviar imagem:', error.message);
      return null;
    }
  },

  /**
   * Envia um documento (PDF) via WhatsApp.
   * @param {string} to          - Número do destinatário
   * @param {string} base64Data  - Arquivo em base64
   * @param {string} mimeType    - Tipo MIME (ex: 'application/pdf')
   * @param {string} filename    - Nome do arquivo para exibição
   * @param {string} caption     - Legenda (opcional)
   * @returns {Object|null}
   */
  enviarDocumento(to, base64Data, mimeType, filename, caption = '') {
    console.log('📄 Enviando documento para:', to);
    const config = getConfig();

    try {
      const bytes = Utilities.base64Decode(base64Data);
      const blob  = Utilities.newBlob(bytes, mimeType, filename);

      // 1. Upload do arquivo
      const uploadResponse = UrlFetchApp.fetch(
        getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/media`),
        {
          method:  'post',
          headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          payload: { messaging_product: 'whatsapp', type: mimeType, file: blob },
          muteHttpExceptions: true
        }
      );

      const uploadResult = JSON.parse(uploadResponse.getContentText());

      if (!uploadResult.id) {
        console.error('❌ Falha no upload do documento:', uploadResult);
        return null;
      }

      console.log(`✅ Upload documento concluído. Media ID: ${uploadResult.id}`);
      Utilities.sleep(2000);

      // 2. Enviar mensagem com o documento
      const resultado = this._enviarMensagemMidia(to, 'document', {
        id:       uploadResult.id,
        caption:  caption,
        filename: filename
      }, config);

      console.log('📤 Resposta envio documento:', resultado ? resultado.getContentText() : 'null');
      return resultado;

    } catch (error) {
      console.error('❌ Exceção ao enviar documento:', error.message);
      return null;
    }
  },

  // ==========================================================================
  // DOWNLOAD DE MÍDIA
  // ==========================================================================

  /**
   * Baixa uma mídia do WhatsApp e retorna em base64.
   * @param {string} mediaId - ID da mídia retornado pelo webhook
   * @returns {string|null} base64 ou null
   */
  baixarMidia(mediaId) {
    const arquivoBaixado = this.baixarArquivo(mediaId);
    return arquivoBaixado?.base64 || null;
  },

  /**
   * Baixa um arquivo do WhatsApp.
   * @param {string} mediaId
   * @returns {{ base64: string, blob: Blob, mimeType: string }|null}
   */
  baixarArquivo(mediaId) {
    const config = getConfig();
    console.log('📥 Baixando arquivo:', mediaId);

    try {
      // 1. Obter URL da mídia
      const urlInfoResponse = UrlFetchApp.fetch(
        getWhatsAppUrl(mediaId),
        {
          method:  'get',
          headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          muteHttpExceptions: true
        }
      );

      const urlInfo = JSON.parse(urlInfoResponse.getContentText());

      if (!urlInfo.url) {
        console.error('❌ URL da mídia não encontrada:', urlInfo);
        return null;
      }

      // 2. Baixar arquivo
      const fileResponse = UrlFetchApp.fetch(urlInfo.url, {
        method:  'get',
        headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
        muteHttpExceptions: true
      });

      if (fileResponse.getResponseCode() !== 200) {
        console.error('❌ Erro ao baixar arquivo, status:', fileResponse.getResponseCode());
        return null;
      }

      const blob     = fileResponse.getBlob();
      const base64   = Utilities.base64Encode(fileResponse.getContent());
      const mimeType = blob.getContentType();

      console.log('✅ Arquivo baixado. Tipo:', mimeType, '| Tamanho:', blob.getBytes().length, 'bytes');

      return { base64, blob, mimeType };

    } catch (error) {
      console.error('❌ Erro ao baixar arquivo:', error);
      return null;
    }
  },

  // ==========================================================================
  // QR CODE PIX
  // ==========================================================================

  /**
   * Gera e envia o QR Code PIX para o usuário.
   *
   * @param {string} to            - Número do destinatário
   * @param {string} chavePix      - Chave PIX da comunidade
   * @param {number} valor         - Valor sugerido (opcional)
   * @param {string} recebedorNome - Nome do recebedor (ex.: titular da conta)
   * @param {string} cidade        - Cidade do recebedor (opcional)
   */
  enviarQrCode(to, chavePix, valor, recebedorNome, cidade) {
    console.log(`💳 Gerando QR Code PIX para chave: ${chavePix}`);

    try {
      // Gera o BR Code (payload EMV) — o texto "copia e cola" do PIX.
      const pixPayload = this._gerarPayloadPix(chavePix, valor, recebedorNome, cidade);

      // Imagem do QR Code a partir do payload.
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(pixPayload)}`;
      const response = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });

      if (response.getResponseCode() !== 200) {
        console.warn('⚠️ API QR Code falhou, status:', response.getResponseCode());
        return;
      }

      const base64QR = Utilities.base64Encode(response.getContent());
      // Enviamos também o "copia e cola" para quem não consegue escanear.
      this.enviarImagemBase64(to, base64QR,
        `💳 *QR Code PIX*\n\nOu use o *PIX copia e cola*:\n${pixPayload}`);

    } catch (error) {
      console.warn('⚠️ Não foi possível gerar QR Code:', error.message);
      // Não lança erro – o fluxo continua sem QR Code
    }
  },

  /**
   * Gera o payload BR Code (EMV) do PIX, conforme o padrão do Banco Central.
   * Correções (BL-11): a tag 54 (valor) só é incluída quando há valor > 0;
   * nome/cidade do recebedor são parametrizáveis e sanitizados; inclui a tag 62
   * (txid estático "***") para maior compatibilidade entre bancos.
   * @private
   */
  _gerarPayloadPix(chavePix, valor, recebedorNome, cidade) {
    const nome = this._sanitizarTextoEmv(recebedorNome || 'PASTORAL DO DIZIMO', 25);
    const cid  = this._sanitizarTextoEmv(cidade || 'CIDADE', 15);
    const chave = String(chavePix || '').trim();

    // Merchant Account Information (tag 26): GUI do PIX + chave.
    const mai = this._emv('00', 'BR.GOV.BCB.PIX') + this._emv('01', chave);

    let p = '';
    p += this._emv('00', '01');        // Payload Format Indicator
    p += this._emv('26', mai);         // Merchant Account Information — PIX
    p += this._emv('52', '0000');      // Merchant Category Code
    p += this._emv('53', '986');       // Moeda: BRL (986)
    if (valor && Number(valor) > 0) {
      p += this._emv('54', Number(valor).toFixed(2));   // Valor — só quando houver
    }
    p += this._emv('58', 'BR');        // País
    p += this._emv('59', nome);        // Nome do recebedor
    p += this._emv('60', cid);         // Cidade do recebedor
    p += this._emv('62', this._emv('05', '***'));  // Additional Data — txid estático
    p += '6304';                       // CRC (id 63 + len 04), valor logo abaixo

    return p + this._crc16(p);
  },

  /** Monta um campo EMV "ID + comprimento(2) + valor". @private */
  _emv(id, value) {
    const v = String(value);
    return id + v.length.toString().padStart(2, '0') + v;
  },

  /**
   * Sanitiza texto para os campos EMV (nome/cidade): remove acentos, deixa
   * maiúsculas, mantém apenas A-Z 0-9 e espaço, e limita o tamanho.
   * @private
   */
  _sanitizarTextoEmv(texto, max) {
    let s = String(texto || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) s = 'RECEBEDOR';
    return s.substring(0, max).trim();
  },

  /** CRC16-CCITT para BR Code PIX */
  _crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  },

  // ==========================================================================
  // VALIDAÇÃO E HELPERS
  // ==========================================================================

  /** Verifica se o tipo MIME é suportado pelo sistema. */
  validarTipoMidia(mimeType) {
    return this.TIPOS_SUPORTADOS.includes(mimeType);
  },

  /** Obtém informações completas de uma mídia (id, url, mime_type, sha256, file_size). */
  obterInfoMidia(mediaId) {
    const config = getConfig();
    try {
      const response = UrlFetchApp.fetch(
        getWhatsAppUrl(mediaId),
        {
          method:  'get',
          headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          muteHttpExceptions: true
        }
      );
      return response.getResponseCode() === 200
        ? JSON.parse(response.getContentText())
        : null;
    } catch (e) {
      console.error('❌ Erro ao obter info da mídia:', e);
      return null;
    }
  },

  // ==========================================================================
  // PRIMITIVO DE ENVIO (privado)
  // ==========================================================================

  _enviarMensagemMidia(to, type, mediaPayload, config) {
    const response = UrlFetchApp.fetch(
      getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
      {
        method:      'post',
        contentType: 'application/json',
        headers:     { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
        payload:     JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type,
          [type]: mediaPayload
        }),
        muteHttpExceptions: true
      }
    );

    if (response.getResponseCode() === 200) {
      console.log('✅ Mídia enviada com sucesso');
      return response;
    }

    console.error('❌ Erro ao enviar mídia:', response.getContentText()); // response.getContentText());
    return null;
  }

};