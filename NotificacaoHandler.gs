/**
 * ============================================================================
 * NOTIFICACAOHANDLER.GS - Bot Meu Dízimo - VERSÃO CORRIGIDA
 * ============================================================================
 * 
 * Handler de notificações via template WhatsApp
 * 
 * Versão: 1.1 - Corrigido
 * Alterações:
 * - Corrigido uso de CONFIG para getConfig()
 * - Atualizado template name
 */

const NotificacaoHandler = {
  /**
   * Enviar lembrete simples via template
   */
  enviarLembreteSimples(dizimista) {
    const config = getConfig();  // ✅ CORRIGido: buscar config dinamicamente
    
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: dizimista.x_studio_partner_phone,
      type: "template",
      template: {
        name: CONFIG.TEMPLATES.LEMBRETE_DEVOLUCAO,  // Nome do template aprovado
        language: {
          code: "pt_BR"
        },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: dizimista.x_name  // {{1}} - Nome
              },
              {
                type: "text",
                text: dizimista.x_studio_value.toFixed(2)  // {{2}} - Valor
              },
              {
                type: "text",
                text: dizimista.x_studio_dia_preferido.toString()  // {{3}} - Dia
              }
            ]
          }
        ]
      }
    };
    
    try {
      const response = UrlFetchApp.fetch(
        getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
        {
          method: 'post',
          contentType: 'application/json',
          headers: {
            'Authorization': `Bearer ${config.WHATSAPP_TOKEN}`
          },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        }
      );
      
      const resultado = JSON.parse(response.getContentText());
      
      if (response.getResponseCode() !== 200) {
        throw new Error(`Erro WhatsApp: ${resultado.error?.message || 'Desconhecido'}`);
      }
      
      Logger.log(`✅ Notificação enviada para ${dizimista.x_name}`);
      return resultado;
      
    } catch (erro) {
      Logger.log(`❌ Erro ao enviar para ${dizimista.x_name}: ${erro.message}`);
      throw erro;
    }
  }
};

// ============================================================================
// SCHEDULER - ROTINA DIÁRIA
// ============================================================================

function executarNotificacoesDiarias() {
  try {
    Logger.log('=== Iniciando rotina de notificações ===');
    
    const notificacoesAtivas = OdooService.buscarParametro('notificacao_ativa');
    if (notificacoesAtivas !== 'true') {
      Logger.log('❌ Notificações desativadas no sistema');
      return;
    }
    
    const dizimistasParaNotificar = buscarDizimistasElegiveis();
    
    Logger.log(`📊 Encontrados ${dizimistasParaNotificar.length} dizimistas para notificar`);
    
    if (dizimistasParaNotificar.length === 0) {
      Logger.log('✅ Nenhum dizimista para notificar hoje');
      return;
    }
    
    let sucessos = 0;
    let erros = 0;
    
    dizimistasParaNotificar.forEach((dizimista, index) => {
      try {
        if (index > 0) {
          Utilities.sleep(2000);  // Delay de 2s entre envios
        }
        
        NotificacaoHandler.enviarLembreteSimples(dizimista);
        registrarLogNotificacao(dizimista.id, 'sucesso', null);
        sucessos++;
        
      } catch (erro) {
        Logger.log(`❌ Erro ao notificar ${dizimista.x_name}: ${erro.message}`);
        registrarLogNotificacao(dizimista.id, 'erro', erro.message);
        erros++;
      }
    });
    
    Logger.log(`=== Rotina concluída: ${sucessos} sucessos, ${erros} erros ===`);
    
  } catch (erro) {
    Logger.log(`❌ Erro crítico na rotina: ${erro.message}`);
  }
}

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

function buscarDizimistasElegiveis() {
  const hoje = new Date();
  const diaHoje = hoje.getDate();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();
  
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
  
  return dizimistas.filter(d => {
    const diaVencimento = d.x_studio_dia_preferido || 10;
    const diaNotificacao = calcularDiaNotificacao(diaVencimento);
    
    if (diaNotificacao !== diaHoje) {
      return false;
    }
    
    if (jaFoiNotificadoEsteMes(d.id, mesAtual, anoAtual)) {
      Logger.log(`${d.x_name} já foi notificado este mês. Pulando.`);
      return false;
    }
    
    if (jaDevolveueEsteMes(d.id, mesAtual, anoAtual)) {
      Logger.log(`${d.x_name} já devolveu este mês. Pulando notificação.`);
      return false;
    }
    
    return true;
  });
}

function calcularDiaNotificacao(diaVencimento) {
  let diaNotificacao = diaVencimento + 2;
  
  if (diaNotificacao > 28) {
    diaNotificacao = 28;
  }
  
  return diaNotificacao;
}

function jaFoiNotificadoEsteMes(dizimistaId, mes, ano) {
  const mesReferencia = `${ano}-${mes.toString().padStart(2, '0')}`;
  
  const logs = OdooService.executar(
    'x_notificacao_log',
    'search_count',
    [[
      ['x_studio_dizimista', '=', dizimistaId],
      ['x_studio_mes_referencia', '=', mesReferencia],
      ['x_studio_tipo', '=', 'lembrete'],
      ['x_studio_status_envio', '=', 'sucesso']
    ]]
  );
  
  return logs > 0;
}

function jaDevolveueEsteMes(dizimistaId, mes, ano) {
  const primeiroDia = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
  const ultimoDia = new Date(ano, mes, 0).toISOString().split('T')[0];
  
  const devolucoes = OdooService.executar(
    'x_devolucao',
    'search_count',
    [[
      ['x_studio_dizimista', '=', dizimistaId],
      ['x_studio_date', '>=', primeiroDia],
      ['x_studio_date', '<=', ultimoDia]
    ]]
  );
  
  return devolucoes > 0;
}

function registrarLogNotificacao(dizimistaId, status, mensagemErro) {
  const hoje = new Date();
  const mesReferencia = `${hoje.getFullYear()}-${(hoje.getMonth() + 1).toString().padStart(2, '0')}`;
  
  const payload = {
    x_studio_dizimista: dizimistaId,
    x_studio_tipo: 'lembrete',
    x_studio_data_envio: hoje.toISOString(),
    x_studio_mes_referencia: mesReferencia,
    x_studio_status_envio: status,
    x_studio_mensagem_erro: mensagemErro || false
  };
  
  try {
    OdooService.executar('x_notificacao_log', 'create', [payload]);
  } catch (erro) {
    Logger.log(`Erro ao registrar log: ${erro.message}`);
  }
}

function getMesReferenciaAtual() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = (hoje.getMonth() + 1).toString().padStart(2, '0');
  return `${ano}-${mes}`;
}

// ============================================================================
// PROCESSAR RESPOSTA DO USUÁRIO
// ============================================================================

function processarRespostaNotificacao(from, mensagem) {
  const texto = mensagem.text.body.toLowerCase().trim();
  
  if (texto.includes('devolver')) {
    DevolucaoHandler.iniciar(from);
    return;
  }
  
  if (texto.includes('histórico') || texto.includes('historico')) {
    HistoricoHandler.mostrar(from);
    return;
  }
}