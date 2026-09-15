# Especificação — Cadastro de família (número compartilhado)

**Criado em:** 14/09/2026 · **Revisado em:** 15/09/2026
**Status:** proposta (aguardando aprovação para implementar)

## Conceito

Uma **família** é um conjunto de dizimistas que **compartilham o mesmo número de WhatsApp**. O primeiro cadastro daquele número é o **responsável** (o registro mais antigo — menor id). A partir do mesmo número, o responsável pode **adicionar membros** e **devolver o dízimo** de um, de vários ou de todos de uma vez, com **um único PIX e um comprovante**.

Não há tela de "gestão de família" separada: o ponto de entrada é a mensagem que já aparece quando o número está cadastrado.

## Decisões (aprovadas)

1. **Vínculo pelo número:** membros compartilham o `x_studio_partner_phone`. A família é obtida buscando **todos** os `x_dizimista` com aquele número. Não é necessário um campo de "responsável"; o primário é o registro mais antigo (o `buscarDizimistaPorWhatsapp` já ordena por id e retorna esse).
2. **Comunidade:** membros herdam a comunidade do responsável → uma única chave PIX; um pagamento cobre a família.
3. **Valores:** cada devolução usa o **valor mensal cadastrado** do membro; o total é a soma dos selecionados.
4. **UI de seleção (Opção B — botão até caber, senão lista):** ≤3 opções → botões (inline, 1 toque); mais que isso → lista (máx. 10 linhas, seleção única). A grande maioria das famílias tem ≤2 membros que devolvem, então o caso comum usa **botões**.
5. **Cadastro do membro:** **completo** (dados pessoais), porém **sem** confirmação de número (é o mesmo), **sem** seleção de comunidade (herdada) e **sem** notificações (evita multiplicar lembretes no mesmo número).
6. **Histórico:** individual (sem visão de família). 1 cadastro → direto como hoje; 2+ → pergunta de quem é o histórico (botões até 3 membros; lista a partir de 4) e mostra o individual do escolhido.

## Modelo de dados (Odoo)

- **Vínculo:** nenhum campo novo obrigatório — o número compartilhado agrupa a família.
- **`x_devolucao.x_studio_grupo_pagamento`** (char/texto) — *recomendado*: mesmo id/uuid nas N devoluções de um mesmo pagamento, para o coordenador ver que vieram juntas.
- **`x_dizimista.x_studio_responsavel`** (m2o → x_dizimista) — *opcional*, só se quiser marcar explicitamente o responsável; a lógica não depende dele.

## Fluxos (WhatsApp)

### 1. Ponto de entrada — mensagem de "já cadastrado"
Quando o número já tem cadastro e o usuário toca "Ser Dizimista", a mensagem atual ("👋 Olá, *Nome*! Você já está cadastrado…") ganha um botão a mais:
- `💰 Devolver dízimo` · `➕ Adicionar membro` · `🔙 Menu`
(3 botões = limite do WhatsApp.)

### 2. Adicionar membro (cadastro completo, mesmo número)
- Reaproveita as etapas: nome → apelido → nascimento → endereço → valor mensal.
- **Pula:** confirmação de número (mesmo), comunidade (herda a do responsável) e notificações.
- Cria `x_dizimista` com o **mesmo `x_studio_partner_phone`**, mesma `x_studio_comunidade`.
- Controlado por flag temporária no estado (`cadastrandoMembro=true`).

### 3. Devolver dízimo (individual ou em lote)
1. Busca **todos** os cadastros do número.
2. Se **1** → fluxo atual (sem mudança).
3. Se **>1** → pergunta **"De quem é a devolução?"** (Opção B):
   - **2 membros** → 3 **botões** (`Utils.enviarMenu`): `[Membro A] [Membro B] [Todos]`. Cobre um, o outro ou os dois — não precisa de "Escolher vários". (Caso mais comum.)
   - **3+ membros** → **lista** (`Utils.enviarLista`, seleção única, 10 linhas):
     - `✅ Todos — R$ <total>` (id `fam_todos`)
     - `1. Nome — R$ X`, `2. Nome — R$ Y`, … (um por membro, id `fam_<dizimistaId>`)
     - `✏️ Escolher vários…` (id `fam_escolher`)
   Comportamento por toque: **um membro** → só dele; **Todos** → toda a família; **Escolher vários…** → bot pede "digite os números separados por vírgula (ex.: `1,3`)" e processa o subconjunto (estado `AGUARDANDO_SELECAO_FAMILIA`).
   Capacidade da lista: 2 linhas fixas + até **8 membros**. Grupo com 9+ é improvável → **sem paginação nesta versão** (mostra os 8 primeiros + `Todos` com aviso; degrada, não quebra).
4. Calcula o **total** = soma dos valores selecionados; mostra os dados de pagamento (chave PIX da comunidade) + **QR do total** + detalhamento (quem × quanto).
5. Estado `AGUARDANDO_COMPROVANTE_FAMILIA`, guardando os ids selecionados.
6. Ao receber o comprovante: OCR + validação de chave (**BL-26**) → cria **uma devolução por membro** (valor = valor mensal do membro), com o **mesmo comprovante** anexado e o mesmo `x_studio_grupo_pagamento`. Mensagem final lista quem foi registrado; chave divergente/ausente → todos entram "em conferência" (igual BL-26).

### 4. Histórico (individual — sem visão de família)
- **1 cadastro** → mostra direto o histórico da pessoa (como hoje).
- **2+ cadastros** → pergunta **"De quem é o histórico?"** (Opção B: **2–3 membros** → botões; **4+** → lista, apenas os membros, **sem** "Todos") → exibe o histórico **individual** do escolhido (estado `AGUARDANDO_SELECAO_HISTORICO`).

## Impacto no código

| Arquivo | Mudança |
|---|---|
| `OdooService.gs` | Novo `listarDizimistasPorWhatsapp(phone)` (retorna todos); `criarMembro(...)` (mesmo número/comunidade); `registrarDevolucaoEmLote(...)`. Mantém `buscarDizimistaPorWhatsapp` (primário) para os fluxos single. |
| `CadastroHandler.gs` | Botão "Adicionar membro" na mensagem de já-cadastrado; suporte a cadastro de membro (flag; pular número/comunidade/notificações; finalizar vinculado ao número). |
| `DevolucaoHandler.gs` | "Devolver dízimo" e "Meu histórico" passam a considerar múltiplos cadastros (botões ≤3 / lista; seleção de membro / "Todos" só no Devolver). |
| `ComprovanteHandler.gs` | Em contexto de família, criar N devoluções em vez de 1. |
| `Router.gs` | Botão `btn_adicionar_membro`; botões/linhas `fam_*`; roteamento dos novos estados. |
| `Config.gs` | Estados `AGUARDANDO_SELECAO_FAMILIA`, `AGUARDANDO_SELECAO_HISTORICO`, `AGUARDANDO_COMPROVANTE_FAMILIA`. |

## Observações / limitações

- **`buscarDizimistaPorWhatsapp` hoje retorna `registros[0]`** (order id asc) — vira o "responsável" de forma determinística. Os fluxos single continuam usando esse; os de família usam a lista completa.
- **Efeito colateral:** o `buscarDizimistaPorWhatsapp` atualiza o telefone ao achar pela variação do 9º dígito (BL-15). Com vários registros no mesmo número, revisar para não atualizar o registro errado.
- **WhatsApp (regra de UI — Opção B):** ≤3 opções → **botões**; mais que isso → **lista** (máx. 10 linhas, seleção única). Devolver: **2 membros = botões** `[A][B][Todos]`; **3+ = lista**. Histórico: **2–3 membros = botões**; **4+ = lista**. Subconjunto ("alguns") só existe na lista, via texto (`1,3`), pois a lista não faz multi-seleção. Até 8 membros por lista; 9+ improvável (sem paginação nesta versão). Caso mais comum (≤2 membros) usa botões.
- **Notificações de membro:** desligadas por padrão (o número já recebe pelo responsável); reavaliar se quiser lembrete por membro.

## Plano de implementação (fases)

- **Fase 0 (usuário):** opcional — criar `x_studio_grupo_pagamento` (e, se quiser, `x_studio_responsavel`). O vínculo por número **não** exige campo novo.
- **Fase 1:** botão "Adicionar membro" + cadastro de membro vinculado ao número + `listarDizimistasPorWhatsapp`.
- **Fase 2:** "Devolver dízimo" com seleção de membro / "Todos" → pagamento em lote → N devoluções.
- **Fase 3:** polimento (agrupamento por pagamento, mensagens).
