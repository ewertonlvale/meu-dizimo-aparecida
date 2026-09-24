# Migração Nível 1 — sair do Apps Script sem reescrever o bot

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

### Fase 0 — CI (1 dia) · fecha BL-43

`.github/workflows/verificacao.yml`: em todo PR e todo push para `staging`, roda
`node ferramentas/conta-mensagens.js`. Branch protection exigindo o check verde.

**Critério de aceite:** um PR com o harness vermelho não entra em `staging`.

Isto é independente da migração e vale por si só. Se o plano parar aqui, já valeu — e ele é o
que torna todas as fases seguintes verificáveis, porque **o harness passa a ser o contrato**:
o critério de "a migração não quebrou nada" é ele continuar verde.

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
  index.js          Fastify: /webhook (POST), /processar, /cron/*, /saude
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

## Onde o dinheiro vai

| Item | Estimativa |
|---|---|
| Cloud Run (scale-to-zero) | R$ 0–30 — a camada gratuita cobre ~2M requisições/mês |
| Cloud Tasks | R$ 0 — 1M operações/mês grátis |
| Cloud Scheduler | R$ 0 — 3 jobs grátis, usamos 2 |
| Redis (Upstash) | R$ 0 no início ⚠️ |
| Cloud Vision | R$ 0 — 1.000 imagens/mês grátis |
| WhatsApp (Meta) | R$ 25–45 — **já se paga hoje** |
| GitHub Actions | R$ 0 — repositório público |

⚠️ **O único teto real é o Redis.** A camada gratuita do Upstash é de 10.000 comandos/dia, e cada
mensagem consome 8–10 operações (estado, dados, idempotência, rate limit). Dá ~1.000 mensagens por
dia, o que sobra para o uso normal e **pode apertar em dia de disparo de notificação**. O
escalonamento do BL-73 ajuda justamente aí. Passando disso, o Upstash cobra por requisição e
continua barato; a alternativa é Firestore, cuja camada gratuita é mais generosa mas cuja
semântica de trava dá mais trabalho.

Valores são ordem de grandeza e mudam. Conferir na hora de contratar.

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

Fase 0 primeiro e sozinha — ela vale independente do resto e é o que torna tudo o mais
verificável. Depois 1 e 2 juntas, que é onde está o risco técnico e nenhum risco de produção.
Só então 3, 4 e 5, que é quando a produção começa a se mover.

Se o plano precisar parar no meio, os pontos seguros de parada são o fim da Fase 0 e o fim da
Fase 2. Parar entre a 3 e a 5 deixa duas arquiteturas de pé ao mesmo tempo.
