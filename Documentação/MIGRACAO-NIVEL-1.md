# Migração Nível 1 — sair do Apps Script sem reescrever o bot

> O **porquê** — a comparação dos três níveis de robustez, com custos — está em
> `EVOLUCAO-ARQUITETURA.md`. Este documento é o **como** do Nível 1.

**Objetivo:** tirar o runtime do Google Apps Script e pôr num container, com fila na frente
do webhook, estado num Redis, deploy por CI e monitoramento. Nada mais.

**O que isto fecha:** BL-21 (teto de ~30 execuções simultâneas), BL-20 (lost update do
cadastro), boa parte do BL-29 (atropelo de mensagens), BL-43 (CI), e a publicação manual —
hoje o passo mais perigoso do projeto, porque `clasp push` + republicar não tem rollback.

**O que isto NÃO toca:** Odoo (continua Online free), WhatsApp Cloud API (continua direto,
sem BSP), Cloud Vision (continua), e a lógica de negócio dos handlers — que não muda uma
linha, pelo motivo explicado logo abaixo.

**Custo em dinheiro:** R$ 30–100/mês, e quase tudo já é o WhatsApp que se paga hoje.
**Custo em trabalho:** 12 a 15 dias, ou 4 a 6 fins de semana. É estimativa minha, não medição.

---

## O achado que decide tudo: o código é síncrono

Este é o ponto em que uma migração dessas costuma virar um trimestre em vez de um mês, e vale
entender antes de olhar as fases.

`UrlFetchApp.fetch` do Apps Script é **síncrono**. O `fetch` do Node é **assíncrono**. E o
projeto inteiro foi escrito em cima da primeira forma:

```js
const response = Utils.fetchComRetry(url, options);   // devolve a resposta NA HORA
const registros = OdooService.searchRead(...);        // idem — 25 chamadas assim
```

São 25 chamadas ao Odoo cujo retorno é usado na linha seguinte, e ~20 pontos de rede diretos
(`MediaService`, `FlowHandler`, `NotificacaoHandler`, `Assets`). Cada uma dessas está dentro de
um handler, que está dentro do Router, que está dentro do webhook. Converter para `async`/`await`
significa marcar **toda essa cadeia** como assíncrona — e um `await` esquecido não dá erro: dá
uma Promise onde o código espera um objeto, silenciosamente, no caminho que grava dízimo.

**A decisão: o processamento de mensagem roda numa _worker thread_, onde bloquear é legítimo.**

Numa worker thread, `sync-fetch` (que usa `Atomics.wait` por baixo) dá uma requisição HTTP
síncrona de verdade, e `Atomics.wait` dá um `Utilities.sleep` de verdade. O event loop do
processo principal nunca bloqueia, porque o principal só faz uma coisa: validar a assinatura e
enfileirar.

Isso é coerente com a arquitetura nova, não é gambiarra para fugir do trabalho: depois da fila,
**uma mensagem é uma unidade de trabalho independente**. Bloquear enquanto ela é processada é o
comportamento correto — a concorrência passa a vir de instâncias do Cloud Run e de um pool de
workers, não de intercalar I/O no mesmo thread.

**O que se ganha:** 17.450 linhas de handler não mudam. **O que se perde:** um pouco de eficiência
por instância, que neste volume não é mensurável. **Plano B, se `sync-fetch` der problema:**
converter para `async`/`await`, e aí a estimativa dobra. É o maior risco isolado deste plano.

### O segundo achado: a superfície do Apps Script é pequena

Nas 17.450 linhas, só 9 APIs do Google aparecem — e três delas nem estão em produção:

| API | Sítios | Vira |
|---|---|---|
| `PropertiesService` | 63 | env vars (≈25 chaves de config) + Redis (5 chaves mutáveis) |
| `Utilities` | 60 | `sleep`→`Atomics.wait`, `formatDate`→`Intl`, `base64`/`newBlob`/`getUuid`→Node |
| `CacheService` | 41 | Redis |
| `ScriptApp` | 9 | Cloud Scheduler (2 gatilhos) |
| `ContentService` | 7 | resposta do Fastify |
| `UrlFetchApp` | 6 | `sync-fetch` — e **só 2 são produção**, ambas atrás de `Utils.fetchComRetry` |
| `LockService` | 4 | `SET NX PX` no Redis, **por usuário** |
| `DriveApp` / `SpreadsheetApp` | 3 | nada — só em `Tests.gs` e numa função morta do `Setup.gs` |

Uma fachada com seis nomes cobre tudo isso. O resto é JavaScript comum.

### O terceiro achado: os `.gs` já rodam em Node

O `ferramentas/conta-mensagens.js` carrega `Config.gs` e `NotificacaoHandler.gs` com
`vm.runInContext` e executa `executarNotificacoesDiarias()` inteira contra stubs. Isso já
funciona, hoje, em 234 verificações.

Ou seja: **o mecanismo de carregar os `.gs` no Node está provado.** O servidor usa o mesmo — lê
os arquivos na ordem, roda num contexto que tem os globais da Plataforma. Os `.gs` continuam
sendo scripts de escopo global, como o Apps Script espera, e o mesmo código roda nos dois lugares
durante toda a transição.

---

## As fases

Cada fase termina num estado publicável e reversível. Produção fica no Apps Script até a Fase 5.

### Fase 0 — CI ✅ **FEITA (24/09)** · fecha BL-43

`.github/workflows/verificacao.yml` roda em **todo pull request** e em todo push para `staging` e
`main`. Um comando só:

```yaml
- run: node ferramentas/verificar-tudo.mjs
```

**Por que um ponto de entrada único.** Se o workflow listasse as suítes por conta própria, o CI e
a máquina de quem desenvolve divergiriam no primeiro dia em que alguém acrescentasse uma — e a
divergência aparece como *"passa aqui, quebra lá"*, o jeito mais caro de descobrir. A lista mora
em `ferramentas/verificar-tudo.mjs`, e o harness **reprova** se o YAML chamar uma suíte direto.

**As quatro suítes** (nenhuma toca em Odoo, WhatsApp ou Apps Script; nenhum segredo envolvido):

| Suíte | O que prova | Rede |
|---|---|---|
| `conta-mensagens.js` | o contrato: mensagens, fluxos, views e guardas — 272 verificações | não |
| `prova-verificador.mjs` | o verificador de permissões, em 12 cenários contra um Odoo de mentira | não |
| `valida-flow.js` | os Flows do WhatsApp contra as regras da Meta | não |
| `provar-dominio-filtro.mjs` | os domínios das views avaliados pelo py_js real do Odoo | **sim** |

A quarta baixa o py_js do GitHub, e é a única que depende de rede. Por isso o `verificar-tudo`
**rotula a falha dela à parte**: quando só ela reprova, a saída diz para conferir o GitHub antes
de procurar bug no código. O workflow também guarda o download em cache, então a rede só é tocada
quando a ferramenta muda.

Tempo total: **~3 segundos**.

#### ⚠️ Falta um passo, e ele é seu

O workflow **avisa**, não impede. Para o critério de aceite valer — *"um PR com o harness
vermelho não entra em `staging`"* — é preciso exigir o check:

> **Settings → Branches → Add branch ruleset** (ou *Add rule*) para `staging`
> → marcar **Require status checks to pass before merging**
> → escolher **Harness** na lista (ele aparece depois da primeira execução do workflow)

Enquanto isso não for feito, a Fase 0 está metade pronta: o sinal existe e é ignorável.

### Fase 1 — Camada `Plataforma`, ainda 100% no Apps Script (2–3 dias)

Novo `Plataforma.gs`, seis fachadas:

| Fachada | Cobre |
|---|---|
| `Plataforma.cache` | `get`, `put(chave, valor, ttl)`, `remove` |
| `Plataforma.config` | leitura das ~25 chaves de configuração |
| `Plataforma.estado` | as 5 chaves mutáveis (`FLOW_CADASTRO_ATIVO`, `WEBHOOK_SECRET`, …) |
| `Plataforma.http` | `fetch(url, options)` **síncrono**, devolvendo a forma do `HTTPResponse` |
| `Plataforma.relogio` | `agora()`, `formatar(data, tz, fmt)`, `dormir(ms)` |
| `Plataforma.trava` | `comTrava(chave, fn)` — recebe a chave, que hoje é ignorada |

A implementação nesta fase é GAS puro: chama `CacheService`, `PropertiesService`, `UrlFetchApp`,
`Utilities`, `LockService`. Não muda comportamento nenhum. Depois, migrar os sítios de chamada.

Repare no detalhe de `Plataforma.trava`: a assinatura **já recebe a chave** mesmo que o Apps
Script não saiba usá-la (só tem lock global). Quando a implementação Node chegar, a trava por
usuário existe sem tocar em quem chama.

**Critério de aceite:** (a) o harness continua verde; (b) **nenhum `.gs` fora de `Plataforma.gs`
cita `CacheService`, `PropertiesService`, `UrlFetchApp`, `Utilities`, `LockService`,
`ContentService` ou `ScriptApp`** — verificação nova no próprio `conta-mensagens.js`, no mesmo
formato da que hoje trava o `everyHours(1)`. Essa verificação é o que impede a fachada de vazar
de volta com o tempo.

Produção segue no Apps Script durante toda a fase. Risco perto de zero.

### Fase 2 — Runtime Node em paralelo, sem tráfego (2–3 dias)

```
servidor/
  index.js          Fastify. O papel vem de env: PAPEL=webhook | worker
  carregador.js     lê os .gs na ordem e roda num vm context
  plataforma/
    cache.js        Redis
    config.js       env vars
    http.js         sync-fetch dentro da worker
    relogio.js      Intl.DateTimeFormat com America/Sao_Paulo
    trava.js        SET NX PX
  worker.js         worker thread onde a mensagem é processada
Dockerfile
```

#### DOIS serviços, não um

A primeira versão deste plano desenhou um servidor só, com `/webhook`, `/processar` e `/cron/*`
juntos. **Está errado:** no Cloud Run o `--allow-unauthenticated` é **por serviço, não por rota**.
Um serviço só significaria expor o worker à internet e proteger por verificação de token dentro
da aplicação — defesa em software para um problema que a plataforma resolve melhor.

Mesma imagem, dois serviços, papel por variável de ambiente:

| Serviço | Rotas | Acesso | Quem chama |
|---|---|---|---|
| `webhook` | `POST /webhook`, `GET /webhook`, `/saude` | público | a Meta (autenticação é o HMAC) |
| `worker` | `POST /processar`, `POST /cron/*` | **privado** | Cloud Tasks e Cloud Scheduler, via OIDC |

O worker fica literalmente inalcançável de fora. É propriedade de infraestrutura, não de código.

#### O que precisa existir na Google antes desta fase

Nada disto é necessário nas Fases 0 e 1 — **não configure antes**, ou terá esquecido as escolhas
quando for usar. É uma sessão de cerca de uma hora, de uma vez, por esta lista.

Já existe, porque o Vision já roda com chave de API: **projeto GCP e billing ativo.**

1. **APIs:** Cloud Run, Cloud Build, Artifact Registry, Cloud Tasks, Cloud Scheduler,
   Secret Manager.
2. **Região.** `southamerica-east1` (São Paulo) pela latência e por responder "os dados estão no
   Brasil" numa pergunta de LGPD. ⚠️ Mas veja a ressalva de Tier 1/Tier 2 em *Limites gratuitos*,
   abaixo: pode custar franquia.
3. **Conta de serviço dedicada** para os dois serviços. **É a mesma lição do BL-17.** A conta
   padrão do Compute vem com papel de Editor no projeto inteiro; não faz sentido tirar o bot de
   Administrador no Odoo e pô-lo de Editor na Google.
4. **Secret Manager** para quatro segredos: `WHATSAPP_TOKEN`, `ODOO_API_KEY`,
   `GOOGLE_VISION_API_KEY` e o **App Secret da Meta** (novo — é o que valida o HMAC na Fase 5).
5. **Artifact Registry**, com **política de limpeza desde o primeiro dia**. Cada deploy gera uma
   imagem de 200–300 MB e elas se acumulam; configurar depois é mexer em algo esquecido.
6. **Workload Identity Federation** para o GitHub Actions publicar sem chave. O caminho comum é
   gerar uma chave de conta de serviço e colar no GitHub Secrets — **este repositório é público**,
   e uma credencial de longa duração perto dele é uma categoria de risco que não precisa existir.
   O WIF dá um token efêmero e nada baixável.

Fora da Google, e independente: a conta no **Upstash** para o Redis. De graça, dois minutos.
**Não use Memorystore** — é o Redis gerenciado do Google e custa ~US$ 35/mês mínimo, o que
sozinho estouraria o orçamento inteiro do Nível 1.

Cuidado registrado: `Utilities.formatDate` usa os padrões do Java (`'yyyy-MM-dd'`, `'H'`), que
não são os do `Intl`. Precisa de um tradutor pequeno e com teste próprio — a janela de disparo do
BL-73 lê a hora com `formatDate(..., 'H')`, e um erro ali é silencioso.

**Critério de aceite:** o `conta-mensagens.js` roda contra o runtime Node e passa; um POST de
teste local percorre o fluxo inteiro contra uma base Odoo descartável.

Nada de tráfego real ainda. A Meta continua apontando para o Apps Script.

### Fase 3 — Fila, estado e trava por usuário (3–4 dias) · fecha BL-20 e BL-21

- **Cloud Tasks na frente.** `POST /webhook` valida a assinatura, enfileira e responde 200 em
  milissegundos. `POST /processar` (só Cloud Tasks, autenticado por OIDC) faz o trabalho.
- **Idempotência vira responsabilidade da fila.** Nome de tarefa determinístico (o `messageId`)
  e o Cloud Tasks recusa a duplicata sozinho. Some a dedup por cache.
- **Retry e backoff também.** A fila tem política própria; o código para de carregar isso.
- **Redis** para `estado_*`, `dados_*`, sessão, rate limit e cache de schema. Mesma semântica do
  `CacheService` (chave, valor, TTL), sem o limite de 100 KB.
- **Trava por usuário** (`SET NX PX` no telefone). Isto é o que fecha o BL-20 de verdade: hoje o
  lock é global *e* best-effort — se não vier em 3 s, grava sem lock, justamente sob a contenção
  que deveria proteger.
- **`Utils._chamadasExternas` tem que virar `INCR` no Redis.** Hoje é contador em memória,
  descarregado no fim da execução. Com várias instâncias do Cloud Run, a contagem do BL-25 passa
  a contar por instância e subestima — o mesmo tipo de erro que o BL-42 já causou uma vez.

**Critério de aceite:** o `ferramentas/simula-carga.js` (que já existe e já dispara requisições
paralelas de verdade) no modo `corrida` não produz lost update. Hoje produz.

### Fase 4 — Agendamentos (1 dia)

Cloud Scheduler para dois endpoints autenticados: notificações (de hora em hora, BL-73) e
sessões abandonadas (a cada 20 minutos).

Cuidado registrado: `TIMEZONE = 'America/Sao_Paulo'` e o Scheduler tem fuso próprio. A janela do
BL-73 tem de continuar lendo a hora em São Paulo, não em UTC — senão o disparo das 9h vira 6h e
ninguém percebe, porque não dá erro. Merece caso no harness.

#### ⚠️ Os jobs nascem PAUSADOS

Se os jobs do Scheduler forem criados já ativos enquanto o acionador do Apps Script ainda roda de
hora em hora, **os dois sistemas notificam**. A deduplicação (`jaFoiNotificadoEsteMes`, que lê o
`x_notificacao_log` no Odoo) segura a maior parte, mas os dois podem checar "não notificado" no
mesmo segundo e os dois enviarem.

Com 500 dizimistas isso é mensagem duplicada para muita gente, e não dá para desfazer.

**Regra:** criar pausados. Despausar é passo da **Fase 5**, no mesmo momento em que se removem os
acionadores do Apps Script (`removerTriggerNotificacoes` e o equivalente do `TriggerSessoes`).
Nunca os dois ligados ao mesmo tempo.

### Fase 5 — Corte (1 dia + uma semana de observação)

- **Assinatura HMAC de verdade.** Hoje o webhook autentica por segredo na query string
  (`?token=…`) porque **o Apps Script não dá acesso aos headers**. No Cloud Run dá: passa a
  validar o `X-Hub-Signature-256` que a Meta manda em todo POST, com o App Secret. Efeito
  colateral bom: o `WEBHOOK_SECRET` que ficou sem rotacionar deixa de existir como conceito.
- Trocar a URL do callback na Meta.
- **O Apps Script fica de pé, sem tráfego, por uma semana.** Rollback é trocar a URL de volta —
  um campo, efeito imediato.

**Critério de aceite:** 7 dias sem incidente, incluindo pelo menos um ciclo de notificação
completo.

### Fase 6 — Observabilidade e limpeza (2 dias)

- Alerta de taxa de erro e uptime check no endpoint (`/saude`).
- Log estruturado em JSON — o Cloud Logging indexa e dá busca de verdade, em vez de rolar texto.
- Remover a implementação GAS da `Plataforma`; o carregador `vm` pode virar import de módulo
  (opcional, e sem pressa).
- Aposentar `clasp`, `.claspignore` e `appsscript.json`.

---

## Continuidade de serviço — o bot para em alguma fase?

**Nenhuma fase desliga o bot de propósito.** Não há janela de manutenção em lugar nenhum deste
plano; isso foi condição de desenho. Mas há dois momentos de risco, e eles não são do tipo que se
espera.

| Fase | O bot | Rollback |
|---|---|---|
| 0 — CI | intacto, nem toca no deploy | apagar o arquivo |
| 1 — `Plataforma` | intacto até o `clasp push`; depois, **risco de regressão** | reapontar a implantação para a versão anterior |
| 2 — runtime Node | intacto, o Cloud Run não recebe tráfego | nada a desfazer |
| 3 — fila e Redis | intacto, idem | nada a desfazer |
| 4 — Scheduler | intacto **se** os jobs nascerem pausados | pausar os jobs |
| 5 — corte | **único momento visível ao usuário** | trocar a URL de volta na Meta |
| 6 — limpeza | intacto | ⚠️ aqui acaba o rollback fácil |

**Fase 0 tem risco zero, e não é força de expressão.** O workflow é um `.yml` em
`.github/workflows/`, e o `clasp` só envia `.gs`, `.js`, `.html` e o `appsscript.json` — YAML ele
nem reconhece como arquivo de projeto. O arquivo entra no Git e nunca chega perto do Apps Script.

**O risco da Fase 1 não é queda, é regressão.** Ela termina num `clasp push` + republicar, e aí
código novo passa a atender. Se o refactor tiver bug, o bot não *cai* — responde errado, que é
pior, porque não avisa. Duas defesas, e é por isso que a Fase 0 vem antes: (a) o harness roda em
todo PR e reprova mudança de comportamento antes do push; (b) o Apps Script guarda as versões —
em *Implantações → Gerenciar implantações → editar* troca-se a versão servida, em segundos, sem
`clasp push`. **Vale testar esse rollback antes de precisar dele.**

**A Fase 5 tem a única perda visível, e é pequena.** Mensagem não se perde: a URL nova já está de
pé e validada desde a Fase 2, então trocar o callback é uma troca entre dois endpoints vivos —
diferente de rotacionar o `WEBHOOK_SECRET`, onde o endpoint antigo passa a *recusar*. O que se
perde é **quem estiver no meio de uma conversa**: o estado (`estado_*`, `dados_*`) vive no
`CacheService` do Apps Script, e o runtime novo procura no Redis e não acha. Essa pessoa volta ao
menu.

Mitigação: **cortar de madrugada**. O TTL da sessão é 1 hora, então às 3h praticamente não há
ninguém no meio de nada. Antes das 9h também, para não pegar a janela de notificação do BL-73.
Não se perde nada que já esteja no Odoo — cadastro, devolução, `x_contato_bot`.

**A Fase 6 é o ponto sem volta.** Enquanto o código do Apps Script existir, voltar é trocar uma
URL. Quando a Fase 6 apagar a implementação GAS da `Plataforma`, voltar vira `git revert` +
`clasp push` + republicar. Por isso ela é a última e vem depois de uma semana de observação com
pelo menos um ciclo de notificação completo. Não custa nada deixar o Apps Script parado de pé por
um mês.

---

## Limites gratuitos, verificados na fonte

Conferidos em 24/09/2026 nas páginas oficiais (links ao fim do documento). **Preços e franquias
mudam — reconferir na hora de contratar.**

### Confirmado

| Serviço | Gratuito por mês | Observação |
|---|---|---|
| **Cloud Run** | 180.000 vCPU-s · 360.000 GiB-s · 2.000.000 requisições | agregado **por conta de faturamento**, não por projeto |
| **Cloud Scheduler** | **3 jobs** | também por conta de faturamento — usamos 2 |
| **Cloud Build** | 2.500 build-minutes | ~800 deploys |
| **Cloud Vision** | primeiras 1.000 unidades | já consumidas hoje |
| **Cloud Logging** | primeiros 50 GiB por projeto | |

### NÃO confirmado

As páginas de preço da Google são tabelas renderizadas por JavaScript e não abriram. **Estes
números não foram apurados e não devem ser presumidos:**

- **Cloud Tasks** — confirmou-se só o modelo: uma operação cobrável é uma chamada de API **ou uma
  tentativa de entrega**, e tarefas são fatiadas de 32 KB em 32 KB. A franquia, não.
- **Secret Manager** — cobra por versão ativa/mês e por acesso a cada 10.000. Os limites, não.
- **Artifact Registry** — existe armazenamento gratuito; quanto, não.

Os três são de baixo impacto neste volume. Conferir no console na Fase 2.

### O que realmente aperta

Estimativa com premissas à vista: 500 dizimistas, ~2.400 mensagens recebidas/mês, e **~6.000
callbacks de status** — a Meta faz um POST para cada mensagem *enviada* (sent, delivered, read),
que é o item que quase sempre falta na conta.

| Recurso | Consumo estimado | Do gratuito |
|---|---|---|
| Requisições | ~11.000 | **0,5%** |
| GiB-segundos | ~15.000 | ~4% |
| **vCPU-segundos** | **~25.000–36.000** | **14–20%** |

**O gargalo é vCPU-segundo, não requisição** — o contrário do que a intuição diz. O número vem do
próprio backlog: as execuções medidas no teste de carga levaram **10 a 24 segundos**, dominadas
por ida e volta ao Odoo e ao Vision, que não ficam mais rápidas no Node.

**Consequência direta da decisão da worker thread síncrona:** ela bloqueia esperando o Odoo, e o
Cloud Run cobra **CPU alocada, não CPU ocupada**. A escolha que preserva 17.450 linhas custa mais
vCPU-segundo do que um desenho assíncrono custaria. Com 14–20% da franquia, cabe folgado — mas é
um custo real da decisão, não almoço grátis.

### Três ressalvas práticas

1. ⚠️ **Região Tier 2 queima a franquia mais rápido.** A franquia do Cloud Run é concedida como
   desconto **a preço de Tier 1**, e o consumo é descontado conforme o tier da região onde se
   roda. Se `southamerica-east1` for Tier 2 — a busca sugere que sim, **mas não foi confirmado** —
   aqueles 14–20% viram algo como 28–40%. Continua dentro, mas a margem deixa de ser confortável e
   passa a ser só suficiente. **Conferir o tier da região antes de fixá-la.**
2. **Os 3 jobs do Scheduler são da conta inteira.** Usamos 2. Um ambiente de staging com os mesmos
   gatilhos dá 4 e sai do gratuito. São centavos, mas convém saber antes.
3. **O teto mais baixo de todos não é da Google.** É o Upstash: 10.000 comandos/dia contra ~8–10
   comandos por mensagem, ou seja ~1.000 mensagens/dia. É o primeiro limite que se encosta, e é
   justamente em dia de disparo — onde o escalonamento do BL-73 ajuda. Passando disso o Upstash
   cobra por requisição e segue barato; a alternativa é Firestore, com franquia mais generosa e
   semântica de trava mais trabalhosa.

### Custo esperado

**R$ 30–100/mês**, e quase tudo já é o WhatsApp que se paga hoje. Cloud Run, Tasks, Scheduler,
Build, Vision e Logging cabem nas franquias neste volume.

---

## Riscos, em ordem de gravidade

1. **`sync-fetch` na worker thread não cobrir algum caso.** O suspeito é o `MediaService`:
   upload de imagem, multipart, binário. Mitigação: é a primeira coisa a portar na Fase 2, antes
   de qualquer outra — se falhar ali, falha barato. Plano B é `async`/`await`, e a estimativa
   dobra.
2. **`formatDate` e fuso.** Dois lugares silenciosos: a janela do BL-73 e a data que vai para o
   Odoo (campo `date`, que já quebrou uma vez no BL-01). Mitigação: tradutor com teste próprio,
   e casos no harness.
3. **Contadores em memória.** `Utils._chamadasExternas` e irmãos deixam de fazer sentido com
   várias instâncias. Mitigação: Fase 3, junto com o Redis.
4. **Estimativa.** 4 a 6 fins de semana é palpite meu sobre código que eu li, não sobre trabalho
   que eu medi. A Fase 1 é a que dá o primeiro dado real — se ela levar muito mais que 3 dias, o
   resto escala junto.

---

## O que o Nível 1 não resolve, de propósito

- **O Odoo Online free continua ponto único.** Se o plano mudar ou a instância tiver incidente,
  para tudo. Isso é Nível 2 (banco próprio como registro do estado do bot, Odoo como tela).
- **Ordem total de mensagens (resto do BL-29).** A fila mais a trava por usuário eliminam o
  lost update e encolhem muito a janela do atropelo — porque o processamento sai do caminho do
  webhook e deixa de levar 10–24 s. Mas garantia *formal* de ordem exige consumidor com
  ordering key, o que pede instância sempre de pé: Nível 2.
- **Fator ônibus.** Continua 1. Não há infraestrutura que resolva.

---

## Ordem de execução recomendada

~~Fase 0 primeiro e sozinha~~ — **feita em 24/09**. Depois 1 e 2 juntas, que é onde está o risco
técnico e nenhum risco de produção.
Só então 3, 4 e 5, que é quando a produção começa a se mover.

Se o plano precisar parar no meio, os pontos seguros de parada são o fim da Fase 0 e o fim da
Fase 2. Parar entre a 3 e a 5 deixa duas arquiteturas de pé ao mesmo tempo.

---

## Fontes dos limites gratuitos

Consultadas em 24/09/2026:

- <https://cloud.google.com/run/pricing>
- <https://cloud.google.com/scheduler/pricing>
- <https://cloud.google.com/tasks/pricing>
- <https://cloud.google.com/build/pricing>
- <https://cloud.google.com/vision/pricing>
- <https://cloud.google.com/products/observability/pricing>
- <https://cloud.google.com/secret-manager/pricing>
- <https://cloud.google.com/artifact-registry/pricing>
- <https://cloud.google.com/free>
