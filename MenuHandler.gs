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
   * Envia o menu principal com as opções: Ser Dizimista / Já sou Dizimista / Secretaria.
   * @param {string} from - Número do destinatário
   */
  menuPrincipal(from) {
    StateManager.setEstado(from, ESTADOS.MENU);

    Utils.enviarMenu(from,
      'Como posso te ajudar hoje?',
      [
        { id: 'btn_ser_dizimista',    title: '💛 Ser Dizimista'   },
        { id: 'btn_ja_sou_dizimista', title: '🙏 Já sou Dizimista' },
        { id: 'btn_secretaria',       title: '📞 Contato Pastoral' }
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

    let msg = '📞 *Pastoral do Dízimo*\n';
    if (comunidadeNome) msg += `Comunidade: *${comunidadeNome}*\n`;
    msg += `\nFale com ${contatos.length > 1 ? 'uma destas pessoas' : 'o responsável'}:\n`;
    contatos.forEach(c => {
      const link = this._linkWhatsApp(c.whatsapp);
      msg += link ? `\n• *${c.nome}*\n  ${link}` : `\n• *${c.nome}* — ${c.whatsapp}`;
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
      if (whats) {
        const link = this._linkWhatsApp(whats);
        msg += link ? `\n📱 ${link}` : `\n📱 ${whats}`;
      }
      if (email) msg += `\n📧 ${email}`;
    } else {
      msg += '\nProcure a secretaria paroquial da sua comunidade. 🙏';
    }
    Utils.enviarComBotaoMenu(from, msg);
  },

  /** Monta um link wa.me a partir de um telefone (adiciona DDI Brasil se faltar). */
  _linkWhatsApp(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.length <= 11) d = '55' + d;   // número local BR sem DDI
    return 'https://wa.me/' + d;
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
   * Mensagem de boas-vindas enviada logo após a imagem da Cidinha.
   * @param {string} from - Número do destinatário
   */
  boasVindas(from) {

    console.log('👋 Enviando boas-vindas para:', from);

    try {
      // Buscar parâmetros do sistema (avatar)
      const parametros = OdooService.buscarParametros();

      if (parametros && parametros.x_studio_avatar) {
        // Avatar encontrado no Odoo
        console.log('🖼️ Enviando avatar do Odoo');
        MediaService.enviarImagemBase64(
          from, 
          parametros.x_studio_avatar,
          '👋 *Olá! Sou a Cidinha*, assistente virtual da Pastoral do Dízimo! 💛'
        );
    }

    } catch (error) {
      console.error('❌ Erro ao enviar avatar:', error);
      // Continuar sem avatar - não bloquear o fluxo
    }

    Utils.enviarSimples(from,
      '🙏 *Bem-vindo(a) ao Meu Dízimo!*\n\n' +
      'Estou aqui para te ajudar com seu cadastro e devoluções!\n\n'
    );
    Utilities.sleep(1000);
    //this.menuPrincipal(from);
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