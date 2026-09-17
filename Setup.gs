/**
 * ============================================
 * SETUP INICIAL - EXECUTE APENAS UMA VEZ
 * ============================================
 * 
 * Este arquivo contém funções para configurar as propriedades
 * do projeto de forma segura.
 * 
 * INSTRUÇÕES:
 * 1. Edite os valores na função setupProperties() abaixo
 * 2. Execute a função setupProperties()
 * 3. Verifique os logs
 * 4. Execute verificarProperties() para confirmar
 * 5. Delete ou comente este arquivo após configuração
 * 
 * Versão: 1.0
 * Data: Fevereiro 2026
 */

/**
 * ============================================
 * CONFIGURAÇÃO INICIAL DAS PROPRIEDADES
 * ============================================
 * 
 * EXECUTE ESTA FUNÇÃO UMA ÚNICA VEZ
 */
function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  
  // ⚠️ EDITE OS VALORES ABAIXO COM SUAS CREDENCIAIS REAIS:
  const configuracoes = {
    // ==========================================
    // WhatsApp Business API
    // ==========================================
    // Obtenha em: https://developers.facebook.com
    'WHATSAPP_TOKEN': 'COLE_SEU_TOKEN_AQUI',
    'WHATSAPP_PHONE_ID': 'COLE_SEU_PHONE_ID_AQUI',
    'VERIFY_TOKEN': 'meu_dizimo_2024',

    // Segredo do webhook: OBRIGATÓRIO (BL-17) — sem ele o webhook rejeita todo
    // POST. Prefira rodar configurarSegredoWebhook(), que gera um valor forte e
    // já imprime a URL de callback pronta para colar na Meta.
    // (Apps Script não expõe headers, então autenticamos pela query string.)
    'WEBHOOK_SECRET': 'COLE_UM_SEGREDO_ALEATORIO_AQUI',
    
    // ==========================================
    // Odoo ERP
    // ==========================================
    // Configure seu servidor Odoo
    'ODOO_URL': 'https://meu-dizimo.odoo.com/',
    'ODOO_DATABASE': 'meu-dizimo',
    'ODOO_UID': '2',
    'ODOO_API_KEY': 'COLE_SUA_ODOO_KEY_AQUI',
    
    // ==========================================
    // Google Vision API
    // ==========================================
    // Obtenha em: https://console.cloud.google.com
    'GOOGLE_VISION_API_KEY': 'COLE_SUA_VISION_KEY_AQUI'
  };
  
  // Validar se você editou os valores
  const valores = Object.values(configuracoes);
  if (valores.some(v => v.includes('COLE_'))) {
    Logger.log('');
    Logger.log('❌ ERRO: Você precisa editar os valores acima!');
    Logger.log('❌ Substitua todos os COLE_SEU_..._AQUI pelos valores reais');
    Logger.log('');
    Logger.log('📋 Propriedades que precisam ser configuradas:');
    Object.keys(configuracoes).forEach(key => {
      if (configuracoes[key].includes('COLE_')) {
        Logger.log(`   ❌ ${key}`);
      }
    });
    return;
  }
  
  // Salvar propriedades
  props.setProperties(configuracoes);
  
  // Confirmar
  Logger.log('');
  Logger.log('✅ Propriedades configuradas com sucesso!');
  Logger.log('');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('📋 PROPRIEDADES SALVAS:');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  
  // Listar (mascarando valores sensíveis)
  Object.keys(configuracoes).forEach(key => {
    Logger.log(`✅ ${key}:`);
    Logger.log(`   ${_mascararValorProp(key, props.getProperty(key))}`);
    Logger.log('');
  });
  
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  Logger.log('🎉 Setup completo!');
  Logger.log('');
  Logger.log('📝 PRÓXIMOS PASSOS:');
  Logger.log('1. Execute verificarProperties() para confirmar');
  Logger.log('2. Execute testarConexaoOdoo() para testar o Odoo');
  Logger.log('3. Execute configurarSegredoWebhook() e cole a URL na Meta');
  Logger.log('4. Delete ou comente este arquivo Setup.gs');
  Logger.log('');
}

/**
 * ============================================
 * BL-17 — SEGREDO DO WEBHOOK (OBRIGATÓRIO)
 * ============================================
 *
 * Gera um WEBHOOK_SECRET aleatório, salva nas Script Properties e imprime a
 * URL de callback completa para colar na Meta.
 *
 * ⚠️ ORDEM IMPORTA. O webhook rejeita todo POST sem o token correto, e o Apps
 * Script sempre responde 200 — ou seja, a Meta NÃO reenvia o que for rejeitado
 * e as mensagens são perdidas. Faça nesta ordem:
 *   1. Execute esta função e copie a URL impressa no log.
 *   2. Cole a URL na configuração do webhook na Meta (Callback URL).
 *   3. Só então republique o deployment com o código novo.
 *
 * Se o segredo já existir, a função não o troca — apenas reimprime a URL.
 */
function configurarSegredoWebhook() {
  const props = PropertiesService.getScriptProperties();

  if (!props.getProperty('WEBHOOK_SECRET')) {
    // UUID v4 do Apps Script é aleatório; dois deles dão 64 chars hex.
    const segredo = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('WEBHOOK_SECRET', segredo);
    Logger.log('✅ WEBHOOK_SECRET gerado e salvo.');
  } else {
    Logger.log('ℹ️ WEBHOOK_SECRET já existe — mantido.');
    Logger.log('   Para trocá-lo, apague a propriedade e rode esta função de novo.');
  }

  const segredo = props.getProperty('WEBHOOK_SECRET');

  let url = null;
  try {
    url = ScriptApp.getService().getUrl();
  } catch (e) {
    Logger.log(`⚠️ Não consegui obter a URL do deployment: ${e.message}`);
  }

  Logger.log('');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('📋 URL DE CALLBACK PARA A META');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (url) {
    Logger.log(`${url}?token=${segredo}`);
  } else {
    Logger.log(`<URL DO SEU DEPLOYMENT>/exec?token=${segredo}`);
    Logger.log('(pegue a URL em Implantar → Gerenciar implantações)');
  }
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  Logger.log('🔒 Esta URL contém o segredo — trate como credencial.');
  Logger.log('📝 Cole na Meta ANTES de republicar o deployment.');
  Logger.log('');
}

/**
 * ============================================
 * VERIFICAR SE AS PROPRIEDADES ESTÃO OK
 * ============================================
 */
function verificarProperties() {
  const props = PropertiesService.getScriptProperties();
  
  const propriedadesNecessarias = [
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_ID',
    'WEBHOOK_SECRET',
    'GOOGLE_VISION_API_KEY',
    'ODOO_URL',
    'ODOO_DATABASE',
    'ODOO_UID',
    'ODOO_API_KEY'
  ];
  
  Logger.log('');
  Logger.log('🔍 Verificando propriedades...');
  Logger.log('');
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  let todasConfiguradas = true;
  
  propriedadesNecessarias.forEach(prop => {
    const valor = props.getProperty(prop);
    const status = valor ? '✅' : '❌';
    
    let info;
    if (!valor) {
      info = 'NÃO CONFIGURADA';
      todasConfiguradas = false;
    } else {
      info = _mascararValorProp(prop, valor);
    }
    
    Logger.log(`${status} ${prop}: ${info}`);
  });
  
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  
  // BL-17: uid 2 é o administrador do Odoo. O bot só precisa dos modelos x_*,
  // então rodar como admin dá muito mais acesso do que a função exige — se as
  // credenciais vazarem, o estrago é o ERP inteiro, não só os dados do bot.
  if (props.getProperty('ODOO_UID') === '2') {
    Logger.log('');
    Logger.log('⚠️ ODOO_UID = 2 (administrador) — recomendado trocar:');
    Logger.log('   1. No Odoo, crie um usuário dedicado ao bot (ex.: "Bot Meu Dízimo").');
    Logger.log('   2. Dê acesso apenas aos modelos x_* que o bot usa.');
    Logger.log('   3. Gere uma API key para esse usuário.');
    Logger.log('   4. Atualize ODOO_UID e ODOO_API_KEY e rode testarConexaoOdoo().');
    Logger.log('');
  }

  if (todasConfiguradas) {
    Logger.log('✅ Todas as propriedades estão configuradas!');
    Logger.log('');
    Logger.log('🎉 Você pode começar a usar o bot!');
    Logger.log('');
    Logger.log('📝 Verificações recomendadas:');
    Logger.log('   - testarConexaoOdoo()');
    Logger.log('   - configurarSegredoWebhook()  (confere a URL de callback)');
    Logger.log('   A suíte completa (Tests.gs) não vai no deploy — ver .claspignore.');
  } else {
    Logger.log('❌ Algumas propriedades estão faltando.');
    Logger.log('');
    Logger.log('Execute setupProperties() para configurar.');
  }
  
  Logger.log('');
}

/**
 * Propriedades cujo valor pode aparecer inteiro no log.
 *
 * É uma lista de PERMITIDOS, não de proibidos, de propósito: assim qualquer
 * propriedade nova nasce mascarada. A regra anterior mascarava por substring do
 * nome ('KEY', 'TOKEN', 'API') e, por isso, imprimia o `WEBHOOK_SECRET` inteiro
 * no log — justamente o segredo que autentica o webhook. `WHATSAPP_PIN` tinha o
 * mesmo problema.
 */
const PROPS_NAO_SENSIVEIS = [
  'WHATSAPP_PHONE_ID',
  'ODOO_URL',
  'ODOO_DATABASE',
  'ODOO_UID',
  'NOTIFICACOES_ATIVAS'
];

/**
 * Devolve o valor pronto para log: inteiro se for inócuo, senão um prefixo
 * curto com o tamanho — o bastante para conferir qual valor está lá, sem
 * expor o segredo.
 * @private
 */
function _mascararValorProp(chave, valor) {
  if (!valor) return valor;
  if (PROPS_NAO_SENSIVEIS.indexOf(chave) >= 0) return valor;

  const texto = String(valor);
  // Valor curto (um PIN de 6 dígitos, por exemplo): qualquer prefixo já o
  // entregaria por inteiro. Nestes casos só o tamanho vai para o log.
  if (texto.length < 16) return `•••• (${texto.length} caracteres)`;

  return `${texto.substring(0, 6)}… (${texto.length} caracteres)`;
}

/**
 * ============================================
 * TESTAR CONEXÃO COM O ODOO
 * ============================================
 *
 * Faz uma leitura mínima para validar URL, database, uid e API key.
 * Vive aqui, e não em `Tests.gs`, porque a suíte de testes não vai no deploy
 * (ver `.claspignore` — BL-16); esta verificação precisa estar disponível no
 * projeto publicado, logo após a configuração.
 */
function testarConexaoOdoo() {
  Logger.log('');
  Logger.log('🔌 Testando conexão com o Odoo...');

  try {
    const comunidades = OdooService.searchRead(
      'x_comunidade', ['id', 'x_name'], [], { limit: 1 }
    );

    Logger.log('✅ Conexão OK — o Odoo respondeu.');
    Logger.log(`   Comunidades acessíveis: ${comunidades.length > 0 ? 'sim' : 'nenhuma encontrada'}`);

    const uid = PropertiesService.getScriptProperties().getProperty('ODOO_UID');
    Logger.log(`   Conectado com ODOO_UID = ${uid}${uid === '2' ? ' (administrador — ver BL-17)' : ''}`);

  } catch (e) {
    Logger.log(`❌ Falha na conexão: ${e.message}`);
    Logger.log('   Confira ODOO_URL, ODOO_DATABASE, ODOO_UID e ODOO_API_KEY com verificarProperties().');
  }

  Logger.log('');
}

/**
 * ============================================
 * LIMPAR TODAS AS PROPRIEDADES (CUIDADO!)
 * ============================================
 */
function limparTodasProperties() {
  const ui = SpreadsheetApp.getUi(); // Ou DocumentApp.getUi() ou FormApp.getUi()
  
  const resposta = ui.alert(
    'ATENÇÃO - OPERAÇÃO PERIGOSA',
    'Tem certeza que deseja DELETAR todas as propriedades?\n\nIsso irá apagar:\n- Tokens do WhatsApp\n- Credenciais do Odoo\n- Chave da Vision API\n\nVocê precisará executar setupProperties() novamente!',
    ui.ButtonSet.YES_NO
  );
  
  if (resposta === ui.Button.YES) {
    PropertiesService.getScriptProperties().deleteAllProperties();
    Logger.log('');
    Logger.log('🗑️ Todas as propriedades foram deletadas.');
    Logger.log('');
    Logger.log('Execute setupProperties() para reconfigurar.');
    Logger.log('');
  } else {
    Logger.log('');
    Logger.log('❌ Operação cancelada.');
    Logger.log('');
  }
}

/**
 * ============================================
 * ADICIONAR UMA PROPRIEDADE INDIVIDUAL
 * ============================================
 */
function adicionarPropriedade(chave, valor) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(chave, valor);
  
  Logger.log('');
  Logger.log(`✅ Propriedade "${chave}" adicionada/atualizada`);
  Logger.log('');
}

/**
 * ============================================
 * REMOVER UMA PROPRIEDADE INDIVIDUAL
 * ============================================
 */
function removerPropriedade(chave) {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(chave);
  
  Logger.log('');
  Logger.log(`🗑️ Propriedade "${chave}" removida`);
  Logger.log('');
}

/**
 * ============================================
 * LISTAR TODAS AS PROPRIEDADES (SEM VALORES)
 * ============================================
 */
function listarPropriedades() {
  const props = PropertiesService.getScriptProperties();
  const todasProps = props.getProperties();
  
  Logger.log('');
  Logger.log('📋 Propriedades configuradas:');
  Logger.log('');
  
  if (Object.keys(todasProps).length === 0) {
    Logger.log('   (nenhuma propriedade configurada)');
  } else {
    Object.keys(todasProps).forEach(key => {
      Logger.log(`   - ${key}`);
    });
  }
  
  Logger.log('');
  Logger.log(`Total: ${Object.keys(todasProps).length} propriedade(s)`);
  Logger.log('');
}

/**
 * ============================================
 * EXEMPLOS DE USO
 * ============================================
 */

// Adicionar uma propriedade específica:
// adicionarPropriedade('WHATSAPP_TOKEN', 'EAAxxxxx...');

// Remover uma propriedade específica:
// removerPropriedade('WHATSAPP_TOKEN');

// Ver todas as propriedades (apenas nomes, sem valores):
// listarPropriedades();