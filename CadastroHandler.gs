/**
 * ============================================================================
 * CADASTROHANDLER.GS - Bot Meu Dízimo - VERSÃO FINAL CORRIGIDA
 * ============================================================================
 *
 * Versão: 8.2 - Corrigido para seguir padrão do StateManager
 * Data: Fevereiro 2026
 * 
 * CORREÇÃO: Usar StateManager.salvarCampoEMudarEstado() em TODOS os passos
 */

const CadastroHandler = {

  // ==========================================================================
  // HELPER DE PROGRESSO
  // ==========================================================================

  /**
   * Gera indicador de progresso visual.
   * @param {number} atual - Passo atual (1-8)
   * @param {number} total - Total de passos (padrão 8)
   * @returns {string} Ex: "📝 Passo 3 de 8  ▰▰▰▱▱▱▱"
   */
  _progresso(atual, total = 8) {
    const preenchido = '▰'.repeat(atual);
    const vazio      = '▱'.repeat(total - atual);
    return `📝 ${preenchido}${vazio}`;
  },

  // ==========================================================================
  // INICIAR CADASTRO
  // ==========================================================================

  iniciar(from) {
    const dizimistaExistente = OdooService.buscarDizimistaPorWhatsapp(from);

    if (dizimistaExistente) {
      const nome = dizimistaExistente.x_name || 'Dizimista';
      Utilities.sleep(2000);
      Utils.enviarMenu(from,
        `👋 Olá, *${nome}*!\n\nVocê já está cadastrado(a) em nosso sistema!\n\n` +
        `Se deseja atualizar seus dados, entre em contato com a secretaria.`,
        [
          { id: 'btn_devolver_dizimo', title: '💰 Devolver dízimo' },
          { id: 'btn_menu',            title: '🔙 Menu'            }
        ]
      );
      return;
    }

    StateManager.limparDados(from);
    StateManager.iniciarSessaoCadastro(from);
    StateManager.registrarSessaoAtiva(from); 

    const numeroFormatado = Utils.formatarNumeroExibicao(from);

    Utils.enviarConfirmar(from,
      `Que alegria ter você como dizimista! 🙏\n\n` +
      `Vi que está me enviando mensagens pelo número:\n\n📱 *${numeroFormatado}*\n\n` +
      `Esse é o número correto para cadastro?`,
      'btn_numero_confirmar',
      'btn_numero_cancelar'
    );

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_CONFIRMACAO_NUMERO);
  },

  // ==========================================================================
  // CONFIRMAR NÚMERO → PEDIR COMUNIDADE
  // ==========================================================================

  confirmarNumero(from) {
    const comunidades = OdooService.listarComunidades();

    if (!comunidades || comunidades.length === 0) {
      MenuHandler.erro(from, 'Erro ao buscar comunidades. Tente novamente mais tarde.');
      return;
    }

    const sections = [{
      title: 'Comunidades Disponíveis',
      rows: comunidades.map(c => ({
        id:          `com_${c.id}`,
        title:       c.x_name.substring(0, 24),
        description: c.x_name.length > 24 ? c.x_name.substring(24, 72) : ''
      }))
    }];

    Utils.enviarLista(from,
      `${this._progresso(1)}\n\nPerfeito! Vamos começar seu cadastro.\n\n📍 De qual comunidade você faz parte?`,
      sections,
      { textoBotao: 'Ver Comunidades' }
    );

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMUNIDADE);
  },

  // ==========================================================================
  // PROCESSAR COMUNIDADE
  // ==========================================================================

  processarComunidade(from, itemId, itemTitle) {
    const comunidadeId = parseInt(itemId.replace('com_', ''));

    StateManager.salvarMultiplosCampos(from, {
      whatsapp:       from,
      comunidadeId:   comunidadeId,
      comunidadeNome: itemTitle
    });

    Utils.enviarSimples(from, `Ótimo! Comunidade: *${itemTitle}* ✅\n\nAgora vamos aos seus dados pessoais.`);
    Utilities.sleep(1000);
    Utils.enviarSimples(from, `${this._progresso(2)}\n\n📝 *Nome Completo*\n\nDigite seu nome completo como está no documento:`);


    StateManager.setEstado(from, ESTADOS.AGUARDANDO_NOME);
  },

  // ==========================================================================
  // COLETA DE DADOS PESSOAIS
  // ==========================================================================

  processarNome(from, texto) {
    if (texto.length < 3) { MenuHandler.campoInvalido(from, 'Nome', 'muito curto'); return; }

    StateManager.salvarCampoEMudarEstado(from, 'nome', texto, ESTADOS.AGUARDANDO_NOME_USUAL);
    Utils.enviarSimples(from,
      `${this._progresso(3)}\n\nPrazer, *${texto}*! 😊\n\nComo gostaria de ser chamado(a)?\n\n💡 Pode ser seu apelido ou nome de preferência:`

    );
  },

  processarNomeUsual(from, texto) {
    if (texto.length < 2) { MenuHandler.campoInvalido(from, 'Apelido', 'muito curto'); return; }

    StateManager.salvarCampoEMudarEstado(from, 'nomeUsual', texto, ESTADOS.AGUARDANDO_DATA_NASCIMENTO);
    Utils.enviarSimples(from,
      `${this._progresso(4)}\n\nCerto, vou te chamar de *${texto}*! 💛\n\n📅 *Data de Nascimento*\n\nDigite no formato DD/MM/AAAA\nExemplo: 15/03/1990`
    );
  },

  processarDataNascimento(from, texto) {
    const data = texto.replace(/\D/g, '');

    if (data.length !== 8) {
      MenuHandler.campoInvalido(from, 'Data', 'use 8 números. Exemplo: 15031990');
      return;
    }

    const dia = data.substring(0, 2);
    const mes = data.substring(2, 4);
    const ano = data.substring(4, 8);

    if (parseInt(dia) < 1 || parseInt(dia) > 31 || parseInt(mes) < 1 || parseInt(mes) > 12) {
      MenuHandler.campoInvalido(from, 'Data', 'verifique o dia e o mês');
      return;
    }

    const dataFormatada = `${dia}/${mes}/${ano}`;
    StateManager.salvarCampoEMudarEstado(from, 'dataNascimento', dataFormatada, ESTADOS.AGUARDANDO_ENDERECO);

    Utils.enviarSimples(from, `Data registrada: *${dataFormatada}* ✅\n\nAgora preciso do seu endereço.`);
    Utilities.sleep(1000);
    Utils.enviarSimples(from,
      `${this._progresso(5)}\n\n🏠 *Endereço*\n\nDigite seu endereço completo:\n\n` +
      `_Rua, número, bairro e ponto de referência_\n\n` +
      `Exemplo: Rua das Flores, 123, Centro, próximo à farmácia São João`
    );
  },

  // ==========================================================================
  // COLETA DE ENDEREÇO
  // ==========================================================================

  processarEndereco(from, texto) {
    if (texto.length < 5) { MenuHandler.campoInvalido(from, 'Endereço', 'muito curto'); return; }

    StateManager.salvarCampoEMudarEstado(from, 'endereco', texto, ESTADOS.AGUARDANDO_VALOR_MENSAL);
    Utils.enviarSimples(from,
      `${this._progresso(6)}\n\n💰 *Valor Mensal do Dízimo*\n\nQual é o valor que você costuma devolver mensalmente?\n\n` +
      `Escreva somente o valor. Por exemplo: 50 ou 50,00\n\n💡 Este valor é apenas uma referência, você pode variar a cada mês.`
    );
  },

  // ==========================================================================
  // VALOR MENSAL → NOTIFICAÇÕES (✅ CORRIGIDO - SEGUINDO PADRÃO)
  // ==========================================================================

  processarValorMensal(from, texto) {
    const valor = parseFloat(texto.replace(',', '.').replace(/[^0-9.]/g, ''));

    if (isNaN(valor) || valor <= 0) {
      MenuHandler.campoInvalido(from, 'Valor', 'informe um número válido. Escreva somente o valor. Por exemplo: 50 ou 50,00');
      return;
    }

    // ✅ CORRIGIDO: Usar o padrão salvarCampoEMudarEstado
    StateManager.salvarCampoEMudarEstado(from, 'valorMensal', valor, ESTADOS.AGUARDANDO_NOTIFICACAO);
    
    Utils.enviarSimples(from, `Valor registrado: *R$ ${valor.toFixed(2).replace('.', ',')}* ✅`);
    Utilities.sleep(1000);
    
    // Perguntar sobre notificações
    Utils.enviarConfirmar(from,
      `${this._progresso(7)}\n\n📲 *NOTIFICAÇÕES*\n\n` +
      'Deseja receber lembretes mensais sobre suas devoluções?\n\n',
      'btn_notificacao_sim',
      'btn_notificacao_nao'
    );
  },

  // ==========================================================================
  // NOTIFICAÇÕES
  // ==========================================================================

  processarNotificacao(from, aceita) {
    if (aceita) {
      // ✅ CORRIGIDO: Usar o padrão salvarCampoEMudarEstado
      StateManager.salvarCampoEMudarEstado(from, 'notificacaoAtiva', true, ESTADOS.AGUARDANDO_DIA_PREFERIDO);
      
      Utils.enviarSimples(from,
        '📅 *DIA PREFERIDO*\n\n' +
        'Em qual dia do mês você prefere receber o lembrete?\n\n' +
        'Digite um número de *1 a 28*.\n\n' +
        '💡 Exemplo: Se escolher 10, você será lembrado todo dia 10 de cada mês.'
      );
    } else {
      // ✅ CORRIGIDO: Usar o padrão salvarCampoEMudarEstado
      StateManager.salvarCampoEMudarEstado(from, 'notificacaoAtiva', false, ESTADOS.AGUARDANDO_FOTO_PERFIL);
      
      Utils.enviarSimples(from, 'Entendido! Você não receberá lembretes automáticos. ✅');
      Utilities.sleep(1000);
      
      // Solicitar uma foto
      Utils.enviarSimples(from,
        `📸 *Foto de Perfil*\n\n` +
        `Agora envie sua foto de perfil!\n\n` +
        `💡 Dica: use uma foto nítida e recente. 😊\n` +
        `Você pode tirar uma selfie ou enviar da galeria.`
      );
    }
  },

  processarDiaPreferido(from, mensagem) {
    const dia = parseInt(mensagem.text.body.trim());
    
    if (isNaN(dia) || dia < 1 || dia > 28) {
      Utils.enviarSimples(from,
        '❌ Por favor, digite um número entre *1 e 28*.\n\n' +
        'Exemplo: 10'
      );
      return;
    }
    
    // ✅ CORRIGIDO: Usar o padrão salvarCampoEMudarEstado
    StateManager.salvarCampoEMudarEstado(from, 'diaPreferido', dia, ESTADOS.AGUARDANDO_FOTO_PERFIL);
    
    Utils.enviarSimples(from,
      `✅ Perfeito!\n\n` +
      `Você receberá um lembrete amigável todo dia *${dia}* do mês.`
    );
    
    Utilities.sleep(1000);
    
    // Solicitar uma foto
    Utils.enviarSimples(from,
      `📸 *Foto de Perfil*\n\n` +
      `Agora envie sua foto de perfil!\n\n` +
      `💡 Dica: use uma foto nítida e recente. 😊\n` +
      `Você pode tirar uma selfie ou enviar da galeria.`
    );
  },

  // ==========================================================================
  // FOTO DE PERFIL
  // ==========================================================================

  solicitarFoto(from) {
    Utils.enviarSimples(from,
      `📸 Envie sua foto de perfil agora!\n\n💡 Dica: use uma foto nítida e recente. 😊\n\n` +
      `Você pode tirar uma Self ou enviar alguma foto da sua galeria.`
    );
  },

  processarFotoPerfil(from, imagem) {
    Utils.enviarSimples(from, '⏳ Processando foto...');

    try {
      const info = MediaService.obterInfoMidia(imagem.id);
      
      if (info && info.url) {
        const dados = StateManager.getDadosTemporarios(from);
        dados.fotoMediaId = imagem.id;
        StateManager.setDadosTemporarios(from, dados);
        
        Utils.enviarSimples(from, '✅ Foto recebida!');
        console.log(`✅ Foto de perfil registrada para ${from} (mediaId: ${imagem.id})`);
        
        Utilities.sleep(1000);
        this.mostrarResumo(from);  // ✅ Só avança se deu certo
      } else {
        console.warn('⚠️ Falha ao validar foto');
        Utils.enviarSimples(from,
          '⚠️ Não consegui processar essa foto.\n\n' +
          'Por favor, envie outra imagem. 📸'
        );
        // ✅ NÃO avança — permanece em AGUARDANDO_FOTO_PERFIL
      }
    } catch (error) {
      console.error('❌ Erro ao processar foto:', error);
      Utils.enviarSimples(from,
        '⚠️ Ocorreu um erro ao processar a foto.\n\n' +
        'Tente enviar novamente. 📸'
      );
      // ✅ NÃO avança — permanece em AGUARDANDO_FOTO_PERFIL
    }
  },

  //Utilities.sleep(1000);
  //this.mostrarResumo(from);

  // ==========================================================================
  // RESUMO E FINALIZAÇÃO
  // ==========================================================================

  mostrarResumo(from) {
    const dados = StateManager.getDadosTemporarios(from);

    // Montar texto de notificação
    let textoNotificacao = '';
    if (dados.notificacaoAtiva) {
      textoNotificacao = `📲 *Notificações:* Ativadas (dia ${dados.diaPreferido})\n`;
    } else {
      textoNotificacao = `📲 *Notificações:* Desativadas\n`;
    }

    const resumo =
      `📋 *RESUMO DO CADASTRO*\n\n` +
      `👤 *Nome:* ${dados.nome}\n` +
      `💛 *Como chamar:* ${dados.nomeUsual}\n` +
      `📅 *Nascimento:* ${dados.dataNascimento}\n` +
      `🏘️ *Comunidade:* ${dados.comunidadeNome}\n\n` +
      `🏠 *Endereço:* ${dados.endereco}\n\n` +
      `💰 *Dízimo mensal:* R$ ${parseFloat(dados.valorMensal).toFixed(2).replace('.', ',')}\n` +
      textoNotificacao +
      `\nOs dados estão corretos?`;

    Utils.enviarMenu(from, resumo,
      [
        { id: 'btn_confirmar_cadastro', title: '✅ Confirmar'  },
        { id: 'btn_cancelar_cadastro',  title: '❌ Corrigir'   }
      ],
      { header: '💛 Confirmação de Cadastro' }
    );
  },

  finalizar(from) {
    Utils.enviarSimples(from, '⏳ Salvando seu cadastro...');

    const dados = StateManager.getDadosTemporarios(from);

    try {
      const id = OdooService.criarDizimista(dados);

      // Upload da foto se existir mediaId
      if (dados.fotoMediaId && id) {
        try {
          const arquivoBaixado = MediaService.baixarArquivo(dados.fotoMediaId);
          if (arquivoBaixado && arquivoBaixado.base64) {
            OdooService.salvarFotoDizimista(id, arquivoBaixado.base64);
            console.log('✅ Foto de perfil salva no Odoo');
          } else {
            console.warn('⚠️ Não foi possível baixar a foto para salvar no Odoo');
          }
        } catch (fotoError) {
          console.warn('⚠️ Erro ao salvar foto no Odoo:', fotoError);
          // Não interrompe o cadastro por falha na foto
        }
      }

      StateManager.persistirLogCadastro(from, true);
      StateManager.limparDados(from);

      // Mensagem de sucesso personalizada
      let mensagemFinal = `🎉 *Cadastro realizado com sucesso!*\n\n` +
                          `Bem-vindo(a), *${dados.nomeUsual}*! 💛\n\n` +
                          `Você já pode devolver seu dízimo pelo WhatsApp.`;
      
      if (dados.notificacaoAtiva) {
        mensagemFinal += `\n\n📲 Você receberá lembretes todo dia *${dados.diaPreferido}* do mês.`;
      }
      
      mensagemFinal += `\n\nQue Deus abençoe sua generosidade! 🙏`;

      Utils.enviarComBotaoMenu(from, mensagemFinal);

    } catch (error) {
      console.error('❌ Erro ao salvar cadastro:', error);
      MenuHandler.erro(from, 'Ocorreu um erro ao salvar seu cadastro. Tente novamente ou entre em contato com a secretaria.');
    }
  },

  cancelar(from) {
    StateManager.persistirLogCadastro(from, false);
    StateManager.limparDados(from);
    Utils.enviarComBotaoMenu(from,
      '❌ *Cadastro cancelado.*\n\nSe mudar de ideia, é só nos chamar! 💛'
    );
  }

};