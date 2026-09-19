/**
 * ============================================================================
 * UTILS.GS - Bot Meu Dízimo
 * ============================================================================
 *
 * Funções utilitárias usadas em todo o projeto.
 * Responsabilidades:
 * - Wrappers de envio de mensagens WhatsApp (texto, botões, listas)
 * - Formatadores de dados (valor, data, número)
 * - Helpers genéricos
 *
 * Versão: 8.0
 * Data: Fevereiro 2026
 */

// ============================================================================
// ENVIO DE MENSAGENS WHATSAPP
// ============================================================================

const Utils = {

  // Teto baixo de propósito: cada espera consome o orçamento de 6 min por
  // execução do Apps Script, e o fluxo de comprovante já faz ~6-8 chamadas
  // externas por mensagem (ver BL-21).
  RETRY_MAX_TENTATIVAS: 3,
  RETRY_BASE_MS:        1000,

  // Orçamento TOTAL da chamada, somando tentativas e esperas.
  //
  // Limitar só o número de tentativas não basta: uma requisição que *trava* —
  // em vez de falhar rápido — vira três travadas. Foi o que aconteceu num teste
  // real: uma consulta ao Odoo pendurou e a execução levou 162s, porque cada
  // repetição pendurou de novo. Sob lentidão do serviço, que é justamente
  // quando o retry deveria ajudar, ele triplicava a duração da execução e
  // consumia o teto de 6 min e o pool de execuções simultâneas mais rápido.
  RETRY_ORCAMENTO_MS: 30000,

  // ── BL-25: consumo da cota diária de UrlFetch ───────────────────────────
  // Ordem de grandeza do teto: ~20 mil chamadas/dia em conta gratuita e
  // ~100 mil em Workspace. Confirme no painel de cotas do projeto e ajuste.
  URLFETCH_COTA_DIARIA: 20000,
  URLFETCH_PREFIXO:     'uso_urlfetch_',
  URLFETCH_SHARDS:      5,

  // ── Mensagens entregues ao WhatsApp (custo) ─────────────────────────────
  // Desde 01/10/2026 a Meta cobra as mensagens de serviço acima de uma
  // franquia mensal por número. Contamos separado dos demais acessos HTTP
  // porque só mensagem entregue é cobrada — chamada ao Odoo, OCR, upload de
  // mídia e download não são.
  //
  // Serviço e template são contados à parte: a franquia vale para serviço;
  // template tem tarifa própria.
  MSG_PREFIXO:          'msgs_',
  MSG_FRANQUIA_SERVICO: 1000,
  MSG_MESES_GUARDADOS:  6,

  // Contadores da execução atual. Cada execução do Apps Script roda num
  // contexto JS próprio, então isto zera sozinho a cada disparo — é por
  // execução, não global.
  _chamadasExternas:  0,
  _mensagensServico:  0,
  _mensagensTemplate: 0,

  /**
   * `UrlFetchApp.fetch` com backoff exponencial para falhas transitórias (BL-24).
   *
   * Só reenvia quando é comprovadamente seguro:
   *   - **429** (throttling): a requisição foi recusada *antes* de ser
   *     executada, então repetir nunca duplica nada. Vale para qualquer chamada.
   *   - **5xx e exceções de rede**: o servidor pode ter processado a requisição
   *     antes de falhar. Só repete quando `idempotente` é true.
   *
   * Por isso um `create` no Odoo passa `idempotente: false`: repetir um 5xx
   * poderia gravar a mesma devolução duas vezes — pior que a falha original.
   *
   * @param {string} url
   * @param {Object} options              - Opções do UrlFetchApp.fetch
   * @param {Object} [cfg]
   * @param {boolean} [cfg.idempotente]   - Repetir com segurança em 5xx/rede?
   * @param {string}  [cfg.rotulo]        - Nome do serviço, para os logs
   * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse} Última resposta obtida
   * @throws Propaga a exceção de rede se todas as tentativas falharem
   */
  fetchComRetry(url, options, cfg = {}) {
    const idempotente = cfg.idempotente === true;
    const rotulo      = cfg.rotulo || 'HTTP';

    const inicio = Date.now();
    let resposta = null;
    let excecao  = null;

    for (let tentativa = 1; tentativa <= this.RETRY_MAX_TENTATIVAS; tentativa++) {
      resposta = null;
      excecao  = null;

      try {
        this._chamadasExternas++;   // BL-25: conta cada tentativa real
        resposta = UrlFetchApp.fetch(url, options);
      } catch (e) {
        excecao = e;
      }

      const code = resposta ? resposta.getResponseCode() : null;

      // Só conta ENTREGA aceita (HTTP 200): é o que a Meta cobra. Tentativa
      // recusada ou repetida não gera cobrança, então não entra na conta.
      if (cfg.mensagem && code === 200) {
        if (cfg.mensagem === 'template') this._mensagensTemplate++;
        else                             this._mensagensServico++;
      }

      const repetir = code === 429 || ((excecao || code >= 500) && idempotente);

      if (!repetir) break;

      // Falha rápido em vez de insistir numa chamada que já consumiu o
      // orçamento — ver o comentário em RETRY_ORCAMENTO_MS.
      const decorrido = Date.now() - inicio;
      if (decorrido >= this.RETRY_ORCAMENTO_MS) {
        console.warn(`⏱️ [${rotulo}] Orçamento de ${this.RETRY_ORCAMENTO_MS}ms esgotado ` +
                     `(${decorrido}ms na tentativa ${tentativa}) — desisto sem repetir.`);
        break;
      }

      if (tentativa < this.RETRY_MAX_TENTATIVAS) {
        const espera = this.RETRY_BASE_MS * Math.pow(2, tentativa - 1);
        console.warn(`⏳ [${rotulo}] Falha transitória ` +
                     `(${excecao ? excecao.message : 'HTTP ' + code}) — ` +
                     `tentativa ${tentativa}/${this.RETRY_MAX_TENTATIVAS}, aguardando ${espera}ms`);
        Utilities.sleep(espera);
      } else {
        console.error(`❌ [${rotulo}] Esgotadas as ${this.RETRY_MAX_TENTATIVAS} tentativas.`);
      }
    }

    if (excecao) throw excecao;
    return resposta;
  },

  /**
   * Acumula o consumo desta execução no total do dia (BL-25).
   *
   * Chamado UMA vez ao fim da execução, nunca a cada requisição: pagar uma
   * escrita em Properties por chamada externa somaria tempo de execução
   * justamente no que o BL-21 tenta enxugar.
   *
   * O contador é distribuído em `URLFETCH_SHARDS` chaves escolhidas ao acaso.
   * Não é uma soma exata — sem compare-and-swap, duas execuções que leiam o
   * mesmo shard ao mesmo tempo perdem um incremento —, e os shards reduzem
   * muito essa chance sem recorrer a lock. O número serve para dar ordem de
   * grandeza e disparar alerta com folga, não para auditoria.
   */
  registrarConsumoExterno() {
    const chamadas = this._chamadasExternas;
    const servico  = this._mensagensServico;
    const template = this._mensagensTemplate;

    this._chamadasExternas  = 0;
    this._mensagensServico  = 0;
    this._mensagensTemplate = 0;

    if (!chamadas && !servico && !template) return;

    try {
      const props = PropertiesService.getScriptProperties();
      const shard = Math.floor(Math.random() * this.URLFETCH_SHARDS);
      const mes   = this._mesAtual();

      // Uma leitura e uma escrita, não uma de cada POR CHAVE. Isto roda no
      // caminho quente — toda mensagem recebida — e o fluxo típico grava duas
      // chaves, o disparo em lote grava três: eram 4 a 6 idas ao Properties
      // onde 2 resolvem. `setProperties(obj)` faz merge; o `true` que apaga
      // tudo NÃO é usado aqui (ver ARQUITETURA.md, seção 1).
      const atuais = props.getProperties();
      const lote   = {};
      const somar  = (chave, quanto) => {
        lote[chave] = String((parseInt(atuais[chave], 10) || 0) + quanto);
      };

      if (chamadas) somar(`${this.URLFETCH_PREFIXO}${this._hoje()}_${shard}`, chamadas);
      // Mensagens são agregadas por MÊS, não por dia: a franquia da Meta é mensal.
      if (servico)  somar(`${this.MSG_PREFIXO}${mes}_servico_${shard}`,  servico);
      if (template) somar(`${this.MSG_PREFIXO}${mes}_template_${shard}`, template);

      props.setProperties(lote);

      console.log(`📊 [Cota] ${chamadas} chamada(s) externa(s)` +
                  (servico || template
                    ? ` · ${servico} mensagem(ns) de serviço, ${template} template(s)`
                    : '') +
                  ' nesta execução');
    } catch (e) {
      console.warn('⚠️ [Cota] Não consegui registrar o consumo:', e.message);
    }
  },

  /**
   * Percorre os shards de um contador e devolve o total do período corrente,
   * podando os períodos vencidos no mesmo passeio.
   *
   * Os dois contadores do projeto (chamadas externas por dia, mensagens por
   * mês) são o mesmo mecanismo com granularidade diferente. Estavam escritos
   * duas vezes, e as cópias já divergiam — uma usava `startsWith`, a outra
   * `indexOf(...) !== 0`. Pior: cada uma tinha um `slice` com o tamanho do
   * período embutido como literal, dependendo do formato montado em
   * `registrarConsumoExterno`; errar esse número devolve total ZERO, sem erro.
   *
   * @param {Object} cfg - { prefixo, tamanho, atual, corte, todas, props }
   * @param {Function} [classificar] - Recebe (chave, valor) para somas separadas
   * @returns {number} Total do período corrente
   * @private
   */
  _somarShards(cfg, classificar) {
    let total = 0;
    const vencidas = [];

    Object.keys(cfg.todas).forEach(chave => {
      if (chave.indexOf(cfg.prefixo) !== 0) return;

      const periodo = chave.slice(cfg.prefixo.length, cfg.prefixo.length + cfg.tamanho);
      if (periodo < cfg.corte) { vencidas.push(chave); return; }   // ISO ordena como texto
      if (periodo !== cfg.atual) return;

      const valor = parseInt(cfg.todas[chave], 10) || 0;
      total += valor;
      if (classificar) classificar(chave, valor);
    });

    vencidas.forEach(chave => cfg.props.deleteProperty(chave));
    return total;
  },

  /**
   * Escolhe a severidade do log pelo percentual de uso.
   * @private
   */
  _alertar(rotulo, pct, msg, limiteAlto, limiteMedio, explicacao) {
    if (pct >= limiteAlto)       console.error(`🚨 [${rotulo}] ${msg} — ${explicacao}`);
    else if (pct >= limiteMedio) console.warn(`⚠️ [${rotulo}] ${msg}`);
    else                         console.log(`📊 [${rotulo}] ${msg}`);
  },

  /**
   * Soma as mensagens do mês corrente, sem log e sem podar.
   *
   * Separado de `verificarCotaMensagens` porque uma consulta não deve APAGAR
   * nada: `verificarConsumoMensagens` (Setup.gs) é um relatório manual e
   * chamava a versão que remove os meses vencidos.
   *
   * @returns {{servico: number, template: number, mes: string}}
   */
  somarMensagensDoMes() {
    const todas = PropertiesService.getScriptProperties().getProperties();
    const mes   = this._mesAtual();
    let servico = 0, template = 0;

    Object.keys(todas).forEach(chave => {
      if (chave.indexOf(this.MSG_PREFIXO) !== 0) return;
      if (chave.slice(this.MSG_PREFIXO.length, this.MSG_PREFIXO.length + 7) !== mes) return;

      const valor = parseInt(todas[chave], 10) || 0;
      if (chave.indexOf('_template_') >= 0) template += valor;
      else                                  servico  += valor;
    });

    return { servico, template, mes };
  },

  /**
   * Soma as mensagens do mês corrente e alerta ao se aproximar da franquia.
   * Roda de carona na trigger de sessões, junto com `verificarCotaUrlFetch`.
   * Também descarta os contadores de meses antigos — por isso um relatório
   * manual deve usar `somarMensagensDoMes`, que não apaga nada.
   * @returns {{servico: number, template: number}|null}
   */
  verificarCotaMensagens(todasProps) {
    try {
      const props = PropertiesService.getScriptProperties();
      const mes   = this._mesAtual();
      let servico = 0, template = 0;

      this._somarShards({
        props,
        todas:   todasProps || props.getProperties(),
        prefixo: this.MSG_PREFIXO,
        tamanho: 7,                     // yyyy-MM
        atual:   mes,
        corte:   this._mesAtual(new Date(Date.now() - this.MSG_MESES_GUARDADOS * 31 * 86400000))
      }, (chave, valor) => {
        if (chave.indexOf('_template_') >= 0) template += valor;
        else                                  servico  += valor;
      });

      const pct = Math.round((servico / this.MSG_FRANQUIA_SERVICO) * 100);
      this._alertar('Mensagens', pct,
        `${servico} de serviço (~${pct}% da franquia de ${this.MSG_FRANQUIA_SERVICO}) ` +
        `e ${template} template(s) em ${mes}`,
        90, 70, 'acima da franquia a Meta cobra por entrega.');

      return { servico, template };
    } catch (e) {
      console.warn('⚠️ [Mensagens] Falha ao verificar:', e.message);
      return null;
    }
  },

  verificarCotaUrlFetch(todasProps) {
    try {
      const props = PropertiesService.getScriptProperties();

      const total = this._somarShards({
        props,
        todas:   todasProps || props.getProperties(),
        prefixo: this.URLFETCH_PREFIXO,
        tamanho: 10,                    // yyyy-MM-dd
        atual:   this._hoje(),
        corte:   this._hoje(new Date(Date.now() - 7 * 86400000))
      });

      const pct = Math.round((total / this.URLFETCH_COTA_DIARIA) * 100);
      this._alertar('Cota', pct,
        `${total} chamada(s) externa(s) hoje (~${pct}% de ${this.URLFETCH_COTA_DIARIA})`,
        80, 60, 'risco de bloqueio de chamadas externas hoje.');

      return total;
    } catch (e) {
      console.warn('⚠️ [Cota] Falha ao verificar:', e.message);
      return null;
    }
  },

  /** Data em America/Sao_Paulo no formato yyyy-MM-dd. @private */
  _hoje(data) {
    return Utilities.formatDate(data || new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  },

  /**
   * Mês em America/Sao_Paulo no formato yyyy-MM. @private
   *
   * Era chamada em quatro lugares e NUNCA EXISTIU — bug encontrado em 19/09 no
   * Cloud Logging, com o bot já em produção. Consequências enquanto durou:
   *
   *   - `registrarConsumoExterno` lançava na PRIMEIRA linha do try, antes de
   *     gravar qualquer contador. Ou seja, nem o consumo de mensagens nem a
   *     cota de UrlFetch (BL-25) chegaram a ser persistidos uma única vez.
   *   - `somarMensagensDoMes` e `verificarCotaMensagens` falhavam sempre, então
   *     `verificarConsumoMensagens()` reportava zero — e o alerta de franquia
   *     nunca poderia disparar.
   *
   * Nada disso APARECIA: as três falhas eram engolidas por `catch` com
   * `console.warn`. O bot funcionava; só a medição estava morta.
   */
  _mesAtual(data) {
    return Utilities.formatDate(data || new Date(), 'America/Sao_Paulo', 'yyyy-MM');
  },

  /**
   * Posta um payload no endpoint /messages do WhatsApp e verifica o resultado.
   * Centraliza o envio (antes duplicado em enviarSimples/enviarMenu/enviarLista)
   * e — importante — checa o status code, que antes era ignorado: falhas de
   * envio (token expirado, janela de 24h fechada) passavam despercebidas.
   * TODO envio do bot passa por aqui — inclusive mídia e template. Isso não é
   * preferência de estilo: é o que garante que a conferência de destinatário
   * do BL-32 valha para todos. Quando `_enviarMensagemMidia` e o lembrete
   * mensal montavam o POST por conta própria, o lembrete — único fluxo que
   * envia para número gravado — era justamente o que escapava do detector.
   *
   * @param {Object} payload - Corpo já montado da mensagem WhatsApp
   * @param {Object} [opcoes] - { mensagem: 'servico'|'template', rotulo }
   * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse|null}
   * @private
   */
  _post(payload, opcoes = {}) {
    const config = getConfig();
    try {
      // BL-24: não idempotente — reenviar um 5xx poderia entregar a mesma
      // mensagem duas vezes ao usuário. Só o 429 (throttling) é repetido, que
      // é justamente o caso em que a mensagem não chegou.
      const response = this.fetchComRetry(
        getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
        {
          method:      'post',
          contentType: 'application/json',
          headers:     { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          payload:     JSON.stringify(payload),
          muteHttpExceptions: true
        },
        {
          idempotente: false,
          rotulo:      opcoes.rotulo   || 'WhatsApp',
          mensagem:    opcoes.mensagem || 'servico'
        }
      );

      const code = response.getResponseCode();
      if (code !== 200) {
        console.error(`❌ [WhatsApp] Envio falhou (HTTP ${code}):`, response.getContentText());
      } else {
        this._conferirDestinatario(payload.to, response);
      }
      return response;
    } catch (e) {
      console.error('❌ [WhatsApp] Exceção ao enviar mensagem:', e.message);
      return null;
    }
  },

  /**
   * Avisa quando a Meta resolve o número para um `wa_id` diferente do enviado.
   *
   * BL-32 — O NONO DÍGITO. No Brasil, o WhatsApp de muitos celulares é o número
   * SEM o 9 depois do DDD, mesmo que o telefone o tenha. A Meta aceita os dois
   * formatos e devolve HTTP 200 nos dois; só um chega.
   *
   * ⚠️ ESTA CONFERÊNCIA NÃO BASTA. Ela só dispara quando a Meta normaliza o
   * número e informa isso no `wa_id` — e quando ela normaliza, a mensagem
   * chega. No caso que originou o BL-32 a Meta devolveu o número como veio e
   * a mensagem sumiu, então nada foi avisado aqui. O detector confiável da
   * não-entrega é o callback de status (BL-31), que chega depois e traz o
   * motivo. Isto aqui é um segundo sinal, não o principal.
   *
   * Números que chegam pelo webhook já vêm canônicos, então o cadastro pelo
   * bot é seguro. O risco está em número DIGITADO: propriedade de teste,
   * contato preenchido à mão no Odoo, lembrete mensal para esse contato.
   *
   * @private
   */
  _conferirDestinatario(enviadoPara, response) {
    if (!enviadoPara) return;
    try {
      const corpo   = JSON.parse(response.getContentText() || '{}');
      const contato = (corpo.contacts || [])[0];
      if (!contato || !contato.wa_id) return;

      if (String(contato.wa_id) !== String(enviadoPara)) {
        console.warn(`⚠️ [WhatsApp] Número ajustado pela Meta: enviado ${enviadoPara}, ` +
                     `entregue a ${contato.wa_id}. Guarde o segundo — ver BL-32.`);
      }
    } catch (e) {
      // Resposta sem JSON esperado não é motivo para falhar um envio bem-sucedido.
    }
  },

  // ============================================================================
  // LIMITE DE RESPOSTAS POR PESSOA
  // ============================================================================
  //
  // O QUE PROTEGE
  //   Mensagem RECEBIDA é grátis; o que custa é a RESPOSTA do bot. Então quem
  //   quiser gerar custo só precisa mandar mensagem sem parar: cada uma nossa
  //   de volta entra na conta. A franquia de 1.000 mensagens de serviço por mês
  //   (a partir de 01/10/2026) some rápido assim.
  //
  //   Não é preciso má-fé: uma criança com o celular do pai, um número que
  //   entra em laço com outro bot, alguém testando o sistema — todos produzem
  //   o mesmo efeito.
  //
  // COMO
  //   Duas janelas por número. A curta pega rajada; a longa pega insistência.
  //   Ao estourar, o bot PARA DE RESPONDER — que é o ponto: continuar
  //   respondendo "você excedeu o limite" gastaria exatamente o que se quer
  //   economizar. Um aviso é enviado UMA vez por hora, e só.
  //
  // OS NÚMEROS, e de onde vêm
  //   Um cadastro completo por conversa são ~13 mensagens recebidas, espalhadas
  //   por vários minutos. Uma devolução, ~5. O dia mais pesado plausível —
  //   cadastro, dois familiares e uma devolução — fica perto de 40.
  //   Os limites ficam acima disso de propósito: barrar quem está usando é pior
  //   que deixar passar algum abuso, porque o abuso aparece no log e o usuário
  //   barrado some sem avisar.
  //
  //   Ajustáveis por Script Properties, sem republicar: LIMITE_MSG_MINUTO e
  //   LIMITE_MSG_HORA.

  LIMITE_MSG_MINUTO_PADRAO: 12,
  LIMITE_MSG_HORA_PADRAO:   60,

  /**
   * A pessoa passou do limite de mensagens? Se passou, não devemos responder.
   *
   * @param {string} from
   * @returns {boolean} true se a mensagem deve ser DESCARTADA.
   */
  // ── BL-36: lista de bloqueio ──────────────────────────────────────────────
  // Uma propriedade por número (`bloqueado_<numero>`), e não uma lista JSON
  // numa chave só. Mesmo raciocínio do BL-22: com chave por usuário cada
  // execução escreve só a sua, some o read-modify-write compartilhado e o lock
  // fica desnecessário. Numa paróquia a lista tem punhados de números, muito
  // longe dos 500 KB do store.
  BLOQUEIO_PREFIXO: 'bloqueado_',
  SUSPEITO_PREFIXO: 'suspeito_',

  /**
   * Este número está bloqueado? Consultado antes de QUALQUER resposta.
   *
   * O resultado vai para o cache porque isto roda em toda mensagem recebida, e
   * uma leitura de Properties por mensagem pesaria no caminho quente. TTL curto
   * quando não está bloqueado: um bloqueio recém-criado passa a valer em
   * minutos, e não em horas.
   */
  estaBloqueado(from) {
    const chave = `${this.BLOQUEIO_PREFIXO}${from}`;
    try {
      const cache    = CacheService.getScriptCache();
      const cacheado = cache.get(chave);
      if (cacheado !== null) return cacheado === '1';

      const bloqueado = !!PropertiesService.getScriptProperties().getProperty(chave);
      cache.put(chave, bloqueado ? '1' : '0', bloqueado ? 3600 : 300);
      return bloqueado;
    } catch (e) {
      // Na dúvida, NÃO bloqueia: um falso positivo cala um dizimista em
      // silêncio, e ninguém descobre até ele reclamar pessoalmente.
      console.warn('⚠️ [Bloqueio] Não consegui verificar:', e.message);
      return false;
    }
  },

  /**
   * Marca o número como suspeito quando ele estoura o freio — sem bloquear.
   *
   * BL-36: por que só marcar. Um falso positivo bloqueia um dizimista, que
   * NÃO recebe aviso (avisar custa exatamente o que o bloqueio evita), some em
   * silêncio, e o sintoma não aponta para a causa. Então o sistema registra o
   * candidato e a inclusão na lista é humana — pelo menos até existir dado real
   * sobre quais critérios são seguros, que hoje não existe.
   *
   * O que se guarda é o número de DIAS DISTINTOS em que o número estourou o
   * freio. Estourar uma vez é gente confusa; estourar em dias diferentes é
   * padrão.
   */
  marcarSuspeito(from) {
    try {
      const props = PropertiesService.getScriptProperties();
      const chave = `${this.SUSPEITO_PREFIXO}${from}`;
      const hoje  = this._hoje();

      const atual = props.getProperty(chave);
      const dados = atual ? JSON.parse(atual) : { dias: [], total: 0 };

      dados.total++;
      if (dados.dias.indexOf(hoje) < 0) {
        dados.dias.push(hoje);
        if (dados.dias.length > 10) dados.dias.shift();
      }

      props.setProperty(chave, JSON.stringify(dados));

      if (dados.dias.length >= 3) {
        console.warn(`🚩 [Spam] ${from} estourou o freio em ${dados.dias.length} dias ` +
                     `distintos (${dados.total} vezes). Candidato a bloqueio — ` +
                     'rode listarSuspeitos() para revisar.');
      }
    } catch (e) {
      console.warn('⚠️ [Spam] Não consegui marcar suspeito:', e.message);
    }
  },

  excedeuTaxa(from) {
    try {
      const props  = PropertiesService.getScriptProperties();
      const porMin = parseInt(props.getProperty('LIMITE_MSG_MINUTO'), 10) || this.LIMITE_MSG_MINUTO_PADRAO;
      const porHora = parseInt(props.getProperty('LIMITE_MSG_HORA'), 10) || this.LIMITE_MSG_HORA_PADRAO;

      const cache = CacheService.getScriptCache();
      const agora = Date.now();

      // A chave inclui o BALDE de tempo. Isso não é detalhe: `cache.put` renova
      // o TTL a cada escrita, então um contador de chave fixa nunca expira
      // enquanto chegarem mensagens — a janela de 60 s viraria "60 s desde a
      // última mensagem", e quem respondesse a cada 20 s acumularia até ser
      // barrado no meio do próprio cadastro. Com o balde na chave, a janela
      // termina na hora certa porque a CHAVE muda.
      const kMin  = `taxa_min_${from}_${Math.floor(agora / 60000)}`;
      const kHora = `taxa_hora_${from}_${Math.floor(agora / 3600000)}`;

      const nMin  = (parseInt(cache.get(kMin), 10)  || 0) + 1;
      const nHora = (parseInt(cache.get(kHora), 10) || 0) + 1;

      // Janela FIXA, não deslizante. O caso ruim conhecido é o dobro do limite
      // em torno da virada do balde — irrelevante para cortar laço, e muito
      // mais barato que manter uma lista de horários por número.
      cache.put(kMin,  String(nMin),  120);
      cache.put(kHora, String(nHora), 7200);

      if (nMin <= porMin && nHora <= porHora) return false;

      const qual = nMin > porMin ? `${nMin} em 1 min` : `${nHora} em 1 h`;
      console.warn(`🛑 [Taxa] ${from} excedeu o limite (${qual}) — não vamos responder`);

      // BL-36: registra o candidato. Só na PRIMEIRA vez da janela de aviso,
      // senão um laço de 200 mensagens contaria 200 estouros e o número de
      // "vezes" perderia o sentido.
      if (!cache.get(`taxa_aviso_${from}`)) this.marcarSuspeito(from);

      // Um aviso por hora, no máximo. Ele também é uma mensagem cobrada: se
      // fosse enviado a cada mensagem descartada, o freio viraria o vazamento.
      if (!cache.get(`taxa_aviso_${from}`)) {
        cache.put(`taxa_aviso_${from}`, '1', 3600);
        this.enviarSimples(from,
          '⏳ Recebi muitas mensagens suas em pouco tempo e preciso de uma pausa.\n\n' +
          'Tente de novo daqui a alguns minutos — seu cadastro e suas devoluções ' +
          'continuam guardados. 💛'
        );
      }

      return true;
    } catch (e) {
      // Falha do cache não pode derrubar o bot: na dúvida, responde.
      console.warn('⚠️ [Taxa] Não consegui verificar o limite:', e.message);
      return false;
    }
  },

  // ============================================================================
  // VALIDADORES PUROS
  // ============================================================================
  //
  // Regras de validação SEM efeito colateral: não enviam mensagem, não mudam
  // estado, não gravam nada. Existem porque as mesmas regras precisam valer em
  // dois caminhos com formas de erro incompatíveis — o cadastro por conversa,
  // que responde campo a campo, e o Flow, que recebe tudo de uma vez e precisa
  // acumular erros.
  //
  // Antes ficavam copiadas em CadastroHandler e FlowHandler. Como são regras
  // que já tiveram bug com número de backlog (BL-06 e BL-08), a cópia garantia
  // que a próxima correção consertasse metade do bot — e os dois caminhos
  // gravam no MESMO campo do Odoo, então a divergência seria silenciosa.

  /**
   * Converte um valor digitado em número, tratando separador de milhar.
   *
   * BL-06: "1.000,50" → 1000.5. A regra: havendo vírgula, o ponto é milhar;
   * sem vírgula, ponto seguido de 3 dígitos também é milhar ("1.000"); ponto
   * isolado é decimal ("50.00").
   *
   * @param {string|number} texto
   * @returns {number|null} null se não for um valor positivo válido.
   */
  parseValorBR(texto) {
    let t = String(texto == null ? '' : texto).replace(/[^\d.,]/g, '');
    if (t.indexOf(',') >= 0) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (/\.\d{3}(\.\d{3})*$/.test(t)) {
      t = t.replace(/\./g, '');
    }
    const valor = parseFloat(t);
    return (isNaN(valor) || valor <= 0) ? null : valor;
  },

  /**
   * Valida uma data de nascimento em partes.
   *
   * BL-08: rejeita data que não existe (31/02), ano anterior a 1900 e data no
   * futuro. `new Date(2026, 1, 31)` não estoura — ele rola para 03/03 — por
   * isso a conferência é comparar os componentes de volta.
   *
   * @returns {boolean}
   */
  validarDataBR(dia, mes, ano) {
    const nDia = parseInt(dia, 10);
    const nMes = parseInt(mes, 10);
    const nAno = parseInt(ano, 10);
    if (isNaN(nDia) || isNaN(nMes) || isNaN(nAno)) return false;

    const d = new Date(nAno, nMes - 1, nDia);
    const existe = d.getFullYear() === nAno && d.getMonth() === nMes - 1 && d.getDate() === nDia;
    return existe && nAno >= 1900 && d <= new Date();
  },

  /**
   * DDDs em que o `wa_id` MANTÉM o nono dígito.
   *
   * São as regiões que receberam o 9 primeiro (São Paulo, Rio, Espírito
   * Santo): quando o WhatsApp nasceu ali, os números já tinham 9 dígitos. Nos
   * demais DDDs, contas antigas ficaram registradas com os 8 dígitos de então,
   * e é esse o `wa_id` até hoje.
   */
  DDD_MANTEM_NONO: [11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28],

  /**
   * Devolve as duas formas possíveis de um celular brasileiro e um palpite.
   *
   * ⚠️ `provavel` é HEURÍSTICA, não regra: uma conta criada depois da mudança
   * mantém o 9 mesmo num DDD fora da lista acima. Serve para priorizar uma
   * revisão manual, nunca para corrigir sozinho — trocar por regra quebraria
   * os números em que o 9 está certo.
   *
   * A única fonte exata do `wa_id` é uma mensagem RECEBIDA daquele número: o
   * `from` do webhook é canônico por definição.
   *
   * @param {string} numero - Só dígitos, com 55 na frente
   * @returns {{comNove: string, semNove: string, provavel: string, ddd: number}|null}
   */
  variantesNumeroBR(numero) {
    const so = String(numero || '').replace(/\D/g, '');
    if (so.indexOf('55') !== 0 || so.length < 12 || so.length > 13) return null;

    const ddd   = parseInt(so.substring(2, 4), 10);
    const resto = so.substring(4);

    let comNove, semNove;
    if (resto.length === 9 && resto.charAt(0) === '9') {
      comNove = so;
      semNove = `55${so.substring(2, 4)}${resto.substring(1)}`;
    } else if (resto.length === 8) {
      comNove = `55${so.substring(2, 4)}9${resto}`;
      semNove = so;
    } else {
      return null;   // Não é celular no formato esperado (fixo, por exemplo).
    }

    const mantem = this.DDD_MANTEM_NONO.indexOf(ddd) >= 0;
    return { comNove, semNove, ddd, provavel: mantem ? comNove : semNove };
  },

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
  tipoDaChavePix(chave) {
    const c = String(chave || '').trim();
    if (!c) return null;

    if (c.indexOf('@') > 0) return 'EMAIL';
    if (c.charAt(0) === '+') return 'PHONE';

    const digitos = c.replace(/\D/g, '');

    // 11 dígitos é ambíguo: CPF e celular brasileiro (DDD + 9 dígitos) têm o
    // mesmo tamanho. O desempate é o dígito verificador — um telefone só passa
    // por acaso, e a chance é de 1%. Comparar por tamanho classificaria todo
    // celular guardado sem o '+' como CPF, e a Meta recusaria sem dizer por quê.
    if (digitos.length === 11) return this._cpfValido(digitos) ? 'CPF' : 'PHONE';
    if (digitos.length === 14) return 'CNPJ';
    if (/^[0-9a-fA-F-]{32,36}$/.test(c)) return 'EVP';

    return null;
  },

  /**
   * Dígito verificador de CPF (módulo 11). Serve só para desempatar CPF de
   * telefone em `tipoDaChavePix` — não é validação de cadastro.
   * @private
   */
  _cpfValido(d) {
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
  },

  /**
   * Marca a mensagem recebida como lida e liga o indicador de "digitando".
   *
   * BL-37 — POR QUE ISTO SUBSTITUI UMA MENSAGEM.
   * O OCR do comprovante leva alguns segundos, e o bot avisava com um
   * "⏳ Analisando comprovante..." — uma mensagem de serviço, cobrada, cujo
   * conteúdo é apenas "estou trabalhando". Este endpoint diz a mesma coisa de
   * graça: **não é uma mensagem**, é o mesmo POST que marca como lida, com o
   * `typing_indicator` junto. Não conta na franquia de 1.000/mês porque não
   * passa por `_post` nem informa `mensagem` ao `fetchComRetry` — só envio
   * aceito com aquele campo entra no contador.
   *
   * O balão some sozinho após ~25 s ou quando o bot envia a próxima mensagem.
   * Se o processamento passar de 25 s, a pessoa fica sem sinal — o mesmo que
   * acontecia depois do "Analisando..." antigo, que também não se repetia.
   *
   * @param {string} messageId - `id` da mensagem RECEBIDA (vem do webhook)
   * @returns {boolean} true se a Meta aceitou. Quem chama precisa saber:
   *   no false, o aviso em texto volta a valer, senão a pessoa espera o OCR
   *   sem retorno nenhum.
   */
  /**
   * `id` da mensagem que está sendo processada AGORA.
   *
   * Uma execução do Apps Script trata uma mensagem, então isto não é estado
   * compartilhado entre conversas — é o contexto da execução corrente. Existe
   * para `sinalizarProcessando` não precisar do id passado de mão em mão por
   * toda a cadeia de handlers só para ligar um balão de "digitando".
   * O `Webhook.gs` preenche; quem quiser ser explícito passa o id direto.
   */
  _mensagemAtualId: null,

  sinalizarProcessando(messageId) {
    messageId = messageId || this._mensagemAtualId;
    if (!messageId) return false;

    const config = getConfig();
    try {
      const resposta = this.fetchComRetry(
        getWhatsAppUrl(`${config.WHATSAPP_PHONE_ID}/messages`),
        {
          method:      'post',
          contentType: 'application/json',
          headers:     { Authorization: `Bearer ${config.WHATSAPP_TOKEN}` },
          payload:     JSON.stringify({
            messaging_product: 'whatsapp',
            status:            'read',
            message_id:        messageId,
            typing_indicator:  { type: 'text' }
          }),
          muteHttpExceptions: true
        },
        // Sem `mensagem`: não é envio, não entra no contador de cobrança.
        // Idempotente: marcar como lida duas vezes não tem efeito colateral.
        { idempotente: true, rotulo: 'WhatsApp digitando' }
      );

      const code = resposta ? resposta.getResponseCode() : null;
      if (code !== 200) {
        console.warn(`⚠️ [WhatsApp] Indicador de digitação recusado (HTTP ${code}):`,
                     resposta ? resposta.getContentText().slice(0, 200) : 'sem resposta');
        return false;
      }
      return true;
    } catch (e) {
      console.warn('⚠️ [WhatsApp] Exceção no indicador de digitação:', e.message);
      return false;
    }
  },

  /**
   * Envia um ou mais CARTÕES DE CONTATO nativos do WhatsApp.
   *
   * BL-41 (A1) — POR QUE ISTO SUBSTITUI O TEXTO COM O NÚMERO.
   * Antes o bot mandava "• João da Silva — (86) 98852-1231" e a pessoa tinha
   * de copiar ou digitar o número para falar com a pastoral. O cartão nativo
   * traz "Conversar" e "Salvar contato": um toque. **Custa a mesma mensagem.**
   *
   * Vários contatos cabem numa mensagem só — comunidade com dois responsáveis
   * não gasta duas.
   *
   * ⚠️ O cartão NÃO tem corpo de texto. Quem precisar dizer algo junto (de que
   * comunidade é, uma bênção) manda isso na mensagem anterior, ou aceita que o
   * cartão vá sozinho. É o motivo de `_enviarContatos` manter um texto curto
   * antes: sem ele, a pessoa recebe um contato solto sem saber por quê.
   *
   * @param {string} to - Destinatário
   * @param {Array<{nome: string, whatsapp: string, email?: string, cargo?: string}>} contatos
   * @returns {boolean} false se não havia contato válido para enviar
   */
  enviarContatos(to, contatos) {
    const validos = (contatos || []).filter(c => c && c.whatsapp);
    if (!validos.length) return false;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'contacts',
      contacts: validos.map(c => {
        const nome = String(c.nome || 'Pastoral do Dízimo').trim();
        // `formatted_name` é o único campo de nome obrigatório; os demais são
        // opcionais mas a Meta recusa o cartão se não vier ao menos um deles
        // além do formatado. `first_name` cobre isso sem inventar sobrenome.
        const partes = nome.split(/\s+/);
        const contato = {
          name: {
            formatted_name: nome,
            first_name:     partes[0]
          },
          phones: [{
            phone: this._e164(c.whatsapp),
            type:  'CELL',
            wa_id: String(c.whatsapp).replace(/\D/g, '')
          }]
        };
        if (partes.length > 1) contato.name.last_name = partes.slice(1).join(' ');
        if (c.email) contato.emails = [{ email: c.email, type: 'WORK' }];
        if (c.cargo) contato.org    = { company: c.cargo };
        return contato;
      })
    };

    const resposta = this._post(payload, { rotulo: 'Cartão de contato' });
    const ok = !!resposta && resposta.getResponseCode() === 200;
    if (!ok) console.warn('⚠️ [Contatos] Cartão recusado pela Meta');
    return ok;
  },

  /**
   * Número no formato E.164 (+5586988521231), que é o que o cartão de contato
   * espera para o botão "Conversar" funcionar. O Odoo guarda em formatos
   * variados — com máscara, sem DDI, com espaços.
   * @private
   */
  _e164(numero) {
    const d = String(numero || '').replace(/\D/g, '');
    if (!d) return '';
    // Sem DDI: números brasileiros têm 10 (fixo) ou 11 (celular) dígitos com
    // DDD. Acima disso já vem com o 55 na frente.
    return d.length <= 11 ? `+55${d}` : `+${d}`;
  },

  /**
   * Envia mensagem de texto simples.
   * @param {string} to    - Número do destinatário
   * @param {string} texto - Corpo da mensagem
   */
  enviarSimples(to, texto) {
    return this._post({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:              'text',
      text:              { body: texto }
    });
  },

  /**
   * Envia mensagem com botão "🔙 Menu" e rodapé padrão.
   * @param {string} to    - Número do destinatário
   * @param {string} texto - Corpo da mensagem
   */
  enviarComBotaoMenu(to, texto) {
    this.enviarMenu(to, texto, [{ id: 'btn_menu', title: '🔙 Menu' }]);
  },

  /**
   * Envia mensagem com botões de confirmação (Sim/Não) configuráveis.
   * @param {string} to        - Número do destinatário
   * @param {string} texto     - Pergunta
   * @param {string} idSim     - ID do botão de confirmação
   * @param {string} idNao     - ID do botão de cancelamento
   * @param {string} txtSim    - Texto do botão Sim (padrão: '✅ Sim')
   * @param {string} txtNao    - Texto do botão Não (padrão: '❌ Não')
   */
  enviarConfirmar(to, texto, idSim, idNao, txtSim = '✅ Sim', txtNao = '❌ Não') {
    this.enviarMenu(to, texto, [
      { id: idSim, title: txtSim },
      { id: idNao, title: txtNao }
    ]);
  },

  /**
   * Envia mensagem interativa com até 3 botões.
   * @param {string} to      - Número do destinatário
   * @param {string} texto   - Corpo da mensagem
   * @param {Array}  botoes  - Array de { id, title }
   * @param {Object} opcoes  - { header?: string, footer?: string }
   */
  enviarMenu(to, texto, botoes, opcoes = {}) {
    if (botoes.length > 3) {
      console.warn('⚠️ WhatsApp permite no máximo 3 botões. Usando os 3 primeiros.');
      botoes = botoes.slice(0, 3);
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: texto },
        action: {
          buttons: botoes.map(btn => ({
            type:  'reply',
            reply: {
              id:    btn.id,
              title: btn.title.substring(0, 20) // limite WhatsApp
            }
          }))
        },
        footer: { text: opcoes.footer || 'Com carinho, Cidinha 💛' }
      }
    };

    // Cabeçalho de IMAGEM (BL-41 · A12). Confirmado no aparelho pela sonda S1:
    // mensagem de BOTÕES renderiza a imagem em cima do texto. A de LISTA não —
    // por isso `enviarLista`, logo abaixo, continua só com cabeçalho de texto.
    //
    // A imagem tem precedência sobre o texto porque `header` é um só e os dois
    // não cabem juntos: quem passa os dois quer a imagem.
    if (opcoes.imagemId) {
      payload.interactive.header = { type: 'image', image: { id: opcoes.imagemId } };
    } else if (opcoes.header) {
      payload.interactive.header = { type: 'text', text: opcoes.header };
    }

    return this._post(payload);
  },

  /**
   * Envia lista interativa com seções e itens.
   * @param {string} to       - Número do destinatário
   * @param {string} titulo   - Corpo da mensagem
   * @param {Array}  secoes   - [{ title, rows: [{ id, title, description }] }]
   * @param {Object} opcoes   - { textoBotao?, footer?, header? }
   */
  enviarLista(to, titulo, secoes, opcoes = {}) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: titulo },
        action: {
          button:   opcoes.textoBotao || 'Ver opções',
          sections: secoes
        },
        footer: { text: opcoes.footer || 'Com carinho, Cidinha 💛' }
      }
    };

    if (opcoes.header) {
      payload.interactive.header = { type: 'text', text: opcoes.header };
    }

    return this._post(payload);
  },

  // ============================================================================
  // FORMATADORES
  // ============================================================================

  /**
   * Formata valor numérico para exibição em Real Brasileiro.
   * Ex: 150 → "R$ 150,00"
   * @param {number|string} valor
   * @returns {string}
   */
  formatarValor(valor) {
    const num = parseFloat(valor);
    if (isNaN(num)) return 'R$ 0,00';
    return 'R$ ' + num.toFixed(2).replace('.', ',');
  },

  /**
   * Formata data no padrão Odoo (YYYY-MM-DD) para exibição (DD/MM/AAAA).
   * @param {string} dataOdoo - Ex: "2025-03-15"
   * @returns {string} Ex: "15/03/2025"
   */
  formatarDataOdoo(dataOdoo) {
    if (!dataOdoo) return '—';
    const partes = dataOdoo.split('-');
    if (partes.length !== 3) return dataOdoo;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  },

  /**
   * Formata número de WhatsApp para exibição amigável.
   * Ex: 5586988521231 → "(86) 98852-1231"
   * @param {string} numero - Número com código de país (55)
   * @returns {string}
   */
  formatarNumeroExibicao(numero) {
    // Remove prefixo 55 (Brasil) se presente
    let num = numero;
    if (num.startsWith('55')) num = num.substring(2);

    // Formata: DDD + número
    if (num.length === 11) {
      return `(${num.substring(0, 2)}) ${num.substring(2, 7)}-${num.substring(7)}`;
    }
    if (num.length === 10) {
      return `(${num.substring(0, 2)}) ${num.substring(2, 6)}-${num.substring(6)}`;
    }

    return numero; // retorna original se não reconhecer
  }

};