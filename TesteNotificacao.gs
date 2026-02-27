/**
 * ============================================================================
 * TESTES_NOTIFICACAO.GS - Bot Meu Dízimo
 * ============================================================================
 * 
 * Funções para testar o sistema de notificações ANTES de ativar o trigger
 * automático. Use estas funções no Google Apps Script para validar tudo.
 * 
 * Como usar:
 * 1. Copie este arquivo para o seu projeto Google Apps Script
 * 2. Execute as funções de teste uma a uma
 * 3. Verifique os logs (View → Logs ou Ctrl+Enter)
 * 4. Valide no WhatsApp se a mensagem chegou
 * 
 * Versão: 1.0
 * Data: Fevereiro 2026
 */

// ============================================================================
// TESTE 1: ENVIO MANUAL PARA UM NÚMERO ESPECÍFICO
// ============================================================================

/**
 * Teste mais simples - envia notificação para UM dizimista específico
 * 
 * Como usar:
 * 1. Substitua o número pelo seu número de teste
 * 2. Execute esta função (Run → testeNotificacaoManual)
 * 3. Verifique os logs
 * 4. Confira se chegou no WhatsApp
 */
function testeNotificacaoManual() {
  Logger.log('========================================');
  Logger.log('TESTE 1: Envio Manual de Notificação');
  Logger.log('========================================\n');
  
  // ⚠️ SUBSTITUA ESTE NÚMERO PELO SEU NÚMERO DE TESTE
  const numeroTeste = '558688521231';  // Formato: 55 + DDD + número
  
  Logger.log(`📱 Buscando dizimista: ${numeroTeste}`);
  
  try {
    // Buscar dizimista no Odoo
    const dizimista = OdooService.buscarDizimistaPorWhatsapp(numeroTeste);
    
    if (!dizimista) {
      Logger.log('❌ ERRO: Dizimista não encontrado!');
      Logger.log('💡 Certifique-se de que o número está cadastrado no Odoo');
      return;
    }
    
    Logger.log(`✅ Dizimista encontrado: ${dizimista.x_name}`);
    Logger.log(`📊 Dados do dizimista:`);
    Logger.log(`   - Nome: ${dizimista.x_name}`);
    Logger.log(`   - Valor mensal: R$ ${dizimista.x_studio_value}`);
    Logger.log(`   - Dia preferido: ${dizimista.x_studio_dia_preferido || 'Não definido'}`);
    Logger.log(`   - Notificação ativa: ${dizimista.x_studio_notificacao_ativa || false}`);
    
    // Validar campos necessários
    if (!dizimista.x_studio_dia_preferido) {
      Logger.log('⚠️ AVISO: Dizimista não tem dia preferido configurado!');
      Logger.log('💡 Usando dia padrão: 10');
      dizimista.x_studio_dia_preferido = 10;
    }
    
    if (!dizimista.x_studio_value) {
      Logger.log('⚠️ AVISO: Dizimista não tem valor mensal configurado!');
      Logger.log('💡 Usando valor padrão: 100.00');
      dizimista.x_studio_value = 100.00;
    }
    
    Logger.log('\n📤 Enviando notificação...\n');
    
    // Enviar notificação
    const resultado = NotificacaoHandler.enviarLembreteSimples(dizimista);
    
    Logger.log('✅ SUCESSO! Notificação enviada!');
    Logger.log(`📊 Resposta do WhatsApp:`);
    Logger.log(JSON.stringify(resultado, null, 2));
    
    Logger.log('\n✅ TESTE CONCLUÍDO COM SUCESSO!');
    Logger.log('📱 Verifique seu WhatsApp para confirmar o recebimento');
    
  } catch (erro) {
    Logger.log('\n❌ ERRO NO TESTE:');
    Logger.log(erro.toString());
    Logger.log('\n🔍 Possíveis causas:');
    Logger.log('1. Template não aprovado no WhatsApp');
    Logger.log('2. Token do WhatsApp inválido');
    Logger.log('3. Número de telefone incorreto');
    Logger.log('4. Campos faltando no Odoo');
    Logger.log('\n💡 Verifique o erro acima para mais detalhes');
  }
  
  Logger.log('\n========================================');
}

// ============================================================================
// TESTE 2: SIMULAR ROTINA COMPLETA (SEM ENVIAR)
// ============================================================================

/**
 * Simula a rotina completa sem enviar notificações
 * Útil para validar a lógica de seleção de dizimistas
 * 
 * Como usar:
 * 1. Execute esta função
 * 2. Verifique nos logs quais dizimistas SERIAM notificados
 * 3. Valide se a lógica está correta
 */
function testeSimularRotina() {
  Logger.log('========================================');
  Logger.log('TESTE 2: Simulação da Rotina Completa');
  Logger.log('========================================\n');
  
  try {
    // Verificar parâmetro de ativação
    Logger.log('1️⃣ Verificando parâmetro de ativação...');
    const notificacoesAtivas = OdooService.buscarParametro('notificacao_ativa');
    Logger.log(`   Status: ${notificacoesAtivas || 'não configurado'}`);
    
    if (notificacoesAtivas !== 'true') {
      Logger.log('⚠️ AVISO: Notificações estão desativadas no sistema!');
      Logger.log('💡 Para ativar, adicione em x_parametros_line:');
      Logger.log('   Chave: notificacao_ativa');
      Logger.log('   Valor: true');
    }
    
    // Buscar dizimistas elegíveis
    Logger.log('\n2️⃣ Buscando dizimistas elegíveis...');
    const hoje = new Date();
    const diaHoje = hoje.getDate();
    Logger.log(`   Data atual: ${hoje.toLocaleDateString('pt-BR')}`);
    Logger.log(`   Dia do mês: ${diaHoje}`);
    
    const filtros = [
      ['x_active', '=', true],
      ['x_studio_notificacao_ativa', '=', true]
    ];
    
    const dizimistas = OdooService.executar(
      'x_dizimista',
      'search_read',
      [filtros],
      {
        fields: [
          'x_name',
          'x_studio_partner_phone',
          'x_studio_value',
          'x_studio_dia_preferido'
        ]
      }
    );
    
    Logger.log(`   Total de dizimistas com notificação ativa: ${dizimistas.length}`);
    
    if (dizimistas.length === 0) {
      Logger.log('\n⚠️ NENHUM DIZIMISTA COM NOTIFICAÇÃO ATIVA!');
      Logger.log('💡 Cadastre dizimistas com x_studio_notificacao_ativa = true');
      return;
    }
    
    // Filtrar por critérios
    Logger.log('\n3️⃣ Aplicando filtros de elegibilidade...\n');
    
    let countDiaCorreto = 0;
    let countJaNotificado = 0;
    let countJaDevolveu = 0;
    let countElegivel = 0;
    
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    
    dizimistas.forEach((d, index) => {
      const diaVencimento = d.x_studio_dia_preferido || 10;
      const diaNotificacao = calcularDiaNotificacao(diaVencimento);
      
      Logger.log(`${index + 1}. ${d.x_name}`);
      Logger.log(`   Dia preferido: ${diaVencimento}`);
      Logger.log(`   Dia notificação: ${diaNotificacao} (vencimento + 2)`);
      Logger.log(`   Dia hoje: ${diaHoje}`);
      
      if (diaNotificacao !== diaHoje) {
        Logger.log(`   ❌ NÃO elegível - Hoje não é o dia de notificar`);
        return;
      }
      countDiaCorreto++;
      Logger.log(`   ✅ Dia correto!`);
      
      if (jaFoiNotificadoEsteMes(d.id, mesAtual, anoAtual)) {
        Logger.log(`   ❌ NÃO elegível - Já foi notificado este mês`);
        countJaNotificado++;
        return;
      }
      Logger.log(`   ✅ Não foi notificado ainda`);
      
      if (jaDevolveueEsteMes(d.id, mesAtual, anoAtual)) {
        Logger.log(`   ❌ NÃO elegível - Já devolveu este mês`);
        countJaDevolveu++;
        return;
      }
      Logger.log(`   ✅ Não devolveu ainda`);
      
      Logger.log(`   🎯 ELEGÍVEL PARA NOTIFICAÇÃO!`);
      countElegivel++;
      Logger.log('');
    });
    
    // Resumo
    Logger.log('\n📊 RESUMO DA SIMULAÇÃO:');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.log(`Total de dizimistas ativos:        ${dizimistas.length}`);
    Logger.log(`Dia correto para notificar:        ${countDiaCorreto}`);
    Logger.log(`Já foram notificados este mês:     ${countJaNotificado}`);
    Logger.log(`Já devolveram este mês:            ${countJaDevolveu}`);
    Logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    Logger.log(`🎯 ELEGÍVEIS PARA NOTIFICAÇÃO:     ${countElegivel}`);
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (countElegivel === 0) {
      Logger.log('\n💡 DICA: Para testar, você pode:');
      Logger.log('1. Criar um dizimista de teste');
      Logger.log('2. Configurar dia_preferido = dia de hoje - 2');
      Logger.log('3. Ativar notificação (notificacao_ativa = true)');
      Logger.log('4. Executar o teste novamente');
    }
    
    Logger.log('\n✅ SIMULAÇÃO CONCLUÍDA!');
    
  } catch (erro) {
    Logger.log('\n❌ ERRO NA SIMULAÇÃO:');
    Logger.log(erro.toString());
  }
  
  Logger.log('\n========================================');
}

// ============================================================================
// TESTE 3: FORÇAR ENVIO PARA TODOS (USO CUIDADOSO!)
// ============================================================================

/**
 * ⚠️ CUIDADO: Esta função envia notificação para TODOS os dizimistas
 * com notificação ativa, independente do dia ou se já foram notificados.
 * 
 * Use APENAS para testes em ambiente de desenvolvimento!
 * 
 * Como usar:
 * 1. Certifique-se de que está em ambiente de teste
 * 2. Defina limite máximo de envios (padrão: 3)
 * 3. Execute e verifique
 */
function testeEnvioForcado() {
  Logger.log('========================================');
  Logger.log('⚠️ TESTE 3: Envio Forçado (CUIDADO!)');
  Logger.log('========================================\n');
  
  const LIMITE_TESTE = 3;  // ⚠️ Máximo de notificações para enviar
  
  Logger.log(`⚠️ Esta função enviará notificações para até ${LIMITE_TESTE} dizimistas`);
  Logger.log('⏸️ Aguardando 5 segundos... (Ctrl+C para cancelar)');
  Utilities.sleep(5000);
  
  Logger.log('\n▶️ Iniciando envio...\n');
  
  try {
    // Buscar dizimistas
    const filtros = [
      ['x_active', '=', true],
      ['x_studio_notificacao_ativa', '=', true]
    ];
    
    const dizimistas = OdooService.executar(
      'x_dizimista',
      'search_read',
      [filtros],
      {
        fields: [
          'x_name',
          'x_studio_partner_phone',
          'x_studio_value',
          'x_studio_dia_preferido'
        ],
        limit: LIMITE_TESTE
      }
    );
    
    Logger.log(`📊 Encontrados ${dizimistas.length} dizimistas`);
    Logger.log(`📤 Enviando para os primeiros ${Math.min(LIMITE_TESTE, dizimistas.length)}...\n`);
    
    let sucessos = 0;
    let erros = 0;
    
    dizimistas.forEach((dizimista, index) => {
      try {
        Logger.log(`${index + 1}. ${dizimista.x_name}...`);
        
        // Delay entre envios
        if (index > 0) {
          Utilities.sleep(2000);
        }
        
        // Enviar
        NotificacaoHandler.enviarLembreteSimples(dizimista);
        
        Logger.log(`   ✅ Enviado com sucesso`);
        sucessos++;
        
      } catch (erro) {
        Logger.log(`   ❌ Erro: ${erro.message}`);
        erros++;
      }
      
      Logger.log('');
    });
    
    Logger.log('\n📊 RESULTADO:');
    Logger.log(`✅ Sucessos: ${sucessos}`);
    Logger.log(`❌ Erros: ${erros}`);
    Logger.log(`📊 Total: ${sucessos + erros}`);
    
    Logger.log('\n✅ TESTE CONCLUÍDO!');
    
  } catch (erro) {
    Logger.log('\n❌ ERRO NO TESTE:');
    Logger.log(erro.toString());
  }
  
  Logger.log('\n========================================');
}

// ============================================================================
// TESTE 4: VALIDAR CONFIGURAÇÃO
// ============================================================================

/**
 * Valida todas as configurações necessárias antes de usar o sistema
 * Execute PRIMEIRO para verificar se tudo está configurado
 */
function testeValidarConfiguracao() {
  Logger.log('========================================');
  Logger.log('TESTE 4: Validação de Configuração');
  Logger.log('========================================\n');
  
  let todosOk = true;
  
  // 1. WhatsApp Config
  Logger.log('1️⃣ Testando configuração do WhatsApp...');
  try {
    const config = getConfig();
    
    if (config.WHATSAPP_TOKEN) {
      Logger.log('   ✅ WHATSAPP_TOKEN configurado');
    } else {
      Logger.log('   ❌ WHATSAPP_TOKEN não configurado!');
      todosOk = false;
    }
    
    if (config.WHATSAPP_PHONE_ID) {
      Logger.log('   ✅ WHATSAPP_PHONE_ID configurado');
    } else {
      Logger.log('   ❌ WHATSAPP_PHONE_ID não configurado!');
      todosOk = false;
    }
    
  } catch (erro) {
    Logger.log(`   ❌ Erro ao buscar config: ${erro.message}`);
    todosOk = false;
  }
  
  // 2. Odoo Config
  Logger.log('\n2️⃣ Testando configuração do Odoo...');
  try {
    const odooConfig = getOdooConfig();
    
    if (odooConfig.apiKey) {
      Logger.log('   ✅ ODOO_API_KEY configurada');
    } else {
      Logger.log('   ❌ ODOO_API_KEY não configurada!');
      todosOk = false;
    }
    
    Logger.log(`   ℹ️ URL: ${odooConfig.url}`);
    Logger.log(`   ℹ️ Database: ${odooConfig.database}`);
    
  } catch (erro) {
    Logger.log(`   ❌ Erro ao buscar config Odoo: ${erro.message}`);
    todosOk = false;
  }
  
  // 3. Template Config
  Logger.log('\n3️⃣ Testando configuração do Template...');
  try {
    const templateName = CONFIG.TEMPLATES.LEMBRETE_DEVOLUCAO;
    
    if (templateName) {
      Logger.log(`   ✅ Template configurado: ${templateName}`);
    } else {
      Logger.log('   ❌ Template não configurado!');
      todosOk = false;
    }
    
  } catch (erro) {
    Logger.log(`   ❌ Erro: ${erro.message}`);
    todosOk = false;
  }
  
  // 4. Parâmetros no Odoo
  Logger.log('\n4️⃣ Testando parâmetros no Odoo...');
  try {
    const paramAtivo = OdooService.buscarParametro('notificacao_ativa');
    
    if (paramAtivo === 'true') {
      Logger.log('   ✅ Notificações ativas no sistema');
    } else if (paramAtivo === 'false') {
      Logger.log('   ⚠️ Notificações DESATIVADAS no sistema');
      Logger.log('   💡 Para ativar, mude o parâmetro para "true"');
    } else {
      Logger.log('   ⚠️ Parâmetro "notificacao_ativa" não encontrado');
      Logger.log('   💡 Crie em x_parametros_line:');
      Logger.log('      Chave: notificacao_ativa');
      Logger.log('      Valor: true');
    }
    
  } catch (erro) {
    Logger.log(`   ❌ Erro ao buscar parâmetros: ${erro.message}`);
    todosOk = false;
  }
  
  // 5. Campos no Odoo
  Logger.log('\n5️⃣ Testando campos no Odoo...');
  try {
    const dizimistas = OdooService.executar(
      'x_dizimista',
      'search_read',
      [[['x_active', '=', true]]],
      {
        fields: ['x_name', 'x_studio_notificacao_ativa', 'x_studio_dia_preferido'],
        limit: 1
      }
    );
    
    if (dizimistas.length > 0) {
      const d = dizimistas[0];
      
      if ('x_studio_notificacao_ativa' in d) {
        Logger.log('   ✅ Campo x_studio_notificacao_ativa existe');
      } else {
        Logger.log('   ❌ Campo x_studio_notificacao_ativa NÃO existe!');
        Logger.log('   💡 Crie o campo no modelo x_dizimista');
        todosOk = false;
      }
      
      if ('x_studio_dia_preferido' in d) {
        Logger.log('   ✅ Campo x_studio_dia_preferido existe');
      } else {
        Logger.log('   ❌ Campo x_studio_dia_preferido NÃO existe!');
        Logger.log('   💡 Crie o campo no modelo x_dizimista');
        todosOk = false;
      }
      
    } else {
      Logger.log('   ⚠️ Nenhum dizimista encontrado para testar campos');
    }
    
  } catch (erro) {
    Logger.log(`   ❌ Erro ao verificar campos: ${erro.message}`);
    todosOk = false;
  }
  
  // 6. Modelo de Log
  Logger.log('\n6️⃣ Testando modelo x_notificacao_log...');
  try {
    const logs = OdooService.executar(
      'x_notificacao_log',
      'search_read',
      [[]],
      { fields: ['id'], limit: 1 }
    );
    
    Logger.log('   ✅ Modelo x_notificacao_log existe');
    
  } catch (erro) {
    Logger.log('   ❌ Modelo x_notificacao_log NÃO existe!');
    Logger.log('   💡 Crie o modelo customizado no Odoo');
    todosOk = false;
  }
  
  // Resultado final
  Logger.log('\n========================================');
  if (todosOk) {
    Logger.log('✅ TODAS AS CONFIGURAÇÕES OK!');
    Logger.log('🚀 Sistema pronto para uso!');
  } else {
    Logger.log('❌ ALGUMAS CONFIGURAÇÕES FALTANDO!');
    Logger.log('📋 Revise os itens marcados com ❌ acima');
  }
  Logger.log('========================================\n');
  
  return todosOk;
}

// ============================================================================
// TESTE 5: TESTE DE INTEGRAÇÃO COMPLETO
// ============================================================================

/**
 * Teste completo: valida configuração + simula rotina + envia para 1 dizimista
 * Este é o teste mais completo antes de ativar o trigger
 */
function testeIntegracaoCompleto() {
  Logger.log('========================================');
  Logger.log('🧪 TESTE 5: Integração Completa');
  Logger.log('========================================\n');
  
  // Passo 1: Validar configuração
  Logger.log('PASSO 1: Validando configuração...\n');
  const configOk = testeValidarConfiguracao();
  
  if (!configOk) {
    Logger.log('\n❌ Corrija as configurações antes de continuar!');
    return;
  }
  
  Logger.log('\n⏸️ Aguardando 3 segundos...\n');
  Utilities.sleep(3000);
  
  // Passo 2: Simular rotina
  Logger.log('PASSO 2: Simulando rotina de seleção...\n');
  testeSimularRotina();
  
  Logger.log('\n⏸️ Aguardando 3 segundos...\n');
  Utilities.sleep(3000);
  
  // Passo 3: Enviar notificação de teste
  Logger.log('PASSO 3: Enviando notificação de teste...\n');
  Logger.log('⚠️ Certifique-se de configurar seu número no testeNotificacaoManual()');
  Logger.log('⏸️ Cancelando envio automático. Execute testeNotificacaoManual() manualmente.\n');
  
  Logger.log('========================================');
  Logger.log('✅ TESTE DE INTEGRAÇÃO CONCLUÍDO!');
  Logger.log('========================================\n');
  Logger.log('📋 PRÓXIMOS PASSOS:');
  Logger.log('1. Execute testeNotificacaoManual() para enviar uma notificação real');
  Logger.log('2. Verifique se chegou no WhatsApp');
  Logger.log('3. Se tudo estiver ok, configure o trigger diário');
  Logger.log('4. Monitor os logs nas primeiras execuções');
  Logger.log('========================================\n');
}