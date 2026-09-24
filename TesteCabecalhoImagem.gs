/**
 * ============================================================================
 * TESTECABECALHOIMAGEM.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * SONDA S1: mensagem de BOTÕES aceita cabeçalho de IMAGEM?
 *
 * POR QUE ESTA PERGUNTA VALE UM ENVIO
 *   A entrada custa 2 mensagens hoje: as boas-vindas (imagem com legenda) e,
 *   logo depois, o menu ou o formulário. Se botões aceitarem cabeçalho de
 *   imagem, as duas viram UMA — a imagem da Cidinha, o texto de boas-vindas e
 *   os botões no mesmo balão.
 *
 *   **Primeiro contato: 2 → 1 mensagem.** Toda pessoa passa por aí, uma vez.
 *
 * O QUE JÁ SE SABE, E O QUE NÃO
 *   - Mensagem de LISTA aceita só cabeçalho de TEXTO. Disso há certeza: é por
 *     isso que o submenu "Outras opções" não tem imagem.
 *   - Mensagem de BOTÕES — a documentação sugere que aceita `image`, mas a
 *     sugestão não basta. Um cabeçalho recusado derrubaria a mensagem de
 *     entrada inteira, que é por onde todo mundo chega.
 *
 *   Daí a sonda: uma pergunta, um envio, resposta definitiva.
 *
 * ⚠️ ENVIA TRÊS MENSAGENS DE VERDADE, cobradas, para o número informado.
 *    Duas são controles. Nada é gravado no Odoo.
 *
 * COMO RODAR (editor do Apps Script)
 *   Selecione `testarCabecalhoImagem` e aperte ▶. Sem argumento usa a Script
 *   Property `NUMERO_TESTE`, como as demais sondas deste projeto.
 *
 * COMO LER O RESULTADO — CONTANDO O QUE CHEGOU NO APARELHO, não no log.
 *   A Meta devolve HTTP 200 e um wamid para mensagem que ela depois descarta
 *   na entrega. Na primeira rodada desta sonda foi exatamente o que houve: as
 *   duas aceitas, uma só entregue. Por isso são três braços, e não dois.
 *
 *   0. `GET /<media-id>` na Graph API           ← o id é entregável?
 *   1. a imagem SOZINHA, com o mesmo media ID   ← controle da mídia
 *   2. os botões COM cabeçalho de imagem        ← a pergunta
 *   3. os MESMOS botões sem cabeçalho           ← controle do envio
 *
 *   3 de 3          → cabeçalho funciona. Libera o A12 (entrada 2 → 1).
 *   1 e 3, sem a 2  → cabeçalho não é suportado. O A12 morre.
 *   só a 3          → o media ID está morto; a sonda não respondeu nada.
 *
 *   O braço 0 é síncrono e não gasta mensagem: a Graph API diz na hora se o
 *   id é entregável. Um id inválido é descartado e a imagem sobe de novo,
 *   sem exigir uma segunda rodada.
 *
 *   O braço 1 existe porque sem ele "a 2 não chegou" tem duas causas e
 *   nenhuma forma de separá-las. O motivo da Meta para cada descarte chega no
 *   webhook, e `Webhook.gs` o loga como "❌ [Entrega] <wamid> FALHOU".
 *
 * Versão: 3.0
 * Data: Setembro 2026
 */

/**
 * @param {string} [numero] - Destinatário. Omitido, usa `NUMERO_TESTE`.
 */
function testarCabecalhoImagem(numero) {
  Logger.log('\n🖼️ SONDA S1: cabeçalho de IMAGEM em mensagem de BOTÕES');
  Logger.log('━'.repeat(60));

  const destino =
    numero || Plataforma.propriedades.getProperty('NUMERO_TESTE');
  if (!destino) {
    Logger.log('❌ Sem destino. Configure a Script Property NUMERO_TESTE');
    Logger.log("   ou chame testarCabecalhoImagem('5586988521231').");
    return false;
  }
  Logger.log(`📱 Destino: ${destino}`);

  // ── O media ID da imagem ────────────────────────────────────────────────
  // Reaproveita o que as boas-vindas já guardam (BL-21): é a MESMA imagem que
  // a entrada usaria, então a sonda testa o caso real e não um genérico.
  //
  // ⚠️ Ler a Script Property crua NÃO basta. `MediaService._mediaIdEmCache`
  // guarda o ID atrás de duas travas — a digital da imagem e a validade de
  // 7 dias — e a primeira versão desta sonda pulava as duas. Um ID vencido é
  // aceito pela Meta com HTTP 200 e some na entrega: a sonda acusaria
  // "cabeçalho recusado" quando o problema era a imagem. Aqui a validade é
  // respeitada e a idade vai para o log.
  let mediaId = null;
  try {
    const bruto = Plataforma.propriedades.getProperty('media_id_avatar');
    if (bruto) {
      const guardado = JSON.parse(bruto);
      const idadeMs = Date.now() - (guardado.em || 0);
      const idadeH  = Math.round(idadeMs / 36e5);
      if (idadeMs <= MediaService.MEDIA_ID_VALIDADE_MS) {
        mediaId = guardado.id;
        Logger.log(`♻️ Media ID do avatar em cache: ${mediaId}  (${idadeH} h de idade)`);
      } else {
        Logger.log(`🗑️ Media ID em cache tem ${idadeH} h — passou da validade ` +
                   `de ${MediaService.MEDIA_ID_VALIDADE_MS / 36e5} h. Subindo de novo.`);
      }
    }
  } catch (e) { /* segue para o upload */ }

  if (!mediaId) {
    mediaId = _subirAvatarDoOdoo();
    if (!mediaId) return false;
  }

  // ── A VALIDAÇÃO DO MEDIA ID ─────────────────────────────────────────────
  // Síncrona, sem gastar mensagem. A Graph API responde o que um media ID é:
  // `GET /<id>` devolve url, mime_type e tamanho se o id vale, e um erro se
  // não vale. Isto separa de vez "a Meta descartou na entrega" de "o id nunca
  // foi entregável" — e a idade em cache não responde: um id de 42 h pode
  // estar morto se o WHATSAPP_PHONE_ID mudou, porque media ID é escopado ao
  // número que subiu o arquivo.
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
    const codeV = rv ? rv.getResponseCode() : null;
    const corpo = rv ? rv.getContentText() : '';
    Logger.log(`   HTTP ${codeV} — ${corpo}`);

    const dados = corpo ? JSON.parse(corpo) : {};
    if (codeV === 200 && dados.url) {
      Logger.log(`   ✅ Media ID vivo: ${dados.mime_type}, ${dados.file_size} bytes.`);
    } else {
      Logger.log('   ❌ MEDIA ID INVÁLIDO. É esta a causa das sumiças, não o');
      Logger.log('      cabeçalho. Repare o id antes de concluir qualquer coisa');
      Logger.log('      sobre o A12.');
      const e = dados.error || {};
      if (e.code) Logger.log(`      Meta: código ${e.code} — ${e.message || ''}`);
      Logger.log('');
      Logger.log('      Causa mais comum: o media ID é escopado ao número que');
      Logger.log('      subiu o arquivo. Se WHATSAPP_PHONE_ID mudou, todo id em');
      Logger.log('      cache morreu junto.');
      Logger.log('');
      Logger.log('   🔧 Descartando o id morto e subindo a imagem de novo…');
      MediaService._descartarMediaId('avatar');
      mediaId = _subirAvatarDoOdoo();
      if (!mediaId) return false;
      Logger.log(`   ✅ Media ID novo: ${mediaId}. Seguindo com a sonda.`);
    }
  } catch (err) {
    Logger.log(`   ⚠️ Não consegui conferir o media ID: ${err.message}`);
    Logger.log('   Seguindo assim mesmo — mas se as imagens sumirem, suspeite daqui.');
  }

  // ── 0. O CONTROLE DA IMAGEM ─────────────────────────────────────────────
  // O braço que faltava. Sem ele, "a mensagem 1 não chegou" tem duas causas
  // possíveis — cabeçalho não suportado ou media ID morto — e nenhuma forma
  // de separar as duas. Esta manda a MESMA imagem, com o MESMO id, sozinha.
  Logger.log('\n📤 1/3 — enviando a imagem SOZINHA (controle da mídia)…');
  const r0 = Utils._post({
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                destino,
    type:              'image',
    image: {
      id:      mediaId,
      caption: '🖼️ *Controle da mídia*\n\nEsta é a imagem sozinha, com o ' +
               'mesmo media ID. Se ela chegou, o id está vivo.'
    }
  }, { rotulo: 'Sonda controle da mídia' });
  const code0 = r0 ? r0.getResponseCode() : null;
  Logger.log(`HTTP ${code0} (imagem sozinha)`);

  // ── 2. O TESTE: botões com cabeçalho de imagem ──────────────────────────
  const comImagem = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                destino,
    type:              'interactive',
    interactive: {
      type:   'button',
      header: { type: 'image', image: { id: mediaId } },
      body:   { text: '👋 *Teste do cabeçalho de imagem*\n\n' +
                      'Se esta mensagem chegou COM a imagem acima dos botões, ' +
                      'a entrada do bot pode cair de 2 para 1 mensagem. 💛' },
      footer: { text: 'Com carinho, Cidinha 💛' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'btn_menu', title: '🔙 Menu' } }
        ]
      }
    }
  };

  Logger.log('\n📤 2/3 — enviando botões COM cabeçalho de imagem…');
  const r1 = Utils._post(comImagem, { rotulo: 'Sonda cabeçalho imagem' });
  const code1 = r1 ? r1.getResponseCode() : null;

  Logger.log('\n' + '━'.repeat(60));
  Logger.log(`HTTP ${code1}`);
  Logger.log(r1 ? r1.getContentText() : '(sem resposta)');
  Logger.log('━'.repeat(60));

  // ── 2. O CONTROLE ───────────────────────────────────────────────────────
  // Sem ele, uma falha de token, de janela de 24 h ou de número não se
  // distingue de "cabeçalho de imagem não é suportado" — e a conclusão errada
  // mataria o A12 sem motivo.
  Logger.log('\n📤 3/3 — enviando os MESMOS botões sem cabeçalho (controle)…');
  const semImagem = JSON.parse(JSON.stringify(comImagem));
  delete semImagem.interactive.header;
  semImagem.interactive.body.text =
    '🔎 *Mensagem de controle*\n\nEsta veio SEM cabeçalho. ' +
    'Se só esta chegou, o cabeçalho de imagem foi recusado.';

  const r2 = Utils._post(semImagem, { rotulo: 'Sonda controle' });
  const code2 = r2 ? r2.getResponseCode() : null;
  Logger.log(`HTTP ${code2} (controle)`);

  // ── Veredito ────────────────────────────────────────────────────────────
  // A Meta devolve 200 para mensagem que ela depois descarta na entrega — foi
  // o que aconteceu na primeira rodada desta sonda. Por isso o veredito do
  // código só cobre a RECUSA no envio; quem decide o resto é o aparelho.
  Logger.log('\n' + '═'.repeat(60));

  if (code1 !== 200 && code2 === 200) {
    Logger.log('❌ O CABEÇALHO DE IMAGEM FOI RECUSADO NO ENVIO.');
    Logger.log('   O controle passou, então não é token, janela nem número.');
    Logger.log('   O A12 morre e a entrada fica em 2 mensagens.');
    Logger.log('═'.repeat(60));
    return false;
  }

  if (code2 !== 200) {
    Logger.log('⚠️ ATÉ O CONTROLE FALHOU — o problema NÃO é o cabeçalho.');
    Logger.log('   Olhe o corpo do erro acima: token expirado, janela de 24 h');
    Logger.log('   fechada, ou número errado. Conserte e repita a sonda.');
    Logger.log('═'.repeat(60));
    return false;
  }

  Logger.log('✅ A META ACEITOU AS TRÊS (HTTP 200).');
  Logger.log('   Aceitar e entregar são coisas diferentes: o que ela descarta');
  Logger.log('   depois some sem erro no retorno. Quem responde é o aparelho.');
  Logger.log('');
  Logger.log('   👉 CONTE QUANTAS DAS 3 CHEGARAM:');
  Logger.log('');
  Logger.log('   3 de 3  → cabeçalho de imagem FUNCIONA.');
  Logger.log('             A12 liberado: entrada de 2 → 1 mensagem.');
  Logger.log('');
  Logger.log('   1 (imagem) e 3 (controle), sem a 2 → cabeçalho NÃO suportado.');
  Logger.log('             A imagem viva prova que o media ID não é a causa.');
  Logger.log('             A12 morre; a entrada fica em 2 mensagens.');
  Logger.log('');
  Logger.log('   só a 3 (controle), sem imagem nenhuma → o MEDIA ID está morto.');
  Logger.log('             A sonda não disse nada sobre cabeçalho. Rode');
  Logger.log('             `MediaService._descartarMediaId(\'avatar\')` e repita.');
  Logger.log('');
  Logger.log(`   O status real de cada uma chega no webhook e Webhook.gs o loga`);
  Logger.log(`   como "❌ [Entrega] <wamid> FALHOU — código N". Procure no Cloud`);
  Logger.log('   Logging pelos wamid acima se quiser o motivo da Meta.');
  Logger.log('═'.repeat(60));

  return true;
}

/**
 * Sobe o avatar do Odoo e devolve o media ID, ou null com o motivo no log.
 *
 * Existe porque a sonda precisa disto em dois pontos — quando não há id em
 * cache e quando o id em cache se revela morto na validação — e repetir o
 * bloco deixaria os dois caminhos divergirem na primeira manutenção.
 *
 * Sobe SEM enviar mensagem: o envio é justamente o que a sonda controla.
 *
 * @returns {string|null}
 * @private
 */
function _subirAvatarDoOdoo() {
  Logger.log('ℹ️ Subindo o avatar do Odoo agora.');
  try {
    const p = OdooService.buscarParametros();
    if (!p || !p.x_studio_avatar) {
      Logger.log('❌ Não há avatar em `x_studio_avatar` no Odoo.');
      Logger.log('   Mande um "oi" de um número novo primeiro (as boas-vindas');
      Logger.log('   sobem a imagem e guardam o id), ou configure o avatar.');
      return null;
    }
    const id = MediaService.subirImagem(p.x_studio_avatar);
    if (!id) {
      Logger.log('❌ O upload da imagem falhou — veja o erro acima.');
      return null;
    }
    return id;
  } catch (e) {
    Logger.log(`❌ Falhei ao preparar a imagem: ${e.message}`);
    return null;
  }
}
