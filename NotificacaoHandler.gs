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
      // BL-24/BL-25: o disparo em lote é onde o throttling da Meta aparece, e
      // é o maior consumidor de cota do projeto. Não idempotente — só repete
      // em 429, que é exatamente o caso em que o lembrete não foi entregue.
      // Passa por Utils._post como todo o resto. O detalhe importa: este é o
      // ÚNICO fluxo que envia para número gravado no Odoo — o cenário do
      // BL-32 — e enquanto montava o POST por conta própria era justamente o
      // que escapava da conferência de destinatário. A proteção estava
      // instalada no caminho seguro e faltava no perigoso.
      const response = Utils._post(payload, {
        rotulo:   'WhatsApp template',
        mensagem: 'template'
      });
      if (!response) throw new Error('Falha ao enviar o template (sem resposta)');
      
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

/**
 * Os quatro números do escalonamento, lidos do Odoo. (BL-73)
 *
 * Vêm de `x_parametros`; o padrão de fábrica é NOTIFICACAO_PADRAO, em
 * Config.gs, e vale enquanto os campos não existirem, vierem vazios ou
 * vierem fora da faixa de NOTIFICACAO_LIMITES.
 *
 * FALHA DE LEITURA NÃO PARA O DISPARO. Se o Odoo não responder, o lembrete
 * do mês não pode deixar de sair por causa disso — sai com o padrão, que é
 * conservador por construção (janela curta, lote pequeno). O oposto seria
 * pior: uma instabilidade de rede às 9h suprimiria o disparo do dia inteiro.
 *
 * `horaFim <= horaInicio` é a única combinação que se rejeita como conjunto:
 * cada número sozinho estaria na faixa, mas juntos fecham a janela e nunca
 * mais sai lembrete nenhum — em silêncio, que é o jeito ruim de quebrar.
 *
 * @returns {{horaInicio:number, horaFim:number, intervaloHoras:number, lote:number, ajustes:string[]}}
 */
function lerEscalonamentoNotificacao() {
  const cfg = {
    horaInicio:     NOTIFICACAO_PADRAO.horaInicio,
    horaFim:        NOTIFICACAO_PADRAO.horaFim,
    intervaloHoras: NOTIFICACAO_PADRAO.intervaloHoras,
    lote:           NOTIFICACAO_PADRAO.lote,
    ajustes:        []
  };

  const CAMPOS = {
    horaInicio:     'x_studio_notif_hora_inicio',
    horaFim:        'x_studio_notif_hora_fim',
    intervaloHoras: 'x_studio_notif_intervalo',
    lote:           'x_studio_notif_lote'
  };

  let p;
  try {
    p = OdooService.buscarParametros() || {};
  } catch (e) {
    cfg.ajustes.push(`não li x_parametros (${e.message}) — tudo no padrão de fábrica`);
    return cfg;
  }

  Object.keys(CAMPOS).forEach((chave) => {
    const bruto = p[CAMPOS[chave]];
    // Campo ausente, nulo ou vazio: silêncio. É o caso normal enquanto o
    // instalador não rodou, e não merece linha de log a cada hora.
    if (bruto === undefined || bruto === null || bruto === false || bruto === '') return;

    const valor = Number(bruto);
    const lim   = NOTIFICACAO_LIMITES[chave];
    if (!Number.isFinite(valor) || !Number.isInteger(valor) || valor < lim.min || valor > lim.max) {
      cfg.ajustes.push(`${CAMPOS[chave]}="${bruto}" fora de ${lim.min}..${lim.max} — usando ${cfg[chave]}`);
      return;
    }
    cfg[chave] = valor;
  });

  if (cfg.horaFim <= cfg.horaInicio) {
    cfg.ajustes.push(`janela ${cfg.horaInicio}h–${cfg.horaFim}h é vazia — voltando ao padrão ` +
                     `${NOTIFICACAO_PADRAO.horaInicio}h–${NOTIFICACAO_PADRAO.horaFim}h`);
    cfg.horaInicio = NOTIFICACAO_PADRAO.horaInicio;
    cfg.horaFim    = NOTIFICACAO_PADRAO.horaFim;
  }

  return cfg;
}

/**
 * Esta hora é hora de disparar um lote? (BL-73)
 *
 * Duas perguntas, nesta ordem, e a segunda é a que o BL-73 acrescentou:
 *
 *   1. Está dentro da janela? (`horaInicio <= hora < horaFim`)
 *   2. Esta hora é um DEGRAU do escalonamento? Com início 9h e intervalo 2h,
 *      os degraus são 9, 11, 13, 15 — as horas 10, 12 e 14 caem na janela e
 *      mesmo assim não disparam. É o que transforma "de hora em hora" em
 *      "de duas em duas horas" sem trocar o acionador.
 *
 * POR QUE NÃO MUDAR O ACIONADOR PARA `everyHours(2)`: porque o intervalo
 * passaria a morar no Apps Script, e mudá-lo exigiria alguém abrir o editor
 * e reinstalar o acionador. O pedido era que TODOS os parâmetros fossem
 * configuráveis — o que só se sustenta se a decisão for tomada aqui, a cada
 * execução, com o número que está no Odoo agora.
 *
 * O preço são as execuções que acordam e não fazem nada (10h, 12h, 14h...).
 * Cada uma custa uma leitura de `x_parametros` e termina. É barato, e é o que
 * paga a configurabilidade.
 *
 * @param {number} hora - 0..23, no fuso da paróquia
 * @param {Object} cfg - o que `lerEscalonamentoNotificacao` devolveu
 * @returns {{disparar: boolean, motivo: string}}
 */
function ehHoraDeDisparar(hora, cfg) {
  const janela = `${cfg.horaInicio}h–${cfg.horaFim}h`;

  if (hora < cfg.horaInicio || hora >= cfg.horaFim) {
    return { disparar: false, motivo: `fora da janela (${hora}h; envia ${janela})` };
  }

  const degraus = [];
  for (let h = cfg.horaInicio; h < cfg.horaFim; h += cfg.intervaloHoras) degraus.push(h);

  if ((hora - cfg.horaInicio) % cfg.intervaloHoras !== 0) {
    return {
      disparar: false,
      motivo: `${hora}h não é degrau do escalonamento (a cada ${cfg.intervaloHoras}h: ` +
              `${degraus.map((h) => h + 'h').join(', ')})`
    };
  }

  return {
    disparar: true,
    motivo: `degrau de ${hora}h (janela ${janela}, a cada ${cfg.intervaloHoras}h, até ` +
            `${cfg.lote} por disparo — ${degraus.length} disparo(s) por dia, ` +
            `no máximo ${degraus.length * cfg.lote} lembrete(s))`
  };
}

function executarNotificacoesDiarias() {
  const t0 = Date.now();
  const agora = Plataforma.relogio.formatar(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  console.log(`━━━━━━ [Notif] INÍCIO da rotina de notificações — ${agora} (${TIMEZONE}) ━━━━━━`);

  try {
    // Etapa 0: interruptor global via Script Property NOTIFICACOES_ATIVAS.
    // Padrão: ATIVADO (ausente = ligado). Para desligar, defina
    // NOTIFICACOES_ATIVAS = 'false' em Script Properties.
    // (Antes lia de x_parametros_line, modelo inexistente no Odoo, o que poluía
    //  o log com um erro a cada execução — agora sem consulta que falha.)
    const flagNotif = Plataforma.propriedades.getProperty('NOTIFICACOES_ATIVAS');
    const desligado = ['false', '0', 'nao', 'não', 'off', 'desativado']
      .indexOf(String(flagNotif || '').trim().toLowerCase()) >= 0;

    console.log(`🔎 [Notif] NOTIFICACOES_ATIVAS = ` +
      (flagNotif === null ? '(ausente → ATIVADO)' : `"${flagNotif}"`));

    if (desligado) {
      console.log('⏹️ [Notif] Notificações desativadas (NOTIFICACOES_ATIVAS) — encerrando.');
      return;
    }

    // Etapa 1: o escalonamento (BL-73). O acionador roda de hora em hora; é
    // aqui que se decide se ESTA hora dispara um lote, e de que tamanho.
    // Vem antes do diagnóstico de credenciais de propósito: 20 das 24
    // execuções do dia terminam neste ponto, e não faz sentido gastar log
    // com configuração de WhatsApp numa execução que não vai enviar nada.
    const esc = lerEscalonamentoNotificacao();
    esc.ajustes.forEach((a) => console.warn(`⚠️ [Notif] parâmetro: ${a}`));

    const horaAtual = Number(Plataforma.relogio.formatar(new Date(), TIMEZONE, 'H'));
    const degrau = ehHoraDeDisparar(horaAtual, esc);
    if (!degrau.disparar) {
      console.log(`🌙 [Notif] ${degrau.motivo} — encerrando sem enviar.`);
      return;
    }
    console.log(`⏱️ [Notif] ${degrau.motivo}`);

    // Etapa 2: diagnóstico de configuração (sem expor segredos)
    try {
      const cfg = getConfig();
      console.log(`🔧 [Notif] Config OK — phoneId=${cfg.WHATSAPP_PHONE_ID} ` +
                  `token=${cfg.WHATSAPP_TOKEN ? 'presente' : 'AUSENTE'} ` +
                  `template="${CONFIG.TEMPLATES.LEMBRETE_DEVOLUCAO}"`);
    } catch (eCfg) {
      console.error(`❌ [Notif] Config inválida: ${eCfg.message}`);
      throw eCfg;
    }

    // Etapa 3: selecionar elegíveis — no MÁXIMO `esc.lote`.
    let dizimistasParaNotificar;
    try {
      dizimistasParaNotificar = buscarDizimistasElegiveis(esc.lote);
    } catch (eBusca) {
      console.error(`❌ [Notif] Falha ao buscar dizimistas elegíveis: ${eBusca.message}`);
      if (eBusca.stack) console.error(`❌ [Notif] Stack: ${eBusca.stack}`);
      throw eBusca;
    }

    console.log(`📊 [Notif] ${dizimistasParaNotificar.length} dizimista(s) neste lote ` +
                `(teto de ${esc.lote}).`);
    if (dizimistasParaNotificar.length === 0) {
      console.log('✅ [Notif] Ninguém a notificar neste disparo — encerrando.');
      return;
    }

    // Etapa 4: enviar
    let sucessos = 0;
    let erros    = 0;
    const falhas = [];

    for (let index = 0; index < dizimistasParaNotificar.length; index++) {
      const dizimista = dizimistasParaNotificar[index];

      if (index > 0) Plataforma.relogio.dormir(2000);  // Delay de 2s entre envios (rate limit)

      // BL-84: para antes do teto de 6 min do Apps Script — conferido DEPOIS
      // da pausa, que é quando o envio aconteceria. O resto do lote não se
      // perde: a repescagem o pega no próximo degrau.
      if (Date.now() - t0 > NOTIFICACAO_ORCAMENTO_MS) {
        console.warn(`⏱️ [Notif] Orçamento de tempo esgotado após ${index} envio(s) — ` +
                     `${dizimistasParaNotificar.length - index} ficam para o próximo degrau.`);
        break;
      }

      console.log(`➡️ [Notif] (${index + 1}/${dizimistasParaNotificar.length}) ` +
                  `id=${dizimista.id} ${dizimista.x_name}`);
      try {
        NotificacaoHandler.enviarLembreteSimples(dizimista);
        // BL-84: a marca vem ANTES do log. Se a gravação no Odoo falhar, o
        // log não existe e o próximo degrau lembraria a pessoa de novo — a
        // marca local segura o dia (6 h, o máximo do cache).
        Plataforma.cache.put(_chaveNotificado(dizimista.id), '1', 21600);
        registrarLogNotificacao(dizimista.id, 'sucesso', null);
        sucessos++;
      } catch (erro) {
        console.error(`❌ [Notif] Erro ao notificar id=${dizimista.id} (${dizimista.x_name}): ${erro.message}`);
        registrarLogNotificacao(dizimista.id, 'erro', erro.message);
        falhas.push(`${dizimista.id}:${dizimista.x_name}`);
        erros++;
      }
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    // Lote cheio quer dizer que provavelmente sobrou gente para o próximo
    // degrau — dizer isso no log evita a leitura errada de que só havia 20.
    const sobra = (sucessos + erros) >= esc.lote
      ? ' — lote cheio, o resto sai no próximo degrau'
      : '';
    console.log(`━━━━━━ [Notif] FIM — ${sucessos} sucesso(s), ${erros} erro(s) em ${dt}s${sobra} ━━━━━━`);
    if (erros > 0) console.error(`❌ [Notif] Falharam: ${falhas.join(', ')}`);

  } catch (erro) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`💥 [Notif] ERRO CRÍTICO após ${dt}s — a rotina foi abortada: ${erro.message}`);
    if (erro.stack) console.error(`💥 [Notif] Stack: ${erro.stack}`);
  } finally {
    // BL-25: o disparo mensal é, de longe, o maior consumidor de chamadas
    // externas do projeto — é ele que pode encostar na cota diária.
    Utils.registrarConsumoExterno();
  }
}

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

/**
 * Quem recebe lembrete NESTE disparo — no máximo `limite`. (BL-73)
 *
 * O `limite` não é um corte aplicado no fim: é uma PARADA. A seleção percorre
 * os candidatos em ordem e para assim que enche o lote. A diferença não é
 * cosmética — cada candidato custa duas consultas ao Odoo (`jaFoiNotificado`
 * e `jaDevolveu`), então filtrar 500 pessoas para depois jogar 480 fora
 * gastaria ~1000 RPCs e minutos de execução para enviar 20 mensagens. Com a
 * parada, o custo é proporcional ao lote, não ao tamanho da paróquia.
 *
 * O ARRASTO FUNCIONA porque quem já foi notificado sai da conta no disparo
 * seguinte (`jaFoiNotificadoEsteMes`) e porque a repescagem notifica a PARTIR
 * do dia de notificação, não só nele: os que sobraram continuam elegíveis
 * amanhã. Ninguém é perdido por ficar de fora de um lote — só adiado.
 *
 * A ORDEM é `dia_preferido asc, id asc`, e é ela que garante justiça: quem
 * venceu primeiro é notificado primeiro, e o desempate por id é estável, de
 * modo que a fila não embaralha entre disparos.
 *
 * @param {number} [limite] - teto do lote; sem ele, vale NOTIFICACAO_PADRAO.lote
 * @returns {Array<Object>}
 */
function buscarDizimistasElegiveis(limite) {
  const teto = (Number.isInteger(limite) && limite > 0)
    ? limite
    : NOTIFICACAO_PADRAO.lote;

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
    { limit: false, order: 'x_studio_dia_preferido asc, id asc' }
  );

  console.log(`🔎 [Notif] ${dizimistas.length} dizimista(s) ativo(s) com notificação ligada. ` +
              `Hoje é dia ${diaHoje} (${mesAtual}/${anoAtual}). Lote de até ${teto}.`);

  const elegiveis = [];
  let examinados = 0;

  for (let i = 0; i < dizimistas.length; i++) {
    if (elegiveis.length >= teto) {
      console.log(`⏹️ [Notif] Lote cheio (${teto}) após examinar ${examinados} de ` +
                  `${dizimistas.length} — o restante fica para o próximo disparo.`);
      break;
    }

    const d = dizimistas[i];
    const diaVencimento  = d.x_studio_dia_preferido || 10;
    const diaNotificacao = calcularDiaNotificacao(diaVencimento);

    // Repescagem: notifica a PARTIR do dia de notificação (não só no dia exato).
    // Se um disparo atrasar, pular a janela ou não couber no lote, o grupo é
    // recuperado no disparo seguinte — a deduplicação (jaFoiNotificadoEsteMes)
    // garante um único envio por mês, e jaDevolveueEsteMes evita lembrar quem
    // já devolveu.
    //
    // NÃO conta como "examinado": este teste é local, não custa RPC nenhuma.
    // Com a ordem por dia_preferido, os que ainda não venceram estão todos no
    // fim da lista — mas não se pode PARAR aqui, porque o teto de 28 dias do
    // `calcularDiaNotificacao` faz dias preferidos diferentes caírem no mesmo
    // dia de notificação, e a ordenação é pelo dia preferido, não por ele.
    if (diaHoje < diaNotificacao) {
      continue;   // ainda não chegou o dia deste dizimista
    }

    examinados++;

    // A partir daqui é candidato — logamos cada decisão.
    if (!d.x_studio_partner_phone) {
      console.warn(`⚠️ [Notif] id=${d.id} (${d.x_name}) SEM telefone — pulando.`);
      continue;
    }

    try {
      if (jaFoiNotificadoEsteMes(d.id, mesAtual, anoAtual)) {
        console.log(`⏭️ [Notif] id=${d.id} (${d.x_name}) já notificado este mês — pulando.`);
        continue;
      }
      if (jaDevolveueEsteMes(d.id, mesAtual, anoAtual)) {
        console.log(`⏭️ [Notif] id=${d.id} (${d.x_name}) já devolveu este mês — pulando.`);
        continue;
      }
    } catch (e) {
      // Erro ao consultar histórico no Odoo: não abortar a rotina inteira nem
      // arriscar notificação indevida — pula este e registra para análise.
      console.error(`❌ [Notif] Erro ao checar histórico de id=${d.id} (${d.x_name}): ${e.message} — pulando por segurança.`);
      continue;
    }

    console.log(`✔️ [Notif] id=${d.id} (${d.x_name}) elegível (dia preferido ${diaVencimento}).`);
    elegiveis.push(d);
  }

  return elegiveis;
}

function calcularDiaNotificacao(diaVencimento) {
  let diaNotificacao = diaVencimento + 2;
  
  if (diaNotificacao > 28) {
    diaNotificacao = 28;
  }
  
  return diaNotificacao;
}

/** Marca local de "lembrete enviado", por pessoa e mês (BL-84). @private */
function _chaveNotificado(dizimistaId) {
  return `notif_ok_${dizimistaId}_${getMesReferenciaAtual()}`;
}

/**
 * Já foi tratado este mês? Sim se houve um envio com sucesso — ou se já
 * falhou NOTIFICACAO_MAX_FALHAS_MES vezes (BL-84: o número com erro
 * permanente não pode ocupar o lote para sempre).
 *
 * A marca do cache vem primeiro: cobre o envio que saiu mas cujo log não
 * chegou ao Odoo, e não custa RPC.
 */
function jaFoiNotificadoEsteMes(dizimistaId, mes, ano) {
  const mesReferencia = `${ano}-${mes.toString().padStart(2, '0')}`;
  if (Plataforma.cache.get(`notif_ok_${dizimistaId}_${mesReferencia}`)) return true;

  const logs = OdooService.searchRead('x_notificacao_log', ['x_studio_status_envio'], [
    ['x_studio_dizimista', '=', dizimistaId],
    ['x_studio_mes_referencia', '=', mesReferencia],
    ['x_studio_tipo', '=', 'lembrete']
  ], { limit: 20 }) || [];

  if (logs.some(l => l.x_studio_status_envio === 'sucesso')) return true;

  const falhas = logs.filter(l => l.x_studio_status_envio === 'erro').length;
  if (falhas >= NOTIFICACAO_MAX_FALHAS_MES) {
    console.warn(`⚠️ [Notif] id=${dizimistaId}: ${falhas} falha(s) de envio este mês — ` +
                 `não tento mais. Confira o telefone no cadastro.`);
    return true;
  }
  return false;
}

/**
 * Já devolveu o DÍZIMO este mês? (BL-84)
 *
 * Contava qualquer x_devolucao: uma OFERTA no mês calava o lembrete do dízimo,
 * e uma devolução REJEITADA — que é dinheiro que não chegou à paróquia, por
 * exemplo chave errada — também. É o mesmo filtro de tipo do
 * `OdooService.devolucoesDoMes`.
 */
function jaDevolveueEsteMes(dizimistaId, mes, ano) {
  const primeiroDia = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
  const ultimoDia = new Date(ano, mes, 0).toISOString().split('T')[0];

  const devolucoes = OdooService.count('x_devolucao', OdooService._comTipo([
    ['x_studio_dizimista', '=', dizimistaId],
    ['x_studio_data_da_devolucao', '>=', primeiroDia],
    ['x_studio_data_da_devolucao', '<=', ultimoDia],
    ['x_studio_status', '!=', 'Rejeitado']
  ], 'dizimo'));

  return devolucoes > 0;
}

function registrarLogNotificacao(dizimistaId, status, mensagemErro) {
  const hoje = new Date();
  const mesReferencia = `${hoje.getFullYear()}-${(hoje.getMonth() + 1).toString().padStart(2, '0')}`;
  
  const payload = {
    // x_name (Descrição) é OBRIGATÓRIO no x_notificacao_log.
    x_name: `Lembrete ${mesReferencia} — dizimista ${dizimistaId} (${status})`,
    x_studio_dizimista: dizimistaId,
    x_studio_tipo: 'lembrete',
    // x_studio_data_envio é um campo DATE no Odoo → precisa de 'yyyy-MM-dd'.
    // Antes gravava toISOString() (datetime ISO), o que o Odoo rejeitava e
    // impedia o registro do log (quebrando a deduplicação).
    x_studio_data_envio: Plataforma.relogio.formatar(hoje, TIMEZONE, 'yyyy-MM-dd'),
    x_studio_mes_referencia: mesReferencia,
    x_studio_status_envio: status,
    x_studio_mensagem_erro: mensagemErro || false
  };
  
  // BL-84: três tentativas. O log é a deduplicação do mês — sem ele, a pessoa
  // é lembrada de novo. O `create` não se repete sozinho (não é idempotente),
  // e aqui repetir é seguro: um log duplicado não faz mal nenhum; um log
  // ausente manda uma mensagem a mais.
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const logId = OdooService.create('x_notificacao_log', payload);
      console.log(`🗒️ [Notif] Log gravado no Odoo (id=${logId}) — dizimista=${dizimistaId} status=${status} ref=${mesReferencia}`);
      return true;
    } catch (erro) {
      // Não relança: a falha em registrar o log não deve derrubar o envio.
      console.error(`❌ [Notif] Falha ao gravar log no Odoo (tentativa ${tentativa}/3, ` +
                    `dizimista=${dizimistaId} status=${status}): ${erro.message}`);
      if (tentativa < 3) Plataforma.relogio.dormir(1000);
    }
  }
  return false;
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
 * Instala o acionador que acorda a rotina DE HORA EM HORA.
 *
 * DE HORA EM HORA NÃO É A CADENA DE ENVIO. Quem decide se a execução dispara
 * um lote é `ehHoraDeDisparar`, com a janela e o intervalo que estão em
 * `x_parametros` naquele momento (BL-73). O acionador é só o despertador; o
 * horário está no Odoo, e mudá-lo lá NÃO exige rodar isto de novo — que é o
 * ponto de tê-lo lá.
 *
 * A deduplicação mensal garante um único envio por dizimista — desde que o log
 * (x_notificacao_log) esteja gravando; confirme com testarGravacaoLog.
 *
 * Menu do editor: Executar → instalarTriggerNotificacoes
 * (Rodar de novo substitui o acionador anterior, inclusive o diário antigo.)
 */
function instalarTriggerNotificacoes() {
  removerTriggerNotificacoes();

  // De hora em hora: é despertador; o disparo em si obedece x_parametros (BL-73).
  Plataforma.gatilhos.aCadaHoras('executarNotificacoesDiarias', 1);

  const p = NOTIFICACAO_PADRAO;
  console.log(`✅ Acionador instalado: executarNotificacoesDiarias (acorda de hora em hora).`);
  console.log(`ℹ️ O disparo obedece x_parametros. Sem eles vale o padrão de fábrica: ` +
              `${p.horaInicio}h–${p.horaFim}h, a cada ${p.intervaloHoras}h, ` +
              `até ${p.lote} por disparo.`);
  console.log(`ℹ️ Rode 'node ferramentas/instalar-escalonamento-notificacao.mjs --aplicar' ` +
              `para poder ajustar esses quatro números no Odoo.`);
}

/** Remove o(s) acionador(es) da rotina de notificações. */
function removerTriggerNotificacoes() {
  Plataforma.gatilhos.removerDe('executarNotificacoesDiarias');
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
  const props  = Plataforma.propriedades;
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
  } finally {
    // Este teste entrega um TEMPLATE COBRADO. Sem descarregar o contador aqui,
    // ele nunca entrava no total do mês — e `verificarConsumoMensagens` projeta
    // a fatura em cima desse número. O erro não era aleatório: subestimava
    // sempre, justamente porque só os pontos de entrada automáticos
    // descarregavam.
    Utils.registrarConsumoExterno();
  }
}

/**
 * DIAGNÓSTICO: confirma se dá para GRAVAR em x_notificacao_log com os campos
 * que o código usa. Grava um registro com tipo='lembrete' e status='erro' —
 * a deduplicação só considera status='sucesso', então NÃO bloqueia o envio
 * real de amanhã. Se falhar, o log aponta o campo/modelo problemático.
 * Depois de rodar, você pode apagar o registro criado no Odoo (Notificação Log).
 * Menu: Executar → testarGravacaoLog
 */
function testarGravacaoLog() {
  const props  = Plataforma.propriedades;
  const numero = props.getProperty('NUMERO_TESTE') || '5586988521231';

  let dizimista;
  try {
    dizimista = OdooService.buscarDizimistaPorWhatsapp(numero);
  } catch (e) {
    console.error(`❌ [Notif][TESTE-LOG] Erro ao buscar dizimista: ${e.message}`);
    return;
  }
  if (!dizimista) {
    console.error(`❌ [Notif][TESTE-LOG] Dizimista ${numero} não encontrado.`);
    return;
  }

  const hoje   = new Date();
  const mesRef = `${hoje.getFullYear()}-${(hoje.getMonth() + 1).toString().padStart(2, '0')}`;
  const payload = {
    x_name:                  `DIAGNÓSTICO — ${dizimista.x_name} — ${mesRef}`, // obrigatório
    x_studio_dizimista:      dizimista.id,
    x_studio_tipo:           'lembrete',
    x_studio_data_envio:     Plataforma.relogio.formatar(hoje, TIMEZONE, 'yyyy-MM-dd'), // campo DATE
    x_studio_mes_referencia: mesRef,
    x_studio_status_envio:   'erro',   // 'erro' NÃO conta na deduplicação (que exige 'sucesso')
    x_studio_mensagem_erro:  'DIAGNOSTICO BL-01 — pode apagar este registro'
  };

  console.log('🧪 [Notif][TESTE-LOG] Tentando gravar registro de diagnóstico em x_notificacao_log...');
  try {
    const id = OdooService.create('x_notificacao_log', payload);
    console.log(`✅ [Notif][TESTE-LOG] GRAVOU! id=${id}. Modelo e campos OK — a deduplicação vai funcionar amanhã.`);
    console.log('ℹ️ [Notif][TESTE-LOG] Pode apagar esse registro no Odoo (Notificação Log). Ele não bloqueia o envio real.');
  } catch (e) {
    console.error(`❌ [Notif][TESTE-LOG] FALHOU ao gravar: ${e.message}`);
    console.error('❌ [Notif][TESTE-LOG] Verifique se existem no modelo x_notificacao_log os campos: ' +
      'x_studio_dizimista, x_studio_tipo, x_studio_data_envio, x_studio_mes_referencia, x_studio_status_envio, x_studio_mensagem_erro.');
  }
}

// ============================================================================
// PRÉ-VISUALIZAÇÃO (dry-run) — quem seria notificado num determinado dia
// ============================================================================

/**
 * Lista, SEM enviar nada, os dizimistas que seriam notificados no dia informado.
 * Aplica exatamente as mesmas regras da rotina real (dia de notificação =
 * dia_preferido + 2, teto 28; pula quem já foi notificado ou já devolveu no mês;
 * pula sem telefone), mas apenas imprime no log.
 *
 * @param {number} [diaAlvo=15] - Dia de notificação a simular. Rodando sem
 *        argumento no editor, assume 15 (→ dia preferido 13).
 *
 * Menu: Executar → listarNotificacoesDoDia   (usa 15 por padrão)
 */
function listarNotificacoesDoDia(diaAlvo) {
  diaAlvo = diaAlvo || 15;

  const hoje     = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();

  console.log(`🔎 [Notif][PREVIEW] Quem seria notificado no DIA ${diaAlvo} ` +
              `(referência do mês ${mesAtual}/${anoAtual}) — nenhuma mensagem é enviada.`);

  let dizimistas;
  try {
    dizimistas = OdooService.searchRead(
      'x_dizimista',
      ['x_name', 'x_studio_partner_phone', 'x_studio_value', 'x_studio_dia_preferido'],
      [['x_active', '=', true], ['x_studio_notificacao_ativa', '=', true]],
      { limit: false }
    );
  } catch (e) {
    console.error(`❌ [Notif][PREVIEW] Erro ao buscar dizimistas no Odoo: ${e.message}`);
    return;
  }

  // Filtra os cujo dia de notificação (dia_preferido + 2, teto 28) cai no diaAlvo.
  const doDia = dizimistas.filter(d => calcularDiaNotificacao(d.x_studio_dia_preferido || 10) === diaAlvo);

  console.log(`📊 [Notif][PREVIEW] ${doDia.length} dizimista(s) com dia de notificação = ${diaAlvo} ` +
              `(entre ${dizimistas.length} ativos com notificação ligada).`);

  let receberao = 0;
  doDia.forEach((d, i) => {
    let status = 'ELEGÍVEL ✅';
    if (!d.x_studio_partner_phone) {
      status = 'PULADO — sem telefone';
    } else {
      try {
        if (jaFoiNotificadoEsteMes(d.id, mesAtual, anoAtual)) {
          status = 'PULADO — já notificado este mês';
        } else if (jaDevolveueEsteMes(d.id, mesAtual, anoAtual)) {
          status = 'PULADO — já devolveu este mês';
        }
      } catch (e) {
        status = `ERRO ao checar histórico: ${e.message}`;
      }
    }
    if (status.indexOf('ELEGÍVEL') === 0) receberao++;

    console.log(`  ${i + 1}. id=${d.id} | ${d.x_name} | fone=${d.x_studio_partner_phone || '-'} | ` +
                `valor=${d.x_studio_value} | diaPreferido=${d.x_studio_dia_preferido} | ${status}`);
  });

  console.log(`✅ [Notif][PREVIEW] RESULTADO: ${receberao} de ${doDia.length} receberão o lembrete no dia ${diaAlvo}.`);
}
// ============================================================================
// PRÉ-VISUALIZAÇÃO DO ESCALONAMENTO (BL-73)
// ============================================================================

/**
 * Mostra, sem enviar nada, COMO os lembretes estão escalonados agora: a
 * janela, os degraus do dia, o tamanho do lote e quantos dias levaria para
 * percorrer a fila de hoje.
 *
 * É o antídoto para o modo de falha silencioso deste desenho. Um lote pequeno
 * demais ou uma janela curta demais não dão erro nenhum — só fazem o lembrete
 * de alguém chegar dias depois, e ninguém descobre isso lendo o log de uma
 * execução que "terminou sem enviar". Aqui a conta aparece inteira.
 *
 * Menu do editor: Executar → previsaoEscalonamento
 */
function previsaoEscalonamento() {
  const esc = lerEscalonamentoNotificacao();
  esc.ajustes.forEach((a) => console.warn(`⚠️ parâmetro: ${a}`));

  const degraus = [];
  for (let h = esc.horaInicio; h < esc.horaFim; h += esc.intervaloHoras) degraus.push(h);

  const porDia = degraus.length * esc.lote;

  console.log(`⏱️ Janela: ${esc.horaInicio}h–${esc.horaFim}h (o fim é exclusivo — ` +
              `o último disparo é o de ${degraus[degraus.length - 1]}h).`);
  console.log(`⏱️ Disparos: ${degraus.map((h) => h + 'h').join(', ')} ` +
              `(a cada ${esc.intervaloHoras}h) — ${degraus.length} por dia.`);
  console.log(`📦 Lote: até ${esc.lote} por disparo → no máximo ${porDia} lembrete(s) por dia.`);

  let candidatos = null;
  try {
    const hoje = new Date();
    const diaHoje = hoje.getDate();
    const todos = OdooService.searchRead(
      'x_dizimista',
      ['x_studio_dia_preferido'],
      [['x_active', '=', true], ['x_studio_notificacao_ativa', '=', true]],
      { limit: false }
    );
    candidatos = todos.filter(
      (d) => diaHoje >= calcularDiaNotificacao(d.x_studio_dia_preferido || 10)
    ).length;
    console.log(`👥 ${candidatos} dizimista(s) já passaram do dia de notificação ` +
                `(entre ${todos.length} ativos com notificação ligada).`);
  } catch (e) {
    console.error(`❌ Não consegui contar os candidatos no Odoo: ${e.message}`);
  }

  if (candidatos === null) return;

  if (candidatos === 0) {
    console.log('✅ Fila vazia — nada a escalonar hoje.');
    return;
  }

  // Estimativa GROSSA de propósito: conta todo mundo que passou do dia, sem
  // descontar quem já foi notificado ou já devolveu — essas duas checagens
  // custam duas RPCs por pessoa, e aqui a pergunta é de dimensionamento, não
  // de quem exatamente recebe. O número real só cai; nunca sobe.
  const dias = Math.ceil(candidatos / porDia);
  console.log(`📆 Teto de ${dias} dia(s) para percorrer a fila ` +
              `(${candidatos} ÷ ${porDia} por dia). Quem já foi notificado ou já ` +
              `devolveu sai da conta, então na prática é menos.`);
  if (dias > 3) {
    console.warn(`⚠️ ${dias} dias é bastante para um lembrete mensal. Para encurtar: ` +
                 `aumente o lote, alargue a janela ou reduza o intervalo em x_parametros.`);
  }
}
