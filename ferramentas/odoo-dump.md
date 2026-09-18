# Dump do Odoo — 2026-09-18T21:38:52.795Z

Odoo: (omitido) · db: (omitido) · uid: (omitido)

> Identificação da instância omitida — o repositório é público. Para incluí-la
> num dump local, rode com `--identificar`.

## Modelos customizados (7)

### `x_comunidade`  — registros: 6
| campo | tipo | relação | related (path) | req | store | ro | selection |
|---|---|---|---|---|---|---|---|
| `activity_date_deadline` | date |  |  |  |  | sim |  |
| `activity_exception_decoration` | selection |  |  |  |  | sim | warning, danger |
| `activity_exception_icon` | char |  |  |  |  | sim |  |
| `activity_ids` | one2many | mail.activity |  |  | sim |  |  |
| `activity_plans_ids` | many2many | mail.activity.plan |  |  |  | sim |  |
| `activity_state` | selection |  |  |  |  | sim | overdue, today, planned |
| `activity_summary` | char |  | activity_ids.summary |  |  |  |  |
| `activity_type_icon` | char |  | activity_ids.icon |  |  | sim |  |
| `activity_type_id` | many2one | mail.activity.type | activity_ids.activity_type_id |  |  |  |  |
| `activity_user_id` | many2one | res.users |  |  |  | sim |  |
| `create_date` | datetime |  |  |  | sim | sim |  |
| `create_uid` | many2one | res.users |  |  | sim | sim |  |
| `display_name` | char |  |  |  |  | sim |  |
| `has_message` | boolean |  |  |  |  | sim |  |
| `id` | integer |  |  |  | sim | sim |  |
| `message_attachment_count` | integer |  |  |  |  | sim |  |
| `message_follower_ids` | one2many | mail.followers |  |  | sim |  |  |
| `message_has_error` | boolean |  |  |  |  | sim |  |
| `message_has_error_counter` | integer |  |  |  |  | sim |  |
| `message_has_sms_error` | boolean |  |  |  |  | sim |  |
| `message_ids` | one2many | mail.message |  |  | sim |  |  |
| `message_is_follower` | boolean |  |  |  |  | sim |  |
| `message_needaction` | boolean |  |  |  |  | sim |  |
| `message_needaction_counter` | integer |  |  |  |  | sim |  |
| `message_partner_ids` | many2many | res.partner |  |  |  |  |  |
| `my_activity_date_deadline` | date |  |  |  |  | sim |  |
| `website_message_ids` | one2many | mail.message |  |  | sim |  |  |
| `write_date` | datetime |  |  |  | sim | sim |  |
| `write_uid` | many2one | res.users |  |  | sim | sim |  |
| `x_active` | boolean |  |  |  | sim |  |  |
| `x_name` | char |  |  | sim | sim |  |  |
| `x_studio_banco` | char |  |  |  | sim |  |  |
| `x_studio_chave_acesso` | char |  |  |  | sim |  |  |
| `x_studio_chave_pix` | char |  |  |  | sim |  |  |
| `x_studio_coordenador` | many2one | res.users |  |  | sim |  |  |
| `x_studio_coordenador_dizimo` | char |  |  |  | sim |  |  |
| `x_studio_devolucoes` | one2many | x_devolucao |  |  | sim |  |  |
| `x_studio_dizimistas` | one2many | x_dizimista |  |  | sim |  |  |
| `x_studio_qr_code` | binary |  |  |  | sim |  |  |
| `x_studio_sequence` | integer |  |  |  | sim |  |  |
| `x_studio_titular_conta` | char |  |  |  | sim |  |  |
| `x_studio_usuarios` | many2many | res.users |  |  | sim |  |  |
| `x_studio_whatsapp_coordenador` | char |  |  |  | sim |  |  |

### `x_contato_bot`  — registros: 4
| campo | tipo | relação | related (path) | req | store | ro | selection |
|---|---|---|---|---|---|---|---|
| `create_date` | datetime |  |  |  | sim | sim |  |
| `create_uid` | many2one | res.users |  |  | sim | sim |  |
| `display_name` | char |  |  |  |  | sim |  |
| `id` | integer |  |  |  | sim | sim |  |
| `write_date` | datetime |  |  |  | sim | sim |  |
| `write_uid` | many2one | res.users |  |  | sim | sim |  |
| `x_active` | boolean |  |  |  | sim |  |  |
| `x_name` | char |  |  | sim | sim |  |  |
| `x_studio_cadastrou` | boolean |  |  |  | sim |  |  |
| `x_studio_data_primeiro_contato` | datetime |  |  |  | sim |  |  |
| `x_studio_etapa_abandono` | char |  |  |  | sim |  |  |
| `x_studio_log_cadastro` | text |  |  |  | sim |  |  |
| `x_studio_sequence` | integer |  |  |  | sim |  |  |

### `x_devolucao`  — registros: 5157
| campo | tipo | relação | related (path) | req | store | ro | selection |
|---|---|---|---|---|---|---|---|
| `activity_date_deadline` | date |  |  |  |  | sim |  |
| `activity_exception_decoration` | selection |  |  |  |  | sim | warning, danger |
| `activity_exception_icon` | char |  |  |  |  | sim |  |
| `activity_ids` | one2many | mail.activity |  |  | sim |  |  |
| `activity_plans_ids` | many2many | mail.activity.plan |  |  |  | sim |  |
| `activity_state` | selection |  |  |  |  | sim | overdue, today, planned |
| `activity_summary` | char |  | activity_ids.summary |  |  |  |  |
| `activity_type_icon` | char |  | activity_ids.icon |  |  | sim |  |
| `activity_type_id` | many2one | mail.activity.type | activity_ids.activity_type_id |  |  |  |  |
| `activity_user_id` | many2one | res.users |  |  |  | sim |  |
| `create_date` | datetime |  |  |  | sim | sim |  |
| `create_uid` | many2one | res.users |  |  | sim | sim |  |
| `display_name` | char |  |  |  |  | sim |  |
| `has_message` | boolean |  |  |  |  | sim |  |
| `id` | integer |  |  |  | sim | sim |  |
| `message_attachment_count` | integer |  |  |  |  | sim |  |
| `message_follower_ids` | one2many | mail.followers |  |  | sim |  |  |
| `message_has_error` | boolean |  |  |  |  | sim |  |
| `message_has_error_counter` | integer |  |  |  |  | sim |  |
| `message_has_sms_error` | boolean |  |  |  |  | sim |  |
| `message_ids` | one2many | mail.message |  |  | sim |  |  |
| `message_is_follower` | boolean |  |  |  |  | sim |  |
| `message_needaction` | boolean |  |  |  |  | sim |  |
| `message_needaction_counter` | integer |  |  |  |  | sim |  |
| `message_partner_ids` | many2many | res.partner |  |  |  |  |  |
| `my_activity_date_deadline` | date |  |  |  |  | sim |  |
| `website_message_ids` | one2many | mail.message |  |  | sim |  |  |
| `write_date` | datetime |  |  |  | sim | sim |  |
| `write_uid` | many2one | res.users |  |  | sim | sim |  |
| `x_active` | boolean |  |  |  | sim |  |  |
| `x_name` | char |  |  | sim | sim |  |  |
| `x_studio_competencia` | date |  |  |  | sim |  |  |
| `x_studio_comprovante` | binary |  |  |  | sim |  |  |
| `x_studio_comunidade` | many2one | x_comunidade | x_studio_dizimista.x_studio_comunidade |  | sim | sim |  |
| `x_studio_conferencia_pix` | char |  |  |  | sim |  |  |
| `x_studio_currency_id` | many2one | res.currency |  |  | sim |  |  |
| `x_studio_data_da_devolucao` | date |  |  |  | sim |  |  |
| `x_studio_dizimista` | many2one | x_dizimista |  |  | sim |  |  |
| `x_studio_forma_de_pagamento` | selection |  |  |  | sim |  | Pix, Dinheiro |
| `x_studio_nome_arquivo` | char |  |  |  | sim |  |  |
| `x_studio_sequence` | integer |  |  |  | sim |  |  |
| `x_studio_status` | selection |  |  |  | sim |  | Pendente, Confirmado, Rejeitado |
| `x_studio_tipo_comprovante` | selection |  |  |  | sim |  | imagem, pdf |
| `x_studio_value` | monetary |  |  |  | sim |  |  |

### `x_dizimista`  — registros: 508
| campo | tipo | relação | related (path) | req | store | ro | selection |
|---|---|---|---|---|---|---|---|
| `activity_date_deadline` | date |  |  |  |  | sim |  |
| `activity_exception_decoration` | selection |  |  |  |  | sim | warning, danger |
| `activity_exception_icon` | char |  |  |  |  | sim |  |
| `activity_ids` | one2many | mail.activity |  |  | sim |  |  |
| `activity_plans_ids` | many2many | mail.activity.plan |  |  |  | sim |  |
| `activity_state` | selection |  |  |  |  | sim | overdue, today, planned |
| `activity_summary` | char |  | activity_ids.summary |  |  |  |  |
| `activity_type_icon` | char |  | activity_ids.icon |  |  | sim |  |
| `activity_type_id` | many2one | mail.activity.type | activity_ids.activity_type_id |  |  |  |  |
| `activity_user_id` | many2one | res.users |  |  |  | sim |  |
| `create_date` | datetime |  |  |  | sim | sim |  |
| `create_uid` | many2one | res.users |  |  | sim | sim |  |
| `display_name` | char |  |  |  |  | sim |  |
| `has_message` | boolean |  |  |  |  | sim |  |
| `id` | integer |  |  |  | sim | sim |  |
| `message_attachment_count` | integer |  |  |  |  | sim |  |
| `message_follower_ids` | one2many | mail.followers |  |  | sim |  |  |
| `message_has_error` | boolean |  |  |  |  | sim |  |
| `message_has_error_counter` | integer |  |  |  |  | sim |  |
| `message_has_sms_error` | boolean |  |  |  |  | sim |  |
| `message_ids` | one2many | mail.message |  |  | sim |  |  |
| `message_is_follower` | boolean |  |  |  |  | sim |  |
| `message_needaction` | boolean |  |  |  |  | sim |  |
| `message_needaction_counter` | integer |  |  |  |  | sim |  |
| `message_partner_ids` | many2many | res.partner |  |  |  |  |  |
| `my_activity_date_deadline` | date |  |  |  |  | sim |  |
| `website_message_ids` | one2many | mail.message |  |  | sim |  |  |
| `write_date` | datetime |  |  |  | sim | sim |  |
| `write_uid` | many2one | res.users |  |  | sim | sim |  |
| `x_active` | boolean |  |  |  | sim |  |  |
| `x_name` | char |  |  | sim | sim |  |  |
| `x_studio_bairro` | char |  |  |  | sim |  |  |
| `x_studio_classificacao` | selection |  |  |  | sim |  | Regular, Eventual, Inativo |
| `x_studio_comunidade` | many2one | x_comunidade |  |  | sim |  |  |
| `x_studio_cpf` | char |  |  |  | sim |  |  |
| `x_studio_currency_id` | many2one | res.currency |  |  | sim |  |  |
| `x_studio_data_cadastro` | date |  |  |  | sim |  |  |
| `x_studio_date` | date |  |  |  | sim |  |  |
| `x_studio_devolucoes` | one2many | x_devolucao |  |  | sim |  |  |
| `x_studio_dia_preferido` | integer |  |  |  | sim |  |  |
| `x_studio_endereco` | char |  |  |  | sim |  |  |
| `x_studio_image` | binary |  |  |  | sim |  |  |
| `x_studio_nome_completo` | char |  |  |  | sim |  |  |
| `x_studio_notificacao_ativa` | boolean |  |  |  | sim |  |  |
| `x_studio_numero` | char |  |  |  | sim |  |  |
| `x_studio_partner_email` | char |  | x_studio_partner_id.email |  | sim |  |  |
| `x_studio_partner_id` | many2one | res.partner |  |  | sim |  |  |
| `x_studio_partner_phone` | char |  | x_studio_partner_id.phone |  | sim |  |  |
| `x_studio_referencia` | char |  |  |  | sim |  |  |
| `x_studio_responsavel` | many2one | x_dizimista |  |  | sim |  |  |
| `x_studio_rua` | char |  |  |  | sim |  |  |
| `x_studio_sequence` | integer |  |  |  | sim |  |  |
| `x_studio_value` | monetary |  |  |  | sim |  |  |

### `x_notificacao_log`  — registros: 3
| campo | tipo | relação | related (path) | req | store | ro | selection |
|---|---|---|---|---|---|---|---|
| `activity_date_deadline` | date |  |  |  |  | sim |  |
| `activity_exception_decoration` | selection |  |  |  |  | sim | warning, danger |
| `activity_exception_icon` | char |  |  |  |  | sim |  |
| `activity_ids` | one2many | mail.activity |  |  | sim |  |  |
| `activity_plans_ids` | many2many | mail.activity.plan |  |  |  | sim |  |
| `activity_state` | selection |  |  |  |  | sim | overdue, today, planned |
| `activity_summary` | char |  | activity_ids.summary |  |  |  |  |
| `activity_type_icon` | char |  | activity_ids.icon |  |  | sim |  |
| `activity_type_id` | many2one | mail.activity.type | activity_ids.activity_type_id |  |  |  |  |
| `activity_user_id` | many2one | res.users |  |  |  | sim |  |
| `create_date` | datetime |  |  |  | sim | sim |  |
| `create_uid` | many2one | res.users |  |  | sim | sim |  |
| `display_name` | char |  |  |  |  | sim |  |
| `has_message` | boolean |  |  |  |  | sim |  |
| `id` | integer |  |  |  | sim | sim |  |
| `message_attachment_count` | integer |  |  |  |  | sim |  |
| `message_follower_ids` | one2many | mail.followers |  |  | sim |  |  |
| `message_has_error` | boolean |  |  |  |  | sim |  |
| `message_has_error_counter` | integer |  |  |  |  | sim |  |
| `message_has_sms_error` | boolean |  |  |  |  | sim |  |
| `message_ids` | one2many | mail.message |  |  | sim |  |  |
| `message_is_follower` | boolean |  |  |  |  | sim |  |
| `message_needaction` | boolean |  |  |  |  | sim |  |
| `message_needaction_counter` | integer |  |  |  |  | sim |  |
| `message_partner_ids` | many2many | res.partner |  |  |  |  |  |
| `my_activity_date_deadline` | date |  |  |  |  | sim |  |
| `website_message_ids` | one2many | mail.message |  |  | sim |  |  |
| `write_date` | datetime |  |  |  | sim | sim |  |
| `write_uid` | many2one | res.users |  |  | sim | sim |  |
| `x_active` | boolean |  |  |  | sim |  |  |
| `x_name` | char |  |  | sim | sim |  |  |
| `x_studio_data_envio` | date |  |  |  | sim |  |  |
| `x_studio_dizimista` | many2one | x_dizimista |  |  | sim |  |  |
| `x_studio_mensagem_erro` | text |  |  |  | sim |  |  |
| `x_studio_mes_referencia` | char |  |  |  | sim |  |  |
| `x_studio_sequence` | integer |  |  |  | sim |  |  |
| `x_studio_status_envio` | selection |  |  |  | sim |  | sucesso, erro |
| `x_studio_tipo` | selection |  |  |  | sim |  | lembrete, relatório |

### `x_parametros`  — registros: 1
| campo | tipo | relação | related (path) | req | store | ro | selection |
|---|---|---|---|---|---|---|---|
| `activity_date_deadline` | date |  |  |  |  | sim |  |
| `activity_exception_decoration` | selection |  |  |  |  | sim | warning, danger |
| `activity_exception_icon` | char |  |  |  |  | sim |  |
| `activity_ids` | one2many | mail.activity |  |  | sim |  |  |
| `activity_plans_ids` | many2many | mail.activity.plan |  |  |  | sim |  |
| `activity_state` | selection |  |  |  |  | sim | overdue, today, planned |
| `activity_summary` | char |  | activity_ids.summary |  |  |  |  |
| `activity_type_icon` | char |  | activity_ids.icon |  |  | sim |  |
| `activity_type_id` | many2one | mail.activity.type | activity_ids.activity_type_id |  |  |  |  |
| `activity_user_id` | many2one | res.users |  |  |  | sim |  |
| `create_date` | datetime |  |  |  | sim | sim |  |
| `create_uid` | many2one | res.users |  |  | sim | sim |  |
| `display_name` | char |  |  |  |  | sim |  |
| `has_message` | boolean |  |  |  |  | sim |  |
| `id` | integer |  |  |  | sim | sim |  |
| `message_attachment_count` | integer |  |  |  |  | sim |  |
| `message_follower_ids` | one2many | mail.followers |  |  | sim |  |  |
| `message_has_error` | boolean |  |  |  |  | sim |  |
| `message_has_error_counter` | integer |  |  |  |  | sim |  |
| `message_has_sms_error` | boolean |  |  |  |  | sim |  |
| `message_ids` | one2many | mail.message |  |  | sim |  |  |
| `message_is_follower` | boolean |  |  |  |  | sim |  |
| `message_needaction` | boolean |  |  |  |  | sim |  |
| `message_needaction_counter` | integer |  |  |  |  | sim |  |
| `message_partner_ids` | many2many | res.partner |  |  |  |  |  |
| `my_activity_date_deadline` | date |  |  |  |  | sim |  |
| `website_message_ids` | one2many | mail.message |  |  | sim |  |  |
| `write_date` | datetime |  |  |  | sim | sim |  |
| `write_uid` | many2one | res.users |  |  | sim | sim |  |
| `x_active` | boolean |  |  |  | sim |  |  |
| `x_name` | char |  |  | sim | sim |  |  |
| `x_studio_avatar` | binary |  |  |  | sim |  |  |
| `x_studio_horario_de` | text |  |  |  | sim |  |  |
| `x_studio_numeros_privilegios` | one2many | x_parametros_line_c498a |  |  | sim |  |  |
| `x_studio_paroquia` | char |  |  |  | sim |  |  |
| `x_studio_repositorio_driver` | char |  |  |  | sim |  |  |
| `x_studio_secretaria_email` | char |  |  |  | sim |  |  |
| `x_studio_secretaria_whatsapp` | char |  |  |  | sim |  |  |
| `x_studio_sequence` | integer |  |  |  | sim |  |  |

### `x_parametros_line_c498a`  — registros: 2
| campo | tipo | relação | related (path) | req | store | ro | selection |
|---|---|---|---|---|---|---|---|
| `create_date` | datetime |  |  |  | sim | sim |  |
| `create_uid` | many2one | res.users |  |  | sim | sim |  |
| `display_name` | char |  |  |  |  | sim |  |
| `id` | integer |  |  |  | sim | sim |  |
| `write_date` | datetime |  |  |  | sim | sim |  |
| `write_uid` | many2one | res.users |  |  | sim | sim |  |
| `x_name` | char |  |  | sim | sim |  |  |
| `x_parametros_id` | many2one | x_parametros |  |  | sim |  |  |
| `x_studio_chave_acesso` | char |  |  |  | sim |  |  |
| `x_studio_notificacao_ativa` | boolean |  |  |  | sim |  |  |
| `x_studio_sequence` | integer |  |  |  | sim |  |  |
| `x_studio_whatsapp` | char |  |  |  | sim |  |  |

## Crons / rotinas
_falhou: Invalid field 'numbercall' on 'ir.cron'_

## Server actions
- **AI Agent Sources: Process Sources** (ai.agent.source, code)
- **AI Embedding: Generate Embeddings** (ai.embedding, code)
- **AI Fields: Compute AI fields** (ir.model.fields, code)
- **AI: Adjust Search** (ai.agent, code)
- **AI: Compute Date** (ai.agent, code)
- **AI: Compute Report Measures** (ai.agent, code)
- **AI: Create Records** (ai.session, code)
- **AI: Generate an Image** (ai.agent, code)
- **AI: Get Fields** (ai.agent, code)
- **AI: Get Menu Details** (ai.agent, code)
- **AI: Load Topics** (ai.agent, code)
- **AI: Open Menu Graph** (ai.agent, code)
- **AI: Open Menu Kanban** (ai.agent, code)
- **AI: Open Menu List** (ai.agent, code)
- **AI: Open Menu Pivot** (ai.agent, code)
- **AI: Read group** (ai.agent, code)
- **AI: Run view action** (ai.agent, code)
- **AI: Search** (ai.agent, code)
- **AI: Update Records** (ai.session, code)
- **AI: Web Search** (ai.session, code)
- **Archive Selection** (privacy.lookup.wizard.line, code)
- **Automation Rules: check and execute** (base.automation, code)
- **Base: Auto-vacuum internal data** (ir.autovacuum, code)
- **Base: Portal Users Deletion** (res.users.deletion, code)
- **Change Password** (res.users, code)
- **Config: Run Remaining Action Todo** (res.config, code)
- **Delete Selection** (privacy.lookup.wizard.line, code)
- **Digest Emails** (digest.digest, code)
- **Disable two-factor authentication** (res.users, code)
- **Discuss: channel member unmute** (discuss.channel.member, code)
- **Download (vCard)** (res.partner, code)
- **Edit in Spreadsheet** (spreadsheet.dashboard, code)
- **Export JS** (web_tour.tour, code)
- **Failed to install demo data for some modules, demo disabled** (ir.demo_failure.wizard, code)
- **Grant portal access** (portal.wizard, code)
- **Invite to use two-factor authentication** (res.users, code)
- **Mail: Email Queue Manager** (mail.mail, code)
- **Mail: End polls** (mail.poll, code)
- **Mail: Fetchmail Service** (fetchmail.server, code)
- **Mail: Post scheduled messages** (mail.scheduled.message, code)
- **Mail: send web push notification** (mail.push, code)
- **Notification: Delete Notifications older than 6 Months** (mail.notification, code)
- **Notification: Notify scheduled messages** (mail.message.schedule, code)
- **Open two-factor authentication configuration** (res.users, code)
- **Privacy Lookup** (res.users, code)
- **Privacy Lookup** (res.partner, code)
- **Publisher: Update Notification** (publisher_warranty.contract, code)
- **Resend** (sms.sms, code)
- **SMS: SMS Queue Manager** (sms.sms, code)
- **Send Password Reset Instructions** (res.users, code)
- **Snailmail: process letters queue** (snailmail.letter, code)
- **Users: Notify About Unregistered Users** (res.users, code)

## Automações (Studio)
_falhou: Invalid field 'action_server_id' on 'base.automation'_

## Record rules
- **Administrators can access all User Settings embedded actions** — ativa
- **Administrators can access all User Settings volumes.** — ativa
- **Administrators can access all User Settings.** — ativa
- **Administrators can access all activity plan templates.** — ativa
- **Administrators can access all activity plans.** — ativa
- **Administrators can read all device logs** — ativa
- **Administrators can read all devices** — ativa
- **Administrators can read all sessions** — ativa
- **Administrators can view user keys to revoke them** — ativa
- **Administrators can view user keys to revoke them** — ativa
- **Admins have all the rights on embedded actions** — ativa
- **Canned response: User read: own or in groups** — ativa
- **Canned response: User write/unlink: own only** — ativa
- **Canned response: admin has all access on shared canned response** — ativa
- **Comunidade - Ver apenas seus dizimistas** — ativa
- **Comunidade - Ver apenas sua comunidade** — ativa
- **Comunidade - Ver apenas suas devoluções** — ativa
- **Criação Usuário: só editar Pastoral** — ativa
- **Dashboard multi-company** — ativa
- **Defaults: alter all defaults** — ativa
- **Defaults: alter personal defaults** — ativa
- **Discuss.gif.favorite: User access** — ativa
- **Discuss.gif.favorite: admin full access** — ativa
- **Discuss.gif.favorite: admin full access** — ativa
- **Employees can only modify templates they have created or been assigned** — ativa
- **Functional Group: admin have full access** — ativa
- **Functional Group: update only by responsible** — ativa
- **Mail Compose Message Rule** — ativa
- **Mail Template Editors - Edit All Templates** — ativa
- **Partner bank company rule** — ativa
- **Passkeys: Admins can view and delete other peoples Passkeys** — ativa
- **Passkeys: Admins can view and delete other peoples Passkeys** — ativa
- **Passkeys: Users can only access own Passkeys** — ativa
- **Passkeys: Users can only modify their own Passkey creation requests** — ativa
- **Public users can't interact with keys at all** — ativa
- **SMS Template: system group granted all** — ativa
- **Spreadsheet dashboard share: manager** — ativa
- **Spreadsheet dashboard threads: groups** — ativa
- **Spreadsheet dashboard: groups** — ativa
- **Spreadsheet dashboard: manager** — ativa
- **Spreadsheet, default no access** — ativa
- **Studio Validation Entries: manage all entries (admin)** — ativa
- **Studio Validation Entries: manage your own entries (user)** — ativa
- **User IAP Account** — ativa
- **Users can modify or delete embedded actions that they have created or that are shared** — ativa
- **Users can only access their own wizard** — ativa
- **Users can read and delete their own keys** — ativa
- **Users can read and delete their own keys** — ativa
- **Users can read only their own device logs** — ativa
- **Users can read only their own devices** — ativa
- **Users can read only their own sessions** — ativa
- **access check to res_id** — ativa
- **change own password** — ativa
- **change user password rule** — ativa
- **company rule erp manager** — ativa
- **company rule erp manager** — ativa
- **company rule public** — ativa
- **create res_model** — ativa
- **create res_model** — ativa
- **discuss.call.history: read call history of accessible channels** — ativa
- **discuss.channel.member: access their own entries** — ativa
- **discuss.channel.member: admin can manipulate all entries** — ativa
- **discuss.channel.member: can join group restricted channels when group is matching** — ativa
- **discuss.channel.member: channel admin can remove members except admins and owners** — ativa
- **discuss.channel.member: channel owner can remove members except owners** — ativa
- **discuss.channel.member: internal users can invite others in channels they are member of** — ativa
- **discuss.channel.member: internal users can invite others in group restricted channels when group is matching** — ativa
- **discuss.channel.member: read members of accessible channels** — ativa
- **discuss.channel: admin full access** — ativa
- **discuss.channel: can access channels (as member or as group allowed)** — ativa
- **edit all** — ativa
- **edit all** — ativa
- **ir.filter: owner or global** — ativa
- **ir.filter: portal/public** — ativa
- **ir.filters.admin.all.rights** — ativa
- **ir.filters.admin.all.rights** — ativa
- **ir.ui.view_custom rule** — ativa
- **mail.activity: user: write/unlink only (created or assigned)** — ativa
- **mail.message.subtype: portal/public: read public subtypes** — ativa
- **mail.notifications: group_portal: own entries** — ativa
- **mail.notifications: group_user: write its own entries** — ativa
- **multi-company currency rate rule** — ativa
- **portal user access** — ativa
- **properties.base.definition: system all access** — ativa
- **read all** — ativa
- **read public attachments** — ativa
- **read res_model** — ativa
- **read res_model** — ativa
- **read res_model** — ativa
- **read res_model** — ativa
- **res.partner company** — ativa
- **res.users.log per user** — ativa
- **res.users.settings.embedded.action: access their own entries** — ativa
- **res.users.settings.volumes: access their own entries** — ativa
- **res.users.settings: access their own entries** — ativa
- **res_partner: portal/public: read access on my commercial partner** — ativa
- **resource.calendar.leaves: admin modifies global** — ativa
- **resource.calendar.leaves: admin modifies global** — ativa
- **resource.calendar.leaves: employee modifies own** — ativa
- **resource.calendar.leaves: employee reads own or global** — ativa
- **resource.calendar.leaves: multi-company rule** — ativa
- **resource.resource multi-company** — ativa
- **self user write access** — ativa
- **self user write access** — ativa
- **spreadsheet.dashboard.share: create uid** — ativa
- **unlink res_model** — ativa
- **unlink res_model** — ativa
- **user read access** — ativa
- **user rule** — ativa
- **users can only access their own id check** — ativa
- **write res_model** — ativa
- **write res_model** — ativa
- **write res_model** — ativa
- **write res_model** — ativa
- **false** — ativa
