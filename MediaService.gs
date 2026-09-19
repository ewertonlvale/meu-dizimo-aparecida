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

    try {
      const imageUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
      
      console.log('imageUrl: ', imageUrl);

      const response = Utils._post({
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type:  'image',
        image: { link: imageUrl, caption }
      }, { rotulo: 'WhatsApp imagem (link)' });

      // _post devolve null quando a chamada nem chegou a acontecer.
      if (!response) return false;

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

  /**
   * Quanto tempo reaproveitamos um media ID já enviado ao WhatsApp. Conservador
   * de propósito: se o ID expirar antes, o envio falha e caímos no reenvio —
   * mas é melhor reaproveitar de menos que ficar com um ID morto em cache.
   */
  MEDIA_ID_VALIDADE_MS: 7 * 24 * 60 * 60 * 1000,

  /**
   * Envia uma imagem FIXA reaproveitando o media ID entre envios.
   *
   * O upload custava ~2s e a espera pós-upload outros 3s, repetidos a cada
   * primeiro contato — sempre para a mesma imagem.
   *
   * Isto é uma função à parte, e não um parâmetro de `enviarImagemBase64`,
   * porque a regra que a torna segura é forte demais para viver num comentário:
   * o cache só vale para imagem que NÃO MUDA. Reaproveitar o media ID de um QR
   * Code do PIX mandaria o código de pagamento de uma pessoa para outra. Antes,
   * nada além do JSDoc impedia passar `chaveCache` num QR Code.
   *
   * @param {string} to
   * @param {string} base64Data
   * @param {string} [caption]
   * @param {string} [chave] - Identifica a imagem fixa no cache ('avatar')
   */
  enviarImagemFixa(to, base64Data, caption = '', chave = 'avatar') {
    const id = this._mediaIdEmCache(chave, base64Data);
    if (id) {
      console.log('♻️ Reaproveitando media ID em cache');
      const enviado = this._enviarMensagemMidia(to, 'image', { id, caption });
      if (enviado) return enviado;
      // ID expirado ou inválido: descarta e segue para o upload normal.
      console.warn('⚠️ Envio com media ID em cache falhou — refazendo o upload.');
      this._descartarMediaId(chave);
    }

    const { resposta, mediaId } = this._subirEEnviarImagem(to, base64Data, caption);
    if (resposta && mediaId) this._guardarMediaId(chave, base64Data, mediaId);
    return resposta;
  },

  /**
   * Envia uma imagem base64 ao WhatsApp. Um upload por envio.
   *
   * Para imagem fixa que se repete (o avatar das boas-vindas), use
   * `enviarImagemFixa`, que reaproveita o media ID.
   *
   * @param {string} to
   * @param {string} base64Data
   * @param {string} [caption]
   */
  enviarImagemBase64(to, base64Data, caption = '') {
    return this._subirEEnviarImagem(to, base64Data, caption).resposta;
  },

  /**
   * Sobe a imagem e a envia, devolvendo TAMBÉM o media ID.
   *
   * O media ID sai daqui num objeto próprio em vez de ser pendurado na
   * `HTTPResponse`: ela é um objeto nativo do Apps Script, e anexar campo nela
   * é o tipo de coisa que funciona até parar de funcionar, sem erro.
   *
   * @returns {{resposta: Object|null, mediaId: string|null}}
   * @private
   */
  _subirEEnviarImagem(to, base64Data, caption) {
    console.log('🖼️ Enviando imagem (base64) para:', to);

    try {
      const mediaId = this.subirImagem(base64Data);
      if (!mediaId) return { resposta: null, mediaId: null };

      // A espera fica só no caminho de upload novo, que com o cache passa a ser
      // raro. Mantida em 3s de propósito: é margem para o WhatsApp registrar a
      // mídia recém-enviada, e encurtá-la sem evidência arriscaria o envio —
      // o ganho real veio de não passar mais por aqui a cada primeiro contato.
      Utilities.sleep(3000);

      const resultado = this._enviarMensagemMidia(to, 'image', { id: mediaId, caption });
      console.log('📤 Resposta envio imagem:', resultado ? resultado.getContentText() : 'null');

      return { resposta: resultado, mediaId: mediaId };

    } catch (error) {
      console.error('❌ Exceção ao enviar imagem:', error.message);
      return { resposta: null, mediaId: null };
    }
  },

  /**
   * Sobe uma imagem e devolve o media ID, **sem enviar mensagem nenhuma**.
   *
   * Extraído de `_subirEEnviarImagem` para a sonda S1: ela precisa do media ID
   * para montar um cabeçalho de imagem por conta própria, e subir-e-enviar
   * mandaria uma mensagem a mais — cobrada, e fora do que se quer medir.
   *
   * @param {string} base64Data
   * @returns {string|null} Media ID, ou null se o upload falhar
   */
  subirImagem(base64Data) {
    const config = getConfig();

    const imageBytes = Utilities.base64Decode(base64Data);
    const blob       = Utilities.newBlob(imageBytes, 'image/png', 'image.png');

    const uploadResponse = Utils.fetchComRetry(
      getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/media`),
      {
        method:  'post',
        headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
        payload: { messaging_product: 'whatsapp', type: 'image/png', file: blob },
        muteHttpExceptions: true
      },
      { idempotente: false, rotulo: 'WhatsApp upload (imagem)' }
    );

    const uploadResult = JSON.parse(uploadResponse.getContentText());

    if (!uploadResult.id) {
      console.error('❌ Falha no upload da imagem:', uploadResult);
      return null;
    }

    console.log(`✅ Upload concluído. Media ID: ${uploadResult.id}`);
    return uploadResult.id;
  },

  /**
   * Media ID do avatar, pronto para usar como cabeçalho — SEM enviar mensagem.
   *
   * `enviarImagemFixa` sobe e envia num passo só, o que serve para a imagem
   * que É a mensagem. O cabeçalho de imagem (BL-41 · A12) precisa do id antes
   * de montar o payload, porque ele vai DENTRO da mensagem de botões.
   *
   * Devolve null em qualquer tropeço — sem avatar no Odoo, sem Odoo, falha no
   * upload. Quem chama cai no caminho sem imagem: a entrada não pode depender
   * de uma imagem para acontecer.
   *
   * @returns {string|null}
   */
  mediaIdDoAvatar() {
    try {
      const parametros = OdooService.buscarParametros();
      if (!parametros || !parametros.x_studio_avatar) return null;

      const base64 = parametros.x_studio_avatar;

      // Mesmas travas de `enviarImagemFixa`: digital da imagem e validade.
      const emCache = this._mediaIdEmCache('avatar', base64);
      if (emCache) return emCache;

      const id = this.subirImagem(base64);
      if (id) this._guardarMediaId('avatar', base64, id);
      return id;
    } catch (e) {
      console.warn('⚠️ Não consegui o media ID do avatar:', e.message);
      return null;
    }
  },

  /**
   * Media ID guardado para esta imagem, ou null se não houver, se a imagem
   * mudou, ou se já passou da validade.
   * @private
   */
  _mediaIdEmCache(chaveCache, base64Data) {
    try {
      const bruto = PropertiesService.getScriptProperties().getProperty(`media_id_${chaveCache}`);
      if (!bruto) return null;

      const guardado = JSON.parse(bruto);
      if (guardado.digital !== this._digitalImagem(base64Data)) return null;   // imagem trocada no Odoo
      if (Date.now() - guardado.em > this.MEDIA_ID_VALIDADE_MS) return null;

      return guardado.id;
    } catch (e) {
      return null;
    }
  },

  /** @private */
  _guardarMediaId(chaveCache, base64Data, id) {
    try {
      PropertiesService.getScriptProperties().setProperty(
        `media_id_${chaveCache}`,
        JSON.stringify({ id, digital: this._digitalImagem(base64Data), em: Date.now() })
      );
    } catch (e) {
      console.warn('⚠️ Não consegui guardar o media ID:', e.message);
    }
  },

  /** @private */
  _descartarMediaId(chaveCache) {
    try {
      PropertiesService.getScriptProperties().deleteProperty(`media_id_${chaveCache}`);
    } catch (e) { /* nada a fazer */ }
  },

  /**
   * Impressão digital barata da imagem: tamanho + um trecho do início. Serve só
   * para detectar que a imagem mudou — calcular hash de um base64 grande
   * custaria mais do que o upload que estamos tentando evitar.
   * @private
   */
  _digitalImagem(base64Data) {
    const texto = String(base64Data);
    return `${texto.length}:${texto.substring(0, 32)}`;
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
      const uploadResponse = Utils.fetchComRetry(
        getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/media`),
        {
          method:  'post',
          headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          payload: { messaging_product: 'whatsapp', type: mimeType, file: blob },
          muteHttpExceptions: true
        },
        { idempotente: false, rotulo: 'WhatsApp upload (documento)' }
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
      });

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
      // BL-24: os dois GETs são idempotentes, e falhar aqui significa perder o
      // comprovante que o usuário acabou de enviar — vale insistir.
      // 1. Obter URL da mídia
      const urlInfoResponse = Utils.fetchComRetry(
        getWhatsAppUrl(mediaId),
        {
          method:  'get',
          headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          muteHttpExceptions: true
        },
        { idempotente: true, rotulo: 'WhatsApp mídia (info)' }
      );

      const urlInfo = JSON.parse(urlInfoResponse.getContentText());

      if (!urlInfo.url) {
        console.error('❌ URL da mídia não encontrada:', urlInfo);
        return null;
      }

      // 2. Baixar arquivo
      const fileResponse = Utils.fetchComRetry(
        urlInfo.url,
        {
          method:  'get',
          headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          muteHttpExceptions: true
        },
        { idempotente: true, rotulo: 'WhatsApp mídia (download)' }
      );

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
  // CARD DE PAGAMENTO NATIVO (BL-40)
  // ==========================================================================

  /**
   * Envia o card `order_details` com o botão nativo **Copiar código Pix**.
   *
   * BL-40 — POR QUE ISTO SUBSTITUI DUAS MENSAGENS.
   * O copia-e-cola precisava ir sozinho e sem formatação, senão o toque longo
   * → Copiar não levava o código EMV exato e o app do banco recusava. Era a
   * única mensagem que o BL-37 não conseguiu fundir. O botão nativo resolve
   * isso de dentro do card: some a imagem do QR, some o copia-e-cola, e as
   * duas viram uma.
   *
   * SEM PSP. O campo `code` é uma string que nós fornecemos, e a sonda de
   * 19/09 confirmou que a Meta aceita o BR Code estático que o próprio bot
   * gera — apesar de o campo se chamar `pix_dynamic_code`. Nada de
   * intermediário, nada de tarifa, dinheiro caindo direto na conta da
   * comunidade. O que continua exigindo PSP é a CONCILIAÇÃO automática, e por
   * isso o comprovante e o OCR seguem existindo.
   *
   * @param {string} to          - Destinatário
   * @param {Object} comunidade  - Registro x_comunidade com os dados de pagamento
   * @param {number} valor       - Valor sugerido, em reais
   * @param {string} corpo       - Texto do card (dados da comunidade, instrução)
   * @param {string} referencia  - `reference_id` do pedido, único por envio
   * @returns {boolean} false se a Meta não aceitou — quem chama DEVE cair no
   *   caminho antigo, senão a pessoa fica sem como pagar.
   */
  enviarCardPix(to, comunidade, valor, corpo, referencia) {
    const chave = comunidade && comunidade.x_studio_chave_pix;
    if (!chave) return false;

    // O card exige `key_type` e o Odoo guarda só a chave. Sem conseguir
    // deduzir, não dá para montar o card — e insistir faria a Meta recusar
    // sem explicar. Cai no caminho antigo, que não precisa do tipo.
    const tipo = Utils.tipoDaChavePix(chave);
    if (!tipo) {
      console.warn('⚠️ [Card PIX] Não deduzi o key_type da chave — usando o caminho antigo');
      return false;
    }

    // A Meta recebe a chave como identificador, pelo mesmo motivo do BR Code.
    const chaveCanonica = Utils.chavePixCanonica(chave);

    const titular = comunidade.x_studio_titular_conta || 'Paroquia';

    let codigo;
    try {
      codigo = this._gerarPayloadPix(chaveCanonica, valor, titular,
                                      comunidade.x_studio_cidade);
    } catch (e) {
      console.warn('⚠️ [Card PIX] Falhei ao gerar o BR Code:', e.message);
      return false;
    }

    // `offset: 100` é exigência da Meta para `payment_type: "br"`: o valor vai
    // em centavos. Mandar 30 aqui cobraria R$ 0,30.
    const centavos = Math.round(valor * 100);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'order_details',
        body: { text: corpo },
        action: {
          name: 'review_and_pay',
          parameters: {
            reference_id: referencia,
            type:         'digital-goods',
            payment_type: 'br',
            payment_settings: [
              {
                type: 'pix_dynamic_code',
                pix_dynamic_code: {
                  code:          codigo,
                  merchant_name: titular,
                  key:           chaveCanonica,
                  key_type:      tipo
                }
              }
            ],
            currency:     'BRL',
            total_amount: { value: centavos, offset: 100 },
            order: {
              status: 'pending',
              items: [
                {
                  retailer_id: 'dizimo',
                  name:        'Dízimo',
                  amount:      { value: centavos, offset: 100 },
                  quantity:    1
                }
              ],
              subtotal: { value: centavos, offset: 100 }
            }
          }
        }
      }
    };

    const resposta = Utils._post(payload, { rotulo: 'Card PIX' });
    const ok = !!resposta && resposta.getResponseCode() === 200;

    if (!ok) {
      console.warn('⚠️ [Card PIX] Recusado pela Meta — caindo no QR + copia-e-cola');
    }
    return ok;
  },

  // ==========================================================================
  // QR CODE PIX — caminho antigo, hoje rede de segurança do card (BL-40)
  // ==========================================================================

  /**
   * Gera e envia o QR Code PIX para o usuário.
   *
   * BL-37 — A LEGENDA CARREGA OS DADOS DE PAGAMENTO.
   * Antes eram três mensagens: os dados da comunidade, a imagem do QR com uma
   * legenda genérica ("escaneie pelo app do banco") e o copia-e-cola. A legenda
   * da imagem estava sendo usada para dizer o óbvio enquanto uma mensagem
   * inteira, cobrada, carregava os dados. Agora os dados VÃO na legenda, e as
   * três viram duas — sem tirar nada da tela e sem perder o QR Code.
   *
   * O copia-e-cola continua sozinho: é o motivo de ele existir (ver o comentário
   * no fim desta função).
   *
   * @param {string} to            - Número do destinatário
   * @param {string} chavePix      - Chave PIX da comunidade
   * @param {number} valor         - Valor sugerido (opcional)
   * @param {string} recebedorNome - Nome do recebedor (ex.: titular da conta)
   * @param {string} cidade        - Cidade do recebedor (opcional)
   * @param {string} [legenda]     - Texto que vai na legenda da imagem. Quando
   *   omitido, usa a instrução genérica.
   * @returns {boolean} false se nada foi enviado — quem chamou precisa saber,
   *   porque agora a legenda pode ser a única cópia dos dados de pagamento.
   */
  enviarQrCode(to, chavePix, valor, recebedorNome, cidade, legenda) {
    // A chave pode ser um CPF — não vai para o log (mesmo critério do VisionService).
    console.log('💳 Gerando QR Code PIX...');

    // Legenda de imagem no WhatsApp tem teto de 1024 caracteres, e a mensagem
    // de pagamento cresce com o nome do titular, o do banco e a linha do
    // histórico. Estourar o teto faria a API recusar a imagem INTEIRA — os
    // dados de pagamento sumiriam junto. Perto do teto, a legenda volta a ser
    // mensagem própria: gasta uma mensagem, mas nada se perde.
    if (legenda && legenda.length > 950) {
      console.warn(`⚠️ [QR] Legenda com ${legenda.length} caracteres — enviando à parte`);
      Utils.enviarSimples(to, legenda);
      legenda = null;
    }

    const instrucao = legenda ||
      ('💳 *QR Code PIX*\n\nEscaneie pelo app do seu banco — ou use o ' +
       '*copia e cola* que vou enviar na próxima mensagem. 👇');

    let pixPayload;
    try {
      // BR Code (payload EMV) — o texto "copia e cola" do PIX.
      pixPayload = this._gerarPayloadPix(chavePix, valor, recebedorNome, cidade);
    } catch (error) {
      // Sem payload não há QR nem copia-e-cola. Mas a legenda pode ser a única
      // cópia dos dados de pagamento — deixar de enviá-la deixaria a pessoa sem
      // como pagar. Antes isto era um `return` seco, e era seguro só porque os
      // dados já tinham ido numa mensagem própria.
      console.warn('⚠️ Não foi possível gerar o payload PIX:', error.message);
      if (legenda) Utils.enviarSimples(to, legenda);
      // `legenda` é null aqui também quando ela já foi enviada acima por ser
      // longa demais — nos dois casos os dados chegaram, que é o que o
      // chamador precisa saber.
      return true;
    }

    // 1. QR Code — depende de serviço externo sem SLA, então é o passo opcional.
    //    Se falhar, o usuário ainda recebe o copia e cola, que é o que permite pagar.
    const semImagem = instrucao + (legenda
      ? '\n\n_(Não consegui gerar a imagem do QR Code; use o código abaixo.)_ 👇'
      : '');
    try {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(pixPayload)}`;
      const response = Utils.fetchComRetry(qrUrl, { muteHttpExceptions: true },
        { idempotente: true, rotulo: 'QR Code' });

      if (response.getResponseCode() === 200) {
        this.enviarImagemBase64(to, Utilities.base64Encode(response.getContent()), instrucao);
      } else {
        console.warn('⚠️ API QR Code falhou, status:', response.getResponseCode());
        Utils.enviarSimples(to, semImagem);
      }
    } catch (error) {
      console.warn('⚠️ Não foi possível gerar QR Code:', error.message);
      Utils.enviarSimples(to, semImagem);
    }

    // 2. O payload vai SOZINHO numa mensagem: assim um toque longo → Copiar leva
    //    exatamente o código, sem o usuário ter de selecionar o trecho à mão num
    //    EMV longo (antes ele ficava no meio da legenda da imagem).
    //    Sem negrito, crase ou qualquer marcador: eles entrariam na cópia e o
    //    código seria recusado pelo app do banco.
    //    Não há espera aqui: quando esta linha executa, o POST da imagem já
    //    retornou, e dois POSTs sequenciais chegam na ordem em que a Meta os
    //    recebeu. Era a mesma espera que o BL-21 removeu de outros quatro
    //    pontos neste ciclo — mantê-la só aqui deixaria a regra ambígua.
    Utils.enviarSimples(to, pixPayload);
    return true;
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
    // BL-48: no BR Code a chave é DADO, não texto. CPF vai com 11 dígitos,
    // telefone em E.164 — a máscara que o Odoo guarda para leitura humana
    // deixa o código fora do padrão, e o banco de quem paga recusa sem dizer
    // por quê.
    const chave = Utils.chavePixCanonica(chavePix);

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
      const response = Utils.fetchComRetry(
        getWhatsAppUrl(mediaId),
        {
          method:  'get',
          headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          muteHttpExceptions: true
        },
        { idempotente: true, rotulo: 'WhatsApp mídia (info)' }
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

  _enviarMensagemMidia(to, type, mediaPayload) {
    // Passa por Utils._post em vez de montar o POST aqui: é o que faz a
    // conferência de destinatário do BL-32 valer também para avatar, QR Code
    // e PDF de relatório. O parâmetro `config` continua na assinatura porque
    // os chamadores já o têm em mãos, mas quem usa agora é o _post.
    const response = Utils._post({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type,
      [type]: mediaPayload
    }, { rotulo: 'WhatsApp mídia (envio)' });

    if (response && response.getResponseCode() === 200) {
      console.log('✅ Mídia enviada com sucesso');
      return response;
    }

    return null;   // O _post já registrou o erro.
  }

};