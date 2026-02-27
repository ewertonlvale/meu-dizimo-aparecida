/**
 * ============================================================================
 * DEVOLUCAOHANDLER.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Gerencia o fluxo de devolução de dízimo.
 * Responsabilidades:
 * - Verificar se o usuário é dizimista cadastrado
 * - Enviar dados de pagamento (PIX/banco)
 * - Exibir histórico de devoluções
 * - Aguardar e encaminhar comprovante para ComprovanteHandler
 *
 * Versão: 8.0
 * Data: Fevereiro 2026
 */

const DevolucaoHandler = {

  // ==========================================================================
  // VERIFICAR DIZIMISTA
  // ==========================================================================

  /**
   * Verifica se o usuário tem cadastro e exibe as opções de devolução.
   * Ponto de entrada via botão 'btn_ja_sou_dizimista'.
   */
  verificarDizimista(from) {
    Utils.enviarSimples(from, '🔍 Buscando seu cadastro...');

    const dizimista = OdooService.buscarDizimistaPorWhatsapp(from);

    if (!dizimista) {
      Utils.enviarMenu(from,
        '😕 Não encontrei seu cadastro em nosso sistema.\n\n' +
        'Para acessar as opções de dizimista, primeiro você precisa se cadastrar.',
        [
          { id: 'btn_ser_dizimista', title: '🙏 Ser Dizimista' },
          { id: 'btn_menu',          title: '🔙 Menu'           }
        ]
      );
      return;
    }

    Utils.enviarSimples(from, `✅ *Olá, ${dizimista.x_name}!*\n\nSeu cadastro foi encontrado! 😊`);
    Utilities.sleep(1000);

    Utils.enviarMenu(from,
      'O que você gostaria de fazer?',
      [
        { id: 'btn_devolver_dizimo',   title: '💰 Devolver dízimo'  },
        { id: 'btn_minhas_devolucoes', title: '📊 Meu histórico'    },
        { id: 'btn_menu',              title: '🔙 Menu'              }
      ]
    );
  },

  // ==========================================================================
  // INICIAR DEVOLUÇÃO
  // ==========================================================================

  /**
   * Busca os dados do dizimista e envia as informações de pagamento.
   * Coloca a conversa em modo AGUARDANDO_COMPROVANTE.
   */
  iniciarDevolucao(from) {
    const dizimista = OdooService.buscarDizimistaPorWhatsapp(from);

    if (!dizimista) {
      Utils.enviarSimples(from, '❌ Você ainda não está cadastrado.\n\nDigite *menu* para se cadastrar.');
      return;
    }

    this._enviarDadosPagamento(from, dizimista);
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMPROVANTE);
  },

  // ==========================================================================
  // HISTÓRICO
  // ==========================================================================

  /** Busca e exibe as últimas devoluções do dizimista. */
  exibirHistorico(from) {
    const dizimista = OdooService.buscarDizimistaPorWhatsapp(from);

    if (!dizimista) {
      Utils.enviarSimples(from, '❌ Cadastro não encontrado.');
      return;
    }

    Utils.enviarSimples(from, '📊 Buscando histórico...');

    const devolucoes = OdooService.buscarDevolucoesDizimista(dizimista.id, 10);

    if (!devolucoes || devolucoes.length === 0) {
      Utilities.sleep(1000);
      Utils.enviarMenu(from,
        '📭 Você ainda não tem devoluções registradas.',
        [
          { id: 'btn_devolver_dizimo', title: '💰 Devolver dízimo' },
          { id: 'btn_menu',            title: '🔙 Menu'             }
        ]
      );
      return;
    }

    let mensagem = `📊 *HISTÓRICO DE DEVOLUÇÕES*\n\n`;
    mensagem += `Olá, ${dizimista.x_name}! Suas últimas ${devolucoes.length} devoluções:\n\n`;

    devolucoes.forEach((dev, index) => {
      const data   = Utils.formatarDataOdoo(dev.x_studio_data_da_devolucao);
      const valor  = Utils.formatarValor(dev.x_studio_value);
      const status = dev.x_studio_status || 'Pendente';
      const emoji  = status === 'Confirmado' ? '✅' : '⏳';

      mensagem += `${emoji} *${data}* – ${valor}\n`;
      mensagem += `   Status: ${status}\n`;
      if (index < devolucoes.length - 1) mensagem += '\n';
    });

    mensagem += '\n━━━━━━━━━━━━━━━━━━━━\n🙏 Obrigado por sua fidelidade!\n';

    Utils.enviarSimples(from, mensagem);
    MenuHandler.menuPrincipal(from);
  },

  // ==========================================================================
  // DADOS DE PAGAMENTO (privado)
  // ==========================================================================

  /**
   * Monta e envia a mensagem com chave PIX e dados bancários.
   * @param {string} from       - Número do destinatário
   * @param {Object} dizimista  - Registro do dizimista no Odoo
   */
  _enviarDadosPagamento(from, dizimista) {
    const comunidade = OdooService.buscarDadosPagamentoComunidade(dizimista);

    if (!comunidade || !comunidade.x_studio_chave_pix) {
      Utils.enviarSimples(from,
        '❌ Erro: Dados de pagamento não configurados.\n\nEntre em contato com a secretaria.'
      );
      return;
    }

    const nomeUsual    = dizimista.x_name;
    const valorMensal  = Utils.formatarValor(dizimista.x_studio_value);

    let mensagem = `━━━━━━━━━━━━━━━━━━━━\n`;
    mensagem    += `💰 *DEVOLUÇÃO DE DÍZIMO*\n`;
    mensagem    += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    mensagem    += `Olá, *${nomeUsual}*! 😊\n\n`;
    mensagem    += `Sua devolução mensal registrada é de *${valorMensal}*\n\n`;
    mensagem    += `💡 *Mas você pode contribuir com qualquer valor!*\n`;
    mensagem    += `Doe o que sentir confortável no momento. 💛\n\n`;
    mensagem    += `━━━━━━━━━━━━━━━━━━━━\n`;
    mensagem    += `💳 *DADOS PARA PAGAMENTO*\n`;
    mensagem    += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (comunidade.x_studio_banco)          mensagem += `🏦 *Banco:* ${comunidade.x_studio_banco}\n\n`;
    if (comunidade.x_studio_titular_conta)  mensagem += `👤 *Titular:* ${comunidade.x_studio_titular_conta}\n\n`;
    if (comunidade.x_studio_chave_pix)      mensagem += `🔑 *Chave PIX:* \`${comunidade.x_studio_chave_pix}\`\n\n`;

    mensagem += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    mensagem += `📸 *Após efetuar o pagamento, envie o comprovante aqui.*\n\n`;
    mensagem += `Aceito: imagem (foto) ou PDF.`;

    Utils.enviarSimples(from, mensagem);

    // Tentar enviar QR Code PIX via MediaService
    try {
      MediaService.enviarQrCode(from, comunidade.x_studio_chave_pix, dizimista.x_studio_value);
    } catch (e) {
      console.warn('⚠️ QR Code PIX não pôde ser gerado:', e.message);
    }
  }

};