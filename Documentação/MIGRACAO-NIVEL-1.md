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

### Correções a este plano (revisão de 24/09)

Uma revisão do código contra este documento (detalhes em `notas.md`) confirmou a tabela de APIs
e a decisão da worker thread, mas achou erros e omissões. Os que mudam trabalho:

- **O carregamento está provado pela metade.** O harness concatena os `.gs` num script só — por
  causa do `const` léxico, que não vira propriedade do contexto — e **nunca carrega**
  `Webhook.gs`, `StateManager.gs` nem `TriggerSessoes.gs`: justamente a entrada e o estado.
- **Estado de módulo vaza entre requisições.** No GAS cada execução começa do zero; numa worker de
  vida longa, não. `Utils._mensagemAtualId` nunca é limpo (o "digitando…" pode ir para a mensagem
  de **outra pessoa**); `OdooService._camposGravaveis`/`_camposConhecidos` guardam `false` sem TTL
  depois de um erro passageiro. **É o risco mais sério da migração, e é silencioso.**
- **Fuso fora do `formatDate`.** ~33 usos de `getMonth`/`getDate`/`setHours` dependem do
  `timeZone` do `appsscript.json`. No container: `TZ=America/Sao_Paulo` e um teste que confirme.
- **`PropertiesService` não é "25 de config + 5 mutáveis".** Há famílias dinâmicas lidas por
  varredura de prefixo (`sessao_ativa_*`, `bloqueado_*`, `suspeito_*`, `media_id_*`,
  `uso_urlfetch_*`, `msgs_*`). Em Redis, isso é `SCAN`.
- **Os três locks têm políticas diferentes** (seguir sem trava / desistir), e a fachada tem de
  carregá-las — `comTrava` sozinho não basta.
- **Multipart.** O `MediaService` passa objeto com `Blob` e o `UrlFetchApp` monta o
  `multipart/form-data` sozinho; `sync-fetch` não.
- **Números:** 17.626 linhas (15.189 de produção); `RegistrarNumero.gs` chama `UrlFetchApp`
  direto; a trigger de sessões roda a cada **5** min, não 20.

**Estimativa revisada: 16–21 dias** (era 12–15). Palpite, como o original.

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

#### ✅ O check é exigido (24/09)

O ruleset **"staging protegida"** exige o check **Harness** para entrar na `staging` (além de
bloquear force push e exclusão). Conferido pela API do GitHub. A partir daqui, um PR com o
harness vermelho não entra.

E o harness passa **nos dois lugares**: até o #145 ele era verde no CI (Linux) e reprovava 3 de 4
suítes no Windows de quem desenvolve — CRLF nas regex, caminho `C:\` no `import()`, e o Node 24
caindo com `0xC0000409` num `process.exit` logo depois de `fetch`. Exatamente a divergência que o
ponto de entrada único existe para impedir, só que vinda da plataforma, não da lista de suítes.

### Fase 1 — Camada `Plataforma`, ainda 100% no Apps Script (2–3 dias) · ✅ publicada e testada (24/09)

#### Como ficou (e onde divergiu do desenho abaixo)

`Plataforma.gs` existe e é o **único** `.gs` do deploy que fala com o Apps Script. 127 linhas
trocadas mecanicamente em 20 arquivos, mais os casos à mão (três travas, dois gatilhos, as
respostas do webhook). Harness verde, 4/4.

| Fachada | Cobre | Desvio do desenho |
|---|---|---|
| `Plataforma.cache` | `get`, `getAll`, `put`, `putAll`, `remove`, `removeAll` | nomes do GAS, de propósito |
| `Plataforma.propriedades` | `getProperty`, `getProperties`, `setProperty`, `setProperties`, `deleteProperty` | **substitui `config` + `estado`**: há famílias dinâmicas lidas por prefixo; a divisão vai para a Fase 2, por prefixo, dentro da fachada. `setProperties` **não repassa** o `true` que apaga o store |
| `Plataforma.http` | `fetch(url, opcoes)` | — |
| `Plataforma.relogio` | `formatar(data, fuso, formato)`, `dormir(ms)` | sem `agora()`: ninguém precisava |
| `Plataforma.bytes` | `paraBase64`, `deBase64`, `blob`, `uuid` | **nova** — o `Utilities` não era só relógio |
| `Plataforma.trava` | `comTrava(chave, esperaMs, fn, aoFalhar)` | **`esperaMs` e `aoFalhar`**: os três locks têm políticas opostas (seguir sem trava × desistir) e a política fica com quem pede |
| `Plataforma.gatilhos` | `aCadaHoras`, `aCadaMinutos`, `removerDe`, `exercitarAutorizacao`, `urlDoServico` | **nova** — era o `ScriptApp` |
| `Plataforma.resposta` | `texto(conteudo)` | **nova** — era o `ContentService` |

**Por que a interface imita o Apps Script.** Com ~150 sítios, trocar
`CacheService.getScriptCache()` por `Plataforma.cache` é revisável linha a linha; uma API nova
em cada sítio não seria. O critério da fase é não mudar comportamento, e a forma mais segura de
cumpri-lo é não mudar o jeito de chamar.

**As chaves das travas** já são por usuário: `dados_<from>`, `contato_<from>`,
`dizimista_<whatsapp>`. O Apps Script as ignora; a Fase 3 as usa.

**Como se provou que nada mudou.** Além do harness de sempre, uma seção nova no
`conta-mensagens.js` executa o **contrato** da fachada — as três políticas de trava nos arquivos
reais, os dois gatilhos, o webhook — e esses casos foram rodados também contra o código **anterior**
à fase: passam nos dois, o que é a prova de equivalência. E um defeito plantado numa política de
trava é acusado. Esses mesmos casos são o critério de aceite da implementação Node.

**Removido:** `limparTodasProperties()` (Setup.gs). Apagava o store inteiro atrás de uma
confirmação por `SpreadsheetApp.getUi()`, que num projeto standalone lança erro antes de
perguntar — nunca funcionou.

**Publicada em 24/09**, com `verificarProperties`, `testarConexaoOdoo` e `configurarSegredoWebhook`
no editor e menu + devolução pelo WhatsApp — todos pela fachada, no Apps Script de verdade.

#### O desenho original

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

### Fase 2 — Runtime Node em paralelo, sem tráfego (2–3 dias) · ✅ no ar, sem tráfego, provada com as APIs reais (25/09)

#### Como ficou

O runtime Node roda os 27 `.gs` de produção **sem mudar uma linha deles**, e a
`ferramentas/prova-runtime.mjs` (agora no `verificar-tudo`) prova isso de ponta a ponta: uma
mensagem entra pelo `/webhook`, passa pelo Router, pede o dízimo, manda a foto do comprovante —
e a devolução de R$ 50 é gravada no Odoo, com a confirmação enviada pelo WhatsApp. Odoo,
WhatsApp e Vision são falsos, em 127.0.0.1; todo o resto é o de verdade.

```
servidor/
  index.mjs                  servidor HTTP (node:http), fila, worker threads; PAPEL=local
  processador.mjs            a worker thread onde os .gs rodam — aqui bloquear é legítimo
  es.mjs                     a thread de E/S da ponte síncrona
  carregador.mjs             quais .gs carregar (os do .claspignore) e o contexto de cada execução
  plataforma/
    index.mjs                a Plataforma Node — mesma interface do Plataforma.gs
    http.mjs                 o UrlFetchApp, síncrono: multipart, binário, muteHttpExceptions
    relogio.mjs              os padrões Java do formatDate traduzidos; dormir com Atomics.wait
    bytes.mjs                base64, Blob, uuid
    armazenamento-memoria.mjs   cache/propriedades/trava para local e teste
    armazenamento-upstash.mjs   os mesmos, no Redis da Upstash, pela API REST
Dockerfile · .dockerignore
```

**Quatro decisões que mudaram o plano, cada uma medida antes de adotada:**

1. **Um contexto `vm` novo por execução.** Custa ~1 ms (medido: 27 arquivos, 1,1 ms). Com isso o
   runtime reproduz o Apps Script — cada mensagem começa do zero — e o **vazamento de estado entre
   requisições**, o risco mais sério que a revisão de 24/09 achou, **deixa de existir por
   construção**: `Utils._mensagemAtualId`, os contadores do BL-25 e os caches do OdooService
   morrem com a execução. A prova planta o vazamento e confere que ele não passa.
2. **Sem `sync-fetch`.** A ponte síncrona é própria, com `worker_threads`: o processador manda o
   pedido a uma thread de E/S e dorme em `Atomics.wait`; ela faz o `fetch` e o acorda. Provado com
   JSON, **multipart com arquivo** (o upload do MediaService — o risco nº 1 do plano) e resposta
   binária. **Zero dependências**: não há `package.json`.
3. **Upstash pela API REST**, pela mesma ponte. Sem cliente Redis, sem conexão para cuidar.
4. **`node:http` em vez de Fastify**, pelo mesmo motivo: nada para instalar nem auditar.

**Como rodar na sua máquina:**

```bash
node ferramentas/prova-runtime.mjs
```

Ou o servidor, com as credenciais em variáveis de ambiente (as de `CHAVES_DE_CONFIG`, em
`servidor/plataforma/index.mjs`) e `CRON_TOKEN` para os agendamentos:

```bash
node servidor/index.mjs
```

**O critério de aceite, reinterpretado.** "O `conta-mensagens.js` roda contra o runtime Node" não
faz sentido literal: aquele harness *simula* o `CacheService` e o `PropertiesService` para
controlar cada cenário, e no Node eles não existem. O equivalente é a `prova-runtime.mjs`, que
exercita o **contrato** da Plataforma Node e o fluxo inteiro. E "base Odoo descartável" não
existe no plano gratuito — são servidores falsos que falam JSON-RPC.

**Provado na nuvem em 25/09.** Serviço `meu-dizimo-runtime` no Cloud Run (`southamerica-east1`),
privado, sem tráfego, publicado pelo workflow `deploy-runtime.yml` (à mão, sem chave, com o harness
antes). Um "oi" simulado do número do dono entrou pelo `/webhook` e o menu chegou no WhatsApp:
Cloud Run → Odoo real → Upstash real → WhatsApp real. O Dockerfile construiu na primeira.

Os tropeços, para a próxima vez:
- `--set-env-vars` e `--update-env-vars` são mutuamente exclusivos no gcloud (sai com código 2);
- um segredo criado sem o *binding* de `secretAccessor` derruba o deploy — o `&&` do comando
  combinado pulou o binding quando o `create` falhou por o segredo já existir;
- um `WHATSAPP_TOKEN` colado errado no Secret Manager dá **190 / Cannot parse access token**.
  Conferir cada segredo contra a API dele antes do deploy (comandos na conversa de 25/09);
- no Brasil, o WhatsApp manda o número **sem o nono dígito** (12 dígitos). O teste com 13 dígitos
  criou um `x_contato_bot` de lixo no Odoo de produção (id 27) — a apagar à mão;
- no Cloud Shell, `gcloud run services proxy` foi mais confiável que o `print-identity-token`.

**O que ainda não foi exercitado na nuvem:** o comprovante (Vision + gravação de devolução) e os
agendamentos. A chave do Vision foi conferida contra a API; o caminho inteiro fica para quando
houver fila (Fase 3).

**Antes do corte (Fase 5), um passo que nenhuma fase listava:** copiar as propriedades MUTÁVEIS
do Apps Script (`FLOW_CADASTRO_ATIVO`, `FLOW_MODO_CADASTRO`, `sessao_ativa_*`, bloqueios…) para o
Upstash. Hoje o runtime Node sobe com elas vazias.

#### O desenho original

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

### Fase 3 — Fila, estado e trava por usuário (3–4 dias) · fecha BL-20 e BL-21 · ✅ no ar, sem tráfego, provada na nuvem (25/09)

#### Como ficou

| Peça | Onde |
|---|---|
| Webhook público: autentica, enfileira, responde em ms | `PAPEL=webhook` em `servidor/index.mjs` + `servidor/fila.mjs` |
| Fila: Cloud Tasks pela API REST, token dos metadados, sem biblioteca | `servidor/fila.mjs` |
| Worker privado: roda os `.gs`, uma mensagem por vez **por pessoa** | `PAPEL=worker` + `servidor/processador.mjs` |
| Contadores do BL-25 atômicos (HINCRBY) | `Plataforma.contador` — nos dois runtimes |
| Dois serviços, uma imagem | `.github/workflows/deploy-runtime.yml` |

**A trava por pessoa, e por que ela devolve 503.** O worker pega a trava de cada remetente da
mensagem antes de rodar o `doPost`. Se outra mensagem da mesma pessoa estiver em processamento,
responde **503** e o Cloud Tasks tenta de novo com espera crescente — a fila faz a espera, sem
thread bloqueada. Pessoas diferentes nunca se esperam. **Provado:** duas respostas simultâneas no
passo do nome, com dois processadores, gravam `nome` e `nomeUsual`; **sem a trava, o mesmo teste
perde o apelido em 3 de 3 rodadas** — o BL-20 de hoje, reproduzido e fechado.

**Idempotência pela fila.** Nome da tarefa = SHA-256 do corpo do POST. A reentrega da Meta traz o
mesmo corpo, e o Cloud Tasks recusa (409). A dedup por cache do BL-78 continua de pé, como segunda
camada.

**Uma melhoria que o plano não previa:** com a fila, se o enfileiramento falhar o webhook responde
**500** — e a Meta reenvia. No Apps Script, uma falha ali era mensagem perdida.

**Critério de aceite, reinterpretado.** A `simula-carga.js` dispara contra uma URL com Odoo real.
O cenário dela — o modo `corrida` — está na `prova-runtime.mjs`, parte 4, contra o webhook, uma
fila falsa com a política de nova tentativa e o worker de verdade.

**Provada na nuvem em 25/09.** Deploy #4 publicou `meu-dizimo-worker` e `meu-dizimo-webhook`; a fila
`mensagens` (southamerica-east1) tenta de novo por até 15 min, com espera de 1 a 10 s. Um "oi"
simulado entrou pelo webhook, respondeu `OK` na hora, passou pelo Cloud Tasks e o worker mandou o
menu pelo WhatsApp. Contas: `meu-dizimo-webhook` (só o segredo do webhook + enfileirar),
`meu-dizimo-invocador` (`run.invoker` no worker). O serviço `meu-dizimo-runtime` da Fase 2 foi
apagado.

**O que a Fase 3 NÃO muda:** ninguém é atendido pelo Cloud Run ainda. Os dois serviços nascem
privados; a Meta segue no Apps Script até a Fase 5.

#### O desenho original

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

### Fase 4 — Agendamentos (1 dia) · ✅ jobs criados PAUSADOS e caminho provado (25/09)

#### Como ficou

Nenhuma linha de código: o worker já tinha `/cron/<função>` desde a Fase 3 (protegido pelo IAM,
só as duas funções da lista). Dois jobs no Cloud Scheduler, em `southamerica-east1`, com token OIDC
da conta `meu-dizimo-invocador`, **sem nova tentativa**:

| Job | Quando | Chama | Por quê |
|---|---|---|---|
| `lembretes` | minuto 5 de toda hora | `executarNotificacoesDiarias` | sem retry: a repescagem do degrau seguinte cobre, e repetir poderia duplicar |
| `sessoes` | **a cada 10 min** (era 5) | `verificarSessoesAbandonadas` | ver abaixo |

**Por que 10 minutos nas sessões.** O aviso "você ainda está aí?" sai quando a sessão tem entre
50 e 60 min — uma janela de 10. Com o job a cada 10, ele cai nela toda vez; a cada 15, pularia
1 sessão em cada 3 (ex.: execuções aos 49 e aos 64 min); a cada 5 é gastar sem ganho. E gastar
importa: esse job era o **maior consumidor de comandos do Upstash** (~45 mil/mês a cada 5 min).

**Os dois nasceram pausados**, e o worker tem `NOTIFICACOES_ATIVAS=false`: proteção dupla contra o
lembrete em dobro. **Provado em 25/09:** retomar → executar → pausar os `lembretes`; o log do worker
mostrou `INÍCIO da rotina — 10:55:20 (America/Sao_Paulo)` — o fuso certo no Cloud Run — e
`Notificações desativadas — encerrando`. Job pausado não aceita `run`: é preciso retomar antes.

**Para a Fase 6:** a conferência da cota de chamadas externas (`UrlFetch`) é um limite do Apps
Script — no Cloud Run vira ruído no log. A contagem de mensagens da Meta continua útil.

#### O desenho original

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

### Fase 5 — Corte (1 dia + uma semana de observação) · ✅ corte executado em 25/09 — em observação até 02/10

#### O corte, como aconteceu (25/09)

Seguido o `ROTEIRO-CORTE.md`, à tarde (o bot ainda está em desenvolvimento, sem dizimistas reais):
webhook aberto (`CORTE-OK`), 18 propriedades importadas, URL trocada na Meta, acionadores do Apps
Script removidos, `NOTIFICACOES_ATIVAS=true` no Upstash, `lembretes` e `sessoes` ENABLED.

**Provado em produção:**
- mensagem real → webhook → fila → worker → menu; callbacks `sent → delivered → read` voltam; partida a frio ~2 s;
- **devolução com comprovante** (Vision + gravação no Odoo) — o último caminho que não tinha rodado na nuvem;
- **lembretes (26/09):** o disparo das 9:05 pulou quem o Apps Script já tinha notificado — lendo o
  `x_notificacao_log` que ele gravou. A troca de plataforma não repete lembrete. Às 10:05, o
  primeiro envio real pelo Cloud Run (template entregue, log gravado no Odoo);
- **fuso** `America/Sao_Paulo` no arranque do worker e na janela dos lembretes (7h e 8h fora, 9h dentro);
- **BL-17:** as regras de registro do Odoo não bloqueiam o uid 13 — leu `x_contato_bot` e `x_dizimista` em produção.

**Achado na importação:** ela substitui, não soma. As mensagens contadas pelo Cloud Run antes do
corte foram sobrescritas pelo número do Apps Script (~1,6% de setembro; some na virada do mês).

**Para a Fase 6:** o telefone completo vai para o Cloud Logging (`📱 Mensagem de …`) — resolver com
o log estruturado; e o `VERIFY_TOKEN` foi exposto em chat — rotacionar junto com o `WEBHOOK_SECRET`.

#### Preparação 1 de 3: a assinatura da Meta (HMAC) · ✅ código pronto (25/09)

O webhook público agora aceita **só** o POST com `X-Hub-Signature-256` válido: HMAC-SHA256 dos
**bytes crus** do corpo com o App Secret (`META_APP_SECRET`), comparado em tempo constante. O
`?token=` da URL não é mais aceito ali — ele aparecia nos logs de requisição do Cloud Run e já
tinha vazado. O `WEBHOOK_SECRET` continua existindo **só entre o worker e os `.gs`** (o `doPost`
ainda o confere), sem trafegar pela internet — e por isso trocá-lo passa a ser trivial.

**401, não 200.** O Apps Script respondia `Forbidden` com 200, e a Meta não reenvia o que recebe
com 200. Com 401, se o App Secret estiver errado no dia do corte, **nenhuma mensagem se perde**: a
Meta continua tentando, e elas chegam quando o segredo for corrigido.

**Provado** na `prova-runtime.mjs`: sem assinatura, com segredo errado, com a assinatura de OUTRO
corpo (adulterado) e só com o `?token=` antigo → os quatro levam 401 e nada entra na fila. Com a
verificação desligada de propósito, os quatro passam e duas tarefas forjadas entram — o teste pega.

**Validar o App Secret antes do corte** é possível sem a Meta mandar nada: pedir um token de app
com ele (`oauth/access_token?grant_type=client_credentials`). Segredo certo devolve um token.

#### Preparação 2 de 3: as propriedades do Apps Script no Upstash · ✅ código pronto (25/09)

Duas peças, e o roteiro do corte as usa em sequência:

1. **`exportarPropriedadesParaMigracao()`** (Setup.gs), rodada no editor NO MOMENTO DO CORTE:
   imprime numa linha de JSON as chaves ligadas/desligadas (`FLOW_*`, `CADASTRO_CONVERSA_ATIVO`…), as
   sessões de cadastro em andamento, os bloqueios, os contadores do mês e os ids de mídia.
2. **`ferramentas/importar-propriedades.mjs`**: lê esse JSON e grava no hash `p` do Upstash.
   **Simula por padrão**; com `--aplicar`, grava e confere lendo de volta.

**O que não migra, nas duas pontas — e o harness confere que as listas são iguais:** os segredos
(vêm do Secret Manager; e o log do editor não é lugar para eles), a configuração fixa (vem das
variáveis do deploy) e o **`NOTIFICACOES_ATIVAS`**. No runtime novo, o valor gravado vence a
variável de ambiente: importar um `true` ligaria os lembretes no Cloud Run antes do corte, com o
Apps Script ainda lembrando. Ele é ligado num passo próprio do roteiro. A ferramenta **recusa**, sem
gravar nada, um arquivo que traga qualquer um deles.

**O que não migra de propósito:** o estado das conversas (`estado_*`, `dados_*`) vive no cache do
Apps Script, que não se lista. Quem estiver no meio de uma conversa na hora do corte volta ao
menu — por isso o corte é de madrugada.

#### Preparação 3 de 3: o roteiro do corte, com a volta · ✅ pronto (25/09)

Em **[ROTEIRO-CORTE.md](ROTEIRO-CORTE.md)**: véspera, hora H em 5 passos (abrir o webhook, levar
as propriedades, trocar a URL na Meta, provar com mensagem real, trocar os agendamentos — nunca os
dois ligados), a semana de observação e a volta em ~2 min.

**Antes de escrever o roteiro, as duas confirmações que decidem se o corte recusa tudo:**
- **HMAC** pela nuvem: sem assinatura → 401; assinado → `OK` e o menu chegou (25/09).
- **App Secret** conferido na própria Meta (`oauth/access_token … client_credentials` devolveu
  token): o segredo guardado é o do app certo (25/09).

- **Assinatura HMAC de verdade.** Hoje o webhook autentica por segredo na query string
  (`?token=…`) porque **o Apps Script não dá acesso aos headers**. No Cloud Run dá: passa a
  validar o `X-Hub-Signature-256` que a Meta manda em todo POST, com o App Secret. Efeito
  colateral bom: o `WEBHOOK_SECRET` que ficou sem rotacionar deixa de existir como conceito.
- Trocar a URL do callback na Meta.
- **O Apps Script fica de pé, sem tráfego, por uma semana.** Rollback é trocar a URL de volta —
  um campo, efeito imediato.

**Critério de aceite:** 7 dias sem incidente, incluindo pelo menos um ciclo de notificação
completo.

### Fase 6 — Observabilidade e limpeza (2 dias) · 🔶 em andamento

**26/09: o Apps Script foi deixado de lado** por decisão do dono, sem esperar os 7 dias (o bot
ainda não atende dizimistas reais). A volta pelo Apps Script deixou de ser plano.

- ✅ **Deploy automático a cada merge na `staging`** (26/09). Merge só de documentação não publica;
  o botão manual continua para republicar sem commit (depois de trocar um segredo). Publicar da
  `main` foi **proibido**: ela anda atrás, e publicar dela voltaria código velho ao ar.
- Trocar o `NOTIFICACOES_ATIVAS=false` do workflow por `true` — hoje quem manda é o valor no Upstash.
- Rotacionar `WEBHOOK_SECRET` e `VERIFY_TOKEN` (expostos em chat).
- Um lugar para as funções que se rodavam no editor (`verificarProperties`, `testarConexaoOdoo`,
  `podarContadores`, `listarNotificacoesDoDia`, `previsaoEscalonamento`…): o `/cron` só aceita as
  duas agendadas.
- Alerta de taxa de erro e uptime check no endpoint (`/saude`).
- Log estruturado em JSON — o Cloud Logging indexa e dá busca de verdade, em vez de rolar texto.
- Remover a implementação GAS da `Plataforma`; o carregador `vm` pode virar import de módulo
  (opcional, e sem pressa).
- Aposentar `clasp`, `.claspignore` e `appsscript.json`. ⚠️ **Não é só apagar:** o carregador do
  runtime lê a lista de arquivos do `.claspignore` (`arquivosDoDeploy`) e o fuso do
  `appsscript.json` (`fusoDoProjeto`). Trocar essas duas fontes antes.

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
