/**
 * ============================================================================
 * COMPROVANTEHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Processa comprovantes de pagamento enviados pelo usuário (imagem ou PDF).
 *
 * Fluxo:
 *   1. Receber arquivo (imagem ou documento) do Router
 *   2. Detectar tipo (imagem / PDF)
 *   3. Baixar arquivo via MediaService
 *   4. Analisar conteúdo via VisionService (OCR)
 *      - Imagem → VisionService.analisarComprovante  (images:annotate)
 *      - PDF    → VisionService.analisarPDF           (files:annotate)
 *   5. Validar se é comprovante legítimo
 *   6. Registrar devolução no Odoo via OdooService
 *   7. Responder ao usuário
 *
 * Versão: 11.0  (PDF nativo via Vision API — removido _converterPdfParaImagem)
 * Data: Fevereiro 2026
 */

const ComprovanteHandler = {

  // ==========================================================================
  // PONTO DE ENTRADA ÚNICO
  // ==========================================================================

  /**
   * @param {string} from
   * @param {Object} arquivo
   * @param {string} [messageId] - `id` da mensagem recebida, para o indicador
   *   de "digitando" (BL-37). Sem ele, o aviso de progresso volta a ser texto.
   */
  processar(from, arquivo, messageId) {
    console.log('📄 Iniciando processamento de comprovante de:', from);

    const tipo = this._detectarTipo(arquivo);

    if (!tipo) {
      Utils.enviarSimples(from,
        '❌ *Tipo de arquivo não suportado*\n\n' +
        'Envie:\n• Foto (JPG, PNG, WebP)\n• PDF\n\nDigite *menu* para voltar.'
      );
      return;
    }

    // BL-37: o "⏳ Analisando comprovante..." era uma mensagem cobrada para
    // dizer "estou trabalhando". O indicador de digitação diz o mesmo de graça
    // — e melhor, porque é um balão vivo em vez de uma linha parada. Só quando
    // ele não sai é que o texto volta: o OCR leva segundos, e silêncio total
    // parece travamento.
    if (!Utils.sinalizarProcessando(messageId)) {
      Utils.enviarSimples(from,
        `⏳ *Analisando ${tipo === 'pdf' ? 'PDF' : 'comprovante'}...*\n\nAguarde um momento.`);
    }

    const resultado = this._processarArquivo(from, arquivo, tipo);
    this._tratarResultado(from, resultado);
  },

  // ==========================================================================
  // DETECÇÃO DE TIPO
  // ==========================================================================

  _detectarTipo(arquivo) {
    const mime = arquivo.mime_type || '';

    if (mime.startsWith('image/'))                       return 'imagem';
    if (mime === 'application/pdf')                      return 'pdf';
    if (arquivo.filename?.toLowerCase().endsWith('.pdf')) return 'pdf';
    if (Object.prototype.hasOwnProperty.call(arquivo, 'sha256')) return 'imagem';

    return null;
  },

  // ==========================================================================
  // PROCESSAMENTO
  // ==========================================================================

  _processarArquivo(from, arquivo, tipo) {
    const resultado = {
      sucesso: false,
      ehComprovante: false,
      dados: null,
      validacao: null,
      erro: null,
      pdfIlegivel: false,
      tipo,
      arquivoOriginalBase64: null
    };

    try {
      // 1. Baixar arquivo
      const arquivoBaixado = MediaService.baixarArquivo(arquivo.id);
      if (!arquivoBaixado) {
        resultado.erro = 'Erro ao baixar arquivo';
        return resultado;
      }

      // 2. Guardar arquivo original
      resultado.arquivoOriginalBase64 = arquivoBaixado.base64;

      // 3. Analisar com Vision API (endpoint adequado ao tipo)
      let analise;

      if (tipo === 'imagem') {
        analise = VisionService.analisarComprovante(arquivoBaixado.base64);
      } else {
        // PDF: enviar direto via files:annotate (sem conversão)
        console.log('📄 Enviando PDF diretamente para Vision API...');
        analise = VisionService.analisarPDF(arquivoBaixado.base64);

        // BL-27: PDF sem texto extraível (protegido, escaneado ruim, corrompido
        // — ou que simplesmente não é um comprovante). Aceitar aqui criaria uma
        // devolução de R$ 0,00 sem chave para conferir, contornando a validação
        // de destinatário do BL-26. Pede reenvio em vez de registrar.
        if (!analise) {
          console.warn('⚠️ Vision API não extraiu texto do PDF — pedindo reenvio');
          resultado.pdfIlegivel = true;
          resultado.erro = 'PDF sem texto extraível';
          return resultado;
        }
      }

      if (!analise) {
        resultado.erro = 'Erro na análise do comprovante';
        return resultado;
      }

      // 4. Validar
      const validacao = VisionService.validarComprovante(analise);

      resultado.sucesso = true;
      resultado.ehComprovante = validacao.ehComprovante;
      resultado.dados = analise;
      resultado.validacao = validacao;

    } catch (error) {
      console.error('❌ Erro ao processar comprovante:', error);
      resultado.erro = error.message;
    }

    return resultado;
  },

  // ==========================================================================
  // CONFERÊNCIA DE CHAVE (BL-26)
  // ==========================================================================

  /**
   * Confere se a chave PIX extraída do comprovante corresponde à chave da
   * comunidade do dizimista.
   * @param {string|null} extraida - Chave lida do comprovante (VisionService)
   * @param {string|null} esperada - Chave PIX cadastrada na comunidade
   * @returns {{conferido: boolean, motivo: string}}
   *          motivo: 'ok' | 'divergente' | 'ausente' | 'sem_referencia'
   * @private
   */
  /**
   * Confere o comprovante contra o cadastro da comunidade (BL-46).
   *
   * Três sinais, de forças MUITO diferentes:
   *
   *   chave PIX  — forte. Se diverge, o dinheiro foi para outra conta.
   *   nome       — médio. Depende de o layout do comprovante ser reconhecido.
   *   banco      — fraco. Idem, e nomes de banco variam ("Itaú" x "Itaú
   *                Unibanco"); serve para confirmar, mal serve para acusar.
   *
   * A chave manda. Nome e banco só decidem quando ela não pôde ser lida, e
   * ainda assim precisam divergir OS DOIS — é o "totalmente divergente".
   *
   * O que NÃO foi extraído nunca conta contra ninguém: `null` é "não sei",
   * não "não confere". Com a variedade de modelos de comprovante, tratar
   * ausência como divergência reprovaria gente que pagou certo.
   *
   * @param {Object} dados      - `resultado.dados` do Vision
   * @param {Object} comunidade - Registro x_comunidade
   * @returns {{conferido: boolean, motivo: string}}
   * @private
   */
  /**
   * A frase de desfecho, conforme o que a conferência encontrou (BL-46).
   *
   * Três desfechos, e a diferença entre o segundo e o terceiro é o pedido do
   * usuário: avisar que *as informações não conferem* só quando forem
   * totalmente divergentes. Nos casos duvidosos a pessoa não precisa saber que
   * houve dúvida — a secretaria confere e pronto. Dizer "seu comprovante não
   * confere" a quem pagou certo é pior que conferir calado.
   *
   * Estava escrito em três lugares (individual, família e oferta), e já
   * divergia entre eles.
   *
   * @param {string} motivo - Código de CONFERENCIA
   * @param {string} oQue   - 'Sua devolução' | 'Sua oferta' | 'Ela'
   * @private
   */
  _fraseDesfecho(motivo, oQue) {
    if (motivo === 'ok') return `${oQue} foi registrada e será confirmada em breve.`;

    if (alertaDoador(motivo)) {
      return '⚠️ *O pagamento não confere.*\n\n' +
             'Os dados de quem recebeu, acima, não batem com os da sua ' +
             `comunidade. ${oQue} foi registrada e será *analisada por um ` +
             'agente da Pastoral do Dízimo*.\n\n' +
             'Se quiser falar com eles agora, é só tocar no botão abaixo. 💛';
    }

    return `${oQue} foi registrada e passará por *conferência da secretaria* ` +
           'antes de ser confirmada.';
  },

  /**
   * Manda o desfecho, com a saída certa para cada caso (BL-50).
   *
   * Quando a mensagem diz que o pagamento não confere, ela PRECISA oferecer a
   * pastoral no mesmo balão: avisar alguém de que o dízimo dela pode ter ido
   * para a conta errada e deixá-la sem para onde ir é pior que não avisar.
   *
   * Nos demais casos, o botão de sempre. Um balão, nos dois.
   * @private
   */
  _responderDesfecho(from, texto, motivo) {
    if (!alertaDoador(motivo)) return Utils.enviarComBotaoMenu(from, texto);

    Utils.enviarMenu(from, texto, [
      { id: 'btn_secretaria', title: '📞 Contato Pastoral' },
      { id: 'btn_menu',       title: '🔙 Menu'             }
    ]);
  },

  /**
   * Pergunta o mês DEPOIS de registrar, e só quando há dúvida real. (BL-62)
   *
   * A dúvida existe quando a pessoa tinha um mês em aberto ANTERIOR ao que
   * acabou de ser registrado: pagou em dezembro tendo setembro em aberto. O bot
   * não tem como saber de qual mês é o pagamento, e adivinhar seria inventar um
   * fato sobre dinheiro.
   *
   * ⚠️ SÓ MANDA MENSAGEM QUANDO HÁ DÚVIDA. No caso comum — a competência do
   *    pagamento bate com o mês em aberto, ou não há mês em aberto — nada é
   *    enviado, e a contagem de mensagens do fluxo normal não muda. O harness
   *    guarda essa contagem.
   *
   * Os dois ids viajam DENTRO do id do botão, e não em sessão. É o que permite
   * a correção não depender de estado nenhum — a pessoa pode tocar em Corrigir
   * horas depois, de outro aparelho, e funciona.
   *
   * @private
   */
  _ofereceCorrigirMes(from, devolucaoId, dizimistaId) {
    if (!devolucaoId || !dizimistaId) return;
    try {
      const reg = OdooService.searchRead('x_devolucao', ['x_studio_competencia'],
        [['id', '=', devolucaoId]], { limit: 1 });
      const competencia = reg && reg[0] && reg[0].x_studio_competencia;
      if (!competencia) return;

      const anterior = OdooService.mesAnteriorSemDevolucao(dizimistaId, competencia);
      if (!anterior) return;   // primeira devolução, ou o mês anterior já coberto

      // Duas opções, sempre. O mês registrado vem primeiro: é o palpite do
      // bot, e quem concorda toca no primeiro botão sem ler o resto.
      Utils.enviarMenu(from,
        `📅 Registrei este dízimo como referente a *${Utils.mesPorExtenso(competencia)}*.\n\n`
        + `Como não vi devolução sua de *${Utils.mesPorExtenso(anterior)}*, quero confirmar: `
        + 'a qual mês ele se refere?',
        [
          { id: `compm_${devolucaoId}_${competencia}`, title: Utils.mesPorExtenso(competencia).substring(0, 20) },
          { id: `compm_${devolucaoId}_${anterior}`,    title: Utils.mesPorExtenso(anterior).substring(0, 20) },
        ]);
    } catch (e) {
      // Nunca derruba nada: a devolução já está registrada e confirmada. O pior
      // que acontece é a pessoa não receber a pergunta.
      console.warn(`⚠️ [Competência] Não consegui oferecer a escolha: ${e.message}`);
    }
  },

  /**
   * A pessoa escolheu o mês de referência. (BL-71)
   *
   * O id do botão carrega o registro e o mês — nada depende de sessão, e por
   * isso a escolha funciona horas depois, com a sessão já expirada. É o caso
   * normal: a devolução é encerrada antes de a pergunta sair.
   *
   * @param {string} buttonId - `compm_<id>_<aaaa-mm-dd>`
   */
  corrigirMes(from, buttonId) {
    const m = String(buttonId).match(/^compm_(\d+)_(\d{4}-\d{2}-\d{2})$/);
    if (!m) {
      // Inclui o formato antigo `comp_<id>_<id>`, de mensagens que saíram
      // antes do BL-71 e ainda estão na conversa de alguém.
      Utils.enviarComBotaoMenu(from,
        '⚠️ Essa opção não vale mais. Sua devolução *está registrada* — se o mês de '
        + 'referência estiver errado, a secretaria ajusta.');
      return;
    }
    try {
      const id = Number(m[1]);
      const atual = OdooService.searchRead('x_devolucao', ['x_studio_competencia'],
        [['id', '=', id]], { limit: 1 });
      if (atual && atual[0] && atual[0].x_studio_competencia === m[2]) {
        Utils.enviarComBotaoMenu(from, '👍 Perfeito, deixo como está. Obrigado!');
        return;
      }
      OdooService.definirCompetencia(id, m[2]);
      Utils.enviarComBotaoMenu(from,
        `✅ Pronto! Seu dízimo passou a valer para *${Utils.mesPorExtenso(m[2])}*.`);
    } catch (e) {
      console.error(`❌ [Competência] Falha ao definir o mês: ${e.message}`);
      Utils.enviarComBotaoMenu(from,
        '⚠️ Não consegui mudar o mês agora. Sua devolução *continua registrada* — ' +
        'apenas o mês de referência não mudou. Fale com a secretaria.');
    }
  },

  _conferirComprovante(dados, comunidade) {
    dados = dados || {};
    comunidade = comunidade || {};

    const chave = this._conferirChave(dados.chavePix, comunidade.x_studio_chave_pix);

    // Chave confere: nada acima disso muda o desfecho para a pessoa. Uma
    // divergência de nome ou banco aqui vira conferência da secretaria, não
    // alerta — pode ser o layout que não entendemos.
    const rec = dados.recebedor || {};
    const nomeDif  = this._textoDivergente(rec.nome,  comunidade.x_studio_titular_conta);
    const bancoDif = this._textoDivergente(rec.banco, comunidade.x_studio_banco);

    // BL-69: a IDADE do comprovante, antes do conteúdo dele.
    //
    // Vem primeiro porque não depende de nada que a comunidade tenha
    // cadastrado — um comprovante de três meses é suspeito com chave certa ou
    // errada. Mas NÃO passa por cima de chave divergente, que é mais grave:
    // por isso só decide quando a chave conferiu ou não foi lida.
    const idade = this._conferirIdade(dados.data);
    if (idade && chave.motivo !== 'divergente') return idade;

    if (chave.motivo === 'ok') {
      if (nomeDif)  return { conferido: false, motivo: 'titular_divergente' };
      if (bancoDif) return { conferido: false, motivo: 'banco_divergente' };
      return chave;
    }

    // Chave divergente já é o caso mais grave; nome e banco não agravam.
    if (chave.motivo === 'divergente') return chave;

    // Sem chave legível, nome E banco divergindo juntos é o sinal que sobra.
    if (nomeDif && bancoDif) return { conferido: false, motivo: 'tudo_divergente' };

    return chave;
  },

  /**
   * O comprovante é velho demais, ou tem data no futuro? (BL-69)
   *
   * Compara com HOJE — não há outro relógio confiável. O E2E do PIX carrega a
   * data, mas é a mesma informação que já foi lida.
   *
   * O limite vem de `x_studio_dias_comprovante` em x_parametros, com
   * DIAS_COMPROVANTE_ANTIGO_PADRAO de fábrica. É parâmetro, e não número no
   * código, porque quem sabe se dois meses é muito ou pouco é a paróquia.
   *
   * Data ILEGÍVEL não acusa nada. O BL-52 fez a leitura funcionar em vários
   * layouts, mas ela ainda falha — e chamar de "antigo" um comprovante cuja
   * data não conseguimos ler seria acusar alguém do nosso próprio limite.
   *
   * @param {string} dataBR - 'dd/mm/aaaa', como o VisionService entrega
   * @returns {{conferido: boolean, motivo: string}|null} null quando está em dia
   * @private
   */
  _conferirIdade(dataBR) {
    const m = String(dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;   // sem data legível não se acusa nada

    const doComprovante = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (isNaN(doComprovante.getTime())) return null;

    const hoje = new Date();
    // Zera a hora dos dois lados: o que interessa é a diferença de DIAS, e um
    // comprovante das 23h comparado com 8h da manhã viraria um dia a mais.
    hoje.setHours(0, 0, 0, 0);
    doComprovante.setHours(0, 0, 0, 0);

    const dias = Math.round((hoje - doComprovante) / 86400000);
    if (dias < 0) return { conferido: false, motivo: 'comprovante_futuro' };

    let limite = DIAS_COMPROVANTE_ANTIGO_PADRAO;
    try {
      const p = OdooService.buscarParametros() || {};
      const cfg = Number(p.x_studio_dias_comprovante);
      // Zero ou negativo reprovaria todo mundo; um número absurdo não reprova
      // ninguém. O campo é editável por quem não escreveu isto.
      if (cfg >= 1 && cfg <= 365) limite = cfg;
    } catch (e) {
      console.warn(`⚠️ [Idade] Não li o parâmetro de dias, usando ${limite}: ${e.message}`);
    }

    return dias > limite ? { conferido: false, motivo: 'comprovante_antigo' } : null;
  },

  /**
   * Os dois textos divergem de verdade? (BL-46)
   *
   * `false` sempre que houver dúvida: sem um dos lados, ou com qualquer
   * palavra significativa em comum. "PAROQUIA N S CONCEICAO" e "Paróquia
   * Nossa Senhora da Conceição Aparecida" são a mesma conta escrita por dois
   * sistemas, e um comparador exato acusaria as duas de divergentes.
   *
   * Divergente é só quando NENHUMA palavra significativa coincide.
   * @private
   */
  _textoDivergente(a, b) {
    const partes = (t) => String(t || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(p => p.length > 2 && ['DOS', 'DAS', 'LTDA'].indexOf(p) < 0);

    const pa = partes(a);
    const pb = partes(b);
    if (!pa.length || !pb.length) return false;        // faltou um lado: não sei

    return !pa.some(p => pb.indexOf(p) >= 0);
  },

  _conferirChave(extraida, esperada) {
    if (!esperada) return { conferido: false, motivo: 'sem_referencia' };
    if (!extraida) return { conferido: false, motivo: 'ausente' };

    // E-mail: compara em minúsculas. Demais tipos (CPF/CNPJ/telefone/aleatória):
    // compara só os dígitos, tolerando o DDI 55 via sufixo.
    const norm = k => {
      k = String(k).trim().toLowerCase();
      return k.indexOf('@') >= 0 ? k : k.replace(/\D/g, '');
    };
    const a = norm(extraida);
    const b = norm(esperada);
    if (!a || !b) return { conferido: false, motivo: 'ausente' };

    let iguais;
    if (a.indexOf('@') >= 0 || b.indexOf('@') >= 0) {
      iguais = a === b;
    } else {
      iguais = a === b ||
        (a.length >= 11 && b.length >= 11 && (a.endsWith(b) || b.endsWith(a)));
    }

    return { conferido: iguais, motivo: iguais ? 'ok' : 'divergente' };
  },

  // ==========================================================================
  // TRATAMENTO DO RESULTADO — FAMÍLIA (N devoluções)
  // ==========================================================================

  /**
   * Contexto de família: cria UMA devolução por membro selecionado (cada uma
   * com o valor mensal do membro e o MESMO comprovante anexado). A validação de
   * chave (BL-26) é feita uma vez, contra a comunidade do responsável.
   * @private
   */
  _tratarResultadoFamilia(from, resultado, lote, blocoDados) {
    console.log(`🎯 [Família] Registrando devolução em lote (${lote.length} membro(s))...`);

    let responsavel = null;
    let erroOdoo = false;
    try {
      responsavel = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      erroOdoo = true;
      console.error('❌ [Família] Erro ao buscar responsável:', e.message);
    }

    // Conferência de chave (uma vez, contra a comunidade do responsável).
    let conferido   = false;
    let conferencia = '';
    if (responsavel) {
      let comunidadeRef = null;
      try {
        comunidadeRef = OdooService.buscarDadosPagamentoComunidade(responsavel);
      } catch (e) {
        console.warn('⚠️ [Família] Não obtive a chave da comunidade:', e.message);
      }
      const conf  = this._conferirComprovante(resultado.dados, comunidadeRef);
      conferido   = conf.conferido;
      conferencia = conf.motivo;
    }

    // Cria uma devolução por membro (valor = valor do membro).
    const tipoComprovante = resultado.tipo === 'pdf' ? 'pdf' : 'imagem';
    const registrados = [];
    const criados = [];
    if (responsavel) {
      for (const m of lote) {
        try {
          const dadosMembro = {
            valor: m.valor || 0,
            data:  resultado.dados && resultado.dados.data,
            tipo:  resultado.dados && resultado.dados.tipo
          };
          const devId = OdooService.registrarDevolucao(
            m.id, dadosMembro, resultado.arquivoOriginalBase64, tipoComprovante, conferencia
          );
          if (devId) {
            registrados.push(m.nome);
            criados.push({ id: devId, dizimistaId: m.id });
          }
        } catch (e) {
          erroOdoo = true;
          console.error(`❌ [Família] Falha ao registrar membro id=${m.id} (${m.nome}): ${e.message}`);
        }
      }
    }

    // Sucesso (ao menos uma criada): encerra a sessão.
    if (registrados.length > 0) {
      StateManager.limparDados(from);
      const base  = `✅ *Comprovante recebido!*\n\n${blocoDados || ''}` +
                    `Registrei ${registrados.length} devolução(ões): ${registrados.join(', ')}.`;
      const fecho = '\n\n🙏 Obrigado pela sua fidelidade! Deus abençoe!';
      this._responderDesfecho(from,
        `${base}\n\n${this._fraseDesfecho(conferencia, 'Ela')}${fecho}`, conferencia);

      // BL-71: a pergunta do mês também aqui, mas SÓ quando o lote tem um
      // membro — que é o caso de quem abre o fluxo de família e escolhe uma
      // pessoa só. Lote de um não é lote.
      //
      // Com vários, uma pergunta por membro viraria uma rajada de mensagens, e
      // uma pergunta única não teria resposta: cada pessoa pode estar num mês
      // diferente. Família de verdade corrige pela tela do Odoo.
      if (criados.length === 1) {
        this._ofereceCorrigirMes(from, criados[0].id, criados[0].dizimistaId);
      }
      return;
    }

    // Falha (Odoo/instabilidade): MANTÉM o estado para o usuário reenviar.
    if (erroOdoo || !responsavel) {
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui registrar as devoluções agora.*\n\n' + (blocoDados || '') +
        'Seu comprovante foi recebido, mas houve uma falha ao salvar. ' +
        'Por favor, *reenvie o comprovante* em alguns minutos ou fale com a secretaria. 🙏'
      );
      return;
    }

    StateManager.limparDados(from);
    Utils.enviarComBotaoMenu(from, '⚠️ Não consegui registrar as devoluções. Tente novamente.');
  },

  /**
   * Comprovante de uma OFERTA (BL-41).
   *
   * Diferente do dízimo em um ponto que importa: pode não haver dizimista, e
   * isso é normal — a comunidade vem da escolha da pessoa, e o telefone fica
   * no registro para a secretaria conseguir falar com quem ofertou.
   *
   * O VALOR — BL-53.
   * Vale o do comprovante. O valor escolhido na tela anterior serve para gerar
   * o código PIX; o que entrou na conta da paróquia é o do comprovante, e é
   * esse que o registro precisa ter.
   *
   * Aqui valia o escolhido, sob o argumento de que o OCR erra (BL-14). Mas o
   * escolhido também não é promessa de nada: ninguém é obrigado a pagar
   * exatamente o que digitou, e trocar de ideia no app do banco é o passo
   * seguinte mais natural que existe. Quem ofertou R$ 55,00 depois de indicar
   * R$ 10,00 via a mensagem dizer R$ 10,00, e a paróquia registrava R$ 10,00 —
   * R$ 45,00 sumiam da prestação de contas sem deixar rastro.
   *
   * Quando os dois não batem, a mensagem diz os dois. A diferença não é
   * acusação (pagar mais, ou menos, é direito de quem oferta): é a chance de
   * a pessoa reconhecer na hora um valor lido errado.
   *
   * Só se o OCR NÃO achar valor nenhum é que o escolhido entra — aí ele é o
   * único número que existe.
   * @private
   */
  _tratarResultadoOferta(from, resultado, blocoDados) {
    const comunidadeId = StateManager.getCampo(from, 'ofertaComunidadeId');
    const valorEscolhido = StateManager.getCampo(from, 'ofertaValor');
    const dizimistaId = StateManager.getCampo(from, 'ofertaDizimistaId') || null;

    const dados = Object.assign({}, resultado.dados);
    const valorLido = (dados.valor && dados.valor > 0) ? dados.valor : null;
    if (!valorLido && valorEscolhido) dados.valor = valorEscolhido;

    // O bloco exibido tem de refletir o que será GRAVADO — senão a pessoa lê
    // um valor na conversa e o Odoo guarda outro, sem que ninguém consiga
    // saber qual dos dois vale.
    blocoDados = this._blocoDados(dados) + this._notaValorDiferente(valorLido, valorEscolhido);

    let comunidadeRef = null;
    try {
      comunidadeRef = OdooService.buscarDadosPagamentoComunidade({ x_studio_comunidade: [comunidadeId] });
    } catch (e) {
      console.warn('⚠️ [Oferta] Não obtive a chave da comunidade:', e.message);
    }
    const conf = this._conferirComprovante(resultado.dados, comunidadeRef);

    let id = null;
    try {
      id = OdooService.registrarDevolucao(
        dizimistaId, dados, resultado.arquivoOriginalBase64,
        resultado.tipo === 'pdf' ? 'pdf' : 'imagem', conf.motivo,
        {
          comunidadeId:      comunidadeId,
          tipo:              'oferta',
          telefoneOfertante: from,
          nomeOfertante:     StateManager.getCampo(from, 'ofertaNome') || ''
        }
      );
    } catch (e) {
      console.error('❌ [Oferta] Falha ao registrar:', e.message);
    }

    if (!id) {
      // MANTÉM o estado, para a pessoa reenviar sem refazer o fluxo.
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui registrar sua oferta agora.*\n\n' + blocoDados +
        'Li o comprovante, mas houve uma falha ao salvar — ele *ainda não foi ' +
        'registrado*. Por favor, reenvie em alguns minutos ou fale com a ' +
        'secretaria informando os dados acima.\n\nPeço desculpas pelo transtorno. 🙏'
      );
      return;
    }

    StateManager.limparDados(from);
    this._responderDesfecho(from,
      '🎁 *Oferta recebida!*\n\n' + blocoDados +
      this._fraseDesfecho(conf.motivo, 'Sua oferta') +
      '\n\n🙏 Que Deus abençoe sua generosidade!',
      conf.motivo
    );
  },

  /**
   * Monta o resumo do que o OCR leu. Vai prefixado à mensagem de resultado
   * (BL-37) — não é enviado por conta própria.
   * @private
   */
  _blocoDados(dados) {
    const rec = dados.recebedor || {};
    const naoVi = '_não identificado_';

    let t = '━━━━━━━━━━━━━━━━━━━━\n📊 *DADOS IDENTIFICADOS*\n━━━━━━━━━━━━━━━━━━━━\n\n';

    t += (dados.valor && dados.valor > 0)
      ? `💰 *Valor devolvido:* ${Utils.formatarValor(dados.valor)}\n`
      : `💰 *Valor devolvido:* ${naoVi}\n`;

    t += dados.data ? `📅 *Data:* ${dados.data}\n` : `📅 *Data:* ${naoVi}\n`;
    if (dados.tipo && dados.tipo !== 'Desconhecido') t += `💳 *Tipo:* ${dados.tipo}\n`;

    // BL-50: quem RECEBEU, em campos próprios e sempre presentes — inclusive
    // quando não foram lidos.
    //
    // O que falta é tão informativo quanto o que veio: se a mensagem diz que
    // algo não confere, a pessoa precisa ver O QUE foi lido para julgar. Um
    // campo omitido em silêncio deixaria "não confere" sem apelação.
    //
    // O banco aqui é o do RECEBEDOR, não `dados.banco` — aquele é o primeiro
    // banco do texto, que num comprovante é o app de quem pagou (BL-46).
    t += '\n👤 *Quem recebeu*\n';
    t += `   Nome: ${rec.nome || naoVi}\n`;
    t += `   Chave PIX: ${dados.chavePix || naoVi}\n`;
    t += `   Banco: ${rec.banco || naoVi}\n`;

    return t + '\n━━━━━━━━━━━━━━━━━━━━\n\n';
  },

  /**
   * Uma linha quando o comprovante mostra um valor diferente do escolhido na
   * tela anterior — BL-53.
   *
   * Não é alerta e não muda status: pagar mais, ou menos, do que indicou é
   * direito de quem oferta, e o que a paróquia registra é o que entrou na
   * conta. A linha existe porque a leitura do valor é reconhecidamente
   * frágil (BL-14), e quem acabou de pagar é a única pessoa no mundo capaz de
   * olhar esse número e dizer na hora que está errado.
   * @private
   */
  _notaValorDiferente(valorLido, valorEscolhido) {
    if (!valorLido || !valorEscolhido) return '';
    // Centavos: dois valores iguais podem diferir na última casa por
    // arredondamento, e isso não é diferença nenhuma.
    if (Math.abs(valorLido - valorEscolhido) < 0.01) return '';

    return `ℹ️ Você havia indicado ${Utils.formatarValor(valorEscolhido)} e o ` +
           `comprovante mostra ${Utils.formatarValor(valorLido)}. ` +
           `Registrei o valor do comprovante.\n\n`;
  },

  // ==========================================================================
  // TRATAMENTO DO RESULTADO
  // ==========================================================================

  _tratarResultado(from, resultado) {
    console.log('🎯 [_tratarResultado] Iniciando...');
    
    if (!resultado.sucesso) {
      console.log('🎯 [_tratarResultado] FALHOU - Não teve sucesso');

      // BL-27: PDF ilegível — mantém o estado AGUARDANDO_COMPROVANTE para o
      // usuário reenviar, e deixa claro que nada foi registrado.
      if (resultado.pdfIlegivel) {
        Utils.enviarMenu(from,
          '📄 *Não consegui ler este PDF*\n\n' +
          'Recebi o arquivo, mas não consegui extrair os dados dele — por isso ' +
          'sua devolução *ainda não foi registrada*.\n\n' +
          'Por favor, envie:\n' +
          '• Uma *foto* (ou print) do comprovante, ou\n' +
          '• O PDF original do aplicativo do banco, sem senha\n\n' +
          'Se o problema continuar, fale com a secretaria. 🙏',
          [{ id: 'btn_menu', title: '🔙 Menu' }]
        );
        return;
      }

      MenuHandler.erro(from,
        `Não consegui processar o comprovante.\n\n_Motivo: ${resultado.erro || 'Erro desconhecido'}_\n\n` +
        'Tente novamente ou entre em contato com a secretaria.'
      );
      return;
    }

    if (!resultado.ehComprovante) {
      console.log('🎯 [_tratarResultado] FALHOU - Não é comprovante válido');
      Utils.enviarMenu(from,
        '🤔 Não identifiquei este arquivo como um comprovante de pagamento.\n\n' +
        'Por favor, envie o comprovante do PIX ou transferência.',
        [{ id: 'btn_menu', title: '🔙 Menu' }]
      );
      return;
    }

    const dados = resultado.dados;

    console.log('🎯 [_tratarResultado] Comprovante VÁLIDO');

    // BL-37: os dados extraídos NÃO são mais uma mensagem própria.
    //
    // Eram enviados aqui, seguidos de "⏳ Registrando sua devolução...", e logo
    // depois vinha o resultado — que repetia valor e data. Duas mensagens
    // cobradas para o mesmo conteúdo, separadas por alguns segundos de Odoo.
    // Agora o bloco vai NA mensagem de resultado, que sai de qualquer forma.
    //
    // A pessoa continua vendo o que o OCR leu, que é o que importa: a extração
    // de valor é reconhecidamente frágil (BL-14), e é olhando esse bloco que
    // alguém percebe um valor errado. Só vê junto com o desfecho, em vez de
    // antes dele.
    const blocoDados = this._blocoDados(dados);

    // ===== CONTEXTO DE OFERTA (BL-41) =====
    // Precisa vir ANTES da busca por dizimista: a oferta pode ser de quem o bot
    // nunca viu, e o caminho normal responderia "não encontrei seu cadastro" —
    // depois de a pessoa já ter pagado.
    if (StateManager.getCampo(from, 'ofertaComunidadeId')) {
      return this._tratarResultadoOferta(from, resultado, blocoDados);
    }

    // ===== CONTEXTO DE FAMÍLIA: uma devolução por membro selecionado =====
    const lote = StateManager.getCampo(from, 'devolucaoLote');
    if (lote && lote.length) {
      return this._tratarResultadoFamilia(from, resultado, lote, blocoDados);
    }

    // ===== REGISTRAR NO ODOO =====
    console.log('🎯 [_tratarResultado] Registrando no Odoo...');

    // Três desfechos distintos — nunca declarar sucesso sem registro real:
    //   devolucaoId != null          → devolução criada com sucesso
    //   erroOdoo === true            → Odoo indisponível/falhou (nada gravado)
    //   dizimista == null sem erro   → número realmente não cadastrado
    let devolucaoId = null;
    let dizimista   = null;
    let erroOdoo    = false;
    let conferido   = false;   // BL-26: chave do comprovante confere com a da comunidade?
    // BL-46: o CÓDIGO da conferência, não só o sim/não. É ele que decide se a
    // pessoa é avisada de que os dados não batem ou se a secretaria confere
    // calada — e 'sem_referencia' (a comunidade não tem chave cadastrada) não
    // é culpa de quem pagou.
    let motivoConferencia = 'sem_referencia';

    try {
      dizimista = OdooService.buscarDizimistaPorWhatsapp(from);
      console.log('🎯 [_tratarResultado] Dizimista:', dizimista ? dizimista.id : 'NULL');
    } catch (e) {
      erroOdoo = true;
      console.error('🎯 [_tratarResultado] ❌ ERRO ao buscar dizimista no Odoo:', e.message);
      console.error('🎯 [_tratarResultado] Stack:', e.stack);
    }

    if (dizimista) {
      try {
        const tipoComprovante = resultado.tipo === 'pdf' ? 'pdf' : 'imagem';

        // BL-26: conferir se o comprovante foi feito para a chave PIX da comunidade.
        // Se não bater (ou não houver chave legível), registra mesmo assim, porém
        // marcado para conferência manual — nunca confirmamos como verificado.
        let comunidadeRef = null;
        try {
          comunidadeRef = OdooService.buscarDadosPagamentoComunidade(dizimista);
        } catch (eCom) {
          console.warn('⚠️ [_tratarResultado] Não obtive a chave da comunidade:', eCom.message);
        }

        const conf = this._conferirComprovante(resultado.dados, comunidadeRef);
        conferido = conf.conferido;
        motivoConferencia = conf.motivo;
        console.log(`🎯 [_tratarResultado] Conferência: ${conferido ? 'OK' : 'PENDENTE'} (${conf.motivo})`);

        devolucaoId = OdooService.registrarDevolucao(
          dizimista.id,
          resultado.dados,
          resultado.arquivoOriginalBase64,
          tipoComprovante,
          conf.motivo
        );
        console.log('🎯 [_tratarResultado] ✅ Devolução registrada! ID:', devolucaoId);
      } catch (e) {
        erroOdoo = true;
        console.error('🎯 [_tratarResultado] ❌ ERRO ao registrar no Odoo:', e.message);
        console.error('🎯 [_tratarResultado] Stack:', e.stack);
      }
    }

    // ===== RESPOSTA FINAL — honesta quanto ao que realmente aconteceu =====
    // BL-37: `blocoDados` entra em todos os desfechos. Antes havia um
    // `dadosResumo` reduzido só para o caso de falha, e o bloco completo ia
    // numa mensagem separada — dois formatos do mesmo conteúdo.

    // 1) Sucesso real: devolução criada. Encerra a sessão.
    if (devolucaoId) {
      StateManager.limparDados(from);
      this._responderDesfecho(from,
        (conferido ? '✅ *Comprovante recebido com sucesso!*\n\n'
                   : '✅ *Comprovante recebido!*\n\n') + blocoDados +
        this._fraseDesfecho(motivoConferencia, 'Sua devolução') +
        '\n\n🙏 Obrigado pela sua fidelidade! Deus abençoe!',
        motivoConferencia
      );
      this._ofereceCorrigirMes(from, devolucaoId, dizimista && dizimista.id);
      return;
    }

    // 2) Falha transitória (Odoo indisponível). MANTÉM o estado
    //    AGUARDANDO_COMPROVANTE para o usuário reenviar sem refazer o fluxo.
    if (erroOdoo) {
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui registrar sua devolução agora.*\n\n' + blocoDados +
        'Li o comprovante, mas estamos com uma instabilidade temporária — então ' +
        'ele *ainda não foi registrado*. Por favor, *reenvie o comprovante* em ' +
        'alguns minutos, ou fale com a secretaria informando os dados acima.\n\n' +
        'Peço desculpas pelo transtorno. 🙏'
      );
      return;
    }

    // 3) Número realmente não cadastrado. Nada foi registrado; volta ao menu.
    StateManager.limparDados(from);
    Utils.enviarMenu(from,
      '⚠️ *Não encontrei seu cadastro* para registrar a devolução.\n\n' + blocoDados +
      'Por isso, seu comprovante *ainda não foi registrado*. Para concluir, ' +
      'faça seu cadastro como dizimista ou entre em contato com a secretaria.',
      [
        { id: 'btn_ser_dizimista', title: '🙏 Ser Dizimista' },
        { id: 'btn_menu',          title: '🔙 Menu' }
      ]
    );
  }
};