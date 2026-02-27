/**
 * ============================================================================
 * CONFIG.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Configuração central do sistema.
 * Responsabilidades:
 * - Carregar credenciais do PropertiesService
 * - Expor constantes de estado (ESTADOS)
 * - Expor constantes de configuração (ODOO, Vision)
 *
 * Versão: 9.0  (adicionados estados do módulo de relatório v2)
 * Data: Fevereiro 2026
 */

// ============================================================================
// ESTADOS DA CONVERSA
// ============================================================================

const ESTADOS = {
  MENU:                          'MENU',
  AGUARDANDO_COMUNIDADE:         'AGUARDANDO_COMUNIDADE',
  AGUARDANDO_CONFIRMACAO_NUMERO: 'AGUARDANDO_CONFIRMACAO_NUMERO',
  AGUARDANDO_NOME:               'AGUARDANDO_NOME',
  AGUARDANDO_NOME_USUAL:         'AGUARDANDO_NOME_USUAL',
  AGUARDANDO_DATA_NASCIMENTO:    'AGUARDANDO_DATA_NASCIMENTO',
  AGUARDANDO_ENDERECO:           'AGUARDANDO_ENDERECO',
  AGUARDANDO_VALOR_MENSAL:       'AGUARDANDO_VALOR_MENSAL',
  AGUARDANDO_FOTO_PERFIL:        'AGUARDANDO_FOTO_PERFIL',
  AGUARDANDO_COMPROVANTE:        'AGUARDANDO_COMPROVANTE',

  AGUARDANDO_NOTIFICACAO:        'AGUARDANDO_NOTIFICACAO',
  AGUARDANDO_DIA_PREFERIDO:      'AGUARDANDO_DIA_PREFERIDO',

  // ── Módulo de Relatório v2 ─────────────────────────────────────────────────
  // Aguardando o código de acesso digitado pelo usuário
  AGUARDANDO_CODIGO_RELATORIO:     'AGUARDANDO_CODIGO_RELATORIO',

  // Menu principal do relatório (seleção via botão)
  AGUARDANDO_OPCAO_RELATORIO:      'AGUARDANDO_OPCAO_RELATORIO',

  // Opção 1 – Resumo Consolidado: aguardando seleção do período na lista
  AGUARDANDO_PERIODO_CONSOLIDADO:  'AGUARDANDO_PERIODO_CONSOLIDADO',

  // Opção 1 – Resumo Consolidado: aguardando mês digitado manualmente (MM/AAAA)
  AGUARDANDO_MES_CUSTOMIZADO:      'AGUARDANDO_MES_CUSTOMIZADO',

  // Opção 2 – Listar Dizimistas: aguardando seleção de comunidade (apenas ADMIN)
  AGUARDANDO_COMUNIDADE_RELATORIO: 'AGUARDANDO_COMUNIDADE_RELATORIO',

  // ── Legado (mantido por compatibilidade com versão 8.x) ───────────────────
  AGUARDANDO_PERIODO_RELATORIO:    'aguardando_periodo_relatorio',

  // Opção 3 – Devoluções Pendentes: aguardando seleção de comunidade (apenas ADMIN)
  AGUARDANDO_COMUNIDADE_PENDENTES: 'AGUARDANDO_COMUNIDADE_PENDENTES',

  // Opção 3 – Devoluções Pendentes: aguardando seleção de devolução na lista
  AGUARDANDO_SELECAO_PENDENTE:     'AGUARDANDO_SELECAO_PENDENTE',

  // Opção 3 – Devoluções Pendentes: visualizando detalhe, aguardando ação (confirmar/rejeitar)
  AGUARDANDO_ACAO_PENDENTE:        'AGUARDANDO_ACAO_PENDENTE',
};

// ============================================================================
// CONFIGURAÇÕES GLOBAIS
// ============================================================================

const CONFIG = {
  TEMPLATES: {
    LEMBRETE_DEVOLUCAO: 'devolucao_dizimo'  // Nome do template aprovado no WhatsApp
  }
};

const PALAVRAS_RELATORIO = [
  'relatório',
  'relatorio',
  'relatórios',
  'relatorios',
  '/relatorio',
  '/relatório',
  'rel'
];

// ============================================================================
// CONFIGURAÇÃO WHATSAPP
// ============================================================================

/**
 * Versão da Graph API do WhatsApp.
 * Centralizada aqui para atualizar em um único lugar quando a Meta deprecar.
 * Consultar: https://developers.facebook.com/docs/graph-api/changelog
 */
const WHATSAPP_API_VERSION = 'v21.0';

/**
 * Monta a URL base da Graph API do WhatsApp.
 * @param {string} path - Caminho após a versão (ex: `${phoneId}/messages`)
 * @returns {string} URL completa
 */
function getWhatsAppUrl(path) {
  return `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${path}`;
}

/**
 * Retorna credenciais do WhatsApp Business API.
 * Lança erro se propriedades obrigatórias não estiverem configuradas.
 * @returns {Object} { WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, VERIFY_TOKEN }
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  const config = {
    WHATSAPP_TOKEN:    props.getProperty('WHATSAPP_TOKEN'),
    WHATSAPP_PHONE_ID: props.getProperty('WHATSAPP_PHONE_ID'),
    VERIFY_TOKEN:      props.getProperty('VERIFY_TOKEN'),
  };

  if (!config.WHATSAPP_TOKEN || !config.WHATSAPP_PHONE_ID) {
    throw new Error(
      '❌ ERRO: Propriedades WHATSAPP_TOKEN e WHATSAPP_PHONE_ID não configuradas!\n\n' +
      'Execute setupProperties() no arquivo Setup.gs'
    );
  }

  return config;
}

// ============================================================================
// CONFIGURAÇÃO ODOO
// ============================================================================

/**
 * Retorna credenciais do Odoo ERP.
 * Lança erro se ODOO_API_KEY não estiver configurada.
 * @returns {Object} { url, database, uid, apiKey }
 */
function getOdooConfig() {
  const props = PropertiesService.getScriptProperties();

  const config = {
    url:      props.getProperty('ODOO_URL')      || 'https://meu-dizimo.odoo.com/',
    database: props.getProperty('ODOO_DATABASE') || 'meu-dizimo',
    uid:      parseInt(props.getProperty('ODOO_UID')) || 2,
    apiKey:   props.getProperty('ODOO_API_KEY')
  };

  if (!config.apiKey) {
    throw new Error(
      '❌ ERRO: ODOO_API_KEY não configurada!\n\nExecute setupProperties() no arquivo Setup.gs'
    );
  }

  return config;
}

// ============================================================================
// CONFIGURAÇÃO GOOGLE VISION
// ============================================================================

/**
 * Retorna credenciais e endpoints da Google Vision API.
 * ENDPOINT       → images:annotate  (imagens)
 * ENDPOINT_FILES → files:annotate   (PDF / TIFF)
 * @returns {Object} { API_KEY, ENDPOINT, ENDPOINT_FILES }
 */
function getVisionConfig() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GOOGLE_VISION_API_KEY');

  if (!apiKey) {
    throw new Error('❌ ERRO: GOOGLE_VISION_API_KEY não configurada!');
  }

  return {
    API_KEY:        apiKey,
    ENDPOINT:       'https://vision.googleapis.com/v1/images:annotate',
    ENDPOINT_FILES: 'https://vision.googleapis.com/v1/files:annotate'
  };
}