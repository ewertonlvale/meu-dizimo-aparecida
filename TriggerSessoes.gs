/**
 * ============================================================================
 * TRIGGERSESSOES.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Trigger agendada para detectar e tratar sessões de cadastro abandonadas.
 * Executa a cada 5 minutos via time-driven trigger.
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
 * Chamada automaticamente pela trigger a cada 5 minutos.
 */
function verificarSessoesAbandonadas() {
  console.log('🔄 [Trigger] Verificando sessões abandonadas...');

  try {
    // Garante que o OAuth seja exercitado mesmo se não houver sessões
    Plataforma.gatilhos.exercitarAutorizacao();

    const cache   = Plataforma.cache;
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
          // BL-84: a marca de início vive 2 h (StateManager.SESSAO_INICIO_TTL_S),
          // o dobro da sessão. Se sumiu e a conversa ainda está de pé, foi o
          // cache que a despejou antes da hora — e apagar aqui jogava fora o
          // cadastro de quem estava digitando, sem aviso. Recomeça a contagem.
          const estado = StateManager.getEstado(from);
          if (estado && estado !== ESTADOS.MENU) {
            console.warn(`♻️ [Trigger] Marca de início de ${from} sumiu com a conversa ativa ` +
                         `(${estado}) — despejo do cache; recomeçando a contagem`);
            cache.put(`sessao_inicio_${from}`, Date.now().toString(), StateManager.SESSAO_INICIO_TTL_S);
            return;
          }
          console.log(`🗑️ [Trigger] Sessão de ${from} já expirou do cache`);
          _tentarPersistir(from, cache);
          StateManager.limparDados(from);
          persistidas++;
          return;
        }

        const minutosDecorridos = (Date.now() - parseInt(inicio)) / 60000;

        if (minutosDecorridos >= 60) {   // BL-03: sessão de 60 min (alinha com o texto ao usuário)
          console.log(`⏰ [Trigger] Sessão de ${from} com ${Math.floor(minutosDecorridos)} min — persistindo`);
          _tentarPersistir(from, cache);
          StateManager.limparDados(from);
          persistidas++;
          return;
        }

        if (minutosDecorridos >= 50) {   // BL-03: aviso 10 min antes de expirar
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
  } finally {
    // BL-25: em `finally` porque o corpo tem um return antecipado quando não há
    // sessão ativa. Esta trigger roda a cada 5 min de qualquer forma, então é o
    // lugar natural para o acompanhamento da cota — sem agendamento próprio.
    Utils.registrarConsumoExterno();

    // As duas verificações liam o store INTEIRO cada uma — tokens, media_id_*,
    // sessao_ativa_*, todos os shards de cota. Agora dividem uma leitura só.
    //
    // A leitura é AQUI, e não no topo da função, de propósito: o
    // `registrarConsumoExterno` acima acabou de gravar os contadores desta
    // execução, e um mapa lido antes dele não os teria. Seria um subregistro
    // silencioso — o mesmo defeito que este ciclo corrigiu em outros pontos.
    // Por isso são duas varreduras por execução, não uma: a de sessões
    // acontece antes das escritas e não pode ser reaproveitada aqui.
    const propsAtuais = Plataforma.propriedades.getProperties();
    Utils.verificarCotaUrlFetch(propsAtuais);
    Utils.verificarCotaMensagens(propsAtuais);
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

  Plataforma.gatilhos.aCadaMinutos('verificarSessoesAbandonadas', 5);

  console.log('✅ Trigger instalada: verificarSessoesAbandonadas a cada 5 minutos');
}

/**
 * Remove todas as triggers de verificação de sessões.
 * Útil para manutenção ou desativação.
 */
function removerTriggerSessoes() {
  const removidas = Plataforma.gatilhos.removerDe('verificarSessoesAbandonadas');

  if (removidas > 0) {
    console.log(`🗑️ ${removidas} trigger(s) removida(s)`);
  }
}