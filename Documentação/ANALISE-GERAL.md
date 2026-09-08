# Análise Geral — Bot Meu Dízimo (meu-dizimo-aparecida)

**Data da análise:** 19/07/2026
**Escopo:** Todo o código-fonte `.gs` do projeto (~7.850 linhas), configuração (`appsscript.json`, `.clasp.json`) e estrutura geral.

---

## 1. Visão geral do projeto

Chatbot de WhatsApp para gestão de dízimo paroquial, rodando em **Google Apps Script** como Web App. Integra:

- **WhatsApp Business API (Meta Graph v21.0)** — mensagens, botões, listas, mídia e templates.
- **Odoo ERP (JSON-RPC)** — cadastro de dizimistas, comunidades, devoluções, admins e logs.
- **Google Vision API** — OCR de comprovantes (imagem via `images:annotate`, PDF via `files:annotate`).

Fluxo principal: `Webhook.gs (doPost)` → `Router.gs` → Handlers (`Cadastro`, `Devolucao`, `Comprovante`, `Relatorio`, `Menu`) → Services (`OdooService`, `MediaService`, `VisionService`, `StateManager`).

---

## 2. Pontos fortes

**Arquitetura limpa e bem camadas.** Separação clara entre roteamento (Router sem lógica de negócio), handlers (fluxos) e serviços (integrações). Máquina de estados centralizada em `Config.gs` (`ESTADOS`, `ESTADOS_CADASTRO`).

**Idempotência no webhook** (`Webhook.gs:76-86`) — cache por `messageId` com TTL de 10 min evita processamento duplicado em reenvios da Meta. A marcação acontece *antes* do processamento, prevenindo race condition (com o trade-off descrito na seção 4.7).

**Autenticação do webhook** (`Webhook.gs:57-65`) — como o Apps Script não expõe headers (impossibilitando validar o HMAC `X-Hub-Signature-256`), usa-se segredo na query string (`?token=...`). A limitação está bem documentada no código.

**Módulo de relatórios com controle de acesso real** (`RelatorioHandler.gs`) — dois perfis (admin/coordenador), identificação por número + código de acesso, rate limiting (3 tentativas, bloqueio de 30 min), escopo por comunidade e divisão automática de mensagens longas (`_enviarComLimite`, limite 3.800 chars).

**Consciência de LGPD nos logs** — `VisionService` loga apenas a *presença* dos campos extraídos, nunca valores/chaves PIX (`_logResumoExtracao`); código de acesso digitado nunca é logado (`RelatorioHandler.gs:221-227`).

**Uso de `LockService`** em `StateManager.registrarSessaoAtiva/removerSessaoAtiva` para proteger a chave global compartilhada `sessoes_cadastro_ativas` contra read-modify-write concorrente.

**Verificação de status HTTP centralizada** em `Utils._post` — falhas de envio (token expirado, janela de 24h) são logadas em vez de silenciadas.

---

## 3. Problemas críticos

### 3.1 `OdooService.executar()` não existe — rotina de notificações quebrada
`NotificacaoHandler.gs` chama `OdooService.executar(...)` em 4 pontos (linhas 148, 197, 215, 242), mas `OdooService` só expõe `searchRead`, `create`, `write` e `_rpc`. Resultado: **`executarNotificacoesDiarias()` lança `TypeError` na primeira busca** e nenhum lembrete mensal é enviado. O mesmo método fantasma é usado em `TesteNotificacao.gs`.

Além disso, no mesmo arquivo:
- `jaDevolveueEsteMes` (linha 211) filtra `x_devolucao` pelo campo **`x_studio_date`**, mas o campo usado em todo o resto do projeto é **`x_studio_data_da_devolucao`** — mesmo corrigindo o `executar`, o filtro retornaria sempre 0.
- `processarRespostaNotificacao` (linha 259) chama `DevolucaoHandler.iniciar` (o método real é `iniciarDevolucao`) e `HistoricoHandler.mostrar` (**objeto `HistoricoHandler` não existe**). Essa função não é referenciada por ninguém — é código morto que quebraria se fosse ligado.

### 3.2 Janela de sessão inconsistente — usuário perde o cadastro em 15 min, mas o bot promete 60
- As mensagens ao usuário prometem sessão de **60 minutos** (`Router._continuarSessao`, `StateManager.renovarSessao`) e o TTL do cache é 3600s.
- Porém `TriggerSessoes.gs` instala a trigger **a cada 5 minutos** (`everyMinutes(5)`, linha 132 — o log da linha 135 diz "20 minutos") e **limpa qualquer sessão com ≥ 15 minutos** (linha 62), avisando a partir de 10 min.
- `StateManager.verificarExpiracaoSessao` também dispara o aviso com apenas **10 minutos** (linha 178), com texto "expira em aproximadamente 10 minutos".
- Os comentários dos dois arquivos descrevem os valores originais (50/55 min, trigger de 20 min). Tudo indica que **valores de teste foram deixados em produção**: um usuário que demore mais de 15 min no cadastro perde tudo, mesmo tendo clicado "Sim, continuar" (a renovação repõe o `sessao_inicio_`, mas a régua de 15 min da trigger continua valendo).

### 3.3 ComprovanteHandler confirma sucesso mesmo quando nada foi registrado
Em `_tratarResultado` (`ComprovanteHandler.gs:225-262`):
- Se `buscarDizimistaPorWhatsapp` retorna `null`, apenas loga o erro — **nenhuma mensagem de falha ao usuário** e nenhum registro criado.
- Em qualquer caso (dizimista não encontrado ou exceção no Odoo), o fluxo termina enviando **"✅ Comprovante recebido com sucesso! Sua devolução foi registrada"**. O usuário acredita que devolveu; a secretaria não tem registro nem o comprovante (que existia só em memória). É o pior tipo de falha para um sistema financeiro: silenciosa e com confirmação falsa.

### 3.4 Lista de comunidades no cadastro estoura o limite do WhatsApp
`CadastroHandler.confirmarNumero` (linhas 80-93) monta a lista interativa com **todas** as comunidades (`listarComunidades` traz até 50). A API do WhatsApp aceita **no máximo 10 rows** — com 11+ comunidades a chamada retorna erro e o usuário fica travado sem ver opção nenhuma. O `RelatorioHandler` já faz `slice(0, 10)` (linhas 610 e 742); o cadastro não (e o `slice` do relatório, por sua vez, **oculta silenciosamente** comunidades além da 10ª).

### 3.5 `ASSETS` não definido
`Assets.gs:23` referencia `ASSETS.AVATAR_DRIVE_ID`, mas o objeto `ASSETS` não é declarado em lugar nenhum — `getAvatar()` sempre cai no `catch` (ReferenceError) e retorna `null`. Hoje só afeta testes (`Tests.gs`), pois `boasVindas` usa o avatar do Odoo, mas é uma armadilha esperando uso.

---

## 4. Problemas médios

### 4.1 Webhook processa apenas a primeira mensagem do lote
`doPost` lê só `body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]` (`Webhook.gs:69`). A Meta pode agrupar múltiplas mensagens/entradas num único POST — as demais são **descartadas sem log**. O correto é iterar sobre `entry[]`, `changes[]` e `messages[]`.

### 4.2 Parse de valor monetário quebra com separador de milhar
`CadastroHandler.processarValorMensal` (linha 190): `"1.000,50"` → `replace(',', '.')` → `"1.000.50"` → `parseFloat` → **1** . Um dízimo de mil reais vira R$ 1,00 no Odoo. O mesmo risco existe em `VisionService._extrairValor`, que ainda captura o **primeiro** `R$` do comprovante — que pode ser tarifa ou saldo, não o valor transferido.

### 4.3 Estado `AGUARDANDO_COMPROVANTE` definido mesmo após erro
`DevolucaoHandler.iniciarDevolucao` (linha 73-74) chama `_enviarDadosPagamento` e **sempre** seta `AGUARDANDO_COMPROVANTE` — mesmo quando a comunidade não tem chave PIX e o usuário recebeu mensagem de erro. Qualquer imagem enviada depois será processada como comprovante de uma devolução sem dados de pagamento.

### 4.4 Validação de data de nascimento aceita datas impossíveis
`processarDataNascimento` valida apenas dia 1–31 e mês 1–12: aceita 31/02/2050 (data futura, inclusive). Combinado com `criarDizimista`, que faz `split('/')` sem validação, datas inválidas chegam ao Odoo.

### 4.5 Payload PIX (BR Code) com problemas
`MediaService._gerarPayloadPix`:
- Quando `valor` é vazio, gera a tag `54` com length `00` — EMV inválido; a tag deveria ser omitida.
- Nome (`PASTORAL DO DIZIMO`) e cidade (`FORTALEZA`) são **fixos no código**, mesmo o projeto sendo de Aparecida e o fuso/config apontando São Paulo.
- O QR é gerado enviando o payload PIX (com chave da comunidade e valor) para a API externa `api.qrserver.com` — dependência de terceiro sem SLA e vazamento desnecessário de dados para fora do ambiente Google/Meta.

### 4.6 Atalhos globais capturam entradas legítimas
`Router._rotearTexto`: durante o cadastro, se o usuário digitar "menu", "0" ou "rel" (ex.: apelido "Rel"), o fluxo é abortado e os dados temporários descartados sem confirmação. Os estados de relatório foram protegidos; os de cadastro não.

### 4.7 Idempotência marca antes de processar
`Webhook.gs:85` marca a mensagem como processada **antes** de `Router.rotear`. Se o processamento falhar (timeout do Odoo, por exemplo), o retry da Meta será ignorado e a mensagem se perde. É um trade-off consciente (evita duplicatas), mas vale registrar: a alternativa seria marcar após sucesso e tornar os handlers idempotentes.

---

## 5. Segurança

**Bom:** segredo de webhook na URL (mitigação correta para a limitação do GAS); rate limiting no acesso a relatórios; bloqueio quando não há código cadastrado; logs sem dados sensíveis; tokens em `PropertiesService` (não no código).

Pontos de atenção:

1. **Credenciais em `Setup.gs`** — o padrão "cole suas credenciais no código e execute" convida a commitar segredos no git. O arquivo hoje só tem placeholders, mas o instrutivo "delete o arquivo após configurar" não foi seguido (o arquivo está no repositório). Preferir colar direto na UI de Script Properties.
2. **`ODOO_UID` padrão = 2** (admin do Odoo) — o bot opera com privilégio total no ERP. O ideal é um usuário de serviço com acesso restrito aos modelos `x_*` usados.
3. **Códigos de acesso em texto plano** no Odoo (`x_studio_chave_acesso`), comparados case-insensitive. Aceitável para o porte, mas qualquer pessoa com acesso ao Odoo vê as "senhas" dos coordenadores.
4. **`getWebhookSecret` é opcional** — sem `WEBHOOK_SECRET` configurado o webhook aceita POST anônimo (o web app é `ANYONE_ANONYMOUS` por necessidade). Há warning no log, mas nada impede operar aberto. Vale tornar obrigatório após o setup.
5. **Fallback de PDF aceita qualquer PDF como comprovante** (`ComprovanteHandler.gs:101-119`): se o Vision não extrair texto, o arquivo é registrado com valor 0 e status pendente. A revisão manual pelos coordenadores mitiga, mas é vetor de lixo/spam no Odoo.

---

## 6. Qualidade e manutenção

1. **Arquivos de teste dominam o projeto**: `Tests.gs` (175 KB), `TestesComprovantes.gs` (93 KB, contém base64 de imagens) e `TesteRelatorio.gs` (34 KB) somam ~60% do tamanho do código implantado via clasp. Recomenda-se movê-los para fora do deploy de produção (ou um projeto GAS separado), reduzindo superfície e tempo de push.
2. **Arquivos HTML órfãos**: `Index.html`, `lealtech.html`, `meudizimo.html.html`, `política_privacidade.html` e `termo_uso.html` não são servidos por nada — `doGet` só atende à verificação da Meta e não há `HtmlService` no projeto. Ou são resquício, ou falta o `doGet` que os sirva.
3. **Comentários desatualizados** descrevendo valores diferentes do código (TriggerSessoes: "20 minutos"/"50-55 min" vs. 5/10/15 reais; versões de cabeçalho divergentes entre arquivos).
4. **`MenuHandler.infoSecretaria` com dados placeholder** — "(00) 0000-0000" e "secretaria@exemplo.com" em produção, apesar de existir `OdooService.buscarParametros()` que retorna exatamente esses dados (`x_studio_secretaria_whatsapp`, `x_studio_secretaria_email`).
5. **`Utilities.sleep` espalhado** (1–3s por mensagem) — melhora a UX de leitura, mas consome tempo do limite de execução de 6 min do GAS; no fluxo de comprovante somam-se ~7s de sleep + 2 chamadas Vision/Odoo.
6. **Duplicação de envio de mídia**: `MediaService.enviarImagemDrive/enviarImagemBase64/enviarDocumento` reimplementam o POST que `Utils._post` centraliza.
7. `buscarDizimistaPorWhatsapp` tem efeito colateral de **atualizar o telefone no Odoo** dentro de uma função de busca — funciona, mas surpreende (dificulta testes e raciocínio).

---

## 7. Recomendações priorizadas

| # | Ação | Severidade | Onde |
|---|------|-----------|------|
| 1 | Corrigir/remover `OdooService.executar` e o campo `x_studio_date` para reativar notificações | 🔴 Crítica | `NotificacaoHandler.gs` |
| 2 | Alinhar janela de sessão (15 min vs. 60 min prometidos) e trigger (5 vs. 20 min) | 🔴 Crítica | `TriggerSessoes.gs`, `StateManager.gs` |
| 3 | Não confirmar sucesso quando a devolução não foi registrada; avisar usuário e secretaria | 🔴 Crítica | `ComprovanteHandler.gs:225-262` |
| 4 | Limitar lista de comunidades a 10 rows no cadastro (ou paginar) | 🔴 Crítica | `CadastroHandler.confirmarNumero` |
| 5 | Iterar sobre todas as mensagens do payload do webhook | 🟠 Média | `Webhook.gs:69` |
| 6 | Corrigir parse de valores com milhar ("1.000,50") no cadastro e no OCR | 🟠 Média | `CadastroHandler.gs:190`, `VisionService.gs:218` |
| 7 | Não setar `AGUARDANDO_COMPROVANTE` quando faltam dados de pagamento | 🟠 Média | `DevolucaoHandler.gs:73` |
| 8 | Validar data de nascimento de verdade (data real, não futura) | 🟠 Média | `CadastroHandler.gs:142` |
| 9 | Definir `ASSETS` ou remover `Assets.gs`; buscar secretaria do Odoo em vez de placeholder | 🟡 Baixa | `Assets.gs`, `MenuHandler.gs` |
| 10 | Separar testes do deploy de produção; remover HTMLs órfãos ou serví-los | 🟡 Baixa | raiz do projeto |
| 11 | Usuário Odoo dedicado (não uid 2) e `WEBHOOK_SECRET` obrigatório | 🟡 Baixa | `Config.gs`, `Setup.gs` |
| 12 | Corrigir tag 54 vazia e dados fixos no payload PIX; avaliar gerar QR localmente | 🟡 Baixa | `MediaService.gs:289` |

---

## 8. Conclusão

O projeto tem **arquitetura acima da média para um bot em Apps Script** — camadas bem definidas, idempotência, rate limiting, locks e preocupação com LGPD são raros nesse tipo de solução. Os problemas graves se concentram em três frentes: **notificações mensais inoperantes** (método inexistente), **sessão de cadastro expirando em 15 min** (valores de teste em produção) e **falsa confirmação de devolução** quando o registro no Odoo falha. As correções 1–4 da tabela são pequenas em esforço e altas em impacto — vale tratá-las antes de qualquer nova funcionalidade.
