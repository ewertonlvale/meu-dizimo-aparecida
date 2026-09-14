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

    console.log(`📤 [Notif] Enviando template "${CONFIG.TEMPLATES.LEMBRETE_DEVOLUCAO}" ` +
                `para dizimista id=${dizimista.id} (${dizimista.x_name}) fone=${dizimista.x_studio_partner_phone}`);

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
                text: dizimista.x_name || 'Dizimista'  // {{1}} - Nome
              },
              {
                type: "text",
                text: Number(dizimista.x_studio_value || 0).toFixed(2)  // {{2}} - Valor
              },
              {
                type: "text",
                text: String(dizimista.x_studio_dia_preferido || 10)  // {{3}} - Dia
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
      
      const statusCode = response.getResponseCode();
      const corpo      = response.getContentText();
      let resultado;
      try {
        resultado = JSON.parse(corpo);
      } catch (eParse) {
        // Resposta não-JSON (ex.: HTML de erro 5xx) — logar o corpo bruto ajuda a diagnosticar.
        console.error(`❌ [Notif] Resposta não-JSON (HTTP ${statusCode}) para id=${dizimista.id}: ${corpo}`);
        throw new Error(`Resposta inválida do WhatsApp (HTTP ${statusCode})`);
      }

      if (statusCode !== 200) {
        const err = resultado.error || {};
        console.error(`❌ [Notif] WhatsApp HTTP ${statusCode} para id=${dizimista.id} (${dizimista.x_name}): ` +
          `code=${err.code} type=${err.type} msg="${err.message}" ` +
          `details="${err.error_data?.details || ''}" fbtrace=${err.fbtrace_id || ''}`);
        console.error(`❌ [Notif] Corpo completo: ${corpo}`);
        throw new Error(`Erro WhatsApp (HTTP ${statusCode}): ${err.message || 'Desconhecido'}`);
      }

      const msgId = resultado.messages?.[0]?.id || '(sem id)';
      const statusMsg = resultado.messages?.[0]?.message_status || '';
      console.log(`✅ [Notif] Enviado para id=${dizimista.id} (${dizimista.x_name}) — messageId=${msgId} ${statusMsg}`);
      return resultado;

    } catch (erro) {
      console.error(`❌ [Notif] Falha ao enviar para id=${dizimista.id} (${dizimista.x_name}): ${erro.message}`);
      if (erro.stack) console.error(`❌ [Notif] Stack: ${erro.stack}`);
      throw erro;
    }
  }
};

// ============================================================================
// SCHEDULER - ROTINA DIÁRIA
// ============================================================================

function executarNotificacoesDiarias() {
  const t0 = Date.now();
  const agora = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  console.log(`━━━━━━ [Notif] INÍCIO da rotina de notificações — ${agora} (${TIMEZONE}) ━━━━━━`);

  try {
    // Etapa 0: diagnóstico de configuração (sem expor segredos)
    try {
      const cfg = getConfig();
      console.log(`🔧 [Notif] Config OK — phoneId=${cfg.WHATSAPP_PHONE_ID} ` +
                  `token=${cfg.WHATSAPP_TOKEN ? 'presente' : 'AUSENTE'} ` +
                  `template="${CONFIG.TEMPLATES.LEMBRETE_DEVOLUCAO}"`);
    } catch (eCfg) {
      console.error(`❌ [Notif] Config inválida: ${eCfg.message}`);
      throw eCfg;
    }

    // Etapa 1: flag global de notificações no Odoo
    let notificacoesAtivas;
    try {
      notificacoesAtivas = OdooService.buscarParametro('notificacao_ativa');
    } catch (eParam) {
      console.error(`❌ [Notif] Falha ao ler parâmetro 'notificacao_ativa' no Odoo: ${eParam.message}`);
      throw eParam;
    }
    console.log(`🔎 [Notif] Parâmetro notificacao_ativa = "${notificacoesAtivas}"`);
    if (notificacoesAtivas !== 'true') {
      console.log('⏹️ [Notif] Notificações desativadas no sistema — encerrando.');
      return;
    }

    // Etapa 2: selecionar elegíveis
    let dizimistasParaNotificar;
    try {
      dizimistasParaNotificar = buscarDizimistasElegiveis();
    } catch (eBusca) {
      console.error(`❌ [Notif] Falha ao buscar dizimistas elegíveis: ${eBusca.message}`);
      if (eBusca.stack) console.error(`❌ [Notif] Stack: ${eBusca.stack}`);
      throw eBusca;
    }

    console.log(`📊 [Notif] ${dizimistasParaNotificar.length} dizimista(s) elegível(is) hoje.`);
    if (dizimistasParaNotificar.length === 0) {
      console.log('✅ [Notif] Nenhum dizimista para notificar hoje — encerrando.');
      return;
    }

    // Etapa 3: enviar
    let sucessos = 0;
    let erros    = 0;
    const falhas = [];

    dizimistasParaNotificar.forEach((dizimista, index) => {
      console.log(`➡️ [Notif] (${index + 1}/${dizimistasParaNotificar.length}) ` +
                  `id=${dizimista.id} ${dizimista.x_name}`);
      try {
        if (index > 0) Utilities.sleep(2000);  // Delay de 2s entre envios (rate limit)

        NotificacaoHandler.enviarLembreteSimples(dizimista);
        registrarLogNotificacao(dizimista.id, 'sucesso', null);
        sucessos++;
      } catch (erro) {
        console.error(`❌ [Notif] Erro ao notificar id=${dizimista.id} (${dizimista.x_name}): ${erro.message}`);
        registrarLogNotificacao(dizimista.id, 'erro', erro.message);
        falhas.push(`${dizimista.id}:${dizimista.x_name}`);
        erros++;
      }
    });

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`━━━━━━ [Notif] FIM — ${sucessos} sucesso(s), ${erros} erro(s) em ${dt}s ━━━━━━`);
    if (erros > 0) console.error(`❌ [Notif] Falharam: ${falhas.join(', ')}`);

  } catch (erro) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`💥 [Notif] ERRO CRÍTICO após ${dt}s — a rotina foi abortada: ${erro.message}`);
    if (erro.stack) console.error(`💥 [Notif] Stack: ${erro.stack}`);
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
  
  const dizimistas = OdooService.searchRead(
    'x_dizimista',
    ['x_name', 'x_studio_partner_phone', 'x_studio_value', 'x_studio_dia_preferido'],
    filtros,
    { limit: false }
  );

  console.log(`🔎 [Notif] ${dizimistas.length} dizimista(s) ativo(s) com notificação ligada. ` +
              `Hoje é dia ${diaHoje} (${mesAtual}/${anoAtual}).`);

  const elegiveis = dizimistas.filter(d => {
    const diaVencimento  = d.x_studio_dia_preferido || 10;
    const diaNotificacao = calcularDiaNotificacao(diaVencimento);

    // Fora do dia de notificação deste dizimista: silencioso (seria muito verboso).
    if (diaNotificacao !== diaHoje) {
      return false;
    }

    // A partir daqui é candidato do dia — logamos cada decisão.
    if (!d.x_studio_partner_phone) {
      console.warn(`⚠️ [Notif] id=${d.id} (${d.x_name}) SEM telefone — pulando.`);
      return false;
    }

    try {
      if (jaFoiNotificadoEsteMes(d.id, mesAtual, anoAtual)) {
        console.log(`⏭️ [Notif] id=${d.id} (${d.x_name}) já notificado este mês — pulando.`);
        return false;
      }
      if (jaDevolveueEsteMes(d.id, mesAtual, anoAtual)) {
        console.log(`⏭️ [Notif] id=${d.id} (${d.x_name}) já devolveu este mês — pulando.`);
        return false;
      }
    } catch (e) {
      // Erro ao consultar histórico no Odoo: não abortar a rotina inteira nem
      // arriscar notificação indevida — pula este e registra para análise.
      console.error(`❌ [Notif] Erro ao checar histórico de id=${d.id} (${d.x_name}): ${e.message} — pulando por segurança.`);
      return false;
    }

    console.log(`✔️ [Notif] id=${d.id} (${d.x_name}) elegível (dia preferido ${diaVencimento}).`);
    return true;
  });

  return elegiveis;
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
  
  const logs = OdooService.count('x_notificacao_log', [
    ['x_studio_dizimista', '=', dizimistaId],
    ['x_studio_mes_referencia', '=', mesReferencia],
    ['x_studio_tipo', '=', 'lembrete'],
    ['x_studio_status_envio', '=', 'sucesso']
  ]);

  return logs > 0;
}

function jaDevolveueEsteMes(dizimistaId, mes, ano) {
  const primeiroDia = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
  const ultimoDia = new Date(ano, mes, 0).toISOString().split('T')[0];
  
  const devolucoes = OdooService.count('x_devolucao', [
    ['x_studio_dizimista', '=', dizimistaId],
    ['x_studio_data_da_devolucao', '>=', primeiroDia],
    ['x_studio_data_da_devolucao', '<=', ultimoDia]
  ]);

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
    const logId = OdooService.create('x_notificacao_log', payload);
    console.log(`🗒️ [Notif] Log gravado no Odoo (id=${logId}) — dizimista=${dizimistaId} status=${status} ref=${mesReferencia}`);
  } catch (erro) {
    // Não relança: a falha em registrar o log não deve derrubar o envio.
    console.error(`❌ [Notif] Falha ao gravar log no Odoo (dizimista=${dizimistaId} status=${status}): ${erro.message}`);
  }
}

function getMesReferenciaAtual() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = (hoje.getMonth() + 1).toString().padStart(2, '0');
  return `${ano}-${mes}`;
}

// ============================================================================
// INSTALAÇÃO DO ACIONADOR (executar UMA VEZ no editor)
// ============================================================================

/**
 * Instala o acionador diário que dispara os lembretes.
 * A própria executarNotificacoesDiarias decide, dia a dia, quem notificar
 * (com base no dia preferido de cada dizimista), então basta rodar 1x/dia.
 *
 * Menu do editor: Executar → instalarTriggerNotificacoes
 */
function instalarTriggerNotificacoes() {
  removerTriggerNotificacoes();

  ScriptApp.newTrigger('executarNotificacoesDiarias')
    .timeBased()
    .everyDays(1)
    .atHour(9)          // ~09h no fuso do projeto (America/Sao_Paulo)
    .create();

  console.log('✅ Acionador instalado: executarNotificacoesDiarias (diário, ~09h)');
}

/** Remove o(s) acionador(es) da rotina de notificações. */
function removerTriggerNotificacoes() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'executarNotificacoesDiarias') {
      ScriptApp.deleteTrigger(t);
    }
  });
}

// NOTA: a resposta do usuário ao lembrete (botão "Devolver agora" do template)
// é tratada no Router (mensagem type 'button' → DevolucaoHandler.iniciarDevolucao).
// A antiga processarRespostaNotificacao foi removida (código morto e quebrado:
// chamava DevolucaoHandler.iniciar e HistoricoHandler.mostrar, inexistentes).

// ============================================================================
// TESTE MANUAL — enviar UM lembrete AGORA (ignora o filtro de dia/mês)
// ============================================================================

/**
 * Envia imediatamente um lembrete de devolução para um número, para validar
 * o template e a integração sem esperar o dia do mês. NÃO grava log no Odoo
 * (para não bloquear o envio real do mês nem depender do modelo x_notificacao_log).
 *
 * Como usar:
 *   1. Defina o número em Script Properties na chave NUMERO_TESTE
 *      (formato internacional, ex.: 5586988521231) — ou edite a const abaixo.
 *   2. No editor: Executar → testarNotificacaoAgora
 *   3. Acompanhe os logs [Notif][TESTE] na aba Execuções.
 */
function testarNotificacaoAgora() {
  const props  = PropertiesService.getScriptProperties();
  const numero = props.getProperty('NUMERO_TESTE') || '5586988521231'; // <- ajuste se necessário

  console.log(`🧪 [Notif][TESTE] Lembrete imediato para ${numero} (ignora filtro de dia/mês)`);

  let dizimista;
  try {
    dizimista = OdooService.buscarDizimistaPorWhatsapp(numero);
  } catch (e) {
    console.error(`❌ [Notif][TESTE] Erro ao buscar dizimista no Odoo: ${e.message}`);
    if (e.stack) console.error(`❌ [Notif][TESTE] Stack: ${e.stack}`);
    return;
  }

  if (!dizimista) {
    console.error(`❌ [Notif][TESTE] Nenhum dizimista com o número ${numero}. ` +
      `Cadastre esse número no bot ou ajuste NUMERO_TESTE.`);
    return;
  }

  console.log(`🧪 [Notif][TESTE] Dizimista id=${dizimista.id} (${dizimista.x_name}) ` +
    `valor=${dizimista.x_studio_value} dia=${dizimista.x_studio_dia_preferido}`);

  try {
    NotificacaoHandler.enviarLembreteSimples(dizimista);
    console.log('✅ [Notif][TESTE] Lembrete de teste enviado — verifique o WhatsApp.');
  } catch (e) {
    console.error(`❌ [Notif][TESTE] Falha no envio de teste: ${e.message}`);
  }
}