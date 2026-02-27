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
    const valor = props.getProperty(key);
    
    // Mascarar tokens e keys
    let valorExibido = valor;
    if (key.includes('KEY') || key.includes('TOKEN') || key.includes('API')) {
      if (valor.length > 20) {
        valorExibido = valor.substring(0, 10) + '...' + valor.substring(valor.length - 5);
      } else {
        valorExibido = valor.substring(0, 10) + '...';
      }
    }
    
    Logger.log(`✅ ${key}:`);
    Logger.log(`   ${valorExibido}`);
    Logger.log('');
  });
  
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  Logger.log('🎉 Setup completo!');
  Logger.log('');
  Logger.log('📝 PRÓXIMOS PASSOS:');
  Logger.log('1. Execute verificarProperties() para confirmar');
  Logger.log('2. Execute testarOdooService() para testar Odoo');
  Logger.log('3. Execute testarMenuCompleto() para testar WhatsApp');
  Logger.log('4. Delete ou comente este arquivo Setup.gs');
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
      // Mascarar valores sensíveis
      if (prop.includes('KEY') || prop.includes('TOKEN') || prop.includes('API')) {
        info = valor.substring(0, 10) + '...';
      } else {
        info = valor;
      }
    }
    
    Logger.log(`${status} ${prop}: ${info}`);
  });
  
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('');
  
  if (todasConfiguradas) {
    Logger.log('✅ Todas as propriedades estão configuradas!');
    Logger.log('');
    Logger.log('🎉 Você pode começar a usar o bot!');
    Logger.log('');
    Logger.log('📝 Testes recomendados:');
    Logger.log('   - testarOdooService()');
    Logger.log('   - testarMenuCompleto()');
  } else {
    Logger.log('❌ Algumas propriedades estão faltando.');
    Logger.log('');
    Logger.log('Execute setupProperties() para configurar.');
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