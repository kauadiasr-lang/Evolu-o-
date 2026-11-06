/** Identificação da build (injetada pelo Vite a partir de versions/versions.json + git). Constante de build: não vem da simulação. */
export interface GsBuildInfo {
  nome: string;
  version: string;
  channel: string;
  stage: number;
  commit: string;
  buildDate: string;
  title: string;
}
declare const __GS__: GsBuildInfo;

export const GS: GsBuildInfo = typeof __GS__ !== 'undefined' ? __GS__ : { nome: 'GS Evolução', version: 'dev', channel: 'dev', stage: 0, commit: 'local', buildDate: '', title: 'servidor de desenvolvimento' };

export const CHANNEL_LABEL: Record<string, string> = { stable: 'estável', experimental: 'experimental', dev: 'desenvolvimento' };
export const channelLabel = (c: string) => CHANNEL_LABEL[c] ?? c;
/** texto curto para o HUD */
export const versionChip = () => `${GS.nome} v${GS.version} · ${channelLabel(GS.channel)}`;
