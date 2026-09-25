/**
 * odoo-env.mjs — Lê as credenciais do Odoo de um arquivo local.
 *
 * POR QUE NÃO USAR `--env-file` DO NODE
 *   Existe desde o Node 20.6, mas o script roda na máquina de quem usa, e não
 *   dá para saber qual Node é. Um parser de 20 linhas aqui custa menos que uma
 *   mensagem de erro obscura na máquina de outra pessoa.
 *
 * PRECEDÊNCIA — a variável de ambiente REAL sempre ganha do arquivo.
 *   Assim dá para sobrescrever pontualmente sem editar nada:
 *     ODOO_DB=outro_banco node ferramentas/baixar-views.mjs
 *   E, num eventual CI, o segredo vem do cofre e o arquivo nem existe.
 *
 * FORMATO
 *   CHAVE=valor, uma por linha. `#` comenta. Aspas em volta do valor são
 *   removidas. O prefixo `export ` é tolerado, para o mesmo arquivo servir a
 *   um `source ferramentas/.odoo-env` no bash.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';

/**
 * Carrega o arquivo para dentro de `process.env`, sem sobrescrever o que já
 * estiver definido. Devolve o que foi lido, para o chamador poder avisar.
 *
 * `carregadas` traz só as chaves com valor. As que existem no arquivo mas
 * estão em branco saem em `vazias` — é o estado de quem acabou de copiar o
 * .exemplo, e confundir as duas faz o script anunciar "carreguei" logo antes
 * de dizer "faltou".
 *
 * @param {string} caminho
 * @returns {{carregadas: string[], vazias: string[], caminho: string}|null}
 *          null quando o arquivo não existe
 */
export function carregarEnv(caminho = 'ferramentas/.odoo-env') {
  if (!existsSync(caminho)) return null;

  // Um arquivo de credenciais legível por qualquer usuário da máquina é um
  // problema silencioso: nada falha, e a chave fica exposta. Avisar é barato.
  try {
    const modo = statSync(caminho).mode & 0o077;
    if (modo && process.platform !== 'win32') {
      console.warn(`⚠️  ${caminho} está acessível a outros usuários da máquina.`);
      console.warn(`   Corrija com:  chmod 600 ${caminho}`);
    }
  } catch { /* statSync falhou — não é motivo para impedir a leitura */ }

  const carregadas = [];
  const vazias = [];

  for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;

    const m = limpa.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;

    const chave = m[1];
    // Aspas só são removidas quando envolvem o valor inteiro — uma aspa no
    // meio de uma senha é parte da senha.
    const valor = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');

    if (process.env[chave] === undefined) {
      process.env[chave] = valor;
      (valor ? carregadas : vazias).push(chave);
    }
  }

  return { carregadas, vazias, caminho };
}
