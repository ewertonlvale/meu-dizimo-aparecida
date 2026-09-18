# Arquitetura e convenções — Bot Meu Dízimo

**O que este documento é:** a referência de *como o sistema funciona hoje* e das regras
que precisam ser respeitadas ao mexer nele. Diferente do [BACKLOG.md](BACKLOG.md), que é
registro de trabalho, e do que está em [historico/](historico/), este arquivo deve ser
mantido atualizado junto com o código.

**Atualizado em:** 17/09/2026

---

## 1. Armazenamento: `CacheService` vs `PropertiesService`

O projeto usa os dois serviços do Apps Script, e **escolher errado causa bugs sutis**.
Esta seção existe porque a diferença já custou uma investigação: a proposta original do
BL-22 era "usar chaves por usuário e varrer por prefixo na trigger", o que é
**impossível no `CacheService`**.

### Regra de decisão

| Se o dado… | Use | Porque |
|---|---|---|
| precisa ser **enumerado** (varrer chaves, listar tudo) | **Properties** | O cache **não lista chaves** |
| é **efêmero** e tem prazo natural de validade | **Cache** | TTL automático, escrita barata |
| precisa **sobreviver** a despejo e ao fim da sessão | **Properties** | O cache pode ser descartado sob pressão |
| é **configuração** do projeto | **Properties** | Persistente, editável pela interface |
| é grande ou muito frequente | **Cache** | Properties é mais lento e tem cota menor |

### Limitações que valem para os dois

- **Nenhum dos dois tem operação atômica** — não existe compare-and-swap nem incremento
  atômico. Todo `ler → alterar → gravar` de uma chave **compartilhada** é uma corrida.
  Foi a causa raiz dos BL-20, BL-22 e BL-23.
- A saída preferida **não é lock**: é fazer cada execução escrever **a sua própria
  chave**, eliminando a disputa em vez de serializá-la (ver seção 3).

### `CacheService` — o que morde

- **Não enumera chaves.** Só `get`/`getAll` por chave conhecida. Se você precisa varrer,
  o cache está descartado — foi por isso que o índice de sessões foi para Properties.
- **TTL máximo de 6 horas** (21600 s). Não serve para nada com horizonte diário.
- **Pode ser despejado** a qualquer momento. Nunca deve ser a única cópia de um dado que
  importa — em especial dado financeiro.
- Limite de ~100 KB por entrada (por isso `appendLog` trunca em 90 KB).

### `PropertiesService` — o que morde

- **Não tem TTL.** O que entra fica até alguém apagar. Toda chave transitória precisa de
  um responsável explícito pela limpeza — no caso das sessões, é a trigger de 5 min.
- ⚠️ **`setProperties(obj)` mescla; `setProperties(obj, true)` APAGA TODO O RESTO.**
  `setupProperties()` usa a forma de um argumento, e **precisa continuar assim**: passar
  `true` ali apagaria as sessões ativas e os contadores de cota junto com a configuração.
- **Config e dados transitórios dividem o mesmo store.** Não há namespaces separados,
  então a convivência depende de prefixo (seção 1.1). Qualquer código que faça
  `getProperties()` tem de **filtrar por prefixo**, nunca assumir que tudo ali é config.
- Cota da ordem de **500 KB por store** e ~9 KB por valor (confirme no painel de cotas).
- É mais lenta que o cache: sirva-se dela **uma vez por execução**, não por operação.
  O contador de cota (BL-25) faz exatamente isso — acumula em memória e grava uma vez.

### 1.1 Inventário de chaves

**Cache** (todas por usuário, `from` = número do WhatsApp):

| Chave | TTL | Para quê |
|---|---|---|
| `estado_${from}` | 1 h | Estado atual da conversa |
| `dados_${from}` | 1 h | Dados temporários do cadastro |
| `log_cadastro_${from}` | 1 h | Transcrição do cadastro (truncada em 90 KB) |
| `sessao_inicio_${from}` | 1 h | Timestamp de início da sessão |
| `aviso_sessao_${from}` | 10 min | Marca que o aviso de expiração já foi enviado |
| `contato_${from}` | 6 h | Número já conhecido (evita ida ao Odoo por mensagem) |
| `msg_${messageId}` | 10 min | Idempotência do webhook |
| `taxa_min_${from}_${balde}` · `taxa_hora_${from}_${balde}` | 2 min / 2 h | Freio de gasto por pessoa. O **balde de tempo na chave** é essencial: `cache.put` renova o TTL, então chave fixa nunca expiraria |
| `taxa_aviso_${from}` | 1 h | Garante um aviso por hora — o aviso também é mensagem cobrada |
| `tentativas_relatorio_${from}` · `bloqueio_relatorio_${from}` | — | Controle de acesso ao relatório |
| `campo_conferencia_pix` | 6 h / 5 min | Cache da checagem de schema do BL-26 (global) |

**Properties:**

| Chave | Tipo | Quem limpa |
|---|---|---|
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_PIN`, `VERIFY_TOKEN`, `WEBHOOK_SECRET`, `ODOO_URL`, `ODOO_DATABASE`, `ODOO_UID`, `ODOO_API_KEY`, `GOOGLE_VISION_API_KEY`, `NOTIFICACOES_ATIVAS`, `NUMERO_TESTE` | Configuração | ninguém (permanente) |
| `sessao_ativa_<numero>` | Transitória — índice de sessões de cadastro; valor = timestamp | Trigger de sessões (5 min) |
| `uso_urlfetch_<yyyy-MM-dd>_<0-4>` | Transitória — contador de chamadas externas | `verificarCotaUrlFetch()` poda > 7 dias |

**Ao criar uma chave transitória nova em Properties:** use prefixo distinto, documente-a
nesta tabela e defina **quem a apaga**. Sem isso ela vaza para sempre.

---

## 2. Chamadas externas

**Regra:** todo acesso HTTP passa por **`Utils.fetchComRetry(url, options, { idempotente, rotulo })`**.
Não chame `UrlFetchApp.fetch` diretamente — isso escapa da contagem de cota (BL-25) e do
retry (BL-24). A única exceção é `RegistrarNumero.gs`, utilitário manual de setup.

### A política de retry depende de idempotência

| Situação | Repete? | Por quê |
|---|---|---|
| **429** (throttling) | Sempre | Recusada *antes* de executar; repetir nunca duplica |
| **5xx / exceção de rede**, `idempotente: true` | Sim | Leituras, `write`, OCR e downloads não têm efeito colateral |
| **5xx / exceção de rede**, `idempotente: false` | **Não** | O servidor pode ter processado antes de falhar |

⚠️ **`idempotente: false` é obrigatório para `create` no Odoo e envios ao WhatsApp.**
Repetir um `create` após 5xx gravaria a mesma devolução duas vezes. No `OdooService._rpc`
a política é derivada do payload (`args[4] !== 'create'`), então não é preciso decidir a
cada chamada.

Teto de 3 tentativas com backoff de 1 s e 2 s, baixo de propósito: cada espera consome o
orçamento de 6 min por execução.

---

## 3. Concorrência

O deployment é `executeAs: USER_DEPLOYING`, então **todas** as execuções rodam como o mesmo
usuário e compartilham o pool de ~30 execuções simultâneas. Não há isolamento por usuário
do WhatsApp.

**`LockService` só oferece lock global.** `getUserLock()` não ajuda: como o *execute as* é
único, todas as execuções são o mesmo usuário. Portanto:

- **Prefira eliminar a disputa a serializá-la.** Chave por usuário/execução > lista única
  sob lock. Foi o que o BL-22 fez com o índice de sessões.
- **O lock global ainda é usado em dois lugares**, ambos protegendo `ler → alterar → gravar`
  no cache, onde não há alternativa: `StateManager._comLock` (gravação de campo do
  cadastro) e `StateManager.ehPrimeiroContato` (primeiro contato).
- As duas políticas de falha ao obter o lock são **deliberadamente opostas**, e a diferença
  importa:
  - `_comLock` segue **sem** lock — perder um campo do cadastro é pior que arriscar a corrida.
  - `ehPrimeiroContato` **desiste** — duplicar o registro no Odoo é pior que atrasar a
    boas-vindas para a próxima mensagem.

---

## 4. Publicação

- **`.claspignore` controla o que sobe.** Suíte de testes e o site de `docs/` ficam fora
  (deploy caiu de ~699 KB para ~281 KB). O arquivo explica como publicar temporariamente os
  testes para rodá-los no editor.
- ⚠️ `clasp push` **sincroniza**: arquivo que deixa de ser enviado é **removido** do projeto
  online.
- `clasp push` sozinho não basta — é preciso **republicar o deployment** para a URL do
  webhook servir o código novo.
- **Funções de setup, no editor:**
  | Função | Quando |
  |---|---|
  | `setupProperties()` | Configuração inicial |
  | `verificarProperties()` | Conferir config; avisa se `ODOO_UID` = 2 |
  | `testarConexaoOdoo()` | Validar credenciais do Odoo |
  | `configurarSegredoWebhook()` | Gerar o `WEBHOOK_SECRET` e obter a URL de callback |
  | `criarCampoConferenciaPix()` | Criar o campo de conferência do BL-26 no Odoo |
  | `criarCamposFamilia()` | Criar os campos da funcionalidade de família |
  | `instalarTriggerSessoes()` · `instalarTriggerNotificacoes()` | Instalar as triggers |
  | `ativarFlowCadastro()` · `desativarFlowCadastro()` | Ligar/desligar o formulário no cadastro |
  | `enviarFlowDeTeste()` | Abrir o formulário num aparelho, mesmo em rascunho |
  | `listarSessoesAtivas()` | Ver quem está no meio de um cadastro |
  | `limparTodasSessoes()` | Apagar todas — ⚠️ sem aviso a quem estiver cadastrando |

**O webhook é fail-closed:** sem `WEBHOOK_SECRET` configurado, todo POST é rejeitado. E como
o Apps Script sempre responde 200 (não há como devolver 403), **a Meta não reenvia o que for
rejeitado** — mensagem recusada é mensagem perdida. Ao rotacionar o segredo, atualize a URL
na Meta *antes* de republicar.

---

## 5. Onde cada coisa mora

| Arquivo | Responsabilidade |
|---|---|
| `Webhook.gs` | Entrada (GET de verificação, POST de mensagens), autenticação, idempotência |
| `Router.gs` | Despacha por estado da conversa |
| `StateManager.gs` | Estado, dados temporários, sessões, primeiro contato |
| `CadastroHandler.gs` · `DevolucaoHandler.gs` · `ComprovanteHandler.gs` · `RelatorioHandler.gs` · `MenuHandler.gs` | Fluxos de conversa |
| `OdooService.gs` | Toda a comunicação JSON-RPC com o Odoo |
| `VisionService.gs` | OCR de comprovantes e extração de valor/chave/data |
| `MediaService.gs` | Upload/download de mídia e QR Code PIX |
| `FlowHandler.gs` | Recebe e revalida a resposta de WhatsApp Flow (`nfm_reply`) — ver [FLOW-CADASTRO.md](FLOW-CADASTRO.md) |
| `AuditoriaNumeros.gs` | Relatório dos números de WhatsApp gravados no Odoo (BL-32) — só lê |
| `NotificacaoHandler.gs` | Lembretes mensais e sua trigger |
| `TriggerSessoes.gs` | Sessões abandonadas e acompanhamento de cota |
| `Utils.gs` | Envio ao WhatsApp, `fetchComRetry`, contagem de cota, formatadores |
| `Config.gs` · `Setup.gs` · `SetupCamposFamilia.gs` · `Assets.gs` | Configuração e setup |
