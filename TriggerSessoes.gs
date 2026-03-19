/**
 * ============================================================================
 * TRIGGERSESSOES.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Trigger agendada para detectar e tratar sessões de cadastro abandonadas.
 * Executa a cada 20 minutos via time-driven trigger.
 *
 * Responsabilidades:
 * - Verificar sessões de cadastro que expiraram silenciosamente
 * - Persistir log e etapa de abandono no Odoo antes que o cache expire
 * - Limpar dados de sessões expiradas
 *
 * Versão: 1.0
 * Data: Fevereiro 2026
 */

/**
 * Verifica sessões de cadastro ativas e persiste dados de sessões
 * que estão prestes a expirar ou já expiraram.
 *
 * Lógica:
 * - Sessão com ≥ 55 minutos: persiste log no Odoo e limpa cache
 * - Sessão com ≥ 50 minutos sem aviso prévio: envia aviso ao usuário
 *
 * Chamada automaticamente pela trigger a cada 20 minutos.
 */
function verificarSessoesAbandonadas() {
  console.log('🔄 [Trigger] Verificando sessões abandonadas...');

  try {
    // Garante que o OAuth seja exercitado mesmo se não houver sessões
    ScriptApp.getOAuthToken();

    const cache   = CacheService.getScriptCache();
    const sessoes = StateManager.getSessoesAtivas();

    if (sessoes.length === 0) {
      console.log('✅ [Trigger] Nenhuma sessão ativa');
      return;
    }

    console.log(`📋 [Trigger] ${sessoes.length} sessão(ões) ativa(s)`);

    let persistidas = 0;
    let avisadas    = 0;

    sessoes.forEach(from => {
      try {
        const inicio = cache.get(`sessao_inicio_${from}`);

        if (!inicio) {
          console.log(`🗑️ [Trigger] Sessão de ${from} já expirou do cache`);
          _tentarPersistir(from, cache);
          StateManager.limparDados(from);
          persistidas++;
          return;
        }

        const minutosDecorridos = (Date.now() - parseInt(inicio)) / 60000;

        if (minutosDecorridos >= 15) {
          console.log(`⏰ [Trigger] Sessão de ${from} com ${Math.floor(minutosDecorridos)} min — persistindo`);
          _tentarPersistir(from, cache);
          StateManager.limparDados(from);
          persistidas++;
          return;
        }

        if (minutosDecorridos >= 10) {
          const jaAvisado = cache.get(`aviso_sessao_${from}`);
          if (!jaAvisado) {
            console.log(`⚠️ [Trigger] Enviando aviso de expiração para ${from}`);
            StateManager.verificarExpiracaoSessao(from, StateManager.getEstado(from));
            avisadas++;
          }
        }
      } catch (eInner) {
        console.warn(`⚠️ [Trigger] Erro ao processar sessão ${from}:`, eInner.message);
        // Não relança — continua processando as demais sessões
      }
    });

    console.log(`✅ [Trigger] Concluído: ${persistidas} persistida(s), ${avisadas} avisada(s)`);

  } catch (e) {
    // Erro geral — loga mas NÃO relança para o GAS não contar como falha
    console.error('❌ [Trigger] Erro geral em verificarSessoesAbandonadas:', e.message);
  }
}

/**
 * Tenta persistir log e etapa de abandono no Odoo.
 * @private
 */
function _tentarPersistir(from, cache) {
  try {
    const estado = StateManager.getEstado(from);
    const log    = cache.get(`log_cadastro_${from}`);

    // Só persiste se havia algo relevante
    if (log || (estado && estado !== ESTADOS.MENU)) {
      const payload = {
        x_studio_cadastrou:      false,
        x_studio_etapa_abandono: estado || 'EXPIRADO'
      };
      if (log) payload.x_studio_log_cadastro = log;
      OdooService.atualizarContatoBot(from, payload);
      console.log(`📋 [Trigger] Log persistido para ${from}`);
    }
  } catch (e) {
    console.warn(`⚠️ [Trigger] Erro ao persistir log de ${from}:`, e.message);
  }
}

// ============================================================================
// SETUP E REMOÇÃO DA TRIGGER
// ============================================================================

/**
 * Instala a trigger de verificação de sessões abandonadas.
 * Executar manualmente UMA VEZ no editor do Apps Script.
 *
 * Menu: Executar → instalarTriggerSessoes
 */
function instalarTriggerSessoes() {
  // Remove triggers anteriores para evitar duplicatas
  removerTriggerSessoes();

  ScriptApp.newTrigger('verificarSessoesAbandonadas')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('✅ Trigger instalada: verificarSessoesAbandonadas a cada 20 minutos');
}

/**
 * Remove todas as triggers de verificação de sessões.
 * Útil para manutenção ou desativação.
 */
function removerTriggerSessoes() {
  const triggers = ScriptApp.getProjectTriggers();
  let removidas = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'verificarSessoesAbandonadas') {
      ScriptApp.deleteTrigger(trigger);
      removidas++;
    }
  });

  if (removidas > 0) {
    console.log(`🗑️ ${removidas} trigger(s) removida(s)`);
  }
}