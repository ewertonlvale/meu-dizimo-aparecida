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
 * O QUE A PRIMEIRA RODADA JÁ RESPONDEU (19/09, 11:46)
 *   `image.id` — o mesmo que funciona em mensagem de BOTÕES — é recusado aqui,
 *   e a Meta foi específica:
 *
 *     (#131008) Required parameter is missing
 *     details: "header image must contain link."
 *
 *   Isso NÃO é "flow não aceita imagem". É "aqui a imagem vai por URL". A
 *   assimetria importa e não está documentada em lugar visível: botões aceitam
 *   `id`, flow exige `link`.
 *
 *   A URL tem de ser pública. A `lookaside.fbsbx.com` devolvida pelo
 *   `GET /<media-id>` exige Bearer token, então a Meta não a buscaria.
 *
 * O QUE FALTA
 *   Configurar a Script Property `AVATAR_URL` e rodar de novo. Ela aceita
 *   VÁRIAS URLs separadas por vírgula, e a sonda tenta uma a uma até alguma
 *   ser aceita — parando aí, porque cada tentativa é uma mensagem cobrada.
 *
 *   Por que mais de uma: o avatar está publicado em `docs/avatar.png`, servido
 *   pelo GitHub Pages. Com o CNAME configurado, a URL `github.io` responde 301
 *   para o domínio próprio, e não se sabe se o buscador da Meta segue
 *   redirecionamento. Passar as duas resolve numa rodada só:
 *
 *     https://meudizimo.pnscaparecida.com/avatar.png,
 *     https://ewertonlvale.github.io/meu-dizimo-aparecida/avatar.png
 *
 * ⚠️ ENVIA ATÉ TRÊS FORMULÁRIOS DE VERDADE, cobrados, para o número informado.
 *    São formulários FUNCIONAIS: preenchê-los cria cadastro no Odoo. Para só
 *    conferir o cabeçalho, NÃO toque em "Preencher cadastro".
 *
 * COMO LER O RESULTADO — CONTANDO O QUE CHEGOU NO APARELHO, não no log.
 *   `HTTP 200` com `wamid` não é entrega: a Meta aceita e descarta em silêncio.
 *   Foi o que custou três rodadas à S1.
 *
 *   0.  `GET /<media-id>` na Graph API        ← o id é entregável? (sem envio)
 *   1.  o formulário com `image.id`           ← já respondido: exige link
 *   1b. o formulário com `image.link`         ← a pergunta que resta
 *       (uma tentativa por URL de AVATAR_URL, até alguma passar)
 *   2.  o formulário com cabeçalho de TEXTO   ← controle (o que roda hoje)
 *
 *   o 1b chegou com a imagem  → fecha o A12: número novo de 2 → 1 mensagem.
 *   o 1b não chegou           → a Meta aceitou e descartou. A entrada fica em
 *                               2, e isso vira resposta, não pendência.
 *   nem o controle chegou     → não é o cabeçalho: token, janela ou FLOW_ID.
 *
 * Versão: 2.1
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

  // ── 1b. A MESMA IMAGEM, POR LINK ────────────────────────────────────────
  // A Meta recusou `image.id` com um detalhe preciso: "header image must
  // contain link". Não é "flow não aceita imagem" — é "aqui a imagem vai por
  // URL". Mensagem de BOTÕES aceita `id`; a de flow, não. A assimetria não
  // está documentada em lugar nenhum que eu conheça, e é o achado desta sonda.
  //
  // A URL precisa ser pública: a `lookaside.fbsbx.com` que o `GET /<media-id>`
  // devolve exige Bearer token, então a Meta não conseguiria buscá-la.
  // `AVATAR_URL` aceita VÁRIAS URLs separadas por vírgula, e a sonda tenta uma
  // a uma. O motivo é concreto: com um CNAME configurado, o GitHub Pages
  // responde a URL `github.io` com 301 para o domínio próprio, e não se sabe
  // se o buscador da Meta segue redirecionamento. Testar as duas numa rodada
  // custa uma mensagem; descobrir na rodada seguinte custa uma rodada.
  const urls = String(props.getProperty('AVATAR_URL') || '')
    .split(',').map(u => u.trim()).filter(Boolean);

  let code1b = null;
  let urlQueFuncionou = null;

  if (!urls.length) {
    Logger.log('\n⏭️ 1b PULADO — sem a Script Property AVATAR_URL.');
    Logger.log('   É ela que responde a pergunta que sobrou: se o flow aceita');
    Logger.log('   imagem por LINK. Configure com uma ou mais URLs públicas do');
    Logger.log('   avatar, separadas por vírgula, e repita.');
  } else {
    urls.forEach((url, n) => {
      // Depois que uma funciona, as outras não acrescentam nada — e cada
      // tentativa é uma mensagem cobrada.
      if (urlQueFuncionou) {
        Logger.log(`\n⏭️ Pulando ${url} — a anterior já funcionou.`);
        return;
      }
      Logger.log(`\n📤 1b.${n + 1} — formulário com a imagem por LINK…\n   ${url}`);
      const r = Utils._post(
        montar({ type: 'image', image: { link: url } },
               '🔗 *Teste do cabeçalho por link*\n\n' +
               `URL ${n + 1}: se esta chegou COM a imagem acima, o flow aceita ` +
               'cabeçalho de imagem por URL. Não precisa preencher. 💛'),
        { rotulo: `Sonda cabeçalho flow (link ${n + 1})` }
      );
      const c = r ? r.getResponseCode() : null;
      Logger.log(`HTTP ${c}`);
      if (c === 200) {
        urlQueFuncionou = url;
      } else {
        Logger.log(r ? r.getContentText() : '(sem resposta)');
      }
      code1b = c;
    });
    if (urlQueFuncionou) code1b = 200;
  }

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

  if (code2 !== 200) {
    Logger.log('⚠️ ATÉ O CONTROLE FALHOU — o problema NÃO é o cabeçalho.');
    Logger.log('   Olhe o erro acima: token, janela de 24 h, FLOW_ID ou o modo');
    Logger.log("   ('draft' x 'published'). Conserte e repita a sonda.");
    Logger.log('═'.repeat(60));
    return false;
  }

  // O detalhe da Meta é a resposta, não o código. "header image must contain
  // link" diz que o cabeçalho de imagem EXISTE no flow e quer outra forma —
  // ler isso como recusa mataria o A12 por engano.
  const exigiuLink = code1 === 400 &&
    String((r1 && r1.getContentText()) || '').indexOf('must contain link') !== -1;

  if (exigiuLink) {
    Logger.log('📌 FLOW ACEITA CABEÇALHO DE IMAGEM — mas só por LINK, não por id.');
    Logger.log('   A Meta foi específica: "header image must contain link".');
    Logger.log('   Mensagem de BOTÕES aceita `id`; a de flow exige URL pública.');
    Logger.log('');
  } else if (code1 !== 200) {
    Logger.log('❌ O cabeçalho por `id` foi recusado por outro motivo — leia o');
    Logger.log('   erro acima antes de concluir qualquer coisa.');
    Logger.log('');
  }

  if (code1b === null) {
    Logger.log('⏳ A pergunta continua aberta: falta AVATAR_URL para testar o link.');
    Logger.log('   Configure a Script Property e rode de novo.');
    Logger.log('═'.repeat(60));
    return false;
  }

  if (code1b !== 200) {
    Logger.log('❌ NENHUMA DAS URLs FOI ACEITA. Leia os erros acima: costuma ser');
    Logger.log('   URL inacessível, redirecionamento (o github.io redireciona 301');
    Logger.log('   quando há CNAME) ou content-type errado.');
    Logger.log('   A entrada de número novo fica em 2 mensagens.');
    Logger.log('═'.repeat(60));
    return false;
  }

  Logger.log(`✅ A META ACEITOU O ENVIO POR LINK: ${urlQueFuncionou}`);
  Logger.log('   Aceitar e entregar são coisas diferentes — a S1 gastou três');
  Logger.log('   rodadas aprendendo isso. Quem responde é o aparelho.');
  Logger.log('');
  Logger.log('   👉 O FORMULÁRIO DESSA URL CHEGOU COM A IMAGEM EM CIMA?');
  Logger.log('');
  Logger.log('   sim  → fecha o A12: a entrada de número novo cai de 2 para 1.');
  Logger.log('          Guarde ESSA url: é a que a produção vai usar.');
  Logger.log('   não  → a Meta aceitou e descartou. A entrada fica em 2, e isso');
  Logger.log('          vira resposta, não pendência.');
  Logger.log('');
  Logger.log('   ⚠️ Os formulários são FUNCIONAIS: preencher cria cadastro no');
  Logger.log('      Odoo. Para só conferir o cabeçalho, não toque neles.');
  Logger.log('═'.repeat(60));

  return true;
}
