/**
 * ============================================================================
 * WEBHOOK.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Ponto de entrada do Google Apps Script.
 * Responsabilidades:
 * - Responder à verificação do webhook (GET)
 * - Receber mensagens do WhatsApp (POST)
 * - Registrar primeiro contato no Odoo (x_contato_bot)
 * - Delegar para o Router
 *
 * Versão: 10.0
 * Data: Fevereiro 2026
 */

// ============================================================================
// VERIFICAÇÃO DO WEBHOOK (GET)
// ============================================================================

/**
 * Atende a requisição de verificação enviada pela Meta ao configurar o webhook.
 * Retorna o hub.challenge se o token bater com VERIFY_TOKEN.
 */
function doGet(e) {
  const config    = getConfig();
  const mode      = e.parameter['hub.mode'];
  const token     = e.parameter['hub.verify_token'];
  const challenge = e.parameter['hub.challenge'];

  if (mode === 'subscribe' && token === config.VERIFY_TOKEN) {
    console.log('✅ Webhook verificado com sucesso!');
    return ContentService.createTextOutput(challenge);
  }

  console.log('❌ Falha na verificação do webhook');
  return ContentService
    .createTextOutput('Forbidden')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================================
// RECEBIMENTO DE MENSAGENS (POST)
// ============================================================================

/**
 * Recebe o payload do WhatsApp e delega o processamento ao Router.
 * Implementa idempotência via CacheService para evitar processamento
 * duplicado em caso de reenvio pelo WhatsApp (timeout).
 */
function doPost(e) {
  try {
    // ── Autenticação do webhook (segredo na URL) ────────────────────────────
    // Headers não são acessíveis no Apps Script, então autenticamos por um
    // segredo na query string (?token=...), que a Meta preserva na callback.
    //
    // BL-17: fail-closed. Sem segredo configurado, REJEITA. O deployment é
    // ANYONE_ANONYMOUS: aceitar POST não autenticado permitiria a qualquer um
    // forjar mensagens do WhatsApp e injetar cadastros/devoluções no fluxo.
    const segredo = getWebhookSecret();
    if (!segredo) {
      console.error('🚫 POST rejeitado: WEBHOOK_SECRET não configurado. ' +
                    'Rode configurarSegredoWebhook() (Setup.gs) e atualize a URL na Meta.');
      return ContentService.createTextOutput('Forbidden');
    }
    if (e.parameter.token !== segredo) {
      console.warn('🚫 POST rejeitado: token de webhook inválido ou ausente');
      return ContentService.createTextOutput('Forbidden');
    }

    const body = JSON.parse(e.postData.contents);

    // BL-09: a Meta pode agrupar várias entradas/mensagens num único POST.
    // Iteramos entry[] → changes[] → value.messages[], processando TODAS.
    const entries = Array.isArray(body.entry) ? body.entry : [];
    let processadas = 0;

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        // Callbacks de status vêm no mesmo formato das mensagens. Registrar as
        // falhas é o único jeito de saber por que uma mensagem aceita pela
        // Meta (HTTP 200 no envio) não chegou ao aparelho: o motivo só existe
        // aqui. Sem isto, "não chegou" fica sem diagnóstico nenhum.
        _registrarStatusEntrega(change.value && change.value.statuses);

        // O número do próprio bot, dito pela Meta. Vem em TODO callback, de
        // graça, e é verdade de fato — ao contrário da Script Property
        // `WHATSAPP_NUMERO_EXIBICAO`, que alguém digita à mão e que já entrou
        // sem o código do país, quebrando o link do convite (A10).
        _guardarNumeroDoBot(change.value && change.value.metadata);

        const messages = change.value && change.value.messages;
        if (!Array.isArray(messages)) continue;   // ex.: eventos de status

        // BL-29: quando a Meta agrupa várias mensagens num POST, a ordem do
        // array NÃO é garantida — a própria documentação manda usar o campo
        // `timestamp`. Aqui a ordem correta é conhecida e está toda em mãos,
        // então ordenar é conserto, não mitigação: dentro de um lote, o
        // atropelo deixa de existir.
        //
        // `sort` estável no V8, então mensagens do mesmo segundo mantêm a
        // ordem em que vieram — que é o melhor palpite disponível.
        const emOrdem = messages.slice().sort(
          (a, b) => (parseInt(a.timestamp, 10) || 0) - (parseInt(b.timestamp, 10) || 0)
        );

        for (const message of emOrdem) {
          // Isola cada mensagem: uma falha não impede as demais do lote.
          try {
            _processarMensagemWebhook(message);
            processadas++;
          } catch (errMsg) {
            console.error(`❌ Erro ao processar mensagem ${message && message.id}:`, errMsg);
          }
        }
      }
    }

    if (!processadas) {
      console.log('ℹ️ POST sem mensagens de usuário (provável evento de status).');
    }

    return ContentService.createTextOutput('OK');

  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    console.error('Stack:', error.stack);
    return ContentService.createTextOutput('Error');
  } finally {
    // BL-25: em `finally`, como nos outros dois pontos de entrada. Antes ficava
    // antes do `return` do caminho feliz, então execução que estourasse perdia
    // a contagem do lote inteiro — justamente as execuções anômalas, que são as
    // que mais consumiram chamadas antes de quebrar. O erro não era aleatório:
    // subestimava sempre.
    Utils.registrarConsumoExterno();
  }
}

/**
 * Guarda o número do bot que veio no `metadata` da Meta.
 *
 * Escreve só quando muda. Um `setProperty` por mensagem recebida seria uma
 * escrita por conversa, o dia inteiro, para gravar sempre a mesma coisa.
 *
 * @param {Object} metadata - change.value.metadata
 * @private
 */
function _guardarNumeroDoBot(metadata) {
  const bruto = metadata && metadata.display_phone_number;
  if (!bruto) return;

  const digitos = String(bruto).replace(/\D/g, '');
  if (!digitos) return;

  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('WHATSAPP_NUMERO_BOT') === digitos) return;
    props.setProperty('WHATSAPP_NUMERO_BOT', digitos);
    console.log(`📞 [Bot] Número próprio confirmado pela Meta: ${digitos}`);
  } catch (e) {
    console.warn('⚠️ [Bot] Não consegui guardar o número próprio:', e.message);
  }
}

/**
 * Registra o resultado de entrega que a Meta devolve para cada mensagem enviada.
 *
 * Só as FALHAS viram log de erro; `sent`, `delivered` e `read` ficam em debug,
 * senão o log vira ruído — são três callbacks por mensagem entregue.
 *
 * Por que importa: o 200 do envio diz apenas que a Meta aceitou a mensagem na
 * fila. Uma mensagem pode ser aceita e nunca chegar (aparelho com WhatsApp
 * antigo demais para o recurso, número inválido, janela fechada), e o motivo
 * só aparece neste callback. Antes disto o webhook descartava tudo e o
 * sintoma ficava sendo "não chegou", sem diagnóstico.
 *
 * @param {Array} statuses - change.value.statuses do payload da Meta
 * @private
 */
function _registrarStatusEntrega(statuses) {
  if (!Array.isArray(statuses) || !statuses.length) return;

  statuses.forEach(st => {
    const situacao = st && st.status;

    if (situacao !== 'failed') {
      console.log(`📬 [Entrega] ${st.id} → ${situacao}`);
      return;
    }

    const erros = Array.isArray(st.errors) ? st.errors : [];
    if (!erros.length) {
      console.error(`❌ [Entrega] ${st.id} FALHOU (sem detalhe da Meta)`);
      return;
    }

    erros.forEach(e => {
      // `error_data.details` é onde a Meta põe o motivo real; `title` e
      // `message` costumam ser genéricos.
      const detalhe = (e.error_data && e.error_data.details) || e.message || '';
      console.error(`❌ [Entrega] ${st.id} FALHOU — código ${e.code}: ${e.title || ''} ${detalhe}`.trim());

      // BL-32: este é o ponto em que o nono dígito se revela, e é o único
      // sinal confiável — a resposta do envio devolve 200 e o número como
      // veio. Sugerir aqui a outra forma poupa a investigação inteira.
      _sugerirOutroNumero(st.recipient_id);
    });
  });
}

/**
 * Numa falha de entrega, aponta a outra forma possível do número (BL-32).
 *
 * Silencioso quando não há alternativa plausível: um número estrangeiro ou um
 * fixo não têm variante de nono dígito, e sugerir qualquer coisa ali só
 * atrapalharia quem está lendo o log atrás da causa real.
 *
 * @private
 */
function _sugerirOutroNumero(destinatario) {
  if (!destinatario) return;

  const v = Utils.variantesNumeroBR(destinatario);
  if (!v) return;

  const enviado = String(destinatario).replace(/\D/g, '');
  const outro   = enviado === v.comNove ? v.semNove : v.comNove;

  console.error(`   ↳ [BL-32] Tente ${outro} (a mesma linha sem/com o nono dígito). ` +
                `No DDD ${v.ddd}, o wa_id costuma ser ${v.provavel}.`);
}

/**
 * Processa UMA mensagem do webhook, com idempotência por messageId.
 * Extraído do doPost para permitir o loop do lote (BL-09).
 * @param {Object} message - Objeto de mensagem do payload do WhatsApp
 */
/**
 * Detecta uma mensagem que chegou DEPOIS de outra mais recente (BL-29).
 *
 * O PROBLEMA
 *   Cada mensagem é um POST separado, o Apps Script executa os POSTs em
 *   paralelo, e o cadastro decide o que fazer lendo o ESTADO ATUAL. Quando
 *   duas mensagens do mesmo usuário se sobrepõem, quem lê o estado primeiro
 *   ganha — e a ordem em que a pessoa digitou deixa de valer. O dado não se
 *   perde: vai para o CAMPO ERRADO. Perda é visível; isto não é. O cadastro
 *   termina completo, plausível e incorreto.
 *
 * O QUE ISTO FAZ
 *   Guarda o maior `timestamp` já processado por usuário. Se chegar uma
 *   estritamente mais antiga, ela é RECUSADA em vez de gravada no campo de
 *   quem estiver na vez — e o passo atual é reapresentado, para a pessoa
 *   responder de novo.
 *
 * ⚠️ O QUE ISTO **NÃO** FAZ, E POR QUÊ
 *   O `timestamp` do WhatsApp tem granularidade de UM SEGUNDO. Duas mensagens
 *   digitadas com 400 ms de diferença podem trazer o mesmo valor, e aí não há
 *   como distingui-las — nesse caso a mensagem passa, e o atropelo continua
 *   possível. Impor ordem de verdade exigiria bufferizar e ordenar antes de
 *   processar, ou seja, a fila assíncrona que o BL-21 avaliou e descartou por
 *   não caber nos limites do Apps Script.
 *
 *   Isto vale porque a janela real é grande: as execuções medidas levaram 10 a
 *   24 s, então mensagens separadas por vários segundos ainda se atropelam — e
 *   essas o portão pega. Reduzir o tempo de execução (BL-21) e o cadastro por
 *   formulário (BL-33) atacam o resto.
 *
 * ESCOPO DELIBERADAMENTE ESTREITO
 *   Só durante o cadastro. Fora dele, chegar fora de ordem é inofensivo — um
 *   toque no menu ou a escolha de uma devolução não gravam resposta em campo
 *   de outra pergunta. Recusar mensagem onde não há dano seria trocar uma
 *   falha silenciosa por uma barulhenta.
 *
 * @returns {boolean} true se a mensagem foi recusada e NÃO deve ser roteada.
 * @private
 */
function _mensagemForaDeOrdem(from, message) {
  const estado = StateManager.getEstado(from);
  if (!ESTADOS_CADASTRO.includes(estado)) return false;

  const ts = parseInt(message.timestamp, 10);
  if (!ts) return false;                    // sem timestamp não há o que comparar

  const cache  = CacheService.getScriptCache();
  const chave  = `ultimo_ts_${from}`;
  const maior  = parseInt(cache.get(chave), 10) || 0;

  if (ts < maior) {
    console.warn(`↩️ [BL-29] Mensagem de ${from} fora de ordem ` +
                 `(ts ${ts} < ${maior}) em ${estado} — recusada`);

    Utils.enviarSimples(from,
      '⚠️ Suas mensagens chegaram fora de ordem e eu quase gravei uma resposta ' +
      'no lugar errado.\n\nNada foi perdido — vamos refazer só este passo. 💛'
    );
    CadastroHandler.reapresentarPasso(from);
    return true;
  }

  // Guarda por 1 h, que é a duração da sessão de cadastro (BL-03).
  if (ts > maior) cache.put(chave, String(ts), 3600);
  return false;
}

function _processarMensagemWebhook(message) {
  if (!message || !message.id || !message.from) return;

  const from      = message.from;
  const messageId = message.id;

  // ── Idempotência: ignorar mensagens já processadas ──────────────────
  const cache    = CacheService.getScriptCache();
  const cacheKey = `msg_${messageId}`;

  if (cache.get(cacheKey)) {
    console.log(`⚠️ Mensagem duplicada ignorada: ${messageId}`);
    return;
  }

  // Marcar ANTES de processar (previne reprocessamento em retry concorrente).
  cache.put(cacheKey, '1', 600); // TTL 10 minutos
  // ─────────────────────────────────────────────────────────────────────

  console.log(`📱 Mensagem de ${from} (id: ${messageId})`);

  // Freio de gasto. Vem ANTES de tudo — inclusive das boas-vindas e do
  // primeiro contato — porque cada coisa daqui para baixo pode gerar resposta,
  // e resposta é o que custa. Mensagem recebida é grátis; a nossa, não.
  // BL-36: número bloqueado não recebe NADA — nem o aviso de que está
  // bloqueado. Avisar custaria exatamente a mensagem que o bloqueio existe para
  // evitar, e ainda informaria ao abusador que ele foi detectado.
  //
  // Vem antes do freio de taxa de propósito: o freio ainda responde uma vez por
  // hora com o aviso de pausa, e para quem está bloqueado nem isso deve sair.
  if (Utils.estaBloqueado(from)) {
    console.warn(`⛔ [Bloqueio] Mensagem de ${from} descartada`);
    return;
  }

  if (Utils.excedeuTaxa(from)) return;

  // BL-37: guarda o id desta mensagem para o indicador de "digitando". Ele é o
  // que substitui os avisos de progresso ("⏳ Analisando...", "⏳ Salvando...")
  // que antes eram mensagens cobradas.
  Utils._mensagemAtualId = message.id || null;

  // BL-29: mensagem que chega DEPOIS de outra mais nova, em execuções
  // separadas. Ver `_mensagemForaDeOrdem`.
  if (_mensagemForaDeOrdem(from, message)) return;

  // Primeiro contato: boas-vindas e já o próximo passo, decidido pelo número.
  if (StateManager.ehPrimeiroContato(from)) {

    // Quando a primeira mensagem já traz uma intenção — o botão "Devolver
    // agora" do lembrete, ou um botão de uma conversa anterior —, ela vale mais
    // que qualquer menu. É o caso de quem a secretaria cadastrou no Odoo e que
    // nunca escreveu ao bot: o lembrete chega, a pessoa toca, e esta é a
    // primeira mensagem dela. Mandar o menu aqui custaria um toque a mais.
    //
    // Aqui as boas-vindas vão SOZINHAS, e não pelo caminho do A12: não há menu
    // a fundir com elas, porque quem manda no próximo passo é a intenção.
    if (message.type === 'interactive' || message.type === 'button') {
      MenuHandler.boasVindas(from);
      Router.rotear(from, message);
      return;
    }

    // "oi", "bom dia", uma foto solta: nada a rotear. `primeiroContato` junta
    // boas-vindas e menu num balão só quando dá (BL-41 · A12) e cai nas duas
    // mensagens de sempre quando não.
    MenuHandler.primeiroContato(from);
    return;
  }

  Router.rotear(from, message);
}