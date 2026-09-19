/**
 * ============================================================================
 * MENUHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Gerencia as mensagens e menus de navegação geral.
 * Responsabilidades:
 * - Exibir menu principal
 * - Exibir informações da secretaria
 * - Enviar mensagens de erro padronizadas
 * - Enviar mensagens de campo inválido
 *
 * Versão: 8.0
 * Data: Fevereiro 2026
 */

const MenuHandler = {

  // ==========================================================================
  // MENU PRINCIPAL
  // ==========================================================================

  /**
   * Menu principal — decide pelo número.
   *
   * Quem é dizimista vê o que dizimista faz; quem não é vê o convite para se
   * cadastrar. O botão "Já sou Dizimista" saiu: pedia identificação de quem o
   * bot já tinha identificado.
   */
  menuPrincipal(from) {
    // O menu é o destino de vários fallbacks — inclusive dos que existem para
    // quando o Odoo falha. Uma exceção aqui deixaria a pessoa sem resposta
    // nenhuma, então o Odoo fora do ar degrada para o menu de quem não é
    // dizimista, e não para o silêncio.
    let dizimista = null;
    try {
      dizimista = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      console.warn('⚠️ [Menu] Odoo indisponível, menu genérico:', e.message);
    }

    if (dizimista) {
      this.menuDizimista(from, dizimista);
      return;
    }

    StateManager.setEstado(from, ESTADOS.MENU);

    Utils.enviarMenu(from,
      'Como posso te ajudar hoje?',
      [
        // BL-41: oferta NÃO exige cadastro, então precisa estar visível aqui —
        // é a razão de este menu voltar a existir para número novo.
        { id: 'btn_ser_dizimista', title: '💛 Ser Dizimista'   },
        { id: 'btn_oferta',        title: '🎁 Oferta'          },
        { id: 'btn_secretaria',    title: '📞 Contato Pastoral' }
      ],
      { header: '💛 Pastoral do Dízimo' }
    );
  },

  // ==========================================================================
  // FALAR COM A PASTORAL (contato do responsável da comunidade)
  // ==========================================================================

  /**
   * Ponto de entrada da opção "Falar com a Pastoral" (id do botão: btn_secretaria).
   * - Dizimista já cadastrado (com comunidade) → mostra o contato da SUA comunidade.
   * - Sem cadastro (ou sem comunidade) → pergunta de qual comunidade ele é.
   */
  infoSecretaria(from) {
    let dizimista = null;
    try {
      dizimista = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      console.warn('⚠️ [Pastoral] Falha ao buscar dizimista:', e.message);
    }

    if (dizimista) {
      const res = OdooService.contatosDoDizimista(dizimista);
      if (res.contatos.length || res.comunidade) {
        return this._enviarContatos(from, res.comunidade, res.contatos);
      }
    }

    // Sem cadastro / sem comunidade → pedir a comunidade.
    this._pedirComunidadeContato(from);
  },

  /** Pergunta de qual comunidade o usuário é (paginado, BL-04). */
  _pedirComunidadeContato(from) {
    const comunidades = OdooService.listarComunidades();
    if (!comunidades || comunidades.length === 0) {
      return this._enviarContatoGeral(from,
        'No momento não consegui carregar as comunidades. Tente novamente mais tarde.');
    }
    StateManager.salvarMultiplosCampos(from, { comunidadesOffset: 0 });
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMUNIDADE_CONTATO);
    this._enviarPaginaComunidadesContato(from, comunidades, 0, true);
  },

  /** Renderiza uma página da lista de comunidades para o fluxo de contato. */
  _enviarPaginaComunidadesContato(from, comunidades, offset, primeira) {
    const POR_PAGINA = 9;
    const fatia   = comunidades.slice(offset, offset + POR_PAGINA);
    const temMais = offset + POR_PAGINA < comunidades.length;

    const rows = fatia.map(c => ({
      id:          `com_${c.id}`,
      title:       c.x_name.substring(0, 24),
      description: c.x_name.length > 24 ? c.x_name.substring(24, 72) : ''
    }));
    if (temMais) {
      rows.push({ id: 'com_mais', title: '➡️ Ver mais', description: 'Mostrar outras comunidades' });
    }

    const texto = primeira
      ? '📞 *Falar com a Pastoral do Dízimo*\n\n📍 De qual comunidade você faz parte?'
      : '📍 Outras comunidades disponíveis:';

    Utils.enviarLista(from, texto, [{ title: 'Comunidades', rows }],
      { textoBotao: 'Ver Comunidades' });
  },

  /** Seleção da comunidade no fluxo de contato (com_mais | com_<id>). */
  processarComunidadeContato(from, itemId, itemTitle) {
    if (itemId === 'com_mais') {
      const comunidades = OdooService.listarComunidades();
      const offset = (StateManager.getCampo(from, 'comunidadesOffset') || 0) + 9;
      StateManager.salvarMultiplosCampos(from, { comunidadesOffset: offset });
      this._enviarPaginaComunidadesContato(from, comunidades, offset, false);
      return;
    }

    const comunidadeId = parseInt(String(itemId).replace('com_', ''), 10);
    StateManager.setEstado(from, ESTADOS.MENU);

    let res = { comunidade: itemTitle, contatos: [] };
    try {
      res = OdooService.buscarContatosComunidade(comunidadeId);
    } catch (e) {
      console.error('❌ [Pastoral] Erro ao buscar contatos da comunidade:', e.message);
    }
    this._enviarContatos(from, res.comunidade || itemTitle, res.contatos);
  },

  /** Monta e envia a mensagem com os contatos (ou fallback se não houver). */
  _enviarContatos(from, comunidadeNome, contatos) {
    if (!contatos || !contatos.length) {
      return this._enviarContatoGeral(from,
        `Ainda não há um contato da pastoral cadastrado${comunidadeNome ? ` para *${comunidadeNome}*` : ''}.`);
    }

    // BL-41 (A1): cartão de contato nativo, com "Conversar" e "Salvar contato".
    //
    // Antes ia um texto com o número formatado, e a pessoa tinha de copiar ou
    // digitar para falar com a pastoral. O cartão resolve num toque e custa a
    // MESMA mensagem.
    //
    // O contexto (de que comunidade é) vai dentro do cartão, no campo de
    // organização — e não numa mensagem anterior. Fosse numa mensagem própria,
    // este caminho passaria de 1 para 2 mensagens só para dizer o óbvio.
    const org = comunidadeNome
      ? `Pastoral do Dízimo · ${comunidadeNome}`
      : 'Pastoral do Dízimo';

    const enviou = Utils.enviarContatos(from, contatos.map(c => ({
      nome:     c.nome,
      whatsapp: c.whatsapp,
      cargo:    org
    })));

    if (enviou) return;

    // Rede de segurança: cartão recusado pela Meta (formato de número
    // inesperado no Odoo, política, indisponibilidade). Sem isto a pessoa
    // ficaria sem contato nenhum — e é justamente quem pediu ajuda.
    console.warn('⚠️ [Pastoral] Cartão de contato não saiu; enviando como texto');

    let msg = '📞 *Pastoral do Dízimo*\n';
    if (comunidadeNome) msg += `Comunidade: *${comunidadeNome}*\n`;
    msg += `\nFale com ${contatos.length > 1 ? 'uma destas pessoas' : 'o responsável'}:\n`;
    contatos.forEach(c => {
      msg += `\n• *${c.nome}* — ${this._formatarTelefoneBr(c.whatsapp)}`;
    });
    msg += '\n\n🙏 Deus abençoe!';

    Utils.enviarComBotaoMenu(from, msg);
  },

  /**
   * Fallback quando não há contato específico da comunidade: usa o contato geral
   * da secretaria (parâmetros do Odoo), se houver.
   * @private
   */
  _enviarContatoGeral(from, motivo) {
    let whats = null, email = null;
    try {
      const p = OdooService.buscarParametros();
      whats = p && p.x_studio_secretaria_whatsapp;
      email = p && p.x_studio_secretaria_email;
    } catch (e) { /* silencioso */ }

    let msg = `📞 *Falar com a Pastoral*\n\n${motivo}\n`;
    if (whats || email) {
      msg += '\nVocê pode falar com a secretaria paroquial:\n';
      if (whats) msg += `\n📱 ${this._formatarTelefoneBr(whats)}`;
      if (email) msg += `\n📧 ${email}`;
    } else {
      msg += '\nProcure a secretaria paroquial da sua comunidade. 🙏';
    }
    Utils.enviarComBotaoMenu(from, msg);
  },

  /**
   * Formata um telefone no padrão brasileiro para exibição — ex.:
   * "5586988777332" → "(86) 9 8877-7332". O WhatsApp detecta o número e o
   * deixa clicável automaticamente (não precisa do link wa.me).
   * Se o formato não for reconhecido, devolve o valor original.
   */
  _formatarTelefoneBr(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return String(tel || '');
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);   // remove DDI Brasil
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d[2]} ${d.slice(3, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return String(tel);
  },

  // ==========================================================================
  // MENSAGENS DE ERRO
  // ==========================================================================

  /**
   * Envia mensagem de erro com botão de retorno ao menu.
   * @param {string} from  - Número do destinatário
   * @param {string} texto - Descrição do erro
   */
  erro(from, texto) {
    Utils.enviarComBotaoMenu(from, `❌ *Ops!*\n\n${texto}`);
  },

  /**
   * Envia aviso de campo inválido com orientação para redigitar.
   * @param {string} from   - Número do destinatário
   * @param {string} campo  - Nome do campo (ex: 'Nome', 'Data')
   * @param {string} motivo - Motivo da invalidez (ex: 'muito curto')
   */
  campoInvalido(from, campo, motivo) {
    Utils.enviarSimples(from,
      `⚠️ *${campo} inválido* – ${motivo}.\n\nPor favor, tente novamente:`
    );
  },

  // ==========================================================================
  // BOAS-VINDAS INICIAL
  // ==========================================================================

  /**
   * Texto de boas-vindas. Fica separado porque vai na LEGENDA da imagem
   * quando há avatar, e como mensagem própria quando não há.
   * @private
   */
  _textoBoasVindas() {
    return '👋 *Olá! Sou a Cidinha*, assistente virtual da Pastoral do Dízimo! 💛\n\n' +
           '🙏 *Bem-vindo(a) ao Meu Dízimo!*\n\n' +
           'Estou aqui para te ajudar com seu cadastro e suas devoluções.';
  },

  /**
   * Boas-vindas de quem JÁ é dizimista e escreve ao bot pela primeira vez —
   * em geral quem a secretaria cadastrou no Odoo e recebeu o lembrete.
   *
   * Separado de `_textoBoasVindas` porque aquele fala em "seu cadastro", e
   * para esta pessoa o cadastro já existe. Aqui a apresentação e a saudação
   * são a MESMA frase: prefixar uma na outra daria dois "olá" seguidos.
   * @private
   */
  _textoBoasVindasDizimista(nome) {
    return `👋 *Olá, ${nome}!* Sou a Cidinha, assistente virtual da Pastoral ` +
           'do Dízimo 💛\n\n' +
           '🙏 *Que alegria ter você por aqui!*\n\n' +
           'Como posso te ajudar hoje?';
  },

  /**
   * Boas-vindas do primeiro contato — UMA mensagem.
   *
   * Eram duas: a imagem com uma legenda curta e, logo depois, um texto com o
   * resto. Como a legenda da imagem já carrega texto, as duas viraram uma —
   * e a pessoa vê a mesma coisa. Sem avatar no Odoo, vira texto simples, que
   * continua sendo uma mensagem.
   */
  boasVindas(from) {
    console.log('👋 Enviando boas-vindas para:', from);

    try {
      const parametros = OdooService.buscarParametros();

      if (parametros && parametros.x_studio_avatar) {
        // `enviarImagemFixa`: o media ID é reaproveitado entre primeiros
        // contatos, em vez de subir a mesma imagem a cada pessoa nova (BL-21).
        MediaService.enviarImagemFixa(from, parametros.x_studio_avatar, this._textoBoasVindas());
        return;
      }
    } catch (error) {
      console.error('❌ Erro ao enviar avatar:', error);
      // Cai no texto abaixo — não bloquear o fluxo por causa da imagem.
    }

    Utils.enviarSimples(from, this._textoBoasVindas());
  },

  /**
   * O primeiro contato inteiro — boas-vindas e próximo passo.
   *
   * BL-41 · A12 — POR QUE UMA MENSAGEM, E POR QUE SÓ PARA QUEM JÁ É DIZIMISTA.
   * A entrada custava duas: o avatar com a legenda de boas-vindas e, logo
   * depois, o menu. A sonda S1 confirmou no aparelho que mensagem de BOTÕES
   * renderiza cabeçalho de imagem — então, para quem já é dizimista, a imagem,
   * o texto e os botões cabem num balão só. Toda pessoa passa por aqui, uma
   * vez: é a economia mais barata do projeto.
   *
   * Para NÚMERO NOVO continuam sendo duas. O próximo passo ali é o formulário
   * (`interactive.type = 'flow'`), e se ele aceita cabeçalho de imagem ninguém
   * testou — a sonda S1 respondeu sobre botões, não sobre flow. Encurtar esse
   * caminho no escuro arriscaria a mensagem de quem chega pela primeira vez,
   * que é justamente quem não pode tropeçar. Fica para a sonda S10.
   *
   * Sem imagem disponível, cai nas duas mensagens de sempre. A entrada não
   * pode depender de uma imagem para acontecer.
   */
  primeiroContato(from) {
    let dizimista;
    try {
      dizimista = OdooService.buscarDizimistaPorWhatsapp(from);
    } catch (e) {
      // Sem saber quem é, não dá para montar a mensagem única. O caminho de
      // sempre pelo menos cumprimenta e oferece um menu.
      console.warn('⚠️ [Primeiro contato] Odoo indisponível:', e.message);
      this.boasVindas(from);
      this.entrada(from, undefined);
      return;
    }

    if (dizimista) {
      // Mensagem de BOTÕES: cabeçalho por media ID (sonda S1).
      const imagemId = MediaService.mediaIdDoAvatar();
      if (imagemId) {
        const nome = dizimista.x_name || 'Dizimista';
        this.menuDizimista(from, dizimista, null, {
          imagemId,
          texto: this._textoBoasVindasDizimista(nome)
        });
        console.log('✅ [A12] Primeiro contato em UMA mensagem (dizimista)');
        return;
      }
      this.boasVindas(from);
      this.entrada(from, dizimista);
      return;
    }

    // Número novo. Mensagem de FLOW: cabeçalho por URL, não por media ID — a
    // sonda S10 mostrou que o flow recusa `image.id` e exige `image.link`.
    //
    // As boas-vindas viajam DENTRO do formulário, como `opcoes`, em vez de
    // virem antes dele. Se o formulário não sair, `CadastroHandler.iniciar` as
    // manda antes de começar a conversa — por isso `boasVindas: true` vai
    // junto. Mandá-las aqui e só então tentar o formulário custaria duas
    // mensagens sempre, que é exatamente o que o A12 remove.
    const imagemUrl = MediaService.urlDoAvatar();
    if (imagemUrl) {
      CadastroHandler.iniciar(from, dizimista, {
        imagemUrl,
        texto: this._textoBoasVindasCadastro(),
        boasVindas: true
      });
      return;
    }

    this.boasVindas(from);
    this.entrada(from, dizimista);
  },

  /**
   * Boas-vindas de quem chega pela primeira vez e ainda não é dizimista,
   * fundidas com o convite do formulário (BL-41 · A12).
   *
   * As duas frases vinham em mensagens separadas — a legenda do avatar e o
   * corpo do formulário. Juntas num balão só, o convite fica logo abaixo da
   * apresentação, que é a ordem em que a pessoa lê de qualquer jeito.
   * @private
   */
  _textoBoasVindasCadastro() {
    return '👋 *Olá! Sou a Cidinha*, assistente virtual da Pastoral do Dízimo! 💛\n\n' +
           '🙏 *Bem-vindo(a) ao Meu Dízimo!*\n\n' +
           'Para começar, preencha seus dados de uma vez só. ' +
           'Leva menos de um minuto. 💛';
  },

  /**
   * Primeira coisa depois das boas-vindas: leva a pessoa direto ao que ela
   * pode fazer, decidindo PELO NÚMERO.
   *
   * Antes havia um botão "Já sou Dizimista" que pedia à pessoa para se
   * identificar — e depois consultava o Odoo pelo mesmo número que o WhatsApp
   * já tinha entregue. Eram três mensagens (menu, "buscando seu cadastro",
   * "cadastro encontrado") para descobrir algo que o bot sabia desde o início.
   *
   * @param {Object} [dizimista] - Resultado já buscado, para não consultar duas vezes
   */
  entrada(from, dizimista) {
    let encontrado = dizimista;

    if (encontrado === undefined) {
      try {
        encontrado = OdooService.buscarDizimistaPorWhatsapp(from);
      } catch (e) {
        // Acabamos de mandar as boas-vindas; parar aqui deixaria a pessoa com
        // um "olá" e mais nada. O menu genérico pelo menos oferece um caminho.
        console.warn('⚠️ [Entrada] Odoo indisponível:', e.message);
        this.menuPrincipal(from);
        return;
      }
    }

    if (encontrado) {
      this.menuDizimista(from, encontrado);
      return;
    }

    // Número novo: direto ao cadastro. `iniciar` manda o formulário quando
    // ligado e cai na conversa quando não — e recebe o resultado da busca
    // para não repetir a consulta ao Odoo.
    CadastroHandler.iniciar(from, encontrado);
  },

  /**
   * Convite para outro paroquiano (BL-41 · A10).
   *
   * POR QUE LINK EM TEXTO, E NÃO BOTÃO.
   * O WhatsApp tem botão de URL (`cta_url`), mas uma mensagem interativa é *ou*
   * de botões de resposta *ou* de botão de URL — nunca as duas. Um botão de
   * convite exigiria mensagem própria, e este caminho já custa duas (submenu +
   * esta). O link em texto o WhatsApp transforma em link sozinho, e a pessoa
   * usa o "encaminhar" dele, que é o que realmente espalha.
   */
  convidar(from) {
    let numero = '';
    try {
      numero = getConfig().WHATSAPP_NUMERO_EXIBICAO || '';
    } catch (e) { /* segue sem o link */ }

    const link = numero
      ? `https://wa.me/${String(numero).replace(/\D/g, '')}`
      : '';

    let msg = '💛 *Convide alguém da paróquia*\n\n' +
              'Se conhece alguém que gostaria de contribuir com o dízimo ou com ' +
              'uma oferta, é só encaminhar esta mensagem. 🙏\n\n';

    msg += link
      ? `👉 ${link}\n\n_Toque e pressione esta mensagem para encaminhar._`
      : '_Peça à secretaria o contato do nosso WhatsApp para compartilhar._';

    Utils.enviarComBotaoMenu(from, msg);
  },

  /**
   * Menu de quem já é dizimista.
   *
   * Três botões é o máximo que o WhatsApp aceita, então o histórico não cabe
   * aqui — ele virou contexto no início da devolução, onde a pessoa já está
   * pensando em dízimo, e atalho digitando "histórico".
   *
   * @param {string} [aviso] - Texto que entra ANTES da saudação, na mesma
   *   mensagem. Quem precisa avisar algo junto do menu usa isto em vez de
   *   mandar uma mensagem própria — que seria uma mensagem cobrada a mais.
   */
  /**
   * Os três botões de quem é dizimista — o teto do WhatsApp.
   *
   * Ficam num lugar só porque aparecem em três telas: o menu, a confirmação do
   * cadastro e a confirmação de membro adicionado. Espalhados, divergiriam com
   * o tempo — foi o que aconteceu com o menu de "já sou dizimista" antes do
   * BL-38, que tinha um conjunto de botões diferente do menu principal.
   *
   * Devolvidos por função, e não como constante: um array exportado é
   * compartilhado, e `Utils.enviarMenu` faz `slice`/`map` nele.
   */
  botoesDizimista() {
    return [
      { id: 'btn_devolver_dizimo', title: '💰 Dízimo'          },
      { id: 'btn_oferta',          title: '🎁 Oferta'          },
      { id: 'btn_outras_opcoes',   title: '⋯ Outras opções'    }
    ];
  },

  /**
   * O que não coube nos 3 botões.
   *
   * BL-41 — POR QUE LISTA, E POR QUE ISSO É BARATO.
   * São 4 destinos e o WhatsApp aceita 3 botões, então aqui é lista
   * obrigatoriamente. Ela custa uma mensagem a mais — mas só para quem entra:
   * dízimo e oferta continuam a um toque, e são eles que se repetem. O submenu
   * é usado por quem vai adicionar membro ou ver histórico, algumas dezenas de
   * vezes por mês contra 500 devoluções.
   */
  menuOutrasOpcoes(from) {
    StateManager.setEstado(from, ESTADOS.MENU);

    Utils.enviarLista(from,
      'O que você gostaria de fazer?',
      [{
        title: 'Mais opções',
        rows: [
          { id: 'opt_membro',    title: '➕ Adicionar membro', description: 'Cadastrar alguém da sua família' },
          { id: 'opt_historico', title: '📊 Meu histórico',    description: 'Suas devoluções anteriores'      },
          { id: 'opt_contato',   title: '📞 Contato Pastoral', description: 'Falar com a sua comunidade'      },
          { id: 'opt_convidar',  title: '💛 Convidar alguém',  description: 'Compartilhar o bot da paróquia'  },
          { id: 'opt_menu',      title: '🔙 Menu',             description: 'Voltar ao início'                }
        ]
      }],
      { textoBotao: 'Ver opções' }
    );
  },

  menuDizimista(from, dizimista, aviso, opcoes = {}) {
    StateManager.setEstado(from, ESTADOS.MENU);

    const nome = (dizimista && dizimista.x_name) || 'Dizimista';

    // Com imagem no cabeçalho, o título em texto perde o lugar — `header` é um
    // só. Não é perda: a arte do avatar já diz "Pastoral do Dízimo".
    const cabecalho = opcoes.imagemId
      ? { imagemId: opcoes.imagemId }
      : { header: '💛 Pastoral do Dízimo' };

    // `opcoes.texto` troca o corpo inteiro, em vez de só prefixar. O primeiro
    // contato precisa disso: prefixar as boas-vindas deixaria dois "olá" no
    // mesmo balão — o da Cidinha se apresentando e o "Olá, Fulano" daqui.
    const corpo = opcoes.texto ||
      ((aviso ? aviso + '\n\n' : '') + `Olá, *${nome}*! Como posso te ajudar hoje?`);

    Utils.enviarMenu(from, corpo, this.botoesDizimista(), cabecalho);
  }

};

/**
 * DIAGNÓSTICO (rodar no editor do Apps Script): mostra os contatos que o bot
 * encontraria para cada comunidade — útil para conferir se os "Usuários Pastoral"
 * têm telefone/celular preenchido no Odoo. Passe um id para checar uma só.
 * @param {number} [comunidadeId]
 */
function testarContatosComunidade(comunidadeId) {
  const alvos = comunidadeId
    ? [{ id: comunidadeId }]
    : (OdooService.listarComunidades() || []);
  alvos.forEach(c => {
    const res = OdooService.buscarContatosComunidade(c.id);
    Logger.log(`🏘️ ${res.comunidade || ('#' + c.id)} → ${res.contatos.length} contato(s)`);
    res.contatos.forEach(k => Logger.log(`   • ${k.nome} — ${k.whatsapp}`));
    if (!res.contatos.length) Logger.log('   (sem telefone nos Usuários Pastoral nem no coordenador do dízimo)');
  });
}