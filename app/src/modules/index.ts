/**
 * modules/index.ts — onde as telas dedicadas entram no app.
 *
 * Só entra aqui o que é real hoje: os ganhos que o entregador lança, a margem
 * em cima deles e a simulação de crédito sobre essa renda.
 *
 * Conta, MEI, moto, cartão, seguro e saúde NÃO têm tela própria de propósito:
 * dependem de fornecedor contratado. Enquanto não houver, o `ModuloPage`
 * mostra a dependência real e a lista de espera — nada de saldo, CNPJ ou
 * apólice de mentira. Quando o fornecedor entrar, o módulo fica `pronto` e
 * passa a rodar a jornada configurada no admin; a tela dedicada, se valer a
 * pena, é só registrar aqui.
 */

import { registrarModulos } from "@/platform/registry";
import { moduloCredito } from "./credito";
import { moduloGanhos } from "./ganhos";
import { moduloMargem } from "./margem";

export function registrarTodosOsModulos(): void {
  registrarModulos([moduloGanhos, moduloMargem, moduloCredito]);
}
