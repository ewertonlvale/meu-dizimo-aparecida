/**
 * carregador.mjs — lê os `.gs` do deploy e os executa num contexto do `vm` (BL-74, Fase 2).
 *
 * QUAIS ARQUIVOS: os mesmos que o `clasp push` manda — todo `.gs` da raiz que o
 * `.claspignore` não corta —, menos o `Plataforma.gs`, que no Node é trocado
 * pela implementação de `servidor/plataforma/`. Uma lista só, derivada, para o
 * runtime novo nunca carregar algo que produção não tem (nem o contrário).
 *
 * UM CONTEXTO NOVO POR EXECUÇÃO. No Apps Script, cada mensagem começa do zero:
 * `Utils._mensagemAtualId`, os contadores do BL-25 e os caches em memória do
 * OdooService morrem com a execução. Numa worker de vida longa eles
 * SOBREVIVERIAM — e o "digitando…" de uma pessoa poderia sair com o id da
 * mensagem de outra. Recriar o contexto custa ~1 ms (medido em 25/09) e elimina
 * essa classe inteira de defeito por construção, em vez de caçá-la variável
 * por variável.
 *
 * Os scripts são COMPILADOS uma vez; a cada execução, só rodam de novo.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Os `.gs` que vão para produção, na ordem de carga. */
export function arquivosDoDeploy(raiz = RAIZ) {
  const ignorados = fs.readFileSync(path.join(raiz, '.claspignore'), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const gs = fs.readdirSync(raiz)
    .filter((f) => f.endsWith('.gs') && !ignorados.includes(f) && f !== 'Plataforma.gs')
    .sort();
  // Config.gs primeiro: é onde moram as constantes (ESTADOS, TIMEZONE…) que
  // os outros usam. Hoje nenhum arquivo as lê no carregamento — mas se um
  // passar a ler, a ordem já está certa.
  return ['Config.gs', ...gs.filter((f) => f !== 'Config.gs')];
}

/** O fuso do projeto, lido do mesmo lugar que o Apps Script lê. */
export function fusoDoProjeto(raiz = RAIZ) {
  return JSON.parse(fs.readFileSync(path.join(raiz, 'appsscript.json'), 'utf8')).timeZone;
}

export function compilar(raiz = RAIZ) {
  return arquivosDoDeploy(raiz).map((arq) => new vm.Script(
    fs.readFileSync(path.join(raiz, arq), 'utf8'), { filename: arq }));
}

/**
 * Um contexto novo, com os `.gs` carregados.
 * @param {vm.Script[]} scripts
 * @param {Object} globais - Plataforma, console, Logger
 */
export function novoContexto(scripts, globais) {
  const ctx = vm.createContext({ ...globais });
  for (const s of scripts) s.runInContext(ctx);
  return ctx;
}
