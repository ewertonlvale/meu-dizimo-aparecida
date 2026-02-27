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
        { id: 'btn_secretaria',       title: '📞 Secretaria'       }
      ],
      { header: '💛 Pastoral do Dízimo' }
    );
  },

  // ==========================================================================
  // SECRETARIA
  // ==========================================================================

  /** Envia informações de contato da secretaria. */
  infoSecretaria(from) {
    Utils.enviarComBotaoMenu(from,
      '📞 *SECRETARIA*\n\n' +
      'Horário de atendimento:\n' +
      '🕗 Seg a Sex: 8h às 17h\n' +
      '🕗 Sábado: 8h às 12h\n\n' +
      '📱 WhatsApp: (00) 0000-0000\n' +
      '📧 Email: secretaria@exemplo.com\n\n' +
      '🙏 Nossa equipe está aqui para te ajudar!'
    );
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