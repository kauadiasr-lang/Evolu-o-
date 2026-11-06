/**
 * Cor de cada espécie (identidade visual estável). Depende SÓ do id da espécie — que vem do motor —, não de genes nem de
 * estado de simulação; por isso o mesmo id tem a mesma cor no mapa, nas listas, nos gráficos e na árvore da vida.
 * Ângulo áureo: ids vizinhos (espécies-irmãs) ficam bem separados no círculo cromático.
 */
const cache: string[] = [];
export function speciesHue(id: number): number {
  return (id * 137.508) % 360;
}
export function speciesCss(id: number): string {
  let c = cache[id];
  if (!c) {
    const l = 56 + ((id * 7) % 3) * 7; // 56/63/70: reforça a separação entre tons parecidos
    c = `hsl(${speciesHue(id).toFixed(0)},82%,${l}%)`;
    cache[id] = c;
  }
  return c;
}
