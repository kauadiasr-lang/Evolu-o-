export function createHandler(opts?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: () => number }): (req: any, res: any) => Promise<void>;
