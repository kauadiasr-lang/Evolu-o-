export function resolveConfig(env: Record<string, string | undefined>): { provider: string; apiKey: string; baseUrl: string; model: string; keyOptional: boolean };
export function complete(cfg: ReturnType<typeof resolveConfig>, req: { system: string; user: string; maxTokens?: number }, fetchImpl?: typeof fetch): Promise<{ text: string; model: string }>;
