# Backlog — Bot Meu Dízimo (meu-dizimo-aparecida)

**Criado em:** 14/09/2026
**Base:** revisão do código-fonte `.gs` (ver [ANALISE-GERAL.md](historico/ANALISE-GERAL.md), arquivada) + análise de concorrência/carga.
**Atualizado em:** 17/09/2026 — **auditoria do código** conferindo cada item marcado como concluído contra os `.gs` (ver "Auditoria de 17/09/2026"). Resultado: adicionado BL-27, BL-26 reclassificado para parcial, BL-22 elevado a 🟠 e registrada a inversão de sequência do BL-01.
**Atualizado em:** 14/09/2026 — adicionados BL-26 e refino do BL-14 a partir de uma **simulação real** (cadastro + devolução) capturada do WhatsApp.
**Progresso:** Sprints 1 e 2 concluídas na `main`, mais BL-09 e BL-11. Em 17/09 fecharam BL-22, BL-23, BL-24, BL-26 e BL-27, e o BL-17 ficou pela metade (webhook fail-closed; falta o uid dedicado no Odoo).
**Pendências:** **BL-28** e **BL-29**, ambos abertos em 17/09 e descobertos no teste de carga. O BL-29 é o mais relevante: mensagens processadas fora de ordem gravam a resposta no campo errado, em silêncio — e a janela do problema é proporcional à duração da execução, o que o amarra ao BL-21. **BL-21** ficou parcial por decisão técnica — o tempo de execução caiu, mas a fila assíncrona foi avaliada e **descartada** (não cabe nos limites do Apps Script; ver análise no item), então o teto de execuções simultâneas continua de pé **com o BL-01 em produção** (ver nota no BL-01). A metade aberta do **BL-17** (uid Odoo dedicado) é tarefa de administração no Odoo — roteiro passo a passo no item.
⚠️ **Duas ações fora do código:** rodar `criarCampoConferenciaPix()` no Odoo (BL-26) e criar o usuário Odoo dedicado (BL-17). E, como sempre, as correções só valem no bot após `clasp push` + republicação do deployment (ver observação no fim).
**Como usar:** cada item tem um ID (`BL-NN`), severidade, esforço estimado, arquivo(s), proposta de correção e critério de aceite. Priorize de cima para baixo.
**Escopo deste arquivo:** é um **registro de trabalho** — o que foi encontrado, decidido e por quê. Para *como o sistema funciona hoje* e as regras a respeitar ao mexer no código (armazenamento, chamadas externas, concorrência, publicação), veja **[ARQUITETURA.md](ARQUITETURA.md)**.

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
| BL-01 | Notificações mensais quebradas (`OdooService.executar` inexistente) | 🔴 | M | ✅ Concluído (+ fail-open, fix `date`, repescagem, botão do template) — ⚠️ **em produção sem BL-21/BL-24**, contrariando a ordem do Sprint 3 |
| BL-02 | Confirmação falsa de devolução quando registro no Odoo falha | 🔴 | P | ✅ Concluído |
| BL-03 | Sessão promete 60 min mas expira em 15 (valores de teste) | 🔴 | P | ✅ Concluído (60 min; aviso em 50) |
| BL-04 | Lista de comunidades estoura limite de 10 rows do WhatsApp | 🔴 | P | ✅ Concluído (paginação "Ver mais") |
| BL-26 | Comprovante não é validado contra a chave PIX/destinatário da comunidade | 🔴 | M | ✅ Concluído — campo estruturado `x_studio_conferencia_pix` + alerta visível ao coordenador (17/09). ⚠️ Requer rodar `criarCampoConferenciaPix()` no Odoo |
| BL-27 | Fallback de PDF aceita qualquer arquivo como comprovante (contorna o BL-26) | 🔴 | P | ✅ Concluído — fallback removido; PDF ilegível pede reenvio e não registra nada |
| BL-05 | Devoluções do bot podem não aparecer em "Pendentes" (comunidade não gravada) | 🟠 | P | ✅ Fechado — `x_studio_comunidade` é related de `x_studio_dizimista.x_studio_comunidade` (stored/readonly); confirmado no schema e em produção |
| BL-06 | Parse de valor mensal quebra com separador de milhar | 🟠 | P | ✅ Concluído |
| BL-07 | `AGUARDANDO_COMPROVANTE` setado mesmo sem dados de pagamento | 🟠 | P | ✅ Concluído |
| BL-08 | Validação de data de nascimento aceita datas impossíveis/futuras | 🟠 | P | ✅ Concluído |
| BL-09 | Webhook processa só a 1ª mensagem do lote | 🟠 | M | ✅ Concluído (loop entry/changes/messages + idempotência por messageId) |
| BL-10 | Atalhos globais (menu/0/rel) abortam o cadastro sem confirmação | 🟠 | P | ✅ Concluído |
| BL-11 | Payload PIX (BR Code) com tag 54 inválida, dados fixos e vazamento a terceiro | 🟠 | M | ✅ Payload corrigido (tag 54 condicional, nome/cidade do titular, tag 62, copia-e-cola). QR externo mantido por decisão (chave não é secreta, baixo risco) |
| BL-28 | Resposta interativa fora de contexto aborta o cadastro em silêncio | 🟠 | P | Aberto — **descoberto no teste de carga de 17/09** |
| BL-29 | Mensagens processadas fora de ordem gravam a resposta no campo errado | 🟠 | G | Aberto — **comprovado no teste de carga de 17/09** |
| BL-12 | `ASSETS` não declarado — `getAvatar()` sempre falha | 🟡 | P | ✅ Concluído (objeto `ASSETS` declarado em Assets.gs) |
| BL-13 | Dados da secretaria com placeholder em produção | 🟡 | P | ✅ Resolvido — opção "Secretaria" virou "Contato Pastoral" (contato do responsável por comunidade; secretaria de `x_parametros` como fallback) |
| BL-14 | Extração frágil de valor e chave PIX do OCR (chave = fragmento do ID da transação) | 🟠 | M | ✅ Concluído |
| BL-15 | Efeito colateral: busca de dizimista atualiza telefone no Odoo | 🟡 | P | ✅ Concluído (removida a escrita durante a leitura; `x_studio_partner_phone` é related+gravável e propagava p/ res.partner) |
| BL-16 | Separar arquivos de teste do deploy de produção | 🟡 | M | ✅ Concluído — `.claspignore`; deploy caiu ~699 KB → ~281 KB (17/09) |
| BL-17 | Segurança: uid Odoo dedicado + `WEBHOOK_SECRET` obrigatório | 🟠 | M | ⚠️ Parcial — webhook agora é fail-closed (17/09); uid dedicado é tarefa de administração no Odoo, o código só alerta |
| **Concorrência / carga** | | | | |
| BL-20 | Race condition por usuário em `dados_`/`estado_` (sem lock) | 🟠 | M | ✅ Concluído (mitigação) |
| BL-21 | Teto de ~30 execuções simultâneas compartilhado por todos os usuários | 🟠 | G | ⚠️ Parcial — tempo de execução reduzido (17/09); a fila assíncrona foi **avaliada e descartada**, ver análise no item |
| BL-22 | Lock global de `sessoes_cadastro_ativas` é gargalo sob contenção | 🟠 | M | ✅ Concluído — lista única virou uma propriedade por sessão; sem lock (17/09) |
| BL-23 | Duplicação de `x_contato_bot` em primeiro contato simultâneo | 🟡 | P | ✅ Concluído (lock + dupla checagem no cache miss) |
| BL-24 | Sem retry/backoff em 429/5xx (WhatsApp, Odoo, Vision) | 🟡 | M | ✅ Concluído (`Utils.fetchComRetry`, com política por idempotência) |
| BL-25 | Cota diária de UrlFetch pode limitar volume total | 🟡 | P | ✅ Concluído — contagem diária + alerta em 60%/80% (17/09) |

---

## Itens críticos

### BL-01 — Notificações mensais quebradas 🔴 (M)
**Arquivo:** `NotificacaoHandler.gs` (linhas 148, 197, 215, 242) · `OdooService.gs`
**Problema:** chama `OdooService.executar(...)`, método que não existe (o serviço só expõe `searchRead`, `create`, `write`, `_rpc`). `executarNotificacoesDiarias()` lança `TypeError`. Além disso: filtro por `x_studio_date` (linha 220) em vez de `x_studio_data_da_devolucao`; e `processarRespostaNotificacao` (259) chama `DevolucaoHandler.iniciar` (real: `iniciarDevolucao`) e `HistoricoHandler.mostrar` (inexistente).
**Correção:** reescrever as chamadas usando `searchRead`/`create`; para `search_count`, adicionar um método `count(model, domain)` em `OdooService`. Corrigir o nome do campo de data. Remover ou corrigir `processarRespostaNotificacao`.
**Aceite:** `executarNotificacoesDiarias()` roda sem erro; um dizimista elegível recebe o template; log gravado em `x_notificacao_log`; quem já devolveu no mês não é notificado.

**⚠️ Nota de sequenciamento (auditoria 17/09/2026):** o Sprint 3 abaixo determina fazer **BL-21 e BL-24 antes** de reativar o BL-01 — mas o BL-01 está concluído e **já em produção** (trigger de hora em hora, `NotificacaoHandler.gs:356-358`), enquanto BL-21 e BL-24 seguem abertos. O envio em si é seguro: é sequencial com `Utilities.sleep(2000)` entre mensagens (`:179`), então não há rajada de *saída*. A exposição é a **onda de respostas** que chega nos minutos seguintes — o cenário 6 da análise de carga — batendo num webhook sem retry/backoff (BL-24) e sob o teto de ~30 execuções simultâneas (BL-21). **Recomendação:** priorizar BL-24 antes do próximo ciclo mensal de notificações, ou reduzir o alcance do disparo (lotes menores por hora) até que BL-21/BL-24 estejam fechados.

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

**Estado atual (auditoria 17/09/2026) — ⚠️ parcial, abaixo do próprio critério de aceite.** O que existe funciona: `ComprovanteHandler._conferirChave` (linha 156) compara a chave extraída com `x_studio_chave_pix` da comunidade, normalizando e-mail e dígitos, e a mensagem ao usuário deixa de prometer confirmação quando não confere (fala em "conferência da secretaria"). **O que falta:** `OdooService.registrarDevolucao` grava `x_studio_status: 'Pendente'` para **todas** as devoluções — conferidas ou não. O único marcador de divergência é um sufixo de texto concatenado ao `x_name` (`⚠️ CONFERIR: ...`). Como tudo já nasce "Pendente", o status não carrega sinal algum e o coordenador **não tem campo filtrável** para separar os comprovantes suspeitos; depende de alguém ler o nome do registro.
**✅ Corrigido em 17/09/2026.** Ao investigar, o problema era **pior que o descrito**: o marcador não era só difícil de filtrar, era **invisível no próprio fluxo do bot**. `_listarPendentes` monta as linhas só com nome, valor e data — nunca com o `x_name` — e a tela de detalhe busca `x_name` mas não o exibe. Ou seja, o coordenador apertava "✅ Confirmar" sem nenhum sinal de que a chave não conferia; a marca só existia para quem abrisse o Odoo.

O que foi feito:
1. **Campo estruturado** `x_devolucao.x_studio_conferencia_pix` (char), com os valores `ok` | `divergente` | `ausente` | `sem_referencia`, gravado por `registrarDevolucao`. Criado pela função idempotente **`criarCampoConferenciaPix()`** em `SetupCamposFamilia.gs`, seguindo o padrão `ir.model.fields` já usado pela funcionalidade de família. **É preciso rodá-la uma vez no editor do Apps Script.**
2. **Degradação segura:** `OdooService._temCampoConferenciaPix()` checa o schema uma vez (cache de 6 h; 5 min enquanto ausente) e só grava/consulta o campo se ele existir. Sem isso, um deploy feito antes do setup faria **toda** devolução falhar — uma devolução perdida é pior que um aviso ausente.
3. **Visibilidade para o coordenador:** a lista de pendentes prefixa `⚠️` no nome e `CONFERIR •` na descrição; a tela de detalhe mostra o motivo por extenso (`⚠️ Confira antes de confirmar: ...`) logo acima dos botões de baixa.
4. **Correção de precisão:** `sem_referencia` (comunidade sem chave PIX cadastrada) antes era rotulado como "chave não identificada no comprovante", culpando o arquivo do dizimista por uma falha de cadastro da comunidade. Agora tem texto próprio.
5. O sufixo no `x_name` foi mantido como redundância visível no backend.

**Observação:** devoluções criadas antes desta mudança ficam sem valor no campo e não exibem alerta — não há como saber retroativamente se a chave conferia, e marcá-las como `ok` seria mentira.

### BL-27 — Fallback de PDF aceita qualquer arquivo 🔴 (P) — **descoberto na auditoria de 17/09/2026**
**Arquivo:** `ComprovanteHandler.gs:99-119`
**Problema:** quando a Vision API não consegue extrair texto de um PDF (protegido, escaneado ruim, corrompido — ou simplesmente um PDF que não é comprovante), o código **força** o resultado como válido: `ehComprovante: true`, `valor: 0`, `chavePix: null`, `confianca: 50`, e segue para o registro no Odoo. Consequência: **qualquer PDF cria uma devolução de R$ 0,00** no Odoo. Como `chavePix` é `null`, a conferência do BL-26 devolve `ausente` e o registro é apenas marcado para conferência — ou seja, não é fraude silenciosa, mas é **exatamente o vetor que o BL-26 existe para fechar, alcançável trocando a imagem por um PDF**. Também polui a lista de pendentes com registros de valor zero.
**Correção:** não tratar "OCR falhou" como "comprovante válido". Opções, em ordem de preferência: (a) pedir ao usuário que reenvie como **foto** ou um PDF legível, sem registrar nada; (b) se a paróquia quiser preservar o envio, registrar em um estado explicitamente distinto (ver campo estruturado do BL-26) com valor nulo e aviso honesto de que **nada foi confirmado**. Em nenhum caso enviar "✅ Comprovante recebido" para um arquivo do qual não se extraiu dado algum.
**Aceite:** um PDF sem texto extraível não gera devolução de R$ 0,00 silenciosamente; o usuário recebe orientação clara para reenviar, ou o registro fica em estado distinguível de uma devolução normal.

**✅ Corrigido em 17/09/2026 — opção (a).** O bloco de fallback saiu de `_processarArquivo`; quando `VisionService.analisarPDF` não devolve dados, o resultado é marcado com `pdfIlegivel` e **nada é registrado**. `_tratarResultado` responde com orientação para reenviar como foto ou PDF original do banco, **mantendo o estado `AGUARDANDO_COMPROVANTE`** para o reenvio não exigir refazer o fluxo. Removido também o ramo `isPdfFallback`, que ficou inalcançável (`dados.tipo` nunca mais vale `'PDF'`, pois `_extrairTipoTransacao` só retorna PIX/TED/DOC/Boleto/Desconhecido).
**Limitação conhecida (→ BL-24):** `analisarPDF` retorna `null` tanto para "PDF sem texto" quanto para falha transitória da Vision API (429/5xx/exceção), então uma indisponibilidade cai na mesma mensagem. É seguro — nada é registrado em nenhum dos casos, contra o registro falso de R$ 0,00 de antes — mas a orientação "envie uma foto" não ajuda durante uma queda da API, já que o caminho de imagem usa o mesmo serviço. Distinguir os dois casos exige mudar o contrato de retorno do `VisionService` e pertence ao BL-24 (retry/backoff), não a este item.

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

### BL-28 — Resposta interativa fora de contexto aborta o cadastro 🟠 (P) — **descoberto no teste de carga de 17/09/2026**
**Arquivo:** `Router.gs` — fallback final de `_rotearInterativo`, ramo `list_reply`
**Problema:** o tratamento de `list_reply` testa o estado atual contra uma sequência de casos conhecidos e, não casando com nenhum, cai em `MenuHandler.menuPrincipal(from)`. Isso **põe o usuário de volta no menu e abandona o cadastro em andamento**, sem aviso e sem explicação.

Observado ao vivo no teste de carga: uma seleção de comunidade chegou enquanto o estado era `AGUARDANDO_CONFIRMACAO_NUMERO` e o log registrou
```
📋 Lista selecionada: com_30
📊 Estado: AGUARDANDO_CONFIRMACAO_NUMERO
📝 Estado → MENU
```

**Por que acontece de verdade, e não só em teste:** o WhatsApp mantém as mensagens interativas antigas clicáveis na conversa. Basta o usuário rolar para cima e tocar numa lista de uma etapa anterior — ou numa lista de outro fluxo — para perder o cadastro que estava preenchendo. Não é preciso concorrência nem má-fé.

**Relação com o BL-10:** aquele item tratou exatamente este risco para os atalhos de *texto* (`menu`, `0`, `rel`), que passaram a não abortar o cadastro. As respostas *interativas* fora de contexto ficaram de fora e continuam abortando.

**Correção sugerida:** durante os `ESTADOS_CADASTRO`, não deixar uma seleção desconhecida cair no menu. Mínimo: responder algo como "não entendi essa opção — vamos continuar de onde paramos" e reenviar a pergunta do passo atual, preservando estado e dados. O mesmo vale para `button_reply`, que deve ser verificado junto.
**Aceite:** tocar numa lista antiga da conversa durante o cadastro não faz o usuário perder o que já preencheu.

### BL-29 — Mensagens fora de ordem gravam no campo errado 🟠 (G) — **comprovado no teste de carga de 17/09/2026**
**Arquivos:** `Webhook.gs` · `Router.gs` · `StateManager.gs` — é do modelo de execução, não de um ponto específico
**Problema:** o WhatsApp entrega cada mensagem como um POST separado, o Apps Script executa os POSTs **em paralelo**, e o fluxo de cadastro decide o que fazer lendo o estado atual. Quando duas mensagens do mesmo usuário se sobrepõem, **quem lê o estado primeiro ganha** — e a ordem em que o usuário digitou deixa de valer.

Evidência direta do log, com as respostas enviadas em ordem e 400 ms de intervalo:
```
20:27:57.102  📊 Estado: AGUARDANDO_NOME
20:27:57.361  📝 Estado → AGUARDANDO_NOME_USUAL      ← outra mensagem já gravou o "nome"
20:27:57.633  📱 Mensagem (..._0_...)                 ← a PRIMEIRA mensagem chega só agora
20:27:57.683  💬 "Joao da Silva Teste" | Estado: AGUARDANDO_NOME_USUAL
```
"Joao Teste" foi gravado como **nome completo** e "Joao da Silva Teste" como **apelido** — invertidos. Mais adiante, "50" (valor mensal) chegou em `AGUARDANDO_DATA_NASCIMENTO` e foi recusado como data inválida; o cadastro parou em `AGUARDANDO_VALOR_MENSAL` esperando um valor que já tinha sido consumido no passo errado.

**Por que é mais grave que o lost update do BL-20.** Não houve **nenhum** `Lock não obtido` nesse teste: a proteção do BL-20 funcionou e nada foi sobrescrito. O dado não se perde — vai para o **campo errado**. Perda é visível (campo vazio); isto não é. O cadastro termina completo, plausível e incorreto.

**Lock não resolve.** Serializar o processamento por usuário faria uma execução esperar a outra, mas **não impõe ordem**: continuaria valendo quem pegasse o lock primeiro. Preservar a ordem exigiria bufferizar as mensagens e ordená-las por `timestamp` antes de processar — o que recai no processamento assíncrono descartado no BL-21.

**⚠️ Acoplamento com o BL-21 — a janela é proporcional à duração da execução.** Com execuções de ~2 s, só se atropelam mensagens enviadas com menos de 2 s de diferença. Nas medições reais deste teste as execuções levaram **10 a 24 s**, então mensagens separadas por *dezenas de segundos* ainda se sobrepõem. Reduzir o tempo de execução não é só questão de vazão: **estreita diretamente a janela deste bug**.

**Caminhos possíveis, do mais barato ao mais estrutural:**
1. **Detectar e avisar.** Guardar o `timestamp` da última mensagem processada por usuário; se chegar uma mais antiga, responder algo como "recebi suas mensagens fora de ordem, vamos confirmar" e reapresentar o passo. Não evita o atropelo, mas troca corrupção silenciosa por erro visível.
2. **Confirmar o resumo antes de gravar.** O cadastro já mostra um resumo no fim; torná-lo um passo de confirmação obrigatório dá ao usuário a chance de pegar campos trocados.
3. **Ordenar por `timestamp` antes de processar** — exige fila, ou seja, o BL-21.

**Aceite:** duas respostas enviadas em sequência rápida não acabam gravadas em campos trocados sem que o usuário perceba.

---

### BL-30 — Cadastro por WhatsApp Flow 🟠 (M) — ⚠️ parcial (simulação pronta, entrada não ligada)
**Arquivos:** `FlowHandler.gs` (novo) · `Router.gs` · `Config.gs` · `ferramentas/flow-cadastro.json` · `ferramentas/simula-flow.js`
**Documentação:** `Documentação/FLOW-CADASTRO.md`

**Ideia:** trocar as ~15 mensagens e ~9 execuções do cadastro conversacional por **um formulário nativo**: 2 mensagens, **1 execução**. Como há uma gravação só, a corrida do **BL-29 deixa de existir nesse caminho** — não é mitigada, é eliminada, porque não há duas execuções do mesmo usuário competindo.

**Feito:**
- `FlowHandler.processar` trata o `nfm_reply`, revalida **tudo** (as validações do Flow JSON rodam no cliente, então o que chega é dado não verificado) e reaproveita `mostrarResumo` → `finalizar`. O Flow troca a **coleta**, não a gravação.
- Ramo `nfm_reply` no `Router`. Sem ele a resposta cairia no `menuPrincipal` do fim de `_rotearInterativo` e o formulário inteiro sumiria em silêncio — o mesmo buraco do BL-28.
- `ferramentas/simula-flow.js` manda ao webhook o `nfm_reply` que o aparelho mandaria, com 5 casos (`ok`, `data-invalida`, `valor-zero`, `campo-faltando`, `token-errado`). **Não exige criar Flow na Meta**: no modo sem endpoint, um cadastro por Flow é exatamente uma requisição HTTP.
- 12 casos de `_normalizar` exercitados fora do GAS, sob `America/Sao_Paulo`. Achado que virou código: o `DatePicker` devolve **epoch em ms na meia-noite UTC**, e lê-lo com `getDate()` num projeto UTC-3 voltaria **um dia em todo cadastro** — daí o `getUTCDate()`.

**Não feito (proposital):**
- **A entrada não está ligada.** `CadastroHandler.iniciar` continua indo pelo fluxo conversacional. Ligar exige o Flow publicado na Meta e testado num aparelho — o simulador cobre o servidor inteiro, não a renderização.
- `FLOW_ID_CADASTRO` ausente faz `enviarFlowCadastro` devolver `false`, então este código pode ser publicado **antes** de existir Flow algum.
- **Foto de perfil fora do formulário**: exigiria tratar upload de mídia, e o ganho do Flow está em cortar mensagens de texto.

**Modo com endpoint é inviável aqui**, e não por escolha: a Meta exige RSA-OAEP-SHA256 + AES-128-GCM por tela, e o Apps Script só tem `computeRsaSha256Signature`, que **assina** — não decifra.

**O Flow não resolve a devolução**, que é o fluxo caro (500/mês contra um cadastro único por pessoa): ela depende de comprovante em imagem/PDF e de OCR.

**Aceite:** com o Flow publicado, um cadastro completo entra em 1 execução e o resumo sai correto; um formulário com data inexistente é recusado pelo servidor.

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

**✅ Corrigido em 17/09/2026 via `.claspignore`.** Os arquivos seguem versionados no Git; apenas deixam de subir no `clasp push`.

**Projeto GAS separado foi descartado:** os testes chamam os globais de produção (`OdooService`, `Utils`, `StateManager`…), então um projeto à parte exigiria duplicar o código do bot dentro dele — dois lugares para manter a mesma coisa. Excluir do push resolve sem essa duplicação.

**Bloat extra encontrado, fora do escrito no item:** o `clasp` trata **qualquer `.html`** como arquivo do projeto, então as 5 páginas de `docs/` (~97 KB — política de privacidade, termo de uso, etc.) também estavam indo para o deploy. Elas são servidas pelo GitHub Pages (`docs/CNAME` → `meudizimo.pnscaparecida.com`) e não têm relação com o Apps Script: não há um único uso de `HtmlService` no projeto. Também excluídas.

| | Antes | Depois |
|---|---|---|
| Código de produção | ~281 KB | ~281 KB |
| Suíte de testes | ~320 KB | — |
| Site `docs/` | ~97 KB | — |
| **Total enviado** | **~699 KB** | **~281 KB** (−60%) |

**Duas armadilhas documentadas no próprio arquivo:**
1. A existência de um `.claspignore` **substitui** a lista padrão do clasp, então `.git/**` e `node_modules/**` precisaram ser repetidos.
2. `clasp push` sincroniza: o primeiro push após a mudança **apaga** os arquivos de teste do editor online. É o efeito desejado, mas convém saber antes.

**Para rodar a suíte:** comentar as quatro linhas da seção de testes no `.claspignore`, `clasp push`, executar no editor, descomentar e publicar de novo. O passo a passo está no cabeçalho do arquivo.

**Correção de arrasto:** `Setup.gs` mandava executar `testarOdooService()` e `testarMenuCompleto()` — **funções que não existem em lugar nenhum do projeto**, um erro anterior a esta mudança e que ficaria pior com os testes fora do deploy. As referências foram corrigidas e foi criada a função `testarConexaoOdoo()`, que faz uma leitura mínima em `x_comunidade` para validar URL, database, uid e API key. Ela vive em `Setup.gs` justamente para continuar disponível no projeto publicado.

### BL-17 — Endurecer segurança 🟠 (M) — *elevado de 🟡 em 17/09/2026*
Usuário Odoo dedicado (não uid 2/admin) com acesso restrito aos modelos `x_*`; tornar `WEBHOOK_SECRET` obrigatório após o setup (hoje o webhook aceita POST anônimo se o segredo não estiver configurado — `Webhook.gs:57-65`).

**✅ Metade 1 — `WEBHOOK_SECRET` obrigatório (17/09/2026).** `doPost` virou *fail-closed*: sem segredo configurado, rejeita. Antes, a ausência do segredo apenas logava um warning e o POST seguia — e como o deployment é `ANYONE_ANONYMOUS`, qualquer um que descobrisse a URL podia forjar payloads do WhatsApp e injetar cadastros e devoluções.

⚠️ **A troca exige ordem de operação, senão o bot fica mudo.** O Apps Script sempre responde 200 (não dá para devolver 403), então a Meta **não reenvia** o que for rejeitado: mensagens recebidas com o token errado são perdidas, não enfileiradas. Por isso foi criada **`configurarSegredoWebhook()`** (Setup.gs), que gera o segredo e imprime a URL de callback pronta. Sequência correta:
1. Rodar `configurarSegredoWebhook()` e copiar a URL do log.
2. Colar a URL na Meta (Callback URL) — **antes** do passo 3.
3. Republicar o deployment com o código novo.

**Roteiro da metade 2 (fazer no Odoo, ~15 min).** A API key **não pode** ser criada via API — o Odoo exige que o próprio usuário a gere logado na interface —, então não há como automatizar este item por completo:
1. **Criar o usuário.** Configurações → Usuários e Empresas → Usuários → Novo. Nome: `Bot Meu Dízimo`. Tipo de usuário: *Usuário interno*. Desmarque todos os grupos de aplicativos (Vendas, Contabilidade, etc.) — o bot não precisa de nenhum.
2. **Dar acesso só aos modelos do bot.** Com o modo desenvolvedor ativo: Configurações → Técnico → Segurança → Regras de Acesso (`ir.model.access`). Criar uma regra por modelo — `x_dizimista`, `x_devolucao`, `x_comunidade`, `x_contato_bot`, `x_parametros`, `x_parametros_line`, `x_notificacao_log` — vinculada a um grupo novo (ex.: `Bot / Operação`) com leitura e escrita/criação onde o bot grava. Sem acesso a `res.users`, `res.partner` além do necessário, nem a modelos contábeis.
3. **Gerar a API key.** Entrar no Odoo **como esse usuário** → Preferências → Segurança da Conta → Nova chave de API. Copiar o valor (só aparece uma vez).
4. **Descobrir o uid.** Com o modo desenvolvedor, abrir o usuário e ler o `id` na URL, ou rodar no bot: `OdooService.searchRead('res.users', ['id','login'], [['login','=','<login do bot>']], {limit:1})`.
5. **Atualizar as propriedades** `ODOO_UID` e `ODOO_API_KEY` e rodar **`testarConexaoOdoo()`**. Se a leitura de `x_comunidade` passar e o aviso de administrador sumir, está feito.

⚠️ Teste antes de considerar pronto: uma ACL faltando só aparece quando o fluxo correspondente roda. Vale exercitar cadastro, devolução com comprovante e relatório do coordenador com o novo uid — de preferência na mesma rodada de testes de staging.

**⚠️ Metade 2 — uid dedicado: NÃO resolvido em código.** Criar o usuário, restringir as permissões aos modelos `x_*` e gerar a API key é tarefa de administração dentro do Odoo — não dá para fazer pelo repositório, e mexer nisso em produção sem combinar seria arriscado. O que o código faz agora é **alertar**: `verificarProperties()` avisa quando `ODOO_UID = 2` e lista os quatro passos da migração. `Config.gs` mantém o fallback `|| 2` de propósito: removê-lo derrubaria as chamadas ao Odoo num ambiente onde a propriedade não esteja setada, sem fechar brecha alguma (o risco é *usar* admin, não o default).
**Aceite restante:** `ODOO_UID` apontando para um usuário sem direitos administrativos, com `testarOdooService()` passando.

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

### BL-20 — Lock por usuário no estado/dados 🟠 (M) — ✅ concluído, com ressalva
Proteger o read-modify-write de `dados_${from}`/`estado_${from}` com `LockService.getScriptLock()` chaveado logicamente por usuário (ou serializar por `from`), evitando lost update quando o mesmo usuário envia mensagens concorrentes. Alternativa: usar `getUserLock()` — mas como o execute-as é único, avaliar um lock curto por chave. Aceite: duas mensagens quase simultâneas do mesmo usuário não corrompem os dados do cadastro.

**Auditoria 17/09/2026:** a cobertura está correta — os 25 pontos de escrita do código passam por `salvarCampoEMudarEstado`/`salvarMultiplosCampos`, e nenhum chama `setDadosTemporarios` direto. **Duas ressalvas:** (1) o `_comLock` é *best-effort* — se o lock não vier em 3s ele grava **sem** lock (`StateManager.gs:64-78`), então o lost update ainda é possível justamente sob a contenção que deveria proteger; (2) o Apps Script só oferece lock **global**. Com o BL-22 resolvido (17/09), a disputa diminuiu bastante — o índice de sessões saiu do lock —, mas este `_comLock` e o `ehPrimeiroContato` do BL-23 seguem serializando globalmente. Não há como torná-los por usuário: o `CacheService` não tem compare-and-swap e o `getUserLock()` é inútil aqui, já que o `executeAs` é único. A saída é o **BL-21**.

### BL-21 — Mitigar teto de execuções simultâneas 🟠 (G) — ⚠️ parcial
Reduzir o tempo de cada execução (retirar/reduzir `Utilities.sleep`, adiar trabalho pesado). Avaliar responder 200 à Meta **imediatamente** e processar de forma assíncrona (fila via `CacheService`/planilha + trigger), desacoplando o ACK do webhook do processamento. Aceite: um pico de N mensagens não derruba o webhook; latência estável.

#### A fila assíncrona foi avaliada e descartada (17/09/2026)

A proposta esbarra em três limites do Apps Script que a tornam pior que o problema que resolve:

1. **Trigger tem intervalo mínimo de 1 minuto.** Uma fila drenada por trigger agendada adicionaria **até 60 s de espera antes de qualquer resposta** do bot. Para uma conversa no WhatsApp isso não é latência, é a sensação de que o bot morreu.
2. **Trigger pontual não escala.** `ScriptApp.newTrigger().timeBased().after(ms)` pareceria resolver, mas o Apps Script limita a **20 triggers por script**: uma trigger por mensagem estoura o teto num pico — exatamente o cenário que o item quer proteger.
3. **A fila precisaria ser durável.** `CacheService` pode despejar entradas sob pressão, e perder uma entrada aqui significa **perder uma devolução já confirmada ao usuário**. Planilha é durável, mas lenta e com escrita concorrente que exigiria `LockService` — reintroduzindo a contenção global recém-eliminada no BL-22.

Ou seja: a fila trocaria uma saturação rara (a própria análise de carga deste documento nota que "no uso cotidiano de uma paróquia a simultaneidade real raramente passa de um punhado") por uma penalidade de experiência constante e um risco novo de perda de dado financeiro. **Decisão: não implementar.**

#### O que foi feito: redução do tempo de execução

O teto de ~30 execuções simultâneas é consumido por *execuções em voo*, então encurtar cada execução aumenta a vazão efetiva na mesma proporção. Foram removidas **4 esperas que não ordenavam nada** (≈6 s no total):

| Local | Espera | Por que era inócua |
|---|---|---|
| `ComprovanteHandler` | 2 s | Seguida das chamadas ao Odoo (buscar dizimista, buscar comunidade, criar devolução com base64), que já separam as mensagens de sobra — **no fluxo mais pesado do bot** |
| `CadastroHandler.iniciar` | 2 s | Não havia mensagem anterior para ordenar; a busca no Odoo já é a pausa natural |
| `DevolucaoHandler` (histórico vazio) | 1 s | A consulta ao Odoo já separa do "Buscando histórico..." |
| `MenuHandler.boasVindas` | 1 s | Esperava por uma chamada **comentada** (`//this.menuPrincipal`) — não guardava absolutamente nada |

**O que foi deliberadamente mantido:** as ~11 esperas do tipo `envia → espera → envia`. Elas existem para garantir a ordem de chegada das mensagens no WhatsApp, que não é garantida em POSTs consecutivos rápidos. Removê-las embaralharia a conversa (ex.: a pergunta seguinte chegando antes do "✅ registrado"), e isso não é testável sem exercitar o bot de verdade. Também ficaram as esperas de propagação de mídia no `MediaService` (3 s/2 s entre upload e envio), que são funcionais, não cosméticas.

**⚠️ Ganhou um segundo motivo (17/09, ver BL-29):** a duração da execução não afeta só a vazão — ela define a **janela em que mensagens do mesmo usuário se atropelam** e acabam gravadas no campo errado. Com execuções medidas em 10-24 s, mensagens separadas por dezenas de segundos ainda colidem. Encurtar a execução estreita esse bug diretamente.

**Ganho real e honesto:** ~2 s a menos por comprovante e ~1-2 s nos demais fluxos citados. Isso **alivia**, não resolve: o gargalo dominante do fluxo de comprovante são as chamadas externas (download da mídia, OCR, e o `create` no Odoo com o anexo em base64), não as pausas. Sob um pico concentrado de verdade — o disparo mensal do BL-01 é o cenário — o teto continua existindo.

**Se um dia o volume justificar**, o caminho não é a fila por trigger: é reduzir o trabalho por mensagem (ex.: não trafegar o comprovante em base64 dentro do `create`, ou adiar o anexo para uma segunda etapa) ou sair do Apps Script para um runtime sem teto de execuções simultâneas. Ambos são mudanças de arquitetura que merecem decisão própria, não um item de backlog.

### BL-22 — Reduzir contenção do lock global 🟠 (M) — *elevado de 🟡 em 17/09/2026*
Repensar `sessoes_cadastro_ativas`: em vez de uma lista única sob lock global, usar chaves por usuário (`sessao_ativa_${from}`) e varrer por prefixo na trigger, ou aceitar perda eventual sem lock. Aceite: cadastros simultâneos não competem por um lock único.

**Por que subiu de severidade:** quando este item foi escrito, o lock global era disputado apenas por `registrarSessaoAtiva`/`removerSessaoAtiva` (`waitLock(5000)`). A correção do BL-20 passou a tomar **o mesmo lock global** (`waitLock(3000)`) em *toda* gravação de campo do cadastro — ou seja, fechar o BL-20 aumentou a contenção exatamente no gargalo descrito aqui. A correção do BL-23 (17/09) somou um terceiro consumidor.

**✅ Corrigido em 17/09/2026 — o índice de sessões não usa mais lock nenhum.** Cada sessão virou uma propriedade própria (`sessao_ativa_<numero>`, valor = timestamp de início) em vez de um array JSON numa chave única. Como cada execução escreve apenas a **sua** chave, o read-modify-write compartilhado deixou de existir e o lock ficou desnecessário — não é o lock que foi afrouxado, é a disputa que sumiu.

**Por que PropertiesService e não CacheService:** a sugestão original deste item era "usar chaves por usuário e varrer por prefixo na trigger" — mas isso **não é possível no CacheService**, que não lista chaves (só lê por chave conhecida, via `get`/`getAll`). A trigger precisa enumerar as sessões, e só `PropertiesService.getProperties()` devolve tudo. As propriedades de sessão convivem com as de configuração no mesmo store, separadas pelo prefixo; `setupProperties()` usa `setProperties(obj)` de um argumento só, que mescla em vez de apagar as demais, então não há conflito.

**Custo aceito:** propriedades não têm TTL, ao contrário do cache. A limpeza vem da própria trigger — toda entrada do índice ou tem sessão viva (tratada pelas regras de tempo e removida aos 60 min) ou não tem cache (persistida e limpa na hora), então nada sobrevive mais que uma rodada de 5 min. Se a trigger for desinstalada, aí sim as entradas acumulam; são ~40 bytes cada, longe da cota de 500 KB, e uma trigger parada já é um problema maior por si só.

**Transitório no deploy:** as sessões que estiverem na lista antiga do cache no momento da publicação ficam órfãs — no máximo alguns usuários em cadastro perdem o aviso de 50 min e o registro da etapa de abandono. Os dados deles expiram normalmente pelo TTL. Não escrevi migração para um estado transitório de uma rodada.

**Testado localmente** (8 asserções, com `PropertiesService` stubado): listagem devolve só os números e nunca as chaves de configuração; número recuperado íntegro (o `slice` do prefixo não corta dígito); valor gravado é timestamp; remoção afeta só a sessão pedida; configuração intacta depois de registrar/remover; remover número inexistente não quebra; registrar o mesmo número duas vezes mantém uma entrada.

**O lock global continua existindo para outros dois usos**, que não são deste item: o `_comLock` do BL-20 (gravação de campo do cadastro) e o `ehPrimeiroContato` do BL-23. Ambos protegem read-modify-write em `CacheService`, que não tem compare-and-swap, e `LockService.getUserLock()` não ajuda porque o `executeAs` é único — todas as execuções são o mesmo usuário. Eliminá-los de vez exige o **BL-21** (tirar o processamento do webhook). Os dois itens estão acoplados e devem ser tratados juntos: a saída real é eliminar a lista global (chaves por usuário) e/ou mover o processamento para fora do webhook (BL-21), o que também dispensaria o lock do BL-20.

### BL-23 — Idempotência do primeiro contato 🟡 (P)
Tornar `ehPrimeiroContato`/`registrarContatoBot` idempotente (checar/gravar cache antes da chamada Odoo, ou usar unicidade em `x_name` no Odoo). Aceite: duas mensagens simultâneas de número novo criam **um** `x_contato_bot` e uma boas-vindas.

**✅ Corrigido em 17/09/2026.** `ehPrimeiroContato` passou a serializar o read-modify-write (buscar → criar → cachear) com `LockService`, com **dupla checagem do cache dentro do lock** — outra execução pode ter registrado o contato enquanto esperávamos. O lock só é disputado no *cache miss* (contato novo ou cache expirado em 6 h); o caminho normal, com cache hit, continua sem lock e sem chamada ao Odoo.
**Impacto extra que o item não mencionava:** o registro duplicado não causava só duas boas-vindas. `atualizarContatoBot` faz buscar → write e escreve **no primeiro registro que encontra**, então, com duplicatas, o log de cadastro e a etapa de abandono passavam a cair num registro arbitrário dos dois.
**Decisão de projeto:** se o lock não for obtido em 5 s, a função retorna `false` (pula a boas-vindas) em vez de seguir sem lock — duplicar o registro é pior que atrasar a saudação, e a próxima mensagem do usuário refaz a verificação. É o oposto da escolha feita no `_comLock` do BL-20, onde perder o dado do cadastro seria pior que gravar sem lock.
**Custo:** é o mesmo lock global usado pelo `_comLock` do BL-20, e aqui ele é mantido durante chamadas de rede ao Odoo (~1-2 s no pior caso), não só durante escrita em cache. **Interação com o BL-24:** desde que as chamadas ao Odoo ganharam retry, o pior caso cresceu — sob throttling, o lock pode ficar retido por mais ~3 s de backoff (1 s + 2 s). Continua sendo degradação e só no cache miss do primeiro contato, mas é um efeito que não existia quando este item foi escrito. Só acontece em cache miss, mas é hoje — junto com o BL-20 — um dos dois usos restantes do lock global, e eliminá-los exige o BL-21.

### BL-24 — Retry/backoff em chamadas externas 🟡 (M)
Adicionar reenvio com backoff para 429/5xx em `Utils._post` (WhatsApp) e nas chamadas Odoo/Vision, com limite de tentativas. Aceite: um 429 transitório não perde a mensagem ao usuário.

**✅ Corrigido em 17/09/2026.** Helper único `Utils.fetchComRetry(url, options, { idempotente, rotulo })`: no máximo 3 tentativas, backoff exponencial de 1 s e 2 s.

**A decisão central é *quando não* repetir.** Reenviar cegamente um 5xx é perigoso: o servidor pode ter processado a requisição antes de falhar, e repetir um `create` no Odoo gravaria **a mesma devolução duas vezes** — exatamente a classe de bug do BL-23, com dado financeiro. A política é:
| Situação | Repete? | Por quê |
|---|---|---|
| **429** (throttling) | Sempre | A requisição foi recusada *antes* de executar; repetir nunca duplica |
| **5xx / exceção de rede**, chamada idempotente | Sim | `search_read`, `search_count`, `write`, OCR e downloads podem repetir sem efeito colateral |
| **5xx / exceção de rede**, chamada não idempotente | **Não** | `create` no Odoo e envio de mensagem ao WhatsApp — repetir duplicaria registro ou mensagem |

No Odoo a política é derivada do próprio payload (`args[4] !== 'create'`), sem mudar assinatura de método. Aplicado em: `Utils._post` (WhatsApp), `OdooService._rpc`, `VisionService` (imagem e PDF) e os dois GETs de `MediaService.baixarArquivo` — este último não estava no escopo original do item, mas falhar ali significa perder o comprovante que o usuário acabou de enviar.

**Correção de bônus:** `_rpc` parseava o corpo como JSON sem olhar o status. Um 5xx do Odoo devolve HTML e estourava um `SyntaxError` de JSON, escondendo a causa real; agora vira um erro explícito com o código HTTP.

**Testado localmente** (8 cenários, fora do Apps Script, com `UrlFetchApp`/`Utilities` stubados): 200 direto; 429→200 em chamada não idempotente; 500 não idempotente **não** repetindo; 500 idempotente esgotando as 3 tentativas com backoff 1 s/2 s; exceção de rede nos dois modos; 429 permanente devolvendo a resposta sem lançar; 503→200 recuperando.

**Limite conhecido:** as esperas consomem o orçamento de 6 min por execução, por isso o teto é baixo (2 reenvios). Sob throttling sustentado isto ameniza, não resolve — a saída estrutural continua sendo o BL-21 (processar fora do webhook).

### BL-25 — Monitorar cota de UrlFetch 🟡 (P)
Instrumentar contagem diária de chamadas externas e alertar ao aproximar da cota; documentar o teto conforme o tipo de conta. Aceite: visibilidade do consumo diário antes de estourar.

**✅ Corrigido em 17/09/2026.** `Utils` passou a contar cada requisição real (tentativas de retry incluídas, pois consomem cota) num contador **da execução** — cada execução do Apps Script roda num contexto JS próprio, então ele zera sozinho. Ao fim de cada execução, `registrarConsumoExterno()` soma esse total ao dia corrente: **uma escrita em Properties por execução, não por chamada**, para não devolver ao custo de execução o que o BL-21 tirou. Ligado em três pontos: `doPost` (webhook), `executarNotificacoesDiarias` (o maior consumidor) e a trigger de sessões — nos dois últimos via `finally`, porque ambos têm `return` antecipado.

`verificarCotaUrlFetch()` roda de carona na trigger de sessões, que já executa a cada 5 min: soma os shards do dia, alerta (`log` → `warn` em 60% → `error` em 80%) e poda contadores com mais de 7 dias. O teto fica em `Utils.URLFETCH_COTA_DIARIA` (20 mil, conta gratuita; ~100 mil em Workspace — confirmar no painel de cotas).

**Precisão assumida:** o contador é distribuído em 5 shards escolhidos ao acaso para reduzir colisão, mas **não é exato** — sem compare-and-swap, duas execuções que leiam o mesmo shard ao mesmo tempo perdem um incremento. É uma subestimativa, por isso os alertas disparam em 60%/80%, com folga. Serve para dar ordem de grandeza, não para auditoria. Usar lock aqui reintroduziria exatamente a contenção removida no BL-22.

**Efeito colateral positivo:** para a contagem ficar correta, os 5 pontos de `UrlFetchApp` que ainda estavam fora do `fetchComRetry` (uploads de mídia, envio de mídia, QR Code e info de mídia) passaram a usá-lo. Além de serem contados, ganharam o retry do BL-24 com a política de idempotência correta — GETs como idempotentes, uploads e envios apenas em 429.

**Testado localmente** (11 asserções): contagem por execução, gravação no shard do dia, zeragem após registrar, execução sem chamadas não escrevendo, soma só do dia corrente, poda de dias antigos, configuração intacta e os três níveis de alerta.

**Contexto de capacidade (auditoria 17/09/2026) — vazão do disparo de notificações.** O envio é sequencial com `sleep(2000)` entre mensagens e o teto de execução é 6 min → **~180 mensagens por rodada**, e a consulta de elegíveis usa `{ limit: false }` (`NotificacaoHandler.gs:222,505`), sem teto. A repescagem horária recupera o que sobrou, mas em paróquia grande isso significa várias rodadas de ~6 min por dia; com ~12 rodadas na janela útil (8h–20h) chega-se perto da cota de **~90 min/dia de trigger** em conta gratuita. Vale medir o nº de elegíveis e o tempo por rodada antes do próximo ciclo, e considerar paginar o disparo explicitamente em vez de depender do corte por timeout.

---

## Auditoria de 17/09/2026

Revisão do código-fonte conferindo **cada item marcado como concluído** contra os arquivos `.gs`, em vez de confiar no status declarado.

### Confirmados como realmente concluídos
| Item | Evidência no código |
|---|---|
| BL-02 | `ComprovanteHandler._tratarResultado` trata três desfechos distintos; a confirmação de sucesso só sai com `devolucaoId` real |
| BL-03 | Aviso em 50 min (`StateManager.gs:211`) e expiração em 60 — textos, TTLs e trigger alinhados |
| BL-09 | Loop `entry[] → changes[] → messages[]` com idempotência gravada **antes** do processamento (`Webhook.gs:71-90,120-127`); falha de uma mensagem não derruba o lote |
| BL-14 | Valor ancorado por rótulo com fallback para o maior valor ignorando saldo/tarifa; chave PIX pula linhas de "ID da transação" e usa fronteiras `(?<!\d)`. Runtime é **V8** (`appsscript.json`), então os lookbehinds são suportados |
| BL-20 | Cobertura completa: os 25 pontos de escrita passam pelos helpers com lock (ver ressalvas no item) |

### Divergências encontradas
1. **BL-26 estava marcado ✅ mas cumpre o aceite só em parte** → reclassificado para ⚠️ Parcial. A conferência de chave existe e a mensagem ao usuário é honesta, mas não há campo estruturado: `x_studio_status` é `'Pendente'` para todos os casos e a marca de divergência vive num sufixo de texto do `x_name`.
2. **BL-27 (novo, 🔴)** — o fallback de PDF força `ehComprovante: true` e registra devolução de R$ 0,00 para qualquer PDF ilegível, contornando na prática a proteção do BL-26.
3. **BL-01 foi para produção fora da ordem planejada** — o Sprint 3 mandava fazer BL-21/BL-24 antes; o trigger está ativo e esses dois seguem abertos.
4. **BL-22 subiu de 🟡 para 🟠** — a correção do BL-20 passou a usar o mesmo lock global, agravando o gargalo que o BL-22 descreve.

### Itens abertos cuja permanência foi confirmada no código
*Situação no fim do dia 17/09: BL-16, BL-23 e BL-24 corrigidos; BL-17 com a metade do webhook fechada, restando o uid dedicado no Odoo.*
- **BL-16:** `Tests.gs` (175 KB), `TestesComprovantes.gs` (93 KB), `TesteRelatorio.gs` (33 KB) e `TesteNotificacao.gs` (19 KB) somam **~320 KB** ainda na raiz do projeto, indo junto no `clasp push`.
- **BL-17:** sem `WEBHOOK_SECRET`, o POST anônimo continua aceito com apenas um `console.warn` (`Webhook.gs:62-65`). Combinado com `access: ANYONE_ANONYMOUS`, qualquer um que descubra a URL injeta mensagens no fluxo.
- **BL-23:** a corrida está exatamente como descrita — `ehPrimeiroContato` faz cache miss → busca no Odoo → cria → e só **depois** grava o cache (`StateManager.gs:272-300`).
- **BL-24:** nenhum dos ~15 pontos de `UrlFetchApp` (Utils, OdooService, VisionService, MediaService) tem retry ou backoff.

---

## Sugestão de ordem de execução

*Revisada em 17/09/2026 — os Sprints 1 e 2 estão concluídos; a ordem abaixo reflete o que sobrou mais os achados da auditoria.*

1. ~~**Sprint 1 (integridade da devolução):** BL-02 → BL-14 → BL-26 → BL-04 → BL-03.~~ ✅ concluído (BL-26 parcial, ver Sprint 4).
2. ~~**Sprint 2 (médios):** BL-05, BL-06, BL-07, BL-08, BL-20, BL-10.~~ ✅ concluído.
3. **Sprint 3 (robustez/carga) — parcialmente feito:** BL-01, BL-09 e BL-11 concluídos. **Restam BL-21, BL-24 e BL-22** — e, como o BL-01 já está no ar, o BL-24 passou a ser o mais urgente do grupo.
4. **Sprint 4 (fechar a integridade do comprovante — prioridade atual):**
   ~~**BL-27**~~ ✅ → ~~**reforço do BL-26**~~ ✅ (falta rodar `criarCampoConferenciaPix()` no Odoo) → ~~**BL-17**~~ ⚠️ metade feita (webhook fail-closed; falta o uid dedicado no Odoo) → ~~**BL-23**~~ ✅. **Sprint 4 encerrado em código.**
5. **Sprint 5 (carga):** ~~BL-24~~ ✅ → ~~**BL-22**~~ ✅ → **BL-21** ⚠️ parcial — tempo de execução reduzido; a fila assíncrona foi avaliada e descartada por não caber nos limites do Apps Script (ver análise no item). O teto de execuções simultâneas e os dois usos restantes do lock global (BL-20, BL-23) seguem de pé, e sair deles exigiria mudança de arquitetura, não mais um item de backlog.
6. **Contínuo:** BL-12, BL-13, BL-15, BL-16, BL-25 ✅ — todos fechados.

---

## Checklist de publicação (17/09/2026)

Nada do que foi corrigido vale no bot antes destes passos. Ordem sugerida, tudo em ambiente de teste primeiro:

1. `clasp push` — o primeiro push **remove os arquivos de teste do editor online** (efeito esperado do BL-16).
2. Republicar o deployment (Implantar → Gerenciar implantações → nova versão). Sem isto, a URL do webhook continua servindo o código antigo.
3. No editor, rodar **`criarCampoConferenciaPix()`** — sem o campo, o BL-26 degrada para o comportamento anterior, sem o alerta ao coordenador. Leva até 5 min para passar a ser usado (cache da checagem de schema).
4. Rodar **`verificarProperties()`** e **`testarConexaoOdoo()`**.
5. `WEBHOOK_SECRET` já está configurado nesta instalação, então o fail-closed do BL-17 não muda nada na Meta. Para conferir a URL de callback: `configurarSegredoWebhook()` reimprime sem trocar o segredo.
6. Testar pelo WhatsApp, com atenção ao **fluxo de comprovante**, que concentra BL-24, BL-26 e BL-27: imagem legível, imagem com chave divergente (deve cair em conferência e aparecer com ⚠️ na lista do coordenador) e um PDF ilegível (deve pedir reenvio e **não** registrar R$ 0,00).
7. Opcional, quando quiser fechar o BL-17: seguir o roteiro do uid dedicado e repetir o passo 6 com as novas credenciais.
