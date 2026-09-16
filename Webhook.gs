/**
 * ============================================================================
 * WEBHOOK.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Ponto de entrada do Google Apps Script.
 * Responsabilidades:
 * - Responder à verificação do webhook (GET)
 * - Receber mensagens do WhatsApp (POST)
 * - Registrar primeiro contato no Odoo (x_contato_bot)
 * - Delegar para o Router
 *
 * Versão: 10.0
 * Data: Fevereiro 2026
 */

// ============================================================================
// VERIFICAÇÃO DO WEBHOOK (GET)
// ============================================================================

/**
 * Atende a requisição de verificação enviada pela Meta ao configurar o webhook.
 * Retorna o hub.challenge se o token bater com VERIFY_TOKEN.
 */
function doGet(e) {
  const config    = getConfig();
  const mode      = e.parameter['hub.mode'];
  const token     = e.parameter['hub.verify_token'];
  const challenge = e.parameter['hub.challenge'];

  if (mode === 'subscribe' && token === config.VERIFY_TOKEN) {
    console.log('✅ Webhook verificado com sucesso!');
    return ContentService.createTextOutput(challenge);
  }

  console.log('❌ Falha na verificação do webhook');
  return ContentService
    .createTextOutput('Forbidden')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================================
// RECEBIMENTO DE MENSAGENS (POST)
// ============================================================================

/**
 * Recebe o payload do WhatsApp e delega o processamento ao Router.
 * Implementa idempotência via CacheService para evitar processamento
 * duplicado em caso de reenvio pelo WhatsApp (timeout).
 */
function doPost(e) {
  try {
    // ── Autenticação do webhook (segredo na URL) ────────────────────────────
    // Headers não estão acessíveis no Apps Script, então usamos um segredo na
    // query string (?token=...) que a Meta preserva. Só bloqueia se o segredo
    // estiver configurado — assim não derruba o webhook antes do setup.
    const segredo = getWebhookSecret();
    if (segredo && e.parameter.token !== segredo) {
      console.warn('🚫 POST rejeitado: token de webhook inválido ou ausente');
      return ContentService.createTextOutput('Forbidden');
    }
    if (!segredo) {
      console.warn('⚠️ WEBHOOK_SECRET não configurado — webhook sem autenticação. ' +
                   'Configure em Setup.gs e adicione ?token=... na URL de callback.');
    }

    const body = JSON.parse(e.postData.contents);

    // BL-09: a Meta pode agrupar várias entradas/mensagens num único POST.
    // Iteramos entry[] → changes[] → value.messages[], processando TODAS.
    const entries = Array.isArray(body.entry) ? body.entry : [];
    let processadas = 0;

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const messages = change.value && change.value.messages;
        if (!Array.isArray(messages)) continue;   // ex.: eventos de status

        for (const message of messages) {
          // Isola cada mensagem: uma falha não impede as demais do lote.
          try {
            _processarMensagemWebhook(message);
            processadas++;
          } catch (errMsg) {
            console.error(`❌ Erro ao processar mensagem ${message && message.id}:`, errMsg);
          }
        }
      }
    }

    if (!processadas) {
      console.log('ℹ️ POST sem mensagens de usuário (provável evento de status).');
    }

    return ContentService.createTextOutput('OK');

  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    console.error('Stack:', error.stack);
    return ContentService.createTextOutput('Error');
  }
}

/**
 * Processa UMA mensagem do webhook, com idempotência por messageId.
 * Extraído do doPost para permitir o loop do lote (BL-09).
 * @param {Object} message - Objeto de mensagem do payload do WhatsApp
 */
function _processarMensagemWebhook(message) {
  if (!message || !message.id || !message.from) return;

  const from      = message.from;
  const messageId = message.id;

  // ── Idempotência: ignorar mensagens já processadas ──────────────────
  const cache    = CacheService.getScriptCache();
  const cacheKey = `msg_${messageId}`;

  if (cache.get(cacheKey)) {
    console.log(`⚠️ Mensagem duplicada ignorada: ${messageId}`);
    return;
  }

  // Marcar ANTES de processar (previne reprocessamento em retry concorrente).
  cache.put(cacheKey, '1', 600); // TTL 10 minutos
  // ─────────────────────────────────────────────────────────────────────

  console.log(`📱 Mensagem de ${from} (id: ${messageId})`);

  // Boas-vindas apenas no primeiro contato
  if (StateManager.ehPrimeiroContato(from)) {
    MenuHandler.boasVindas(from);
    Utilities.sleep(2000);
  }

  Router.rotear(from, message);
}