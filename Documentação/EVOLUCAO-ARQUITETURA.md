# Evolução da arquitetura — o que trocar, quando, e por quanto

**Origem:** pergunta do usuário em 23/09/2026 — *"Se fosse trocar as ferramentas e tecnologias
para uma solução mais robusta a nível comercial, quais seriam? Ciente que haveria custos.
Escale entre: atende com baixo custo / ideal com alto custo."*

Este documento é o **por quê**. O **como** do Nível 1 está em `MIGRACAO-NIVEL-1.md`.

---

## A stack de hoje

| Peça | Hoje | Situação |
|---|---|---|
| Runtime | Google Apps Script | **é o teto arquitetural** (BL-21) |
| Mensageria | WhatsApp Cloud API, direto com a Meta | adequada |
| Dados | Odoo 19 SaaS (`saas~19.3`), plano Online **free** | ponto único de falha |
| OCR | Google Cloud Vision (chave de API) | adequado |
| Deploy | `clasp push` + republicar, manual | **sem rollback fácil, sem CI** |
| Monitoramento | nenhum | ninguém sabe que caiu até alguém reclamar |

### Os elos fracos, em ordem de risco

1. **O Apps Script como runtime.** É a origem do teto de ~30 execuções simultâneas (BL-21), das
   corridas de estado (BL-20, BL-29), do deploy manual e da ausência de observabilidade. É a
   maior alavanca isolada que existe no projeto.
2. **Deploy manual sem CI.** Um push ruim quebra a produção em silêncio, e voltar exige saber
   que dá para reapontar a implantação para uma versão anterior.
3. **Sem monitoramento.** O primeiro detector de falha é um fiel reclamando.
4. **Odoo Online free.** Um app só, sem módulos, sem acesso ao banco, sem staging — e os termos
   do plano gratuito são da Odoo para mudar, não suas.

---

## Os três níveis

### Nível 1 — atende, e o custo em dinheiro é quase zero

**Troca só o runtime.**

| Hoje | Vira | Por quê |
|---|---|---|
| Apps Script | **Cloud Run** (Node, scale-to-zero) | mesma linguagem, sem servidor para cuidar |
| webhook síncrono | **Cloud Tasks** na frente | responde 200 na hora, processa depois, com retry |
| `CacheService` / `PropertiesService` | **Redis** (Upstash) | TTL e operação atômica de verdade, sem limite de 100 KB |
| `clasp push` manual | **GitHub Actions** no merge | rollback vira reativar a revisão anterior |
| nada | Cloud Logging + alerta + uptime check | |

**Fecha:** BL-21, BL-20, boa parte do BL-29, BL-43, e a publicação manual.

**Custo:** R$ 30–100/mês — e quase tudo já é o WhatsApp que se paga hoje.

**O preço real não é dinheiro, é trabalho:** 4 a 6 fins de semana. É o melhor retorno por real
de toda esta lista, com folga.

### Nível 2 — robusto de verdade

Tudo do Nível 1, mais:

- **Sair do Odoo Online free**, por um de dois caminhos com custos bem diferentes:
  - *Odoo Community self-hosted* num VPS (~R$ 30–60/mês): módulos de verdade, acesso ao banco e
    **migrações de schema versionadas no git** — o que aposentaria os `instalar-*.mjs` ad-hoc que
    hoje são o único jeito de mudar o Odoo. Custa administração: backup, atualização, segurança.
  - *Odoo Online pago* (~US$ 25/usuário/mês): R$ 400–550 com 3–4 agentes. Zero administração, e
    continua sem acesso ao banco.
- **Postgres próprio** (Neon, Supabase, Cloud SQL) como registro do estado do bot e log de
  eventos. O Odoo segue sendo a tela da pastoral, mas deixa de ser a **única cópia**.
- **Sentry** (~R$ 140/mês): erro em produção com stack trace e contexto, não linha de log.
- **BSP de WhatsApp** (360dialog ~€49, Twilio por mensagem). Tecnicamente opcional. O que se
  compra é **alguém a quem recorrer** quando a Meta bloqueia o número ou rejeita um template —
  hoje isso não tem telefone.

**Custo:** R$ 400–1.200/mês. A faixa é larga por causa das duas escolhas acima.

### Nível 3 — ideal, alto custo

Postgres gerenciado com HA e point-in-time recovery; três ambientes (dev/staging/prod) com dados
sintéticos; Odoo Enterprise; BSP com SLA contratual; Document AI com parser treinado para
comprovante brasileiro no lugar do Vision genérico; Terraform e secret manager; observabilidade
paga; auditoria LGPD formal e pentest anual.

**Custo:** R$ 3.000–8.000/mês, mais R$ 8–25k de pentest uma vez por ano.

**Recomendação explícita: não faça.** Para uma paróquia isso é pagar por garantias que ninguém
vai cobrar — não há SLA contratual com os dizimistas, e duas horas fora do ar num domingo custam
incômodo, não dinheiro. O Nível 3 só faz sentido se isto virar **produto para várias paróquias**,
e aí a conta inverte porque passa a haver receita.

---

## O que NÃO trocar

- **WhatsApp Cloud API direto.** Funciona, é barato, e o BSP agrega suporte humano, não
  capacidade técnica.
- **Cloud Vision.** Resolve comprovante brasileiro bem o bastante depois do BL-52, e custa quase
  nada neste volume.
- **Odoo como tela da pastoral.** Os agentes já sabem usar. Trocar por um admin próprio seriam
  meses de trabalho para chegar no mesmo lugar. O que precisa mudar é o **plano**, não a
  ferramenta.

---

## Duas coisas que dinheiro nenhum resolve

**Multi-paróquia não é troca de ferramenta, é outra arquitetura.** Os modelos `x_dizimista`,
`x_devolucao` e `x_comunidade` criados no Studio são de uma instância só. Multi-tenancy quebra
antes do runtime. Se esse for o plano, ele muda a ordem de tudo aqui — e o primeiro problema
passa a ser isolamento de dados, não vazão.

**O fator ônibus é 1.** Uma pessoa entende o sistema inteiro. O `BACKLOG.md`, com o raciocínio de
cada decisão preservado, é uma defesa boa e incomum contra isso — mas parcial. Resolve-se com uma
segunda pessoa, não com infraestrutura.

---

## Veredito

**Se fosse fazer uma coisa só: o Nível 1, e dentro dele só o Cloud Run com a fila.** Fecha três
itens abertos do backlog, custa quase nada por mês, e é o único passo que os outros dois níveis
pressupõem.

Os valores deste documento são ordem de grandeza, apurados em setembro de 2026, e mudam.
Os limites gratuitos verificados na fonte estão em `MIGRACAO-NIVEL-1.md`.
