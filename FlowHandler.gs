/**
 * ============================================================================
 * FLOWHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Recebe e valida a resposta de um WhatsApp Flow (formulário nativo).
 *
 * POR QUE ISTO EXISTE
 *   O cadastro conversacional gasta ~15 mensagens e é onde a corrida do BL-29
 *   aparece: cada resposta é uma execução separada, e execuções fora de ordem
 *   gravam no campo errado. Um Flow coleta os mesmos campos em UMA submissão:
 *   uma execução, uma gravação, nenhuma corrida — e 2 mensagens no lugar de 15.
 *
 * MODO SEM ENDPOINT (o único viável aqui)
 *   O modo com endpoint exige decifrar RSA-OAEP-SHA256 + AES-128-GCM a cada
 *   tela. O Apps Script só oferece `Utilities.computeRsaSha256Signature` (que
 *   assina, não decifra), então esse modo está fora. Sem endpoint o Flow roda
 *   inteiro no aparelho e devolve tudo de uma vez ao apertar "Enviar".
 *
 *   Consequência que manda no código abaixo: as validações do Flow JSON rodam
 *   NO CLIENTE. O que chega aqui é dado de fora, não verificado. Por isso
 *   `_normalizar` revalida tudo, com as mesmas regras do CadastroHandler.
 *
 * O QUE O FLOW **NÃO** FAZ
 *   - Foto de perfil: fica fora do formulário. Quem vier pelo Flow cai direto
 *     no resumo, sem foto. É proposital — foto por Flow exigiria tratar o
 *     upload de mídia, e o ganho do Flow está em cortar mensagens de texto.
 *   - Devolução: o fluxo caro no dia a dia é a devolução, e ela depende de
 *     comprovante (imagem/PDF). O Flow não ajuda lá.
 *
 * Versão: 1.0
 * Data: Setembro 2026
 */

const FlowHandler = {

  /** Prefixo do flow_token que identifica o Flow de cadastro. */
  TOKEN_CADASTRO: 'cadastro:',

  /** Prefixo do flow_token do Flow de membro da família. */
  TOKEN_MEMBRO: 'membro:',

  /** BL-41: prefixo do formulário de OFERTA. */
  TOKEN_OFERTA: 'oferta:',

  // ==========================================================================
  // ENTRADA
  // ==========================================================================

  /**
   * Trata o `nfm_reply` — a resposta de um Flow enviada pelo aparelho.
   * @param {string} from     - Número do remetente
   * @param {Object} nfmReply - message.interactive.nfm_reply
   */
  processar(from, nfmReply) {
    let resposta;
    try {
      resposta = JSON.parse(nfmReply?.response_json || '{}');
    } catch (e) {
      console.error('❌ [Flow] response_json inválido:', e.message);
      MenuHandler.erro(from, 'Não consegui ler os dados do formulário. Vamos tentar pelo menu.');
      return;
    }

    const token = String(resposta.flow_token || '');
    console.log(`📝 [Flow] Resposta recebida — token "${token}", ${Object.keys(resposta).length} campo(s)`);

    if (token.indexOf(this.TOKEN_CADASTRO) === 0) {
      this._processarCadastro(from, resposta);
      return;
    }

    if (token.indexOf(this.TOKEN_OFERTA) === 0) {
      this._processarOferta(from, resposta);
      return;
    }

    if (token.indexOf(this.TOKEN_MEMBRO) === 0) {
      this._processarMembro(from, resposta);
      return;
    }

    console.warn(`⚠️ [Flow] flow_token não reconhecido: "${token}"`);
    MenuHandler.menuPrincipal(from);
  },

  // ==========================================================================
  // CADASTRO
  // ==========================================================================

  /**
   * Converte a resposta do Flow em `dados_<from>` e mostra o resumo.
   * Reaproveita `CadastroHandler.mostrarResumo`, então o botão "✅ Confirmar"
   * cai no `finalizar` de sempre — o Flow troca a COLETA, não a gravação.
   * @private
   */
  _processarCadastro(from, resposta) {
    // BL-39: o formulário pode ser de meses atrás — a mensagem fica na conversa
    // e o toque nela chega aqui como uma submissão nova. A gravação é barrada
    // de qualquer jeito (`OdooService.criarDizimista`), mas só lá no fim, depois
    // da foto e do resumo. Conferir aqui poupa esses passos a quem já é
    // dizimista; a guarda do OdooService continua sendo a que não pode falhar.
    let jaCadastrado = null;
    try {
      jaCadastrado = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      // Odoo fora do ar: segue o fluxo. A guarda da gravação ainda pega.
      console.warn('⚠️ [Flow] Não consegui conferir cadastro existente:', e.message);
    }

    if (jaCadastrado) {
      console.log(`ℹ️ [Flow] ${from} respondeu um formulário antigo — já é dizimista`);
      StateManager.limparDados(from);
      MenuHandler.menuDizimista(from, jaCadastrado,
        '😊 *Você já está cadastrado(a)!*\n\n' +
        'Este formulário era de uma conversa anterior — não precisava preencher ' +
        'de novo, e *nada foi duplicado*.'
      );
      return;
    }

    const { dados, erros } = this._normalizar(from, resposta);

    if (erros.length) {
      // Sem endpoint não dá para devolver o erro para dentro do Flow: ele já
      // fechou. Então o conserto é por conversa, como sempre foi.
      console.warn('⚠️ [Flow] Cadastro recusado:', erros.join(' | '));
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui aproveitar o formulário.*\n\n' +
        erros.map(e => `• ${e}`).join('\n') +
        '\n\nPodemos fazer o cadastro pelo menu, passo a passo. 💛'
      );
      return;
    }

    StateManager.salvarMultiplosCampos(from, dados);
    StateManager.appendLog(from, `Cadastro via Flow (${Object.keys(dados).length} campos)`);

    console.log(`✅ [Flow] Cadastro de ${from} montado em 1 execução — pedindo a foto`);

    // A foto fica FORA do formulário (exigiria tratar upload de mídia no Flow)
    // e vem logo depois, por conversa. É o único passo que sobra: os 8 campos
    // de texto chegaram todos numa submissão.
    CadastroHandler.pedirFotoDoDizimista(from);
  },

  /**
   * Converte a resposta do Flow de MEMBRO e segue para a foto.
   *
   * O membro não tem comunidade nem notificações — ele herda a comunidade do
   * responsável, e essas informações já foram gravadas na sessão por
   * `iniciarCadastroMembro` antes do formulário sair. Aqui só entram os seis
   * campos do familiar.
   *
   * @private
   */
  _processarMembro(from, resposta) {
    const dados = StateManager.getDadosTemporarios(from);

    // A sessão precisa dizer que é membro. Se não disser, o formulário chegou
    // sem contexto — o cache expirou, ou a pessoa respondeu um formulário
    // antigo. Gravar como membro sem `responsavelId` criaria um familiar solto.
    if (!dados.cadastrandoMembro || !dados.responsavelId) {
      console.warn(`⚠️ [Flow] Resposta de membro sem sessão de membro para ${from}`);
      Utils.enviarComBotaoMenu(from,
        '⚠️ Não consegui ligar esse formulário à sua família — a sessão expirou.\n\n' +
        'Toque em *Adicionar membro* de novo e preencha, que desta vez vai. 💛'
      );
      return;
    }

    const { campos, erros } = this._validarMembro(resposta);

    if (erros.length) {
      console.warn('⚠️ [Flow] Membro recusado:', erros.join(' | '));
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui aproveitar o formulário.*\n\n' +
        erros.map(e => `• ${e}`).join('\n') +
        '\n\nPodemos cadastrar o familiar pelo menu, passo a passo. 💛'
      );
      return;
    }

    StateManager.salvarMultiplosCampos(from, campos);
    StateManager.appendLog(from, `Membro via Flow (${Object.keys(campos).length} campos)`);

    console.log(`✅ [Flow] Membro de ${from} montado em 1 execução — pedindo a foto`);
    CadastroHandler._pedirFotoMembro(from);
  },

  /**
   * Regras do membro. São as mesmas do dizimista menos comunidade e
   * notificação — e o dia é obrigatório aqui, porque o membro sempre tem um
   * dia de devolução (herdado ou escolhido), enquanto no cadastro normal ele
   * só existe se a pessoa quiser lembrete.
   *
   * @returns {{campos: Object, erros: string[]}}
   * @private
   */
  _validarMembro(r) {
    const erros  = [];
    const campos = {};

    const nome = String(r.nome || '').trim();
    if (nome.length < 3) erros.push('Nome do familiar muito curto.');
    else campos.nome = nome;

    const apelido = String(r.nome_usual || '').trim();
    if (apelido.length < 2) erros.push('Apelido muito curto.');
    else campos.nomeUsual = apelido;

    const data = this._data(r.data_nascimento);
    if (!data) erros.push('Data de nascimento inválida ou no futuro.');
    else campos.dataNascimento = data;

    const endereco = String(r.endereco || '').trim();
    if (endereco.length < 5) erros.push('Endereço muito curto.');
    else campos.endereco = endereco;

    const valor = Utils.parseValorBR(r.valor_mensal);
    if (valor === null) erros.push('Valor mensal inválido.');
    else campos.valorMensal = valor;

    const dia = parseInt(r.dia_preferido, 10);
    if (isNaN(dia) || dia < 1 || dia > 28) erros.push('Dia da devolução deve ficar entre 1 e 28.');
    else campos.diaPreferido = dia;

    return { campos, erros };
  },

  /**
   * Valida e converte os campos do Flow para o formato de `dados_<from>`.
   *
   * As regras são as MESMAS do CadastroHandler (nome ≥ 3, apelido ≥ 2, data
   * real e não futura, endereço ≥ 5, valor > 0, dia entre 1 e 28). As duas que
   * já tiveram bug com número de backlog — valor com milhar (BL-06) e data
   * real (BL-08) — moram em `Utils.parseValorBR` e `Utils.validarDataBR`, e os
   * dois caminhos chamam as mesmas.
   *
   * O que NÃO dá para reaproveitar é o `processarX` do CadastroHandler: lá cada
   * validação já envia a mensagem de erro e muda o estado, e um formulário que
   * chega inteiro precisa acumular erros em vez de responder ao primeiro.
   *
   * @returns {{dados: Object, erros: string[]}}
   * @private
   */
  _normalizar(from, r) {
    const erros = [];
    const dados = { whatsapp: from };

    // ── Comunidade ─────────────────────────────────────────────────────────
    const comunidadeId = parseInt(r.comunidade_id, 10);
    if (!comunidadeId) {
      erros.push('Comunidade não informada.');
    } else {
      dados.comunidadeId = comunidadeId;
      // O Flow devolve só o id — `flow-cadastro.json` não tem como mandar o
      // rótulo do Dropdown junto. O `||` que havia aqui sugeria um atalho que
      // nunca acontecia.
      dados.comunidadeNome = this._nomeDaComunidade(comunidadeId);
    }

    // ── Nome e apelido ─────────────────────────────────────────────────────
    const nome = String(r.nome || '').trim();
    if (nome.length < 3) erros.push('Nome completo muito curto.');
    else dados.nome = nome;

    const nomeUsual = String(r.nome_usual || '').trim();
    if (nomeUsual.length < 2) erros.push('Apelido muito curto.');
    else dados.nomeUsual = nomeUsual;

    // ── Data de nascimento ─────────────────────────────────────────────────
    const data = this._data(r.data_nascimento);
    if (!data) erros.push('Data de nascimento inválida ou no futuro.');
    else dados.dataNascimento = data;

    // ── Endereço ───────────────────────────────────────────────────────────
    const endereco = String(r.endereco || '').trim();
    if (endereco.length < 5) erros.push('Endereço muito curto.');
    else dados.endereco = endereco;

    // ── Valor mensal ───────────────────────────────────────────────────────
    const valor = Utils.parseValorBR(r.valor_mensal);
    if (valor === null) erros.push('Valor mensal inválido.');
    else dados.valorMensal = valor;

    // ── Notificação e dia ──────────────────────────────────────────────────
    // O Flow manda string ("sim"/"nao" ou "true"/"false"), nunca boolean.
    const querNotificacao = ['sim', 'true', '1'].indexOf(
      String(r.notificacao || '').toLowerCase()
    ) >= 0;
    dados.notificacaoAtiva = querNotificacao;

    if (querNotificacao) {
      const dia = parseInt(r.dia_preferido, 10);
      if (isNaN(dia) || dia < 1 || dia > 28) erros.push('Dia do lembrete deve ficar entre 1 e 28.');
      else dados.diaPreferido = dia;
    }

    return { dados, erros };
  },

  /**
   * Devolve sempre "DD/MM/AAAA", que é o formato gravado hoje.
   *
   * Aceita quatro entradas porque o formato depende do componente usado no
   * Flow JSON, e trocar o componente não pode quebrar o cadastro:
   *   - "1990-03-15"   CalendarPicker
   *   - "637372800000" DatePicker (epoch em MILISSEGUNDOS, como string)
   *   - "15/03/1990"   TextInput
   *   - "15031990"     TextInput sem máscara
   *
   * O epoch é distinguido pelo comprimento: 10 dígitos ou mais. "15031990"
   * tem 8, então não há ambiguidade com a data digitada.
   *
   * @returns {string|null} null se a data não existir ou for futura.
   * @private
   */
  _data(entrada) {
    const texto = String(entrada || '').trim();
    if (!texto) return null;

    let dia, mes, ano;

    if (/^\d{10,}$/.test(texto)) {
      const d = new Date(parseInt(texto, 10));
      if (isNaN(d.getTime())) return null;
      // Getters em UTC, não locais: o DatePicker manda meia-noite UTC e este
      // projeto roda em America/Sao_Paulo (UTC-3). Com getDate() toda data
      // voltaria um dia — "15/03" viraria "14/03" em todo cadastro por Flow.
      dia = ('0' + d.getUTCDate()).slice(-2);
      mes = ('0' + (d.getUTCMonth() + 1)).slice(-2);
      ano = String(d.getUTCFullYear());
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      [ano, mes, dia] = texto.split('-');
    } else {
      const so = texto.replace(/\D/g, '');
      if (so.length !== 8) return null;
      dia = so.substring(0, 2);
      mes = so.substring(2, 4);
      ano = so.substring(4, 8);
    }

    // Mesma regra do cadastro por conversa (BL-08), num lugar só.
    if (!Utils.validarDataBR(dia, mes, ano)) return null;

    return `${dia}/${mes}/${ano}`;
  },

  /**
   * O Flow devolve só o id da comunidade escolhida. O nome é usado no resumo,
   * então buscamos no Odoo quando o formulário não mandou junto.
   * @private
   */
  _nomeDaComunidade(id) {
    try {
      const achada = OdooService.searchRead(
        'x_comunidade', ['x_name'], [['id', '=', id]], { limit: 1 }
      )[0];
      return achada ? achada.x_name : `Comunidade ${id}`;
    } catch (e) {
      console.warn('⚠️ [Flow] Não consegui buscar o nome da comunidade:', e.message);
      return `Comunidade ${id}`;
    }
  },

  // ==========================================================================
  // ENVIO
  // ==========================================================================

  /**
   * Envia o Flow de cadastro.
   *
   * Exige a propriedade FLOW_ID_CADASTRO (o id do Flow criado na Meta).
   * Sem ela devolve `false` e quem chamou segue pelo cadastro conversacional —
   * é o que permite publicar este código antes de existir Flow nenhum.
   *
   * O modo (`draft`/`published`) não é escolhido por quem chama: quem sabe o
   * estado do Flow é a Meta. Começamos pelo último modo que funcionou, guardado
   * em `FLOW_MODO_CADASTRO`, e trocamos quando ela recusar. Assim a requisição
   * extra custa uma vez por mudança de estado do Flow, não uma por envio.
   *
   * Enquanto o Flow está em rascunho, só números com papel na conta da Meta
   * (admin, desenvolvedor ou testador) conseguem abrir o formulário.
   *
   * @param {string} from
   * @returns {boolean} true se o Flow foi enviado.
   */
  enviarFlowCadastro(from) {
    const props  = PropertiesService.getScriptProperties();
    const flowId = props.getProperty('FLOW_ID_CADASTRO');

    if (!flowId) {
      console.log('ℹ️ [Flow] FLOW_ID_CADASTRO não configurado — seguindo pelo cadastro por conversa');
      return false;
    }

    // Interruptor separado do id, e não redundante com ele: id ausente é "não
    // configurado"; isto aqui é "configurado e DESLIGADO". Com o Flow publicado
    // e funcionando, é o que permite voltar ao cadastro por conversa sem apagar
    // o id — e voltar em segundos, que é o que importa quando algo dá errado
    // com gente usando.
    if (props.getProperty('FLOW_CADASTRO_ATIVO') !== 'true') {
      console.log('ℹ️ [Flow] FLOW_CADASTRO_ATIVO não está "true" — seguindo pelo cadastro por conversa');
      return false;
    }

    // A lista de comunidades vai junto, no payload: sem endpoint, o Flow não
    // tem como consultar o Odoo sozinho.
    let comunidades;
    try {
      comunidades = (OdooService.listarComunidades() || [])
        .map(c => ({ id: String(c.id), title: String(c.x_name).substring(0, 30) }));
    } catch (e) {
      console.error('❌ [Flow] Falha ao listar comunidades:', e.message);
      return false;
    }
    if (!comunidades.length) return false;

    let modo = props.getProperty('FLOW_MODO_CADASTRO') || 'published';
    let resposta = this._postarFlow(from, flowId, comunidades, modo);

    // O estado do Flow muda na Meta, sem avisar nada aqui. Em vez de exigir que
    // quem chama acerte o modo — e receba um 131009 quando errar — trocamos e
    // GUARDAMOS o que funcionou. Antes o palpite errado era refeito do zero a
    // cada envio, custando duas chamadas à Meta toda vez; agora custa uma vez
    // por mudança de estado do Flow.
    if (this._recusouPorModo(resposta)) {
      modo = modo === 'draft' ? 'published' : 'draft';
      console.log(`ℹ️ [Flow] A Meta recusou o modo anterior — o Flow está como ` +
                  `'${modo}'. Reenviando e guardando.`);
      resposta = this._postarFlow(from, flowId, comunidades, modo);
    }

    const enviou = !!resposta && resposta.getResponseCode() === 200;
    console.log(`📤 [Flow] Envio do cadastro para ${from} ` +
                `(modo ${modo}, ${comunidades.length} comunidades): ` +
                `${enviou ? 'ok' : 'falhou'}`);
    if (enviou) {
      props.setProperty('FLOW_MODO_CADASTRO', modo);
      StateManager.setEstado(from, ESTADOS.AGUARDANDO_FLOW_CADASTRO);
      // Sem gravar `whatsapp` aqui: `_normalizar` já o põe em `dados` quando a
      // resposta chega, e esta escrita pagava o lock global à toa.
    }
    return enviou;
  },

  /**
   * Envia o Flow de MEMBRO da família.
   *
   * Exige `FLOW_ID_MEMBRO` e o mesmo interruptor `FLOW_CADASTRO_ATIVO` do
   * cadastro. Um id sem o outro degrada sozinho: com o interruptor ligado e
   * só o `FLOW_ID_CADASTRO` configurado, o cadastro vai por formulário e o
   * membro segue pela conversa — sem nada quebrar.
   *
   * O formulário chega PREENCHIDO com o endereço e o dia do responsável. Isso
   * não é enfeite: na conversa, herdar o endereço custa uma pergunta com dois
   * botões e um estado só para isso. No formulário, o campo já vem com o valor
   * e a pessoa altera se for diferente — que é o que ela faria de qualquer
   * jeito, sem a ida e volta.
   *
   * @param {string} from
   * @param {Object} dados - Sessão já montada por `iniciarCadastroMembro`
   * @returns {boolean} true se o Flow foi enviado.
   */
  /**
   * Resposta do formulário de OFERTA: comunidade + valor numa submissão.
   *
   * Substitui duas mensagens da conversa (a lista de comunidades e a pergunta
   * do valor) por uma. E para quem já é dizimista a comunidade chega
   * pré-selecionada, então sobra confirmar.
   * @private
   */
  _processarOferta(from, resposta) {
    const comunidadeId = parseInt(resposta.comunidade, 10);
    const valor        = Utils.parseValorBR(resposta.valor);
    const nome         = String(resposta.nome || '').trim();

    const erros = [];
    if (!comunidadeId) erros.push('Comunidade não reconhecida');
    if (!valor || valor <= 0) erros.push('Valor da oferta inválido');
    if (nome.length < 2) erros.push('Nome não informado');

    if (erros.length) {
      // A validação do Flow roda no cliente, então o servidor não pode confiar
      // nela. Sem endpoint não dá para devolver o erro para dentro do
      // formulário — ele já fechou —, então o conserto é por conversa.
      console.warn('⚠️ [Flow] Oferta recusada:', erros.join(' | '));
      Utils.enviarComBotaoMenu(from,
        '⚠️ *Não consegui aproveitar o formulário.*\n\n' +
        erros.map(e => `• ${e}`).join('\n') +
        '\n\nVamos tentar pelo menu, passo a passo. 💛'
      );
      OfertaHandler.iniciar(from);
      return;
    }

    // O nome da COMUNIDADE não vem do formulário — o Dropdown devolve só o id —,
    // e é ele que aparece na mensagem de pagamento.
    let nomeComunidade = '';
    try {
      const c = OdooService.searchRead('x_comunidade', ['x_name'],
        [['id', '=', comunidadeId]], { limit: 1 });
      nomeComunidade = (c && c[0] && c[0].x_name) || '';
    } catch (e) {
      console.warn('⚠️ [Flow] Não li o nome da comunidade:', e.message);
    }

    StateManager.salvarMultiplosCampos(from, {
      ofertaComunidadeId:   comunidadeId,
      ofertaComunidadeNome: nomeComunidade,
      ofertaNome:           nome,
      ofertaValor:          valor
    });

    console.log(`✅ [Flow] Oferta de ${from} montada em 1 execução — enviando pagamento`);
    OfertaHandler.enviarPagamentoDaSessao(from);
  },

  /**
   * Manda o formulário de oferta. Devolve false quando não dá — e aí o
   * `OfertaHandler` segue pela conversa, que continua inteira.
   *
   * @param {Object} [dados] - `{ nomePadrao }` para pré-preencher o nome de
   *   quem já é dizimista. A comunidade NÃO é pré-preenchida: ver o comentário
   *   no `flow_action_payload`.
   */
  enviarFlowOferta(from, dados = {}) {
    const props  = PropertiesService.getScriptProperties();
    const flowId = props.getProperty('FLOW_ID_OFERTA');

    if (!flowId) {
      console.log('ℹ️ [Flow] FLOW_ID_OFERTA não configurado — oferta segue pela conversa');
      return false;
    }
    if (props.getProperty('FLOW_CADASTRO_ATIVO') !== 'true') {
      console.log('ℹ️ [Flow] FLOW_CADASTRO_ATIVO não está "true" — oferta segue pela conversa');
      return false;
    }

    let comunidades = [];
    try {
      comunidades = (OdooService.listarComunidades() || []).map(c => ({
        // O Dropdown do Flow espera id e title como STRING. Um id numérico
        // é recusado na renderização, sem erro no envio.
        id:    String(c.id),
        title: String(c.x_name || '').substring(0, 30)
      }));
    } catch (e) {
      console.warn('⚠️ [Flow] Não listei comunidades:', e.message);
    }

    if (!comunidades.length) {
      console.log('ℹ️ [Flow] Sem comunidades — oferta segue pela conversa');
      return false;
    }

    const resposta = Utils._post({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to:                from,
      type:              'interactive',
      interactive: {
        type:   'flow',
        header: { type: 'text', text: '🎁 Oferta' },
        body:   { text: 'Escolha a comunidade e o valor da sua oferta. 💛' },
        footer: { text: 'Com carinho, Cidinha 💛' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token:  `${this.TOKEN_OFERTA}${from}:${Date.now()}`,
            flow_id:     flowId,
            flow_cta:    'Fazer oferta',
            flow_action: 'navigate',
            mode:        props.getProperty('FLOW_MODO_CADASTRO') || 'published',
            flow_action_payload: {
              screen: 'OFERTA',
              data: {
                comunidades: comunidades,
                // A COMUNIDADE NÃO VEM PRÉ-SELECIONADA, de propósito.
                //
                // A versão anterior caía em `comunidades[0].id` quando não havia
                // sugestão — ou seja, quem NÃO é cadastrado recebia a primeira
                // comunidade da lista já marcada. Arbitrária, e é ela que decide
                // para onde o dinheiro vai: quem não reparasse ofertaria para a
                // comunidade errada sem nunca saber.
                //
                // Nem para o dizimista: a dele é onde ele se cadastrou, não
                // necessariamente para onde quer ofertar. Um campo obrigatório
                // vazio obriga a escolha; um preenchido convida a ignorar.
                nome_padrao: String(dados.nomePadrao || '')
              }
            }
          }
        }
      }
    }, { rotulo: 'Flow oferta' });

    const ok = !!resposta && resposta.getResponseCode() === 200;
    if (ok) StateManager.setEstado(from, ESTADOS.AGUARDANDO_FLOW_OFERTA);
    return ok;
  },

  enviarFlowMembro(from, dados) {
    const props  = PropertiesService.getScriptProperties();
    const flowId = props.getProperty('FLOW_ID_MEMBRO');

    if (!flowId) {
      console.log('ℹ️ [Flow] FLOW_ID_MEMBRO não configurado — membro segue pela conversa');
      return false;
    }
    if (props.getProperty('FLOW_CADASTRO_ATIVO') !== 'true') {
      console.log('ℹ️ [Flow] FLOW_CADASTRO_ATIVO não está "true" — membro segue pela conversa');
      return false;
    }

    const resposta = Utils._post({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to:                from,
      type:              'interactive',
      interactive: {
        type:   'flow',
        header: { type: 'text', text: '👨‍👩‍👧 Adicionar familiar' },
        body:   { text: 'Preencha os dados do familiar. O endereço e o dia já vêm com os seus. 💛' },
        footer: { text: 'Com carinho, Cidinha 💛' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token:  `${this.TOKEN_MEMBRO}${from}:${Date.now()}`,
            flow_id:     flowId,
            flow_cta:    'Preencher dados',
            flow_action: 'navigate',
            mode:        props.getProperty('FLOW_MODO_CADASTRO') || 'published',
            flow_action_payload: {
              screen: 'MEMBRO',
              data: {
                // O rótulo vai DENTRO do dado: no Flow JSON o `${...}` só é
                // resolvido quando é o valor inteiro do campo. Numa frase
                // maior — "Comunidade: ${data.comunidade}" — ele aparece
                // literal na tela, como aconteceu no primeiro teste.
                comunidade:      `Comunidade: ${dados.comunidadeNome || '—'}`,
                endereco_padrao: String(dados.responsavelEndereco || ''),
                // NÚMERO, não string: o campo do dia é `input-type: number`, e
                // o validador do Flow confere o tipo do valor inicial contra o
                // tipo do campo. Um "10" entre aspas é recusado na publicação.
                dia_padrao:      parseInt(dados.responsavelDia, 10) || 10
              }
            }
          }
        }
      }
    }, { rotulo: 'WhatsApp Flow (membro)' });

    const enviou = !!resposta && resposta.getResponseCode() === 200;
    console.log(`📤 [Flow] Envio do formulário de membro para ${from}: ${enviou ? 'ok' : 'falhou'}`);

    if (enviou) StateManager.setEstado(from, ESTADOS.AGUARDANDO_FLOW_CADASTRO);
    return enviou;
  },

  /**
   * Monta e posta a mensagem de Flow.
   * @param {string} modo - 'draft' ou 'published'.
   * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse|null}
   * @private
   */
  _postarFlow(from, flowId, comunidades, modo) {
    return Utils._post({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to:                from,
      type:              'interactive',
      interactive: {
        type:   'flow',
        header: { type: 'text', text: '💛 Cadastro de Dizimista' },
        body:   { text: 'Preencha seus dados de uma vez só. Leva menos de um minuto. 💛' },
        footer: { text: 'Com carinho, Cidinha 💛' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            // Volta em response_json — é por ele que `processar` sabe que Flow é.
            flow_token:   `${this.TOKEN_CADASTRO}${from}:${Date.now()}`,
            flow_id:      flowId,
            flow_cta:     'Preencher cadastro',
            flow_action:  'navigate',
            // 'draft' abre a versão não publicada; 'published', a publicada.
            // Pedir o modo que o Flow não está devolve 131009.
            mode:         modo,
            flow_action_payload: {
              screen: 'CADASTRO',
              data:   { comunidades }
            }
          }
        }
      }
    });
  },

  /**
   * A recusa foi só por causa do modo (131009), e não por outro motivo?
   *
   * A mensagem da Meta é genérica ("Parameter value is not valid"); o que
   * identifica o caso é o `details`, que cita o estado de rascunho nos dois
   * sentidos: "The flow is not in a draft state, but the mode is set to
   * 'draft'" e o equivalente para um Flow ainda não publicado.
   *
   * @private
   */
  _recusouPorModo(resposta) {
    if (!resposta || resposta.getResponseCode() === 200) return false;
    const corpo = String(resposta.getContentText() || '');
    return corpo.indexOf('131009') >= 0 && corpo.indexOf('draft') >= 0;
  }

};
