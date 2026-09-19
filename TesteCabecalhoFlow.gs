/**
 * ============================================================================
 * TESTECABECALHOFLOW.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * SONDA S10: mensagem de FLOW aceita cabeçalho de IMAGEM?
 *
 * POR QUE ESTA PERGUNTA VALE UM ENVIO
 *   A S1 respondeu a metade do A12: mensagem de BOTÕES renderiza cabeçalho de
 *   imagem, e quem já é dizimista passou a receber a entrada num balão só.
 *
 *   Para NÚMERO NOVO continuam duas: as boas-vindas com o avatar e, logo
 *   depois, o formulário. Quem chega pela primeira vez é justamente quem o
 *   projeto mais quer receber bem — e é o único caminho de entrada que ainda
 *   custa duas mensagens.
 *
 *   O formulário é `interactive.type = 'flow'`. A S1 não responde por ele: são
 *   tipos diferentes de mensagem, com regras de cabeçalho diferentes. A de
 *   LISTA, por exemplo, só aceita cabeçalho de TEXTO.
 *
 * O QUE JÁ SE SABE
 *   A mensagem de flow aceita cabeçalho de TEXTO — é o que está em produção
 *   hoje ('💛 Cadastro de Dizimista', em `FlowHandler._postarFlow`). A dúvida é
 *   só se `image` entra no lugar de `text`.
 *
 * ⚠️ ENVIA DOIS FORMULÁRIOS DE VERDADE, cobrados, para o número informado.
 *    São formulários FUNCIONAIS: preenchê-los cria cadastro no Odoo. Para só
 *    conferir o cabeçalho, NÃO toque em "Preencher cadastro".
 *
 * COMO LER O RESULTADO — CONTANDO O QUE CHEGOU NO APARELHO, não no log.
 *   `HTTP 200` com `wamid` não é entrega: a Meta aceita e descarta em silêncio.
 *   Foi o que custou três rodadas à S1.
 *
 *   0. `GET /<media-id>` na Graph API   ← o id é entregável?  (não gasta envio)
 *   1. o formulário COM cabeçalho de imagem   ← a pergunta
 *   2. o formulário com cabeçalho de TEXTO    ← controle (o que roda hoje)
 *
 *   as 2         → cabeçalho de imagem funciona no flow.
 *                  Fecha o A12: entrada de número novo de 2 → 1 mensagem.
 *   só a 2       → não funciona no flow. A entrada de número novo fica em 2,
 *                  e isso passa a ser resposta, não pendência.
 *   nenhuma      → não é o cabeçalho: token, janela de 24 h ou FLOW_ID.
 *                  Conserte e repita.
 *
 * Versão: 1.0
 * Data: Setembro 2026
 */

/**
 * @param {string} [numero] - Destinatário. Omitido, usa `NUMERO_TESTE`.
 */
function testarCabecalhoFlow(numero) {
  Logger.log('\n📋 SONDA S10: cabeçalho de IMAGEM em mensagem de FLOW');
  Logger.log('━'.repeat(60));

  const props = PropertiesService.getScriptProperties();
  const destino = numero || props.getProperty('NUMERO_TESTE');

  if (!destino) {
    Logger.log('❌ Sem destino. Configure a Script Property NUMERO_TESTE');
    Logger.log("   ou chame testarCabecalhoFlow('5586988521231').");
    return false;
  }
  Logger.log(`📱 Destino: ${destino}`);

  const flowId = props.getProperty('FLOW_ID_CADASTRO');
  if (!flowId) {
    Logger.log('❌ FLOW_ID_CADASTRO não configurado — sem ele não há o que enviar.');
    return false;
  }

  // ── As comunidades ──────────────────────────────────────────────────────
  // Vão no payload porque o Flow não tem endpoint para consultar o Odoo. Sem
  // elas a tela abre vazia, e a Meta recusa o envio.
  let comunidades;
  try {
    comunidades = (OdooService.listarComunidades() || [])
      .map(c => ({ id: String(c.id), title: String(c.x_name).substring(0, 30) }));
  } catch (e) {
    Logger.log(`❌ Falha ao listar comunidades: ${e.message}`);
    return false;
  }
  if (!comunidades.length) {
    Logger.log('❌ Nenhuma comunidade ativa no Odoo.');
    return false;
  }

  // ── O media ID, e a conferência que a S1 ensinou a fazer ────────────────
  const mediaId = MediaService.mediaIdDoAvatar();
  if (!mediaId) {
    Logger.log('❌ Sem media ID do avatar. Confira `x_studio_avatar` no Odoo.');
    return false;
  }
  Logger.log(`🖼️ Media ID: ${mediaId}`);

  Logger.log('\n🔍 Conferindo o media ID na Graph API (não envia nada)…');
  try {
    const cfg = getConfig();
    const rv = Utils.fetchComRetry(
      getWhatsAppUrl(`${mediaId}?phone_number_id=${cfg.WHATSAPP_PHONE_ID}`),
      {
        method:  'get',
        headers: { Authorization: `Bearer ${cfg.WHATSAPP_TOKEN}` },
        muteHttpExceptions: true
      },
      { idempotente: true, rotulo: 'Consulta media ID' }
    );
    const corpo = rv ? rv.getContentText() : '';
    const dados = corpo ? JSON.parse(corpo) : {};
    if (rv && rv.getResponseCode() === 200 && dados.url) {
      Logger.log(`   ✅ Media ID vivo: ${dados.mime_type}, ${dados.file_size} bytes.`);
    } else {
      Logger.log(`   ❌ Media ID inválido: ${corpo}`);
      Logger.log('      Sem imagem entregável a sonda não responde nada.');
      return false;
    }
  } catch (e) {
    Logger.log(`   ⚠️ Não consegui conferir o media ID: ${e.message}`);
  }

  // ── O payload, igual ao de produção menos o cabeçalho ───────────────────
  // Montado aqui, e não por `FlowHandler._postarFlow`, porque a sonda precisa
  // trocar exatamente UMA coisa entre os dois envios. Reaproveitar a função de
  // produção exigiria abrir um parâmetro de cabeçalho nela antes de saber se o
  // cabeçalho funciona — pôr a resposta na frente da pergunta.
  const montar = (cabecalho, corpo) => ({
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                destino,
    type:              'interactive',
    interactive: {
      type:   'flow',
      header: cabecalho,
      body:   { text: corpo },
      footer: { text: 'Com carinho, Cidinha 💛' },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token:  `${FlowHandler.TOKEN_CADASTRO}${destino}:${Date.now()}`,
          flow_id:     flowId,
          flow_cta:    'Preencher cadastro',
          flow_action: 'navigate',
          mode:        props.getProperty('FLOW_MODO_CADASTRO') || 'published',
          flow_action_payload: { screen: 'CADASTRO', data: { comunidades } }
        }
      }
    }
  });

  // ── 1. O TESTE ──────────────────────────────────────────────────────────
  Logger.log('\n📤 1/2 — formulário COM cabeçalho de imagem…');
  const r1 = Utils._post(
    montar({ type: 'image', image: { id: mediaId } },
           '👋 *Teste do cabeçalho no formulário*\n\n' +
           'Se esta mensagem chegou COM a imagem acima, a entrada de quem é ' +
           'novo cai de 2 para 1 mensagem. Não precisa preencher. 💛'),
    { rotulo: 'Sonda cabeçalho flow' }
  );
  const code1 = r1 ? r1.getResponseCode() : null;
  Logger.log('\n' + '━'.repeat(60));
  Logger.log(`HTTP ${code1}`);
  Logger.log(r1 ? r1.getContentText() : '(sem resposta)');
  Logger.log('━'.repeat(60));

  // ── 2. O CONTROLE ───────────────────────────────────────────────────────
  // O cabeçalho de TEXTO é o que roda em produção. Se nem ele chegar, o
  // problema não é o tipo do cabeçalho — é token, janela ou FLOW_ID.
  Logger.log('\n📤 2/2 — o MESMO formulário com cabeçalho de texto (controle)…');
  const r2 = Utils._post(
    montar({ type: 'text', text: '💛 Cadastro de Dizimista' },
           '🔎 *Mensagem de controle*\n\nEste veio com cabeçalho de TEXTO, ' +
           'como o de produção. Se só este chegou, imagem não vale no flow.'),
    { rotulo: 'Sonda controle flow' }
  );
  const code2 = r2 ? r2.getResponseCode() : null;
  Logger.log(`HTTP ${code2} (controle)`);

  // ── Veredito ────────────────────────────────────────────────────────────
  Logger.log('\n' + '═'.repeat(60));

  if (code1 !== 200 && code2 === 200) {
    Logger.log('❌ O CABEÇALHO DE IMAGEM FOI RECUSADO NO ENVIO.');
    Logger.log('   O controle passou, então não é token, janela nem FLOW_ID:');
    Logger.log('   é o cabeçalho. A entrada de número novo fica em 2 mensagens');
    Logger.log('   — e isso vira resposta, não pendência.');
    Logger.log('═'.repeat(60));
    return false;
  }

  if (code2 !== 200) {
    Logger.log('⚠️ ATÉ O CONTROLE FALHOU — o problema NÃO é o cabeçalho.');
    Logger.log('   Olhe o erro acima: token, janela de 24 h, FLOW_ID ou o modo');
    Logger.log("   ('draft' x 'published'). Conserte e repita a sonda.");
    Logger.log('═'.repeat(60));
    return false;
  }

  Logger.log('✅ A META ACEITOU AS DUAS (HTTP 200).');
  Logger.log('   Aceitar e entregar são coisas diferentes — a S1 gastou três');
  Logger.log('   rodadas aprendendo isso. Quem responde é o aparelho.');
  Logger.log('');
  Logger.log('   👉 CONTE QUANTAS DAS 2 CHEGARAM:');
  Logger.log('');
  Logger.log('   as 2    → imagem funciona no flow. Fecha o A12: a entrada de');
  Logger.log('             número novo cai de 2 para 1 mensagem.');
  Logger.log('   só a 2  → não funciona. A entrada de número novo fica em 2,');
  Logger.log('             e o A12 está completo no que dava para fazer.');
  Logger.log('');
  Logger.log('   ⚠️ Os dois formulários são FUNCIONAIS: preencher cria cadastro');
  Logger.log('      no Odoo. Para só conferir o cabeçalho, não toque neles.');
  Logger.log('═'.repeat(60));

  return true;
}
