# Cadastro por WhatsApp Flow — simulação e viabilidade

*Setembro de 2026*

Um **Flow** é um formulário nativo do WhatsApp: o usuário toca um botão, abre
uma tela dentro do próprio app, preenche tudo e envia **uma vez**. Do lado do
bot, isso chega como **uma única mensagem**.

Este documento descreve a simulação que já está no repositório, o que ela prova
e o que falta para valer em produção.

---

## 1. Por que isso interessa a este projeto

O cadastro conversacional de hoje gasta **~15 mensagens** e **~9 execuções**
do Apps Script. Não é só custo: é exatamente o formato que produz o **BL-29**
— cada resposta é uma execução separada, execuções se sobrepõem, e uma resposta
acaba gravada no campo da outra.

| | Cadastro por conversa | Cadastro por Flow |
|---|---|---|
| Mensagens | ~15 | 2 (envio do Flow + resumo) |
| Execuções do GAS | ~9 | 1 |
| Janela de corrida (BL-29) | existe em cada passo | **não existe** — uma gravação só |
| Validação | passo a passo, com erro imediato | toda no fim, pelo servidor |

O ganho real é a **coluna do meio da tabela virar uma linha só**: com uma
submissão, não há duas execuções do mesmo usuário competindo.

**O Flow não ajuda na devolução**, que é o fluxo caro no dia a dia (500/mês
contra um cadastro único por pessoa). A devolução depende de comprovante em
imagem/PDF e de OCR — nada disso cabe num formulário.

---

## 2. Modo sem endpoint — e por que é o único possível aqui

Flows têm dois modos:

- **Com endpoint**: cada tela chama um servidor seu. A Meta exige decifrar o
  payload com **RSA-OAEP-SHA256** e **AES-128-GCM**.
- **Sem endpoint**: o Flow roda inteiro no aparelho e devolve o resultado no
  fim.

O Apps Script oferece `Utilities.computeRsaSha256Signature`, que **assina** —
não decifra. Não há RSA-OAEP nem AES-GCM disponíveis. **O modo com endpoint
está fora**, e não por preferência de projeto.

Três consequências que mandam no código:

1. **As validações do Flow JSON rodam no cliente.** O que chega ao webhook é
   dado não verificado. Por isso `FlowHandler._normalizar` revalida tudo com as
   mesmas regras do `CadastroHandler` — nome ≥ 3, apelido ≥ 2, data real e não
   futura, endereço ≥ 5, valor > 0, dia entre 1 e 28.
2. **A lista de comunidades tem que ir junto.** O Flow não consulta o Odoo
   sozinho; `enviarFlowCadastro` manda as comunidades em
   `flow_action_payload.data`.
3. **Erro não volta para dentro do Flow.** Quando ele fecha, fechou. Um
   formulário recusado vira mensagem de conversa pedindo o cadastro pelo menu.

---

## 3. O que já está no repositório

| Arquivo | Papel |
|---|---|
| `FlowHandler.gs` | Recebe o `nfm_reply`, revalida, monta `dados_<from>` e chama `CadastroHandler.mostrarResumo`. Também envia o Flow (`enviarFlowCadastro`). |
| `Router.gs` | Ramo `nfm_reply` em `_rotearInterativo`. Sem ele a resposta cairia no menu principal e o formulário inteiro seria descartado em silêncio. |
| `Config.gs` | Estado `AGUARDANDO_FLOW_CADASTRO`. |
| `ferramentas/flow-cadastro.json` | O Flow JSON, uma tela só, para colar no Flow Builder da Meta. |
| `ferramentas/simula-flow.js` | Manda ao webhook o mesmo `nfm_reply` que o aparelho mandaria. |

O Flow **troca a coleta, não a gravação**: o resumo e o botão "✅ Confirmar"
são os mesmos de hoje, e quem grava no Odoo continua sendo
`CadastroHandler.finalizar`.

**Foto de perfil fica fora do formulário.** Quem vier pelo Flow cai direto no
resumo, sem foto. É deliberado: foto por Flow exigiria tratar upload de mídia,
e o ganho do Flow está em cortar as mensagens de texto.

---

## 4. Como rodar a simulação

Não é preciso criar Flow nenhum na Meta, nem usar o app do WhatsApp. No modo
sem endpoint, um cadastro por Flow é **exatamente uma requisição HTTP** — e o
simulador faz essa requisição.

```bash
node ferramentas/simula-flow.js \
  --url "https://script.google.com/.../exec" \
  --token "<WEBHOOK_SECRET>" \
  --comunidade 3
```

Casos disponíveis em `--caso`:

| Caso | O que deve acontecer |
|---|---|
| `ok` (padrão) | `✅ [Flow] Cadastro ... montado em 1 execução` e o resumo chega no WhatsApp |
| `data-invalida` | 31/02 recusado — **o caso que mais importa**: prova que o servidor não confia na validação do cliente |
| `valor-zero` | recusado; `0` passa pelo `input-type: number` do Flow |
| `campo-faltando` | recusado; simula o Flow editado sem que o handler saiba |
| `token-errado` | cai no menu, não no cadastro |

O `200` diz apenas que o webhook aceitou. O veredito está no Cloud Logging
(procure por `[Flow]`) e no WhatsApp do número de teste.

⚠️ Escreve de verdade: confirmando o resumo, o cadastro vai para o Odoo. O
número padrão começa com `5599`, o mesmo prefixo das ferramentas de teste, e
sai com `limparContatosTeste()`.

### Prova offline das regras de validação

As regras de `_normalizar` foram exercitadas fora do Apps Script, com 12 casos,
sob o fuso do projeto (`America/Sao_Paulo`). Um achado dessa prova está no
código: o `DatePicker` do Flow devolve **epoch em milissegundos na meia-noite
UTC**, e ler isso com `getDate()` num projeto em UTC-3 voltaria **um dia em
todo cadastro**. Por isso aquele trecho usa `getUTCDate()`.

---

## 4b. Testar no WhatsApp de verdade, antes de publicar

A página de simulação e o `simula-flow.js` cobrem o **servidor**. Nenhum dos
dois mostra como o formulário se comporta num aparelho — rolagem, teclado
numérico, o `DatePicker`, o aviso de campo obrigatório. Para isso há três
caminhos, do mais barato ao mais fiel:

### Limites que o validador do Flow Builder cobra

O JSON só é aceito depois que o validador passa, e ele tem limites que não estão
escritos no arquivo:

| Onde | Limite |
|---|---|
| `label` de qualquer componente | **20 caracteres** — "para evitar truncamento em telas diferentes" |
| `helper-text` | 80 caracteres |
| `title` da tela | 30 caracteres |

O limite de 20 é o que pega: um rótulo natural em português como
"Quer receber lembrete mensal?" estoura. A saída é encurtar o `label` e mandar o
detalhe para o `helper-text`, que tem quatro vezes mais espaço — foi o que
`flow-cadastro.json` faz com o formato da data e a faixa de 1 a 28.

**1. Preview do Flow Builder.** No WhatsApp Manager → Flows, o botão *Preview*
abre o formulário num telefone simulado, com troca de iOS/Android e claro/escuro.
Não envolve o bot: serve para conferir layout e validações declaradas.

**2. Link de preview.** O mesmo Preview gera uma URL compartilhável, válida por
**30 dias**. Útil para mostrar à secretaria ou ao coordenador sem instalar nada.

**3. Enviar o rascunho para um celular.** É o teste de verdade — o formulário
abre dentro do WhatsApp e a resposta chega no webhook:

```
enviarFlowDeTeste('5586999998888')     // Setup.gs, no editor do Apps Script
```

A Meta permite enviar a versão **em rascunho** com `mode: 'draft'` nos
parâmetros da mensagem, então **não é preciso publicar o Flow** para testar.
O cliente mostra um aviso de que é rascunho.

Duas restrições que costumam ser confundidas com bug:

- Um Flow em rascunho **só abre para números com papel na conta da Meta**
  (admin, desenvolvedor ou testador). Num número qualquer o botão aparece mas
  não abre.
- Vale a **janela de 24 h**: o número precisa ter mandado alguma mensagem ao bot
  nas últimas 24 horas, senão a Meta recusa o envio.

Ordem prática: criar e **salvar** o Flow no WhatsApp Manager (sem publicar) →
`adicionarPropriedade('FLOW_ID_CADASTRO', '<id>')` → mandar "oi" ao bot pelo
celular de teste → `enviarFlowDeTeste()`.

---

## 5. O que falta para valer em produção

1. **Criar o Flow na Meta** (WhatsApp Manager → Flows), colar o conteúdo de
   `ferramentas/flow-cadastro.json`, salvar e — depois de testar o rascunho num
   aparelho, como descrito na seção 4b — publicar.
2. **Guardar o id** na propriedade `FLOW_ID_CADASTRO`. Sem ela,
   `enviarFlowCadastro` devolve `false` e o bot segue pelo cadastro por
   conversa — é o que permite publicar este código antes de existir Flow algum.
3. **Chamar `FlowHandler.enviarFlowCadastro(from)` no `CadastroHandler.iniciar`**,
   caindo no fluxo atual quando devolver `false`. *Ainda não foi feito*: enquanto
   o Flow não estiver publicado e testado num aparelho real, o caminho de
   entrada continua o de sempre.
4. **Testar num aparelho** com `enviarFlowDeTeste()` (seção 4b). O simulador
   cobre o lado do servidor por completo; ele não cobre a renderização do
   formulário nem o comportamento do `DatePicker` no aparelho.

### Custo

Flows não têm cobrança própria. A mensagem que **abre** o Flow é uma mensagem
de serviço comum, cobrada como qualquer outra. Menos mensagens no cadastro
significa custo menor, não maior — mas o cadastro é evento único por pessoa, e
não é ele que pesa na conta mensal.
