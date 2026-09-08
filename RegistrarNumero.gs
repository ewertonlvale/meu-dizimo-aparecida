/**
 * Re-registra o número na WhatsApp Cloud API para aplicar o novo
 * nome de exibição aprovado ("Meu Dízimo Digital").
 *
 * Como usar (no editor do Apps Script):
 * 1. Cole seu PIN de verificação em duas etapas (6 dígitos) abaixo.
 * 2. Execute a função registrarNumero().
 * 3. Verifique o log: { "success": true } = nome aplicado.
 * 4. Por segurança, apague o PIN daqui depois de executar.
 */
function registrarNumero() {
  // Se a verificação em duas etapas estiver DESATIVADA, deixe vazio ('').
  // Se estiver ativada, coloque o PIN de 6 dígitos.
  const PIN = PropertiesService.getScriptProperties().getProperty('WHATSAPP_PIN');

  const config = getConfig(); // usa WHATSAPP_TOKEN e WHATSAPP_PHONE_ID já configurados
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_ID}/register`;

  const payload = { messaging_product: 'whatsapp' };
  if (PIN) payload.pin = PIN;

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + config.WHATSAPP_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log(response.getResponseCode());
  Logger.log(response.getContentText());
}
