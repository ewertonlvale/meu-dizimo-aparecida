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
 * ⚠️ ENVIA DUAS MENSAGENS DE VERDADE, cobradas, para o número informado.
 *    A segunda é a de controle. Nada é gravado no Odoo.
 *
 * COMO RODAR (editor do Apps Script)
 *   Selecione `testarCabecalhoImagem` e aperte ▶. Sem argumento usa a Script
 *   Property `NUMERO_TESTE`, como as demais sondas deste projeto.
 *
 * COMO LER O RESULTADO — no aparelho, não só no log:
 *   ✅ chegaram DUAS mensagens, a primeira com imagem em cima dos botões
 *      → funciona. Libera o A12 (entrada 2 → 1).
 *   ❌ a primeira não chegou, ou chegou sem imagem
 *      → não funciona. O A12 morre e a entrada fica em 2 mensagens.
 *
 *   O log traz a resposta crua da Meta nos dois casos.
 *
 * Versão: 1.0
 * Data: Setembro 2026
 */

/**
 * @param {string} [numero] - Destinatário. Omitido, usa `NUMERO_TESTE`.
 */
function testarCabecalhoImagem(numero) {
  Logger.log('\n🖼️ SONDA S1: cabeçalho de IMAGEM em mensagem de BOTÕES');
  Logger.log('━'.repeat(60));

  const destino =
    numero || PropertiesService.getScriptProperties().getProperty('NUMERO_TESTE');
  if (!destino) {
    Logger.log('❌ Sem destino. Configure a Script Property NUMERO_TESTE');
    Logger.log("   ou chame testarCabecalhoImagem('5586988521231').");
    return false;
  }
  Logger.log(`📱 Destino: ${destino}`);

  // ── O media ID da imagem ────────────────────────────────────────────────
  // Reaproveita o que as boas-vindas já guardam (BL-21): é a MESMA imagem que
  // a entrada usaria, então a sonda testa o caso real e não um genérico.
  let mediaId = null;
  try {
    const bruto = PropertiesService.getScriptProperties().getProperty('media_id_avatar');
    if (bruto) mediaId = JSON.parse(bruto).id;
  } catch (e) { /* segue para o upload */ }

  if (mediaId) {
    Logger.log(`♻️ Usando o media ID do avatar já em cache: ${mediaId}`);
  } else {
    Logger.log('ℹ️ Sem media ID em cache — subindo o avatar do Odoo agora.');
    try {
      const p = OdooService.buscarParametros();
      if (!p || !p.x_studio_avatar) {
        Logger.log('❌ Não há avatar em `x_studio_avatar` no Odoo.');
        Logger.log('   Mande um "oi" de um número novo primeiro (as boas-vindas');
        Logger.log('   sobem a imagem e guardam o id), ou configure o avatar.');
        return false;
      }
      // Sobe SEM enviar mensagem: o envio é justamente o que a sonda controla.
      mediaId = MediaService.subirImagem(p.x_studio_avatar);
      if (!mediaId) {
        Logger.log('❌ O upload da imagem falhou — veja o erro acima.');
        return false;
      }
    } catch (e) {
      Logger.log(`❌ Falhei ao preparar a imagem: ${e.message}`);
      return false;
    }
  }

  // ── 1. O TESTE: botões com cabeçalho de imagem ──────────────────────────
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

  Logger.log('\n📤 1/2 — enviando botões COM cabeçalho de imagem…');
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
  Logger.log('\n📤 2/2 — enviando os MESMOS botões sem cabeçalho (controle)…');
  const semImagem = JSON.parse(JSON.stringify(comImagem));
  delete semImagem.interactive.header;
  semImagem.interactive.body.text =
    '🔎 *Mensagem de controle*\n\nEsta veio SEM cabeçalho. ' +
    'Se só esta chegou, o cabeçalho de imagem foi recusado.';

  const r2 = Utils._post(semImagem, { rotulo: 'Sonda controle' });
  const code2 = r2 ? r2.getResponseCode() : null;
  Logger.log(`HTTP ${code2} (controle)`);

  // ── Veredito ────────────────────────────────────────────────────────────
  Logger.log('\n' + '═'.repeat(60));
  if (code1 === 200 && code2 === 200) {
    Logger.log('✅ A META ACEITOU AS DUAS.');
    Logger.log('   👉 CONFIRA NO APARELHO: a primeira mensagem tem a imagem');
    Logger.log('      em cima dos botões? Aceitar o envio e renderizar são');
    Logger.log('      coisas diferentes — foi assim com o card PIX do BL-40.');
    Logger.log('   Se a imagem apareceu: A12 liberado, entrada 2 → 1 mensagem.');
  } else if (code1 !== 200 && code2 === 200) {
    Logger.log('❌ O CABEÇALHO DE IMAGEM FOI RECUSADO.');
    Logger.log('   O controle passou, então não é token, janela nem número:');
    Logger.log('   é o cabeçalho mesmo. O A12 morre e a entrada fica em 2.');
    Logger.log('   Registre no BL-41 e siga — não é perda, é resposta.');
  } else {
    Logger.log('⚠️ AS DUAS FALHARAM — o problema NÃO é o cabeçalho.');
    Logger.log('   Olhe o corpo do erro acima: token expirado, janela de 24 h');
    Logger.log('   fechada, ou número errado. Conserte e repita a sonda.');
  }
  Logger.log('═'.repeat(60));

  return code1 === 200;
}
