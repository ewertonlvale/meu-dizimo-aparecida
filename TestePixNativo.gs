/**
 * ============================================================================
 * TESTEPIXNATIVO.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * SONDA: a Meta aceita `order_details` com o NOSSO código PIX, sem PSP?
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *   O WhatsApp tem um card de pagamento nativo com botão "Copiar código Pix".
 *   Ele resolveria a única mensagem que não conseguimos fundir na devolução: o
 *   copia-e-cola precisa ir sozinho e sem formatação para que o toque longo →
 *   Copiar leve o código exato (ver BL-37). Com o botão nativo, ele vira parte
 *   do card, e a devolução cai de 3 para 2 mensagens.
 *
 *   A pesquisa (BL-40) mostrou que o campo `pix_dynamic_code.code` é uma
 *   STRING que nós fornecemos — não há campo apontando para um provedor de
 *   pagamento. Isso sugere que a MENSAGEM não exige PSP; quem exige é a
 *   CONCILIAÇÃO (saber que o pagamento ocorreu), que continuaria por
 *   comprovante e OCR, como hoje.
 *
 *   "Sugere" não é "garante". Três dúvidas ficaram abertas, e a documentação
 *   oficial da Meta não pôde ser consultada:
 *
 *     1. A Meta exige uma configuração de pagamento aprovada na conta?
 *     2. Ela valida que o código é dinâmico de verdade (emitido por PSP)?
 *     3. Entidade religiosa é elegível para a API de Pagamentos?
 *
 *   Esta sonda responde as três de uma vez, com um envio. É mais barato do que
 *   qualquer conversa comercial com PSP — e precisa vir ANTES dela.
 *
 * ⚠️ ENVIA UMA MENSAGEM DE VERDADE, cobrada, para o número informado. Use o
 *    seu. Nada é gravado no Odoo.
 *
 * COMO RODAR (editor do Apps Script)
 *   Basta selecionar `testarPixNativo` e apertar ▶ Executar. O botão do editor
 *   NÃO passa argumentos, então sem nada ela usa a Script Property
 *   `NUMERO_TESTE` — a mesma que o resto dos testes deste projeto usa.
 *
 *   Para configurá-la: ⚙️ Configurações do projeto → Propriedades do script →
 *   Adicionar propriedade → `NUMERO_TESTE` = `5586988521231` (formato
 *   internacional, sem o '+').
 *
 *   Do editor, dá também para chamar com argumento — mas aí é preciso usar
 *   uma função sem parâmetros, porque o ▶ só roda essas:
 *
 *     testarPixNativo('5586988521231')        // usa o valor do cadastro
 *     testarPixNativo('5586988521231', 25)    // força R$ 25,00
 *
 * COMO LER O RESULTADO — está no Logger, e é o que interessa reportar:
 *   ✅ HTTP 200            → funciona SEM PSP. Ver o card no aparelho e seguir
 *                            para o BL-40 opção A.
 *   ❌ 131009 / parâmetro  → o payload foi recusado por forma. Provavelmente
 *                            estrutura, não elegibilidade — ajustar e repetir.
 *   ❌ 100 / #33 / not     → recurso não habilitado nesta conta. É a resposta
 *      supported            "precisa de onboarding/PSP".
 *   ❌ qualquer outro      → copiar o texto inteiro do log.
 *
 * Versão: 1.0
 * Data: Setembro 2026
 */

/**
 * Descobre o tipo da chave PIX pelo formato.
 *
 * O `pix_dynamic_code` exige `key_type`, e o Odoo guarda só a chave. As regras
 * são as do próprio PIX: CPF tem 11 dígitos, CNPJ tem 14, telefone vem com
 * +55, e-mail tem @, e o que sobra é chave aleatória (EVP, 32 hexadecimais).
 *
 * @param {string} chave
 * @returns {string|null} CPF | CNPJ | PHONE | EMAIL | EVP
 */
function tipoDaChavePix(chave) {
  const c = String(chave || '').trim();
  if (!c) return null;

  if (c.indexOf('@') > 0) return 'EMAIL';
  if (c.charAt(0) === '+') return 'PHONE';

  const digitos = c.replace(/\D/g, '');

  // 11 dígitos é ambíguo: CPF e celular brasileiro (DDD + 9 dígitos) têm o
  // mesmo tamanho. O desempate é o dígito verificador — um telefone só passa
  // por acaso, e a chance é de 1%. Comparar por tamanho classificaria todo
  // celular guardado sem o '+' como CPF, e a Meta recusaria sem dizer por quê.
  if (digitos.length === 11) return _cpfValido(digitos) ? 'CPF' : 'PHONE';
  if (digitos.length === 14) return 'CNPJ';
  if (/^[0-9a-fA-F-]{32,36}$/.test(c)) return 'EVP';

  return null;
}

/**
 * Dígito verificador de CPF (módulo 11). Serve só para desempatar CPF de
 * telefone em `tipoDaChavePix` — não é validação de cadastro.
 * @private
 */
function _cpfValido(d) {
  if (/^(\d)\1{10}$/.test(d)) return false;   // 00000000000, 11111111111…

  for (let bloco = 9; bloco <= 10; bloco++) {
    let soma = 0;
    for (let i = 0; i < bloco; i++) {
      soma += parseInt(d.charAt(i), 10) * (bloco + 1 - i);
    }
    let dv = (soma * 10) % 11;
    if (dv === 10) dv = 0;
    if (dv !== parseInt(d.charAt(bloco), 10)) return false;
  }
  return true;
}

/**
 * Envia um `order_details` com o BR Code que o bot já gera hoje.
 *
 * @param {string} [numero] - Destinatário, formato internacional sem '+'.
 *   Omitido (é o caso do botão ▶ do editor, que não passa argumentos), usa a
 *   Script Property `NUMERO_TESTE`.
 * @param {number} [valorForcado] - Em reais. Omitido, usa o valor do cadastro.
 */
function testarPixNativo(numero, valorForcado) {
  Logger.log('\n💳 SONDA: order_details com o nosso próprio código PIX');
  Logger.log('━'.repeat(60));

  // O ▶ do editor roda a função sem argumentos. Em vez de falhar, cai na mesma
  // Script Property que o resto dos testes deste projeto já usa.
  const destino = numero || NUMERO_TESTE;

  if (!destino) {
    Logger.log('❌ Sem número de destino.');
    Logger.log('   Configure a Script Property NUMERO_TESTE (⚙️ Configurações do');
    Logger.log('   projeto → Propriedades do script), no formato 5586988521231,');
    Logger.log("   ou chame testarPixNativo('5586988521231') de outra função.");
    return false;
  }

  Logger.log(`📱 Destino: ${destino}${numero ? '' : '  (da Script Property NUMERO_TESTE)'}`);

  // ── 1. Os mesmos dados que a devolução real usaria ────────────────────────
  const dizimista = OdooService.buscarDizimistaPorWhatsapp(destino);
  if (!dizimista) {
    Logger.log(`❌ ${destino} não tem cadastro — a sonda usa os dados reais da comunidade.`);
    Logger.log('   Cadastre o número antes, ou use um que já seja dizimista.');
    return false;
  }

  const comunidade = OdooService.buscarDadosPagamentoComunidade(dizimista);
  if (!comunidade || !comunidade.x_studio_chave_pix) {
    Logger.log('❌ A comunidade do dizimista não tem chave PIX configurada.');
    return false;
  }

  const chave    = comunidade.x_studio_chave_pix;
  const tipo     = tipoDaChavePix(chave);
  const titular  = comunidade.x_studio_titular_conta || 'Paroquia';
  const valor    = valorForcado || dizimista.x_studio_value || 10;

  if (!tipo) {
    Logger.log(`❌ Não consegui deduzir o key_type da chave cadastrada.`);
    Logger.log('   Formatos reconhecidos: CPF, CNPJ, e-mail, telefone com +55, chave aleatória.');
    Logger.log('   Um telefone SEM o "+" é indistinguível de CPF — corrija no Odoo.');
    return false;
  }

  Logger.log(`🏘️ Comunidade: ${comunidade.x_name}`);
  Logger.log(`🔑 Tipo da chave: ${tipo}`);   // a chave em si não vai para o log
  Logger.log(`💰 Valor: R$ ${valor.toFixed(2).replace('.', ',')}`);

  // ── 2. O BR Code que o bot já manda hoje, sem mudar nada ──────────────────
  let codigo;
  try {
    codigo = MediaService._gerarPayloadPix(chave, valor, titular);
  } catch (e) {
    Logger.log(`❌ Falhei ao gerar o BR Code: ${e.message}`);
    return false;
  }
  Logger.log(`📜 BR Code gerado (${codigo.length} caracteres)`);

  // ── 3. O payload de order_details ─────────────────────────────────────────
  // `offset: 100` significa centavos: R$ 30,00 vai como 3000. É exigência da
  // Meta para payment_type "br" — mandar 30 aqui cobraria R$ 0,30.
  const centavos    = Math.round(valor * 100);
  const referencia  = `dizimo-sonda-${Date.now()}`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                destino,
    type:              'interactive',
    interactive: {
      type: 'order_details',
      body: {
        text: 'Teste do card de pagamento nativo.\n\n' +
              'Se você está vendo o botão *Copiar código Pix*, a Meta aceitou ' +
              'o nosso próprio código — sem intermediário. 💛'
      },
      action: {
        name: 'review_and_pay',
        parameters: {
          reference_id:  referencia,
          type:          'digital-goods',
          payment_type:  'br',
          payment_settings: [
            {
              type: 'pix_dynamic_code',
              pix_dynamic_code: {
                code:          codigo,
                merchant_name: titular,
                key:           chave,
                key_type:      tipo
              }
            }
          ],
          currency:     'BRL',
          total_amount: { value: centavos, offset: 100 },
          order: {
            status: 'pending',
            items: [
              {
                retailer_id: 'dizimo',
                name:        'Dízimo',
                amount:      { value: centavos, offset: 100 },
                quantity:    1
              }
            ],
            subtotal: { value: centavos, offset: 100 }
          }
        }
      }
    }
  };

  // ── 4. Envio pelo caminho de sempre ───────────────────────────────────────
  // Vai por `Utils._post` de propósito: é ele que faz a conferência de
  // destinatário (BL-32) e conta a mensagem no consumo (BL-25). Uma sonda que
  // desvia do caminho real testa outra coisa.
  Logger.log('\n📤 Enviando...');
  const resposta = Utils._post(payload, { rotulo: 'PIX nativo (sonda)' });

  if (!resposta) {
    Logger.log('❌ Exceção no envio — veja o erro acima no log.');
    return false;
  }

  const code  = resposta.getResponseCode();
  const corpo = resposta.getContentText();

  Logger.log('\n' + '━'.repeat(60));
  Logger.log(`HTTP ${code}`);
  Logger.log(corpo);
  Logger.log('━'.repeat(60));

  if (code === 200) {
    Logger.log('\n✅ A META ACEITOU.');
    Logger.log('   Confira no aparelho se o card veio com "Copiar código Pix".');
    Logger.log('   Se veio: o botão nativo funciona SEM PSP e sem tarifa —');
    Logger.log('   a devolução pode cair de 3 para 2 mensagens (BL-40, opção A).');
    Logger.log('   ⚠️ O pagamento NÃO será conciliado automaticamente: isso');
    Logger.log('      continua exigindo PSP. O comprovante e o OCR ficam.');
    return true;
  }

  Logger.log('\n❌ RECUSADO. O corpo acima diz por quê. Interpretação:');
  Logger.log('   • "not supported" / código 100 / #33 → recurso não habilitado');
  Logger.log('     nesta conta: é a resposta "precisa de onboarding de pagamentos".');
  Logger.log('   • erro de parâmetro/estrutura → provavelmente o payload, não a');
  Logger.log('     elegibilidade. Vale ajustar e repetir antes de concluir.');
  Logger.log('   Copie o bloco inteiro entre as linhas ━ ao reportar.');
  return false;
}
