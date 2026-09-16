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
          { id: 'btn_devolver_dizimo',  title: '💰 Devolver dízimo'  },
          { id: 'btn_adicionar_membro', title: '➕ Adicionar membro' },
          { id: 'btn_menu',             title: '🔙 Menu'             }
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
  // ADICIONAR MEMBRO DA FAMÍLIA (Fase 1)
  // ==========================================================================

  /**
   * Inicia o cadastro de um familiar, vinculado ao responsável (o número atual).
   * Reaproveita as etapas do cadastro, mas pula número (o membro não tem
   * telefone), comunidade (herda a do responsável) e notificações.
   * Ponto de entrada: botão 'btn_adicionar_membro'.
   */
  iniciarCadastroMembro(from) {
    const responsavel = OdooService.buscarDizimistaPorWhatsapp(from);
    if (!responsavel) {
      Utils.enviarComBotaoMenu(from, '❌ Não encontrei seu cadastro. Digite *menu* para começar.');
      return;
    }

    // Comunidade do responsável (many2one → [id, nome]).
    const com = responsavel.x_studio_comunidade;
    const comunidadeId   = Array.isArray(com) ? com[0] : com;
    const comunidadeNome = Array.isArray(com) ? com[1] : '';

    StateManager.limparDados(from);
    StateManager.iniciarSessaoCadastro(from);
    StateManager.registrarSessaoAtiva(from);
    StateManager.salvarMultiplosCampos(from, {
      cadastrandoMembro:   true,
      responsavelId:       responsavel.id,
      comunidadeId:        comunidadeId,
      comunidadeNome:      comunidadeNome,
      responsavelEndereco: responsavel.x_studio_endereco || '',
      responsavelDia:      responsavel.x_studio_dia_preferido || 10
    });

    Utils.enviarSimples(from,
      `👨‍👩‍👧 *Adicionar membro da família*\n\n` +
      `Vamos cadastrar um familiar na sua comunidade *${comunidadeNome || '—'}*.\n\n` +
      `📝 *Nome Completo*\n\nDigite o nome completo do familiar:`
    );

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_NOME);
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

    // BL-04: a lista do WhatsApp aceita no máximo 10 linhas. Paginamos (9 por
    // página + "Ver mais") em vez de truncar — nenhuma comunidade fica oculta.
    StateManager.salvarMultiplosCampos(from, { comunidadesOffset: 0 });
    this._enviarPaginaComunidades(from, comunidades, 0, true);

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_COMUNIDADE);
  },

  /**
   * Envia uma "página" de comunidades como lista interativa.
   * Até 9 comunidades + a linha "Ver mais" (id `com_mais`) quando houver mais,
   * respeitando o limite de 10 linhas do WhatsApp (BL-04).
   * @private
   */
  _enviarPaginaComunidades(from, comunidades, offset, primeira) {
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
      ? `${this._progresso(1)}\n\nPerfeito! Vamos começar seu cadastro.\n\n📍 De qual comunidade você faz parte?`
      : '📍 Outras comunidades disponíveis:';

    Utils.enviarLista(from, texto, [{ title: 'Comunidades Disponíveis', rows }],
      { textoBotao: 'Ver Comunidades' });
  },

  // ==========================================================================
  // PROCESSAR COMUNIDADE
  // ==========================================================================

  processarComunidade(from, itemId, itemTitle) {
    // BL-04: "Ver mais" avança para a próxima página, sem sair do estado.
    if (itemId === 'com_mais') {
      const comunidades = OdooService.listarComunidades();
      const offset = (StateManager.getCampo(from, 'comunidadesOffset') || 0) + 9;
      StateManager.salvarMultiplosCampos(from, { comunidadesOffset: offset });
      this._enviarPaginaComunidades(from, comunidades, offset, false);
      return;
    }

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

    // BL-08: validar data real (rejeita 31/02), não futura e ano plausível.
    const nDia = parseInt(dia, 10);
    const nMes = parseInt(mes, 10);
    const nAno = parseInt(ano, 10);
    const d = new Date(nAno, nMes - 1, nDia);
    const dataReal =
      d.getFullYear() === nAno && d.getMonth() === nMes - 1 && d.getDate() === nDia;

    if (!dataReal || nAno < 1900 || d > new Date()) {
      MenuHandler.campoInvalido(from, 'Data', 'informe uma data de nascimento válida e não futura. Exemplo: 15/03/1990');
      return;
    }

    const dataFormatada = `${dia}/${mes}/${ano}`;
    StateManager.salvarCampoEMudarEstado(from, 'dataNascimento', dataFormatada, ESTADOS.AGUARDANDO_ENDERECO);
    Utils.enviarSimples(from, `Data registrada: *${dataFormatada}* ✅`);
    Utilities.sleep(800);

    // Membro: oferece o endereço do responsável (confirmar) ou digitar outro.
    if (StateManager.getCampo(from, 'cadastrandoMembro')) {
      const end = StateManager.getCampo(from, 'responsavelEndereco') || '(não informado)';
      Utils.enviarMenu(from,
        `🏠 *Endereço do familiar*\n\nÉ o mesmo endereço do responsável?\n\n_${end}_`,
        [
          { id: 'btn_end_mesmo', title: '🏠 Mesmo endereço' },
          { id: 'btn_end_outro', title: '✏️ Outro endereço' }
        ]
      );
      return;
    }

    Utils.enviarSimples(from,
      `${this._progresso(5)}\n\n🏠 *Endereço*\n\nDigite seu endereço completo:\n\n` +
      `_Rua, número, bairro e ponto de referência_\n\n` +
      `Exemplo: Rua das Flores, 123, Centro, próximo à farmácia São João`
    );
  },

  /** Membro: usa o endereço do responsável e segue para o valor. */
  usarEnderecoDoResponsavel(from) {
    const end = StateManager.getCampo(from, 'responsavelEndereco') || '';
    StateManager.salvarCampoEMudarEstado(from, 'endereco', end, ESTADOS.AGUARDANDO_VALOR_MENSAL);
    Utils.enviarSimples(from, `🏠 Endereço: *mesmo do responsável* ✅`);
    Utilities.sleep(600);
    Utils.enviarSimples(from,
      `💰 *Valor Mensal do Dízimo*\n\nQuanto esse familiar costuma devolver mensalmente?\n\n` +
      `Escreva só o valor (ex.: 50 ou 50,00).`
    );
  },

  /** Membro: pede para digitar um endereço diferente. */
  solicitarEnderecoDigitado(from) {
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_ENDERECO);
    Utils.enviarSimples(from,
      `🏠 *Endereço do familiar*\n\nDigite o endereço completo:\n\n_Rua, número, bairro e ponto de referência_`
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
    // BL-06: tratar separador de milhar. "1.000,50" → 1000.5 (antes virava 1).
    // Regra: vírgula presente → ponto é milhar; sem vírgula, ponto+3 dígitos
    // também é milhar (ex.: "1.000"); ponto isolado (ex.: "50.00") é decimal.
    let t = String(texto).replace(/[^\d.,]/g, '');
    if (t.indexOf(',') >= 0) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (/\.\d{3}(\.\d{3})*$/.test(t)) {
      t = t.replace(/\./g, '');
    }
    const valor = parseFloat(t);

    if (isNaN(valor) || valor <= 0) {
      MenuHandler.campoInvalido(from, 'Valor', 'informe um número válido. Escreva somente o valor. Por exemplo: 50 ou 50,00');
      return;
    }

    StateManager.salvarMultiplosCampos(from, { valorMensal: valor });
    Utils.enviarSimples(from, `Valor registrado: *R$ ${valor.toFixed(2).replace('.', ',')}* ✅`);
    Utilities.sleep(1000);

    // Membro: pula notificações e pergunta o dia da devolução (manter o do
    // responsável ou informar outro).
    if (StateManager.getCampo(from, 'cadastrandoMembro')) {
      const dia = StateManager.getCampo(from, 'responsavelDia') || 10;
      StateManager.setEstado(from, ESTADOS.AGUARDANDO_DIA_PREFERIDO);
      Utils.enviarMenu(from,
        `📅 *Dia da devolução*\n\nManter o mesmo dia do responsável?`,
        [
          { id: 'btn_dia_mesmo', title: `📅 Manter dia ${dia}`.substring(0, 20) },
          { id: 'btn_dia_outro', title: '✏️ Outro dia' }
        ]
      );
      return;
    }

    // Cadastro normal: pergunta sobre notificações.
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_NOTIFICACAO);
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
    
    StateManager.salvarMultiplosCampos(from, { diaPreferido: dia });

    // Membro: sem texto de "lembrete" (não recebe notificações) → foto.
    if (StateManager.getCampo(from, 'cadastrandoMembro')) {
      Utils.enviarSimples(from, `📅 Dia da devolução: *${dia}* ✅`);
      Utilities.sleep(600);
      this._pedirFotoMembro(from);
      return;
    }

    StateManager.setEstado(from, ESTADOS.AGUARDANDO_FOTO_PERFIL);
    Utils.enviarSimples(from,
      `✅ Perfeito!\n\n` +
      `Você receberá um lembrete amigável todo dia *${dia}* do mês.`
    );
    Utilities.sleep(1000);
    Utils.enviarSimples(from,
      `📸 *Foto de Perfil*\n\n` +
      `Agora envie sua foto de perfil!\n\n` +
      `💡 Dica: use uma foto nítida e recente. 😊\n` +
      `Você pode tirar uma selfie ou enviar da galeria.`
    );
  },

  /** Membro: mantém o dia do responsável e segue para a foto. */
  usarDiaDoResponsavel(from) {
    const dia = StateManager.getCampo(from, 'responsavelDia') || 10;
    StateManager.salvarMultiplosCampos(from, { diaPreferido: dia });
    Utils.enviarSimples(from, `📅 Dia da devolução: *${dia}* ✅`);
    Utilities.sleep(600);
    this._pedirFotoMembro(from);
  },

  /** Membro: pede para digitar um dia diferente (1–28). */
  solicitarDiaDigitado(from) {
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_DIA_PREFERIDO);
    Utils.enviarSimples(from, '📅 Digite o dia da devolução (número de *1 a 28*):');
  },

  /** Membro: solicita a foto do familiar, com opção de pular. */
  _pedirFotoMembro(from) {
    StateManager.setEstado(from, ESTADOS.AGUARDANDO_FOTO_PERFIL);
    Utils.enviarMenu(from,
      `📸 *Foto do familiar*\n\nEnvie uma foto do familiar. Se não tiver agora, pode pular.`,
      [{ id: 'btn_foto_pular_membro', title: '⏭️ Pular foto' }]
    );
  },

  /** Membro: pula a foto e vai ao resumo. */
  pularFotoMembro(from) {
    this.mostrarResumo(from);
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
        // BL-20: usar o helper com lock em vez de get/set cru (evita perder
        // outros campos se houver gravação concorrente).
        StateManager.salvarMultiplosCampos(from, { fotoMediaId: imagem.id });

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
    const ehMembro = !!dados.cadastrandoMembro;

    // Linha final: membro não tem notificações; cadastro normal mostra o status.
    const linhaExtra = ehMembro
      ? `👨‍👩‍👧 *Membro da família* (mesma comunidade)\n📅 *Dia da devolução:* ${dados.diaPreferido || '—'}\n`
      : (dados.notificacaoAtiva
          ? `📲 *Notificações:* Ativadas (dia ${dados.diaPreferido})\n`
          : `📲 *Notificações:* Desativadas\n`);

    const resumo =
      `📋 *${ehMembro ? 'RESUMO DO MEMBRO' : 'RESUMO DO CADASTRO'}*\n\n` +
      `👤 *Nome:* ${dados.nome}\n` +
      `💛 *Como chamar:* ${dados.nomeUsual}\n` +
      `📅 *Nascimento:* ${dados.dataNascimento}\n` +
      `🏘️ *Comunidade:* ${dados.comunidadeNome}\n\n` +
      `🏠 *Endereço:* ${dados.endereco}\n\n` +
      `💰 *Dízimo mensal:* R$ ${parseFloat(dados.valorMensal).toFixed(2).replace('.', ',')}\n` +
      linhaExtra +
      `\nOs dados estão corretos?`;

    Utils.enviarMenu(from, resumo,
      [
        { id: 'btn_confirmar_cadastro', title: '✅ Confirmar'  },
        { id: 'btn_cancelar_cadastro',  title: '❌ Corrigir'   }
      ],
      { header: ehMembro ? '👨‍👩‍👧 Confirmação do Membro' : '💛 Confirmação de Cadastro' }
    );
  },

  finalizar(from) {
    const dados = StateManager.getDadosTemporarios(from);
    const ehMembro = !!dados.cadastrandoMembro;

    Utils.enviarSimples(from, ehMembro ? '⏳ Adicionando membro...' : '⏳ Salvando seu cadastro...');

    try {
      // ── Membro da família ────────────────────────────────────────────────
      if (ehMembro) {
        const idMembro = OdooService.criarMembro(dados, dados.responsavelId);

        // Foto do familiar, se foi enviada (é opcional para membros).
        if (dados.fotoMediaId && idMembro) {
          try {
            const arq = MediaService.baixarArquivo(dados.fotoMediaId);
            if (arq && arq.base64) OdooService.salvarFotoDizimista(idMembro, arq.base64);
          } catch (e) {
            console.warn('⚠️ Foto do membro não salva:', e.message);
          }
        }

        StateManager.limparDados(from);

        let msg = `🎉 *Membro adicionado!*\n\n` +
                  `*${dados.nomeUsual}* foi vinculado(a) à sua família.`;
        try {
          const familia = OdooService.listarFamilia(dados.responsavelId);
          if (familia && familia.length) {
            msg += `\n\n👨‍👩‍👧 Sua família agora tem *${familia.length}* pessoa(s).`;
          }
        } catch (e) {
          console.warn('⚠️ listarFamilia falhou (apenas contagem):', e.message);
        }
        msg += `\n\nVocê já pode devolver o dízimo dele(a) por você. 💛`;

        Utils.enviarComBotaoMenu(from, msg);
        return;
      }

      // ── Cadastro normal (responsável) ────────────────────────────────────
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
      MenuHandler.erro(from, ehMembro
        ? 'Ocorreu um erro ao adicionar o membro. Tente novamente ou fale com a secretaria.'
        : 'Ocorreu um erro ao salvar seu cadastro. Tente novamente ou entre em contato com a secretaria.');
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