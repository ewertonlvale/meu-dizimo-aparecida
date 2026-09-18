# Fluxos do bot e o custo de cada um

*Levantado em 18/09/2026, contando as chamadas de envio no código — não por estimativa.*

Este documento existe por causa de uma preocupação concreta: **a partir de 1º de
outubro de 2026 a Meta cobra as mensagens de serviço acima de 1.000 por mês**, e
é preciso saber de onde elas saem antes de decidir o que cortar.

A regra que vale para tudo aqui: **mensagem recebida é grátis; o que custa é a
resposta do bot.** Então o número que importa em cada fluxo é quantas mensagens
o bot envia, não quantas trocas acontecem.

---

## 1. Resumo — quantas mensagens cada fluxo custa

| Fluxo | Mensagens do bot | Frequência esperada |
|---|---|---|
| Primeiro contato (boas-vindas + menu) | **3** | uma vez por pessoa |
| Cadastro por conversa | **19** | uma vez por pessoa |
| Cadastro por formulário (Flow) | **4** | uma vez por pessoa |
| Adicionar membro por conversa | **14** | raro |
| Adicionar membro por formulário | **4** | raro |
| **Devolução do dízimo** | **8** | **a mais frequente** |
| Lembrete mensal (template) | **1** | uma vez por mês, por pessoa |
| Relatório do coordenador | 4 a 12 | poucas pessoas |

⚠️ **O cadastro por conversa estava sendo subestimado** em análises anteriores
deste projeto, que falavam em "~15". A contagem passo a passo dá **19**, e 22
somando boas-vindas e menu para quem chega do zero.

---

## 2. O fluxo completo, em desenho

```mermaid
flowchart TD
    A([Mensagem recebida]) --> B{Primeiro contato?}
    B -- sim --> C["Boas-vindas + avatar<br/>2 mensagens"]
    B -- não --> D
    C --> D{Tipo da mensagem}

    D -- texto/menu --> E["Menu principal<br/>1 mensagem"]
    D -- botão --> F[Roteia por id]
    D -- imagem/PDF --> G[Comprovante]
    D -- formulário --> H[FlowHandler]

    E --> I{O que a pessoa escolhe}
    F --> I

    I -- Ser Dizimista --> J{Flow ligado?}
    J -- sim --> K["Formulário + foto + resumo<br/><b>4 mensagens</b>"]
    J -- não --> L["Cadastro por conversa<br/><b>19 mensagens</b>"]

    I -- Devolver dízimo --> M["Dados PIX + QR + copia-e-cola<br/>4 mensagens"]
    M --> N([Aguarda comprovante])
    G --> O["Análise + dados + confirmação + resultado<br/>4 mensagens"]

    I -- Adicionar membro --> P{Flow de membro?}
    P -- sim --> Q["<b>4 mensagens</b>"]
    P -- não --> R["<b>14 mensagens</b>"]

    I -- Relatório --> S["Coordenador<br/>4 a 12 mensagens"]

    H --> K
    H --> Q

    style M fill:#fde68a,stroke:#b45309,color:#000
    style O fill:#fde68a,stroke:#b45309,color:#000
    style L fill:#fecaca,stroke:#b91c1c,color:#000
    style R fill:#fecaca,stroke:#b91c1c,color:#000
    style K fill:#bbf7d0,stroke:#15803d,color:#000
    style Q fill:#bbf7d0,stroke:#15803d,color:#000
```

Em amarelo, a devolução — **o único fluxo que se repete todo mês**. Em vermelho,
os caminhos por conversa. Em verde, os por formulário.

---

## 3. Devolução do dízimo — o fluxo que pesa

É o único recorrente. Tudo o mais acontece uma vez por pessoa, ou quase nunca.

```mermaid
sequenceDiagram
    participant P as Pessoa
    participant B as Bot
    P->>B: toca "Devolver dízimo"
    B->>P: 1. "Vou te passar os dados de pagamento"
    B->>P: 2. Dados da comunidade (banco, titular, valor)
    B->>P: 3. Imagem do QR Code
    B->>P: 4. PIX copia-e-cola (mensagem própria)
    P->>B: envia o comprovante
    B->>P: 5. "⏳ Analisando comprovante..."
    B->>P: 6. Dados extraídos pelo OCR
    B->>P: 7. "Confirma?" (botões)
    P->>B: toca Confirmar
    B->>P: 8. "✅ Devolução registrada"
```

**8 mensagens.** Se a pessoa chegar pelo menu em vez do botão do lembrete, 9.

### Onde estão os cortes, e o que cada um custa em usabilidade

| # | Mensagem | Dá para cortar? |
|---|---|---|
| 1 | "Vou te passar os dados" | **Sim** — juntar com a 2. É anúncio do que vem na mensagem seguinte |
| 2 | Dados da comunidade | Não |
| 3 | Imagem do QR Code | **Sim** — quem paga pelo celular usa o copia-e-cola; o QR serve para quem lê de outra tela |
| 4 | PIX copia-e-cola | Não — é o que a pessoa efetivamente usa |
| 5 | "⏳ Analisando..." | **Sim** — é feedback de progresso. Sem ela a pessoa espera alguns segundos sem retorno |
| 6 | Dados extraídos | **Sim** — juntar com a 7, que já os repete |
| 7 | "Confirma?" | Não |
| 8 | Resultado | Não |

**8 → 4 mensagens** cortando as quatro. Nenhum corte remove informação: três são
fusões e um é o QR, que duplica o copia-e-cola.

---

## 4. Cadastro — por conversa e por formulário

### Por conversa: 19 mensagens

| # | Mensagem |
|---|---|
| 1 | Confirmar o número |
| 2 | Lista de comunidades |
| 3 | "Ótimo! Comunidade X ✅" |
| 4 | "Nome completo" |
| 5 | "Prazer! Como quer ser chamado?" |
| 6 | "Certo. Data de nascimento" |
| 7 | "Data registrada ✅" |
| 8 | "Endereço" |
| 9 | "Valor mensal" |
| 10 | "Valor registrado ✅" |
| 11 | "Quer receber lembretes?" |
| 12 | "Perfeito. Qual dia?" |
| 13 | "✅ Lembrete no dia X" |
| 14 | "📸 Foto de perfil" |
| 15 | "⏳ Processando foto..." |
| 16 | "✅ Foto recebida!" |
| 17 | Resumo + Confirmar/Corrigir |
| 18 | "⏳ Salvando seu cadastro..." |
| 19 | "🎉 Cadastro realizado!" |

Repare no padrão: **7 das 19 são confirmações do tipo "X registrado ✅"**,
sempre seguidas da pergunta seguinte. Cada par poderia ser uma mensagem só —
o que levaria 19 a 12 sem tirar nada da tela.

### Por formulário: 4 mensagens

| # | Mensagem |
|---|---|
| 1 | Mensagem que abre o formulário |
| 2 | "Recebi seus dados! Envie uma foto" |
| 3 | Resumo + Confirmar/Corrigir |
| 4 | "🎉 Cadastro realizado!" |

A resposta do formulário é **mensagem recebida — não é cobrada**. Os 8 campos
chegam de graça.

---

## 5. O que isso dá em dinheiro

Cenário da paróquia: **500 dizimistas, 500 devoluções por mês**.

Tarifa Brasil, mensagem de serviço: **R$ 0,035**. Franquia: **1.000/mês**, a
partir de 01/10/2026. Template não tem franquia — é cobrado desde o primeiro.

### Hoje, como está

| Item | Contas | Mensagens |
|---|---|---|
| Devoluções | 500 × 8 | 4.000 |
| Lembretes (template) | 500 × 1 | 500 |

- Serviço: 4.000 − 1.000 de franquia = 3.000 × R$ 0,035 = **R$ 105,00**
- Template: 500 × R$ 0,035 = **R$ 17,50**
- **Total: R$ 122,50/mês** (R$ 1.470/ano)

### Com os quatro cortes da devolução

| Item | Contas | Mensagens |
|---|---|---|
| Devoluções | 500 × 4 | 2.000 |
| Lembretes | 500 × 1 | 500 |

- Serviço: 2.000 − 1.000 = 1.000 × R$ 0,035 = **R$ 35,00**
- Template: **R$ 17,50**
- **Total: R$ 52,50/mês** (R$ 630/ano)

**A conta cai 57%.** E o custo por pessoa por ano sai de R$ 2,94 para R$ 1,26.

### O mês da adesão

Se os 500 se cadastrarem no mesmo mês, some os cadastros uma vez:

| Cadastro | Mensagens | Custo do mês |
|---|---|---|
| Por conversa (19) | +9.500 | ≈ R$ 455 |
| Por formulário (4) | +2.000 | ≈ R$ 122 |

É evento único, mas é o pico. **O formulário economiza ~R$ 330 só nesse mês.**

---

## 6. Conclusão, sem rodeio

**Não fica inviável.** No pior caso de hoje, R$ 122,50/mês — pouco mais de
R$ 1.400 por ano para 500 famílias. Com os cortes da seção 3, cai para
R$ 52,50/mês sem perder nada na tela.

O que muda a ordem de grandeza não é o cadastro, e sim a **devolução**: ela é a
única que se repete. Cortar uma mensagem da devolução vale 500 mensagens por
mês; cortar uma do cadastro vale 500 uma única vez na vida da paróquia.

**A ordem de prioridade, por retorno:**

1. **Fundir as quatro mensagens da devolução** — R$ 70/mês, sem perda
2. **Manter o formulário ligado** — já feito; evita o pico da adesão
3. Reduzir o cadastro por conversa — só vale para quem não usa o formulário

**O que não vale a pena mexer:** o lembrete mensal. São 500 templates a
R$ 17,50 no total, e é ele que traz a pessoa de volta — cortá-lo economiza
pouco e custa a devolução inteira.

---

## 7. Como conferir estes números na sua instância

```
verificarConsumoMensagens()    // Setup.gs, no editor do Apps Script
```

Mostra serviço e template do mês corrente e projeta o fechamento. O contador é
alimentado por `Utils.fetchComRetry`, que marca cada entrega aceita pela Meta —
então mede o que é cobrado, não o que o código pretendia enviar.

Rode antes e depois de um bloco de testes para medir um fluxo isolado.
