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
    const body = JSON.parse(e.postData.contents);
    console.log('📨 Webhook recebido:', JSON.stringify(body, null, 2));

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from      = message.from;
      const messageId = message.id;

      // ── Idempotência: ignorar mensagens já processadas ──────────────
      const cache    = CacheService.getScriptCache();
      const cacheKey = `msg_${messageId}`;

      if (cache.get(cacheKey)) {
        console.log(`⚠️ Mensagem duplicada ignorada: ${messageId}`);
        return ContentService.createTextOutput('OK');
      }

      // Marcar ANTES de processar (previne race condition)
      cache.put(cacheKey, '1', 600); // TTL 10 minutos
      // ────────────────────────────────────────────────────────────────

      console.log(`📱 Mensagem de ${from} (id: ${messageId})`);

      // Boas-vindas apenas no primeiro contato
      if (StateManager.ehPrimeiroContato(from)) {
        MenuHandler.boasVindas(from);
        Utilities.sleep(2000);
      }

      Router.rotear(from, message);
    }

    return ContentService.createTextOutput('OK');

  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    console.error('Stack:', error.stack);
    return ContentService.createTextOutput('Error');
  }
}