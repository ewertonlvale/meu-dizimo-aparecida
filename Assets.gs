/**
 * ============================================================================
 * ASSETS.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Centraliza os assets estáticos do bot.
 * As imagens ficam no Google Drive — apenas o ID é armazenado aqui.
 * Para trocar o avatar, basta atualizar AVATAR_DRIVE_ID.
 *
 * Versão: 8.0
 * Data: Fevereiro 2026
 */

/**
 * Busca o avatar do Google Drive e retorna em base64.
 * Usa UrlFetchApp para baixar o binário diretamente via URL de exportação,
 * evitando erros de servidor do DriveApp.getBlob() com arquivos binários.
 *
 * @returns {string|null} Base64 da imagem ou null em caso de erro
 */
function getAvatar() {
  try {
    const fileId = ASSETS.AVATAR_DRIVE_ID;

    if (!fileId || fileId.startsWith('COLE_AQUI')) {
      console.warn('⚠️ ASSETS.AVATAR_DRIVE_ID não configurado em Assets.gs.');
      return null;
    }

    console.log('🖼️ Buscando avatar do Drive. ID:', fileId);

    // Baixa o arquivo diretamente via URL pública do Drive
    // Funciona para PNG/JPEG compartilhados como "Qualquer pessoa com o link"
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;

    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true
    });

    const code = response.getResponseCode();

    if (code !== 200) {
      console.error(`❌ Drive retornou HTTP ${code}. Verifique o ID e o compartilhamento do arquivo.`);
      return null;
    }

    const bytes  = response.getContent();
    const base64 = Utilities.base64Encode(bytes);

    console.log(`✅ Avatar obtido. Tamanho: ${bytes.length} bytes (~${Math.round(bytes.length / 1024)} KB)`);
    return base64;

  } catch (error) {
    console.error('❌ Erro ao buscar avatar do Drive:', error.message);
    return null;
  }
}