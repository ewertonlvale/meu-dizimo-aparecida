/**
 * ============================================================================
 * CONFIG.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Configuração central do sistema.
 * Responsabilidades:
 * - Carregar credenciais do PropertiesService
 * - Expor constantes de estado (ESTADOS)
 * - Expor constantes de configuração (ODOO, Vision)
 *
 * Versão: 9.0  (adicionados estados do módulo de relatório v2)
 * Data: Fevereiro 2026
 */

// ============================================================================
// ESTADOS DA CONVERSA
// ============================================================================

const ESTADOS = {
  MENU:                          'MENU',
  AGUARDANDO_COMUNIDADE:         'AGUARDANDO_COMUNIDADE',
  AGUARDANDO_CONFIRMACAO_NUMERO: 'AGUARDANDO_CONFIRMACAO_NUMERO',
  AGUARDANDO_NOME:               'AGUARDANDO_NOME',
  AGUARDANDO_NOME_USUAL:         'AGUARDANDO_NOME_USUAL',
  AGUARDANDO_DATA_NASCIMENTO:    'AGUARDANDO_DATA_NASCIMENTO',
  AGUARDANDO_ENDERECO:           'AGUARDANDO_ENDERECO',
  AGUARDANDO_VALOR_MENSAL:       'AGUARDANDO_VALOR_MENSAL',
  AGUARDANDO_FOTO_PERFIL:        'AGUARDANDO_FOTO_PERFIL',
  AGUARDANDO_COMPROVANTE:        'AGUARDANDO_COMPROVANTE',

  // ── Família (devolução em lote e histórico) ────────────────────────────────
  AGUARDANDO_SELECAO_FAMILIA:      'AGUARDANDO_SELECAO_FAMILIA',
  AGUARDANDO_COMPROVANTE_FAMILIA:  'AGUARDANDO_COMPROVANTE_FAMILIA',
  AGUARDANDO_SELECAO_HISTORICO:    'AGUARDANDO_SELECAO_HISTORICO',

  // Aviso de que já existe devolução no mês (usuário confirma se registra outra)
  AGUARDANDO_CONFIRMA_DUPLICATA:   'AGUARDANDO_CONFIRMA_DUPLICATA',

  // Contato da pastoral: usuário sem cadastro escolhe a comunidade para ver o responsável
  AGUARDANDO_COMUNIDADE_CONTATO:   'AGUARDANDO_COMUNIDADE_CONTATO',

  // Flow de cadastro enviado — aguardando o `nfm_reply` do aparelho.
  // Não entra em ESTADOS_CADASTRO: o Flow roda no cliente, então não há
  // sessão de coleta a expirar nem log passo a passo a acumular.
  AGUARDANDO_FLOW_CADASTRO:      'AGUARDANDO_FLOW_CADASTRO',

  // ── Oferta (BL-41) ─────────────────────────────────────────────────────────
  // Oferta NÃO exige cadastro, então estes estados valem também para número
  // desconhecido — são os primeiros do bot nessa condição.
  AGUARDANDO_COMUNIDADE_OFERTA:  'AGUARDANDO_COMUNIDADE_OFERTA',
  AGUARDANDO_NOME_OFERTA:        'AGUARDANDO_NOME_OFERTA',
  AGUARDANDO_VALOR_OFERTA:       'AGUARDANDO_VALOR_OFERTA',
  AGUARDANDO_COMPROVANTE_OFERTA: 'AGUARDANDO_COMPROVANTE_OFERTA',
  AGUARDANDO_FLOW_OFERTA:        'AGUARDANDO_FLOW_OFERTA',

  AGUARDANDO_NOTIFICACAO:        'AGUARDANDO_NOTIFICACAO',
  AGUARDANDO_DIA_PREFERIDO:      'AGUARDANDO_DIA_PREFERIDO',

  // ── Módulo de Relatório v2 ─────────────────────────────────────────────────
  // Aguardando o código de acesso digitado pelo usuário
  AGUARDANDO_CODIGO_RELATORIO:     'AGUARDANDO_CODIGO_RELATORIO',

  // Menu principal do relatório (seleção via botão)
  AGUARDANDO_OPCAO_RELATORIO:      'AGUARDANDO_OPCAO_RELATORIO',

  // Opção 1 – Resumo Consolidado: aguardando seleção do período na lista
  AGUARDANDO_PERIODO_CONSOLIDADO:  'AGUARDANDO_PERIODO_CONSOLIDADO',

  // Opção 1 – Resumo Consolidado: aguardando mês digitado manualmente (MM/AAAA)
  AGUARDANDO_MES_CUSTOMIZADO:      'AGUARDANDO_MES_CUSTOMIZADO',

  // Opção 2 – Listar Dizimistas: aguardando seleção de comunidade (apenas ADMIN)
  AGUARDANDO_COMUNIDADE_RELATORIO: 'AGUARDANDO_COMUNIDADE_RELATORIO',

  // ── Legado (mantido por compatibilidade com versão 8.x) ───────────────────
  AGUARDANDO_PERIODO_RELATORIO:    'aguardando_periodo_relatorio',

  // Opção 3 – Devoluções Pendentes: aguardando seleção de comunidade (apenas ADMIN)
  AGUARDANDO_COMUNIDADE_PENDENTES: 'AGUARDANDO_COMUNIDADE_PENDENTES',

  // Opção 3 – Devoluções Pendentes: aguardando seleção de devolução na lista
  AGUARDANDO_SELECAO_PENDENTE:     'AGUARDANDO_SELECAO_PENDENTE',

  // Opção 3 – Devoluções Pendentes: visualizando detalhe, aguardando ação (confirmar/rejeitar)
  AGUARDANDO_ACAO_PENDENTE:        'AGUARDANDO_ACAO_PENDENTE',
};

/**
 * Estados que compõem o fluxo de cadastro.
 * Centralizado aqui para evitar duplicação no Router (antes repetido em
 * _rotearBotao e _rotearTexto). Usado para decidir quando aplicar log de
 * cadastro e verificação de expiração de sessão.
 */
const ESTADOS_CADASTRO = [
  ESTADOS.AGUARDANDO_CONFIRMACAO_NUMERO,
  ESTADOS.AGUARDANDO_COMUNIDADE,
  ESTADOS.AGUARDANDO_NOME,
  ESTADOS.AGUARDANDO_NOME_USUAL,
  ESTADOS.AGUARDANDO_DATA_NASCIMENTO,
  ESTADOS.AGUARDANDO_ENDERECO,
  ESTADOS.AGUARDANDO_VALOR_MENSAL,
  ESTADOS.AGUARDANDO_NOTIFICACAO,
  ESTADOS.AGUARDANDO_DIA_PREFERIDO,
  ESTADOS.AGUARDANDO_FOTO_PERFIL
];

/**
 * ============================================================================
 * CONFERÊNCIA DA CHAVE PIX (BL-26)
 * ============================================================================
 *
 * O resultado da conferência entre a chave do comprovante e a da comunidade
 * nasce em `ComprovanteHandler._conferirChave`, é gravado em
 * `x_studio_conferencia_pix` e precisa ser lido em dois lugares muito
 * diferentes: o nome do registro no Odoo (curto, cabe numa linha) e a tela do
 * coordenador no WhatsApp (uma frase).
 *
 * Estava escrito em três lugares — o enum no ComprovanteHandler, um mapa de
 * texto curto no OdooService e outro de texto longo declarado DENTRO de uma
 * função do RelatorioHandler. Os dois mapas falham em SILÊNCIO: um código novo
 * (ou um typo) vira `undefined`, e a devolução aparece sem aviso nenhum para
 * quem vai confirmar. É exatamente a falha silenciosa que o BL-26 existe para
 * acabar.
 *
 * `exigeConferencia` também mora aqui: o RelatorioHandler codificava a regra
 * "diferente de 'ok' significa conferir" por conta própria.
 */
const CONFERENCIA = {
  ok: {
    exigeConferencia: false,
    avisoRegistro:    '',
    textoCoordenador: ''
  },
  divergente: {
    exigeConferencia: true,
    alertaDoador:     true,
    avisoRegistro:    '⚠️ CONFERIR: chave do comprovante diverge da comunidade',
    textoCoordenador: 'a chave do comprovante *diverge* da chave da comunidade'
  },
  ausente: {
    exigeConferencia: true,
    avisoRegistro:    '⚠️ CONFERIR: chave não identificada no comprovante',
    textoCoordenador: 'não consegui identificar a chave no comprovante'
  },
  sem_referencia: {
    exigeConferencia: true,
    avisoRegistro:    '⚠️ CONFERIR: comunidade sem chave PIX cadastrada',
    textoCoordenador: 'a comunidade não tem chave PIX cadastrada para comparar'
  },

  // BL-46: o que o recebedor do comprovante diz, além da chave. `alertaDoador`
  // marca os casos em que a PESSOA é avisada de que algo não bate — e só os
  // graves entram, porque um alerta injusto acusa quem pagou certo.
  titular_divergente: {
    exigeConferencia: true,
    // BL-50: passou a avisar. Antes só o "totalmente divergente" avisava, para
    // não acusar quem pagou certo. O que mudou foi a mensagem: ela agora
    // MOSTRA nome, chave e banco que foram lidos, então a pessoa vê em cima de
    // que dado a dúvida se apoia — e tem o botão da pastoral ao lado.
    alertaDoador:     true,
    avisoRegistro:    '⚠️ CONFERIR: nome de quem recebeu diverge do titular',
    textoCoordenador: 'o nome de quem recebeu *diverge* do titular da comunidade'
  },
  banco_divergente: {
    exigeConferencia: true,
    alertaDoador:     true,
    avisoRegistro:    '⚠️ CONFERIR: banco de destino diverge do cadastrado',
    textoCoordenador: 'o banco de destino *diverge* do cadastrado na comunidade'
  },
  // BL-69: a IDADE do comprovante, e não o conteúdo dele.
  //
  // Os dois entram como `alertaDoador`, então `statusDaDevolucao` os leva a
  // "Não confere". É mais duro que o resto da tabela de propósito: chave que
  // não bate pode ser layout de banco que não entendemos, mas data é data.
  //
  // ⚠️ Por isso mesmo, estes dois SÓ valem quando a chave conferiu ou não foi
  //    lida. Divergência de chave é mais grave e continua mandando — ver
  //    `_conferirComprovante`.
  comprovante_antigo: {
    exigeConferencia: true,
    alertaDoador:     true,
    avisoRegistro:    '⚠️ CONFERIR: comprovante antigo',
    textoCoordenador: 'a data do comprovante é bem anterior ao pagamento de hoje'
  },
  comprovante_futuro: {
    exigeConferencia: true,
    alertaDoador:     true,
    // Data posterior a hoje é impossível. Ou o comprovante foi adulterado, ou
    // a leitura errou — e nos dois casos alguém precisa olhar.
    avisoRegistro:    '🚨 CONFERIR: comprovante com data no futuro',
    textoCoordenador: 'a data do comprovante está no futuro'
  },

  tudo_divergente: {
    exigeConferencia: true,
    alertaDoador:     true,
    avisoRegistro:    '🚨 CONFERIR: nome E banco de destino divergem',
    textoCoordenador: 'nome e banco de quem recebeu *divergem* dos da comunidade'
  }
};

/**
 * O status com que a devolução nasce no Odoo, conforme a conferência (BL-51).
 *
 * Três desfechos, e o do meio é o que não pode sumir:
 *
 *   'Confirmado'  a chave, o nome e o banco conferem. Nada a decidir.
 *   'Rejeitado'   algum dado LIDO diverge. É o mesmo critério que avisa a
 *                 pessoa — e ela já foi avisada de que um agente da pastoral
 *                 vai analisar, então o registro precisa estar achável.
 *   'Pendente'    não deu para ler o que seria comparado. Continua como antes:
 *                 entra na fila do coordenador, que confirma ou rejeita.
 *
 * A TERCEIRA LINHA É O PONTO. Marcar 'Rejeitado' o que não foi lido rejeitaria
 * pagamento legítimo em massa: o comprovante do Nubank sem chave no destino é
 * o caso mais comum que existe (BL-49), e ali não se sabe de nada. Ausência de
 * informação não é prova de erro.
 *
 * ⚠️ 'Confirmado' aqui quer dizer "o comprovante bate com o cadastro" — não
 *    que o dinheiro caiu na conta. Quem quiser a conferência financeira
 *    continua tendo o extrato; isto é conferência de comprovante.
 *
 * @param {string} codigo - Valor de x_studio_conferencia_pix
 * @returns {string} 'Confirmado' | 'Rejeitado' | 'Pendente'
 */
function statusDaDevolucao(codigo) {
  if (codigo === 'ok')          return 'Confirmado';
  if (alertaDoador(codigo))     return 'Rejeitado';
  return 'Pendente';
}

/**
 * O estado "A devolver", que o bot NÃO cria mais. (BL-71)
 *
 * A previsibilidade automática — abrir o mês seguinte a cada devolução — foi
 * removida. Ela resolvia um problema e criava três: mês fantasma para quem
 * devolve de dois em dois meses, pergunta disparando em toda devolução, e um
 * buraco sem rastro quando alguém pulava um mês. A regra de ouro do BL-71
 * cobre o que importava com duas opções e nenhum registro inventado.
 *
 * A constante fica porque o VALOR continua existindo no Odoo — há registros
 * criados antes desta mudança, e o coordenador pode criar um à mão. O bot só
 * precisa saber IGNORÁ-LOS: `A devolver` é previsão, não pagamento, e quem
 * conta "o mês anterior teve devolução?" não pode confundir os dois.
 */
const STATUS_A_DEVOLVER = 'A devolver';

/**
 * A partir de quantos dias um comprovante é velho demais. (BL-69)
 *
 * Vem de `x_studio_dias_comprovante` em x_parametros; este é o padrão de
 * fábrica, usado enquanto o campo não existir ou vier vazio.
 *
 * POR QUE 60, E NÃO 30 NEM 90
 *   5 dias pegaria quem paga no dia 1º pelo mês anterior — falso positivo
 *   garantido, todo mês. 30 dias é apertado para quem pagou e esqueceu de
 *   mandar. 90 já passou da janela de 3 meses que a classificação usa: um
 *   comprovante assim não diz mais nada sobre o mês corrente.
 *
 *   Dois meses é onde deixa de ser plausível como "dízimo deste mês".
 */
const DIAS_COMPROVANTE_ANTIGO_PADRAO = 60;

/**
 * Este resultado merece AVISAR A PESSOA de que os dados não conferem? (BL-46)
 *
 * Bem mais restrito que `exigeConferencia`. Ali o custo de errar é um olhar
 * humano a mais; aqui é dizer a quem devolveu o dízimo que o comprovante dela
 * parece estar errado. Comprovante bancário não tem formato padrão, e um
 * alerta injusto é pior que uma conferência a mais.
 *
 * Só entram os casos em que o dinheiro provavelmente foi para outro lugar:
 * a chave diverge, ou — sem chave legível — nome E banco divergem juntos.
 *
 * Código desconhecido NÃO alerta. É o oposto de `exigeConferencia`, e de
 * propósito: no silêncio, o lado seguro ali é conferir; aqui é calar.
 *
 * @param {string} codigo - Valor de x_studio_conferencia_pix
 * @returns {boolean}
 */
function alertaDoador(codigo) {
  const regra = CONFERENCIA[codigo];
  return !!(regra && regra.alertaDoador);
}

/**
 * Este resultado de conferência pede olhar humano?
 *
 * Um código DESCONHECIDO conta como "sim". É o lado seguro: melhor um aviso a
 * mais do que uma devolução com problema passando batida por falta de entrada
 * na tabela — que era o comportamento anterior.
 *
 * @param {string} codigo - Valor de x_studio_conferencia_pix
 * @returns {boolean}
 */
function exigeConferencia(codigo) {
  if (!codigo) return false;                    // campo vazio: nada a conferir
  const regra = CONFERENCIA[codigo];
  return regra ? regra.exigeConferencia : true;
}

/**
 * Fuso horário único do projeto. Use esta constante em todo Utilities.formatDate
 * para evitar inconsistências (antes havia mistura de 'America/Sao_Paulo' e
 * 'America/Fortaleza', com risco de erro de borda em datas de relatório).
 */
const TIMEZONE = 'America/Sao_Paulo';

// ============================================================================
// CONFIGURAÇÕES GLOBAIS
// ============================================================================

const CONFIG = {
  TEMPLATES: {
    LEMBRETE_DEVOLUCAO: 'devolucao_dizimo'  // Nome do template aprovado no WhatsApp
  }
};

const PALAVRAS_RELATORIO = [
  'relatório',
  'relatorio',
  'relatórios',
  'relatorios',
  '/relatorio',
  '/relatório',
  'rel'
];

// ============================================================================
// CONFIGURAÇÃO WHATSAPP
// ============================================================================

/**
 * Versão da Graph API do WhatsApp.
 * Centralizada aqui para atualizar em um único lugar quando a Meta deprecar.
 * Consultar: https://developers.facebook.com/docs/graph-api/changelog
 */
const WHATSAPP_API_VERSION = 'v21.0';

/**
 * Monta a URL base da Graph API do WhatsApp.
 * @param {string} path - Caminho após a versão (ex: `${phoneId}/messages`)
 * @returns {string} URL completa
 */
function getWhatsAppUrl(path) {
  return `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${path}`;
}

/**
 * Retorna credenciais do WhatsApp Business API.
 * Lança erro se propriedades obrigatórias não estiverem configuradas.
 * @returns {Object} { WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, VERIFY_TOKEN,
 *                      WHATSAPP_NUMERO_EXIBICAO }
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();

  const config = {
    WHATSAPP_TOKEN:    props.getProperty('WHATSAPP_TOKEN'),
    WHATSAPP_PHONE_ID: props.getProperty('WHATSAPP_PHONE_ID'),
    VERIFY_TOKEN:      props.getProperty('VERIFY_TOKEN'),

    // BL-41 (A10): o número do bot, para montar o link wa.me do convite.
    // OPCIONAL — sem ele o convite ainda sai, só sem o link clicável.
    // Não dá para derivar do PHONE_ID: aquele é o identificador interno da
    // Meta, não o telefone. Formato: 5586988521231 (internacional, sem '+').
    WHATSAPP_NUMERO_EXIBICAO: props.getProperty('WHATSAPP_NUMERO_EXIBICAO') || '',
  };

  if (!config.WHATSAPP_TOKEN || !config.WHATSAPP_PHONE_ID) {
    throw new Error(
      '❌ ERRO: Propriedades WHATSAPP_TOKEN e WHATSAPP_PHONE_ID não configuradas!\n\n' +
      'Execute setupProperties() no arquivo Setup.gs'
    );
  }

  return config;
}

/**
 * Retorna o segredo do webhook usado para autenticar o POST da Meta.
 * BL-17: é obrigatório — sem ele `doPost` rejeita todas as requisições.
 * Use `configurarSegredoWebhook()` (Setup.gs) para gerar e obter a URL pronta.
 *
 * IMPORTANTE: web apps do Apps Script NÃO expõem os headers da requisição em
 * doPost(e), portanto não é possível validar o header X-Hub-Signature-256
 * (HMAC) da Meta como em servidores tradicionais. A mitigação viável aqui é
 * um segredo na própria URL de callback (?token=...), que a Meta preserva ao
 * postar. Configure a URL na Meta como: https://.../exec?token=SEU_SEGREDO
 *
 * @returns {string|null} Segredo configurado, ou null se não definido.
 */
function getWebhookSecret() {
  return PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
}

// ============================================================================
// CONFIGURAÇÃO ODOO
// ============================================================================

/**
 * Retorna credenciais do Odoo ERP.
 * Lança erro se ODOO_API_KEY não estiver configurada.
 * @returns {Object} { url, database, uid, apiKey }
 */
function getOdooConfig() {
  const props = PropertiesService.getScriptProperties();

  // SEM PADRÃO PARA NENHUM DELES. (BL-17)
  //
  // 1. O `|| 2` do uid era uma armadilha: propriedade ausente ou com lixo caía
  //    silenciosamente no ADMINISTRADOR. O item inteiro deste backlog é tirar o
  //    bot de administrador, e um padrão que o devolve para lá apaga o trabalho
  //    sem avisar. Falta a propriedade? Estoura, e alguém conserta.
  //
  // 2. A URL e o banco estavam escritos aqui, e este repositório é PÚBLICO.
  //    A URL não é credencial, mas diz a quem quiser onde apontar uma tentativa
  //    de força bruta, e confirma o nome do banco. Passa a vir só das Script
  //    Properties, que não vão para o git.
  const config = {
    url:      props.getProperty('ODOO_URL'),
    database: props.getProperty('ODOO_DATABASE'),
    uid:      parseInt(props.getProperty('ODOO_UID'), 10),
    apiKey:   props.getProperty('ODOO_API_KEY')
  };

  const faltando = ['url', 'database', 'uid', 'apiKey']
    .filter((k) => !config[k] || (k === 'uid' && isNaN(config.uid)));
  if (faltando.length) {
    const nomes = { url: 'ODOO_URL', database: 'ODOO_DATABASE', uid: 'ODOO_UID', apiKey: 'ODOO_API_KEY' };
    throw new Error(
      `❌ Faltam Script Properties do Odoo: ${faltando.map((k) => nomes[k]).join(', ')}\n\n`
      + 'Rode verificarProperties() (Setup.gs) para ver o que está configurado.\n'
      + 'Nenhuma delas tem valor padrão, de propósito — ver a nota acima.'
    );
  }



  return config;
}

// ============================================================================
// CONFIGURAÇÃO GOOGLE VISION
// ============================================================================

/**
 * Retorna credenciais e endpoints da Google Vision API.
 * ENDPOINT       → images:annotate  (imagens)
 * ENDPOINT_FILES → files:annotate   (PDF / TIFF)
 * @returns {Object} { API_KEY, ENDPOINT, ENDPOINT_FILES }
 */
function getVisionConfig() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GOOGLE_VISION_API_KEY');

  if (!apiKey) {
    throw new Error('❌ ERRO: GOOGLE_VISION_API_KEY não configurada!');
  }

  return {
    API_KEY:        apiKey,
    ENDPOINT:       'https://vision.googleapis.com/v1/images:annotate',
    ENDPOINT_FILES: 'https://vision.googleapis.com/v1/files:annotate'
  };
}