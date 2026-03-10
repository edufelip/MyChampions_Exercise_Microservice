export function isRetryableStatus(status?: number): boolean {
  if (!status) {
    return true;
  }
  return status === 408 || status === 429 || status >= 500;
}

export function isRetryableCode(code?: string): boolean {
  if (!code) {
    return false;
  }
  return new Set([
    'ECONNABORTED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
  ]).has(code);
}

export async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function backoffDelayMs(attempt: number): number {
  const base = 150;
  return base * 2 ** (attempt - 1);
}
