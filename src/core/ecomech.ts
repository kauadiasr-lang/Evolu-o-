import { P } from './params';

/**
 * Mecanismos ecológicos gerais da Etapa 5 (funções puras). Nenhum deles conhece espécies, rótulos ou relações:
 * apenas física (energia saturada vaza matéria; estrutura vegetal esconde corpos pequenos).
 */

/** Matéria que vaza por tick de um corpo cuja energia está em `fill` (energia/capacidade). 0 abaixo do limiar. */
export function exudation(mass: number, fill: number): number {
  if (fill <= P.EXUDE_FROM) return 0;
  return P.EXUDE_K * mass * ((fill - P.EXUDE_FROM) / (1 - P.EXUDE_FROM));
}

/** Fator multiplicativo da probabilidade de captura dada a cobertura vegetal da célula e o raio da presa. 1 = sem abrigo. */
export function refugeFactor(cover: number, preyRadius: number): number {
  return 1 - (P.REFUGE_K * cover) / (1 + preyRadius * preyRadius);
}
