/**
 * modules/index.ts — onde as telas dedicadas entram no app.
 *
 * Esta é a ÚNICA lista de telas do produto. Módulos que não estão aqui rodam
 * pela jornada genérica — é de propósito: moto, cartão, seguro e saúde são
 * vendidos hoje pelo `JornadaRunner`, e ganham tela própria quando a jornada
 * deixar de dar conta. Para trocar, escreva o componente e acrescente aqui.
 */

import { registrarModulos } from "@/platform/registry";
import { moduloConta } from "./conta";
import { moduloGanhos } from "./ganhos";
import { moduloMargem } from "./margem";
import { moduloMei } from "./mei";

export function registrarTodosOsModulos(): void {
  registrarModulos([moduloConta, moduloGanhos, moduloMargem, moduloMei]);
}
