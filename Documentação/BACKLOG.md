# Backlog — Bot Meu Dízimo (meu-dizimo-aparecida)

**Criado em:** 14/09/2026
**Base:** revisão do código-fonte `.gs` (ver [ANALISE-GERAL.md](ANALISE-GERAL.md)) + análise de concorrência/carga.
**Atualizado em:** 14/09/2026 — adicionados BL-26 e refino do BL-14 a partir de uma **simulação real** (cadastro + devolução) capturada do WhatsApp.
**Progresso:** Sprint 1 (BL-02, BL-14, BL-26) e Sprint 2 (BL-05, BL-06, BL-07, BL-08, BL-10, BL-20) concluídas na `main`. Pendências principais: BL-01 (notificações) após mitigações de carga, BL-09, BL-11 e itens de robustez/manutenção. ⚠️ As correções só valem no bot após `clasp push` + republicação do deployment (ver observação no fim).
**Como usar:** cada item tem um ID (`BL-NN`), severidade, esforço estimado, arquivo(s), proposta de correção e critério de aceite. Priorize de cima para baixo.

## Legenda

| Severidade | Significado |
|---|---|
| 🔴 Crítica | Quebra função essencial ou corrompe dado financeiro / confiança do usuário |
| 🟠 Média | Falha em cenário comum ou degrada a experiência |
| 🟡 Baixa | Manutenção, cosmético ou risco apenas latente |

**Esforço:** P = pequeno (< 1h) · M = médio (algumas horas) · G = grande (≥ 1 dia).

---

## Tabela-resumo

| ID | Título | Sev. | Esforço | Status |
|----|--------|------|---------|--------|
| BL-01 | Notificações mensais quebradas (`OdooService.executar` inexistente) | 🔴 | M | Aberto |
| BL-02 | Confirmação falsa de devolução quando registro no Odoo falha | 🔴 | P | ✅ Concluído |
| BL-03 | Sessão promete 60 min mas expira em 15 (valores de teste) | 🔴 | P | ✅ Concluído (60 min; aviso em 50) |
| BL-04 | Lista de comunidades estoura limite de 10 rows do WhatsApp | 🔴 | P | ✅ Concluído (paginação "Ver mais") |
| BL-26 | Comprovante não é validado contra a chave PIX/destinatário da comunidade | 🔴 | M | ✅ Concluído |
| BL-05 | Devoluções do bot podem não aparecer em "Pendentes" (comunidade não gravada) | 🟠 | P | ✅ Fechado — `x_studio_comunidade` é related de `x_studio_dizimista.x_studio_comunidade` (stored/readonly); confirmado no schema e em produção |
| BL-06 | Parse de valor mensal quebra com separador de milhar | 🟠 | P | ✅ Concluído |
| BL-07 | `AGUARDANDO_COMPROVANTE` setado mesmo sem dados de pagamento | 🟠 | P | ✅ Concluído |
| BL-08 | Validação de data de nascimento aceita datas impossíveis/futuras | 🟠 | P | ✅ Concluído |
| BL-09 | Webhook processa só a 1ª mensagem do lote | 🟠 | M | Aberto |
| BL-10 | Atalhos globais (menu/0/rel) abortam o cadastro sem confirmação | 🟠 | P | ✅ Concluído |
| BL-11 | Payload PIX (BR Code) com tag 54 inválida, dados fixos e vazamento a terceiro | 🟠 | M | Aberto |
| BL-12 | `ASSETS` não declarado — `getAvatar()` sempre falha | 🟡 | P | Aberto |
| BL-13 | Dados da secretaria com placeholder em produção | 🟡 | P | Aberto |
| BL-14 | Extração frágil de valor e chave PIX do OCR (chave = fragmento do ID da transação) | 🟠 | M | ✅ Concluído |
| BL-15 | Efeito colateral: busca de dizimista atualiza telefone no Odoo | 🟡 | P | Aberto |
| BL-16 | Separar arquivos de teste do deploy de produção | 🟡 | M | Aberto |
| BL-17 | Segurança: uid Odoo dedicado + `WEBHOOK_SECRET` obrigatório | 🟡 | M | Aberto |
| **Concorrência / carga** | | | | |
| BL-20 | Race condition por usuário em `dados_`/`estado_` (sem lock) | 🟠 | M | ✅ Concluído (mitigação) |
| BL-21 | Teto de ~30 execuções simultâneas compartilhado por todos os usuários | 🟠 | G | Aberto |
| BL-22 | Lock global de `sessoes_cadastro_ativas` é gargalo sob contenção | 🟡 | M | Aberto |
| BL-23 | Duplicação de `x_contato_bot` em primeiro contato simultâneo | 🟡 | P | Aberto |
| BL-24 | Sem retry/backoff em 429/5xx (WhatsApp, Odoo, Vision) | 🟡 | M | Aberto |
| BL-25 | Cota diária de UrlFetch pode limitar volume total | 🟡 | P | Aberto — monitorar |

---

## Itens críticos

### BL-01 — Notificações mensais quebradas 🔴 (M)
**Arquivo:** `NotificacaoHandler.gs` (linhas 148, 197, 215, 242) · `OdooService.gs`
**Problema:** chama `OdooService.executar(...)`, método que não existe (o serviço só expõe `searchRead`, `create`, `write`, `_rpc`). `executarNotificacoesDiarias()` lança `TypeError`. Além disso: filtro por `x_studio_date` (linha 220) em vez de `x_studio_data_da_devolucao`; e `processarRespostaNotificacao` (259) chama `DevolucaoHandler.iniciar` (real: `iniciarDevolucao`) e `HistoricoHandler.mostrar` (inexistente).
**Correção:** reescrever as chamadas usando `searchRead`/`create`; para `search_count`, adicionar um método `count(model, domain)` em `OdooService`. Corrigir o nome do campo de data. Remover ou corrigir `processarRespostaNotificacao`.
**Aceite:** `executarNotificacoesDiarias()` roda sem erro; um dizimista elegível recebe o template; log gravado em `x_notificacao_log`; quem já devolveu no mês não é notificado.

### BL-02 — Confirmação falsa de devolução 🔴 (P)
**Arquivo:** `ComprovanteHandler.gs:225-262`
**Problema:** se o dizimista não é encontrado, apenas loga (não avisa, não registra). Em todos os caminhos (inclusive o `catch`) envia "✅ Comprovante recebido com sucesso! Sua devolução foi registrada". No `catch`, o usuário recebe erro **e** sucesso.
**Correção:** só enviar a confirmação de sucesso quando `devolucaoId` for realmente retornado. Se dizimista nulo → mensagem orientando a se cadastrar/contatar secretaria. Em exceção → apenas a mensagem de falha (remover o sucesso duplicado). Registrar métrica/alerta para a secretaria.
**Aceite:** dizimista inexistente ou erro no Odoo ⇒ usuário recebe **somente** aviso de falha; nunca "registrada" sem registro real.

### BL-03 — Janela de sessão inconsistente 🔴 (P)
**Arquivo:** `TriggerSessoes.gs:62,70,132,135` · `StateManager.gs:163,178`
**Problema:** trigger limpa sessão com ≥15 min e avisa com ≥10; textos ao usuário prometem 60 min; comentários citam 20/50 min. Valores de teste em produção.
**Correção:** definir a janela real desejada (ex.: 60 min) numa constante única e derivar todos os limiares dela (aviso em ~50 min, limpeza em ~60). Alinhar `everyMinutes` e os textos. Corrigir comentários.
**Aceite:** um usuário que leve ~55 min no cadastro recebe o aviso e, ao clicar "continuar", mantém a sessão; nada é limpo antes do tempo prometido.

### BL-04 — Lista de comunidades > 10 rows 🔴 (P)
**Arquivo:** `CadastroHandler.gs:80-93`
**Problema:** monta rows com todas as comunidades (até 50). WhatsApp aceita no máximo 10 → chamada falha com 11+, usuário trava.
**Correção:** paginar (seções ou "ver mais") ou, no mínimo, `slice(0,10)` como o RelatorioHandler — mas paginação é o ideal para não ocultar comunidades. Considerar busca por texto se a lista crescer.
**Aceite:** com ≥11 comunidades cadastradas, o usuário consegue selecionar qualquer uma.

### BL-26 — Comprovante não validado contra o destinatário correto 🔴 (M) — **descoberto em simulação real**
**Arquivo:** `VisionService.gs:300` (`validarComprovante`) · `ComprovanteHandler.gs` · `DevolucaoHandler.gs`
**Problema:** o bot aceita qualquer comprovante que "pareça" um pagamento — nunca confere se ele foi feito para a chave PIX da comunidade. Na simulação (cadastro + devolução real), o bot instruiu pagar para **Inter / Daniel Fernandes Silva / `037.756.033-12`**, mas o comprovante enviado era para **Caixa / Marlize Ferreira Rodrigues De Sousa / `160.740.093-68`** — destinatário, banco e chave totalmente diferentes — e ainda assim foi registrado como "devolução recebida com sucesso". `validarComprovante` só soma pontos por *presença* de valor/data/tipo/palavras-chave; não há checagem de destino. Na prática, qualquer comprovante de terceiros, antigo ou de valor simbólico é aceito como dízimo (vetor de fraude/erro).
**Correção:** ao validar, comparar a chave PIX (e, se possível, nome/instituição do recebedor) extraída do comprovante com a `x_studio_chave_pix`/titular da comunidade do dizimista. Se não bater: **não** confirmar automaticamente — marcar a devolução para revisão manual (status pendente + aviso claro ao usuário de que será conferida), em vez de dizer "registrada com sucesso". Depende de BL-14 (extração confiável da chave). Considerar também validar a data (recente) e alertar divergências grosseiras.
**Aceite:** um comprovante cuja chave de destino ≠ chave da comunidade não é confirmado como sucesso; cai em revisão manual com mensagem honesta ao usuário.

---

## Itens médios

### BL-05 — Comunidade não gravada na devolução 🟠 (P) — **verificar no Odoo**
**Arquivo:** `OdooService.gs:333` (`registrarDevolucao`) vs `:406` (`buscarDevolucoesPendentes`)
**Problema:** `registrarDevolucao` não grava `x_studio_comunidade`, mas a busca de pendentes filtra por esse campo. Se ele não for *related/stored* (derivado do dizimista) no Odoo Studio, o coordenador verá sempre "nenhuma pendente" e as baixas nunca ocorrem.
**Ação:** confirmar no Odoo se `x_devolucao.x_studio_comunidade` é computado a partir do dizimista. Se **não** for: gravar a comunidade no `registrarDevolucao` (buscar do dizimista) **ou** tornar o campo related/stored.
**Aceite:** uma devolução criada pelo bot aparece na lista de pendentes da comunidade correta.

### BL-06 — Parse de valor com milhar 🟠 (P)
**Arquivo:** `CadastroHandler.gs:190`
**Problema:** `"1.000,50"` → `parseFloat("1.000.50")` → `1`. `VisionService._extrairValor` já trata milhar corretamente — inconsistência.
**Correção:** remover separador de milhar antes do decimal: `.replace(/\./g,'').replace(',', '.')` (ou reusar a lógica do VisionService). Validar limites razoáveis.
**Aceite:** `1.000,50` vira `1000.5`; `50` e `50,00` seguem corretos.

### BL-07 — Estado setado sem dados de pagamento 🟠 (P)
**Arquivo:** `DevolucaoHandler.gs:65-75`
**Problema:** `_enviarDadosPagamento` retorna cedo quando não há PIX, mas `setEstado(AGUARDANDO_COMPROVANTE)` roda sempre depois.
**Correção:** `_enviarDadosPagamento` retornar boolean; só setar o estado se enviou os dados com sucesso.
**Aceite:** comunidade sem PIX ⇒ usuário recebe erro e **não** fica em `AGUARDANDO_COMPROVANTE`.

### BL-08 — Data de nascimento inválida aceita 🟠 (P)
**Arquivo:** `CadastroHandler.gs:142-160`
**Problema:** valida só faixa de dia/mês; aceita `31/02/2050`.
**Correção:** validar data real (construir `Date` e conferir dia/mês/ano de volta) e rejeitar datas futuras e anos implausíveis.
**Aceite:** `31/02/2050` e datas futuras são recusadas com mensagem clara.

### BL-09 — Webhook processa só a 1ª mensagem 🟠 (M)
**Arquivo:** `Webhook.gs:69`
**Problema:** lê `messages?.[0]`; a Meta pode agrupar várias entradas/mensagens num POST — as demais somem sem log.
**Correção:** iterar `entry[] → changes[] → messages[]`, aplicando idempotência por `messageId` a cada uma.
**Aceite:** um POST com 2 mensagens resulta em 2 processamentos.

### BL-10 — Atalhos globais abortam cadastro 🟠 (P)
**Arquivo:** `Router.gs:185-199` · `Config.gs:100-108`
**Problema:** durante o cadastro, `menu`/`0`/`rel` descartam os dados sem confirmação (ex.: apelido "Rel").
**Correção:** não aplicar os atalhos durante `ESTADOS_CADASTRO` (como já se faz para os estados de relatório), ou pedir confirmação antes de descartar.
**Aceite:** digitar "Rel" no campo de apelido salva o apelido, não abre o relatório.

### BL-11 — Payload PIX (BR Code) 🟠 (M)
**Arquivo:** `MediaService.gs:259-317`
**Problema:** tag `54` com length `00` quando valor vazio (EMV inválido); nome/cidade fixos no código; QR gerado via `api.qrserver.com` (terceiro sem SLA + envio da chave PIX e valor para fora).
**Correção:** omitir a tag 54 quando não houver valor; puxar nome/cidade de parâmetros do Odoo; avaliar gerar o QR localmente (evita dependência externa e vazamento).
**Aceite:** BR Code válido com e sem valor; sem chamada a serviço externo com dado sensível.

---

## Itens baixos / manutenção

### BL-12 — `ASSETS` não declarado 🟡 (P)
`Assets.gs:23` usa `ASSETS.AVATAR_DRIVE_ID`, nunca definido → `getAvatar()` sempre cai no catch. Definir o objeto `ASSETS` ou remover a função (boas-vindas usa avatar do Odoo).

### BL-13 — Secretaria com placeholder 🟡 (P)
`MenuHandler.gs:52-53` mostra `(00) 0000-0000` / `secretaria@exemplo.com`. Buscar de `OdooService.buscarParametros()` (`x_studio_secretaria_whatsapp`, `x_studio_secretaria_email`).

### BL-14 — Extração frágil de valor e chave PIX do OCR 🟠 (M) — *refinado por simulação*
`VisionService.gs:218-272`. Dois problemas confirmados na simulação real:
- **Valor:** `_extrairValor` retorna o primeiro `R$` encontrado, que pode ser tarifa/saldo, não o valor transferido.
- **Chave PIX:** `_extrairChavePix` retornou `4339441920260` — que **não é uma chave**, mas os 13 primeiros dígitos do *ID da transação* (`E**4339441920260**4052103uuGZ7BZQ3g5`). O padrão de telefone (primeiro do array) casa com o trecho numérico do ID antes de chegar à chave real (`160.740.093-68`). Isso grava dado enganoso no Odoo e inviabiliza o BL-26.
**Correção:** melhorar heurística de valor (proximidade de "valor"/"total"/"pix", maior valor, contexto) e de chave (ignorar sequências dentro do "ID da transação"/"identificador"; priorizar padrões ancorados por rótulo "Chave Pix:"; reordenar padrões para não deixar telefone capturar IDs). Elevada de 🟡 para 🟠 por bloquear a validação do BL-26.

### BL-15 — Efeito colateral em busca 🟡 (P)
`OdooService.gs:171` — `buscarDizimistaPorWhatsapp` grava telefone no Odoo dentro de uma leitura. Extrair a atualização para o chamador ou documentar explicitamente.

### BL-16 — Testes no deploy de produção 🟡 (M)
`Tests.gs` (~175 KB), `TestesComprovantes.gs` (~93 KB, com base64), `TesteRelatorio.gs` (~34 KB) somam a maior parte do que o clasp envia. Mover para um projeto GAS separado ou excluir do push.

### BL-17 — Endurecer segurança 🟡 (M)
Usuário Odoo dedicado (não uid 2/admin) com acesso restrito aos modelos `x_*`; tornar `WEBHOOK_SECRET` obrigatório após o setup (hoje o webhook aceita POST anônimo se o segredo não estiver configurado — `Webhook.gs:57-65`).

---

## Análise de concorrência e carga

### Modelo de execução (fatos do projeto)
- **Deploy:** `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS` (`appsscript.json`). Consequência central: **todas** as execuções do webhook rodam como o **mesmo** usuário (o dono do deploy) e **compartilham um único pool** de execuções simultâneas e as mesmas cotas de projeto — não há isolamento por usuário do WhatsApp.
- **Estado:** `CacheService` por usuário (`estado_${from}`, `dados_${from}`) + uma chave **global** `sessoes_cadastro_ativas`. Persistência final em Odoo.
- **Trabalho por mensagem:** de 1 (texto simples) a ~6-8 chamadas externas (fluxo de comprovante: baixar mídia + Vision + buscar dizimista + criar devolução + envios WhatsApp), com ~7s de `Utilities.sleep` de UX.

### Cotas relevantes do Apps Script *(aproximadas — variam por tipo de conta e mudam com o tempo; confirmar no painel de cotas)*
| Recurso | Ordem de grandeza | Efeito ao estourar |
|---|---|---|
| Execuções simultâneas | ~30 (por usuário → aqui, global) | Excedentes falham ("too many simultaneous invocations") |
| Tempo por execução | 6 min | Execução abortada |
| `UrlFetch`/dia | ~20 mil (grátis) / ~100 mil (Workspace) | Bloqueio de chamadas externas no dia |
| Tempo total de trigger/dia | ~90 min (grátis) | Trigger para de rodar |

### Como a aplicação se comporta sob muitos acessos simultâneos

1. **Teto de ~30 execuções simultâneas (BL-21).** Como todas as mensagens compartilham o pool do dono do deploy, um pico acima de ~30 mensagens *no mesmo instante* faz os excedentes falharem no webhook → a Meta recebe não-200 e **reenvia** depois. Efeito prático: sob rajada, os usuários sentem **lentidão**, não perda (a Meta faz retry), mas há um ponto de saturação real.

2. **Race condition por usuário (BL-20) — o risco mais concreto.** Estado e dados temporários são lidos-modificados-gravados **sem lock** (`getDadosTemporarios` → altera → `setDadosTemporarios`, em `StateManager` e nos helpers `salvarMultiplosCampos`/`salvarCampoEMudarEstado`). Se o **mesmo** usuário emitir duas mensagens quase juntas (ou a Meta entregar um lote / retries concorrentes), duas execuções podem sobrescrever os dados uma da outra → **campo de cadastro perdido** ou estado inconsistente. A idempotência do webhook protege contra reprocessar a *mesma* messageId, mas **não** contra duas mensagens diferentes do mesmo usuário em paralelo.

3. **Gargalo do lock global (BL-22).** `registrarSessaoAtiva`/`removerSessaoAtiva` usam `LockService.getScriptLock()` (lock **global**, não por usuário) com `waitLock(5000)`. Sob muitos cadastros simultâneos, todos disputam o mesmo lock; alguns podem estourar os 5s e **não registrar/remover** a sessão (apenas warning). Impacto: sessões órfãs na lista ou não rastreadas para limpeza — degradação, não corrupção de dado do usuário.

4. **Duplicação em primeiro contato (BL-23).** Se um usuário novo manda 2 mensagens simultâneas, ambas as execuções podem não achar o `x_contato_bot`, **criar dois registros** e mandar boas-vindas em duplicidade (o cache anti-duplicação é gravado só depois).

5. **Odoo Online é o verdadeiro teto de escala.** Cada mensagem gera várias chamadas JSON-RPC (com uid 2). O Odoo SaaS tem workers limitados; uma rajada satura os workers → respostas lentas → execuções do GAS ficam mais longas → o pool de ~30 esgota mais rápido → mais retries da Meta → **efeito cascata (retry storm)**. É aqui que o sistema "cai de joelhos" antes de qualquer cota do Google.

6. **Cenário que dispara o pico:** o *disparo de lembretes mensais* (quando BL-01 for corrigido) envia para muitos de uma vez; boa parte responde nos minutos seguintes → rajada concentrada. Também: avisos de evento/campanha. No uso cotidiano de uma paróquia (mensagens esparsas), a simultaneidade real raramente passa de um punhado — então **no dia a dia o comportamento é adequado**; o risco mora nos picos concentrados.

7. **Sem retry/backoff (BL-24).** `Utils._post` loga falha de WhatsApp (429/janela 24h) mas não reenvia; Odoo/Vision idem. Sob throttling, mensagens são perdidas silenciosamente para o usuário (só ficam no log).

### Itens de backlog derivados

### BL-20 — Lock por usuário no estado/dados 🟠 (M)
Proteger o read-modify-write de `dados_${from}`/`estado_${from}` com `LockService.getScriptLock()` chaveado logicamente por usuário (ou serializar por `from`), evitando lost update quando o mesmo usuário envia mensagens concorrentes. Alternativa: usar `getUserLock()` — mas como o execute-as é único, avaliar um lock curto por chave. Aceite: duas mensagens quase simultâneas do mesmo usuário não corrompem os dados do cadastro.

### BL-21 — Mitigar teto de execuções simultâneas 🟠 (G)
Reduzir o tempo de cada execução (retirar/reduzir `Utilities.sleep`, adiar trabalho pesado). Avaliar responder 200 à Meta **imediatamente** e processar de forma assíncrona (fila via `CacheService`/planilha + trigger), desacoplando o ACK do webhook do processamento. Aceite: um pico de N mensagens não derruba o webhook; latência estável.

### BL-22 — Reduzir contenção do lock global 🟡 (M)
Repensar `sessoes_cadastro_ativas`: em vez de uma lista única sob lock global, usar chaves por usuário (`sessao_ativa_${from}`) e varrer por prefixo na trigger, ou aceitar perda eventual sem lock. Aceite: cadastros simultâneos não competem por um lock único.

### BL-23 — Idempotência do primeiro contato 🟡 (P)
Tornar `ehPrimeiroContato`/`registrarContatoBot` idempotente (checar/gravar cache antes da chamada Odoo, ou usar unicidade em `x_name` no Odoo). Aceite: duas mensagens simultâneas de número novo criam **um** `x_contato_bot` e uma boas-vindas.

### BL-24 — Retry/backoff em chamadas externas 🟡 (M)
Adicionar reenvio com backoff para 429/5xx em `Utils._post` (WhatsApp) e nas chamadas Odoo/Vision, com limite de tentativas. Aceite: um 429 transitório não perde a mensagem ao usuário.

### BL-25 — Monitorar cota de UrlFetch 🟡 (P)
Instrumentar contagem diária de chamadas externas e alertar ao aproximar da cota; documentar o teto conforme o tipo de conta. Aceite: visibilidade do consumo diário antes de estourar.

---

## Sugestão de ordem de execução

1. **Sprint 1 (integridade da devolução):** BL-02 → **BL-14 → BL-26** (a validação do destinatário depende da extração confiável da chave) → BL-04 → BL-03.
2. **Sprint 2 (médios):** BL-05 (verificar Odoo primeiro), BL-06, BL-07, BL-08, BL-20, BL-10.
3. **Sprint 3 (notificações + robustez/carga):** BL-21 e BL-24 **antes** de reativar BL-01; depois BL-09, BL-11, BL-22.
4. **Contínuo:** BL-12, BL-13, BL-15, BL-16, BL-17, BL-23, BL-25.
