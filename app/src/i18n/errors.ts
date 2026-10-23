import { sl } from './sl';

export const errorMessages: Record<string, string> = sl.errors;

const authErrorMessages: Record<string, string> = sl.authErrors;

const tokenPattern = /^(AMRAP_[A-Z_]+)/;

function stringField(value: unknown, field: 'message' | 'code'): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const found = (value as Record<string, unknown>)[field];
  return typeof found === 'string' ? found : undefined;
}

export function fromError(error: unknown): string {
  const message = typeof error === 'string' ? error : stringField(error, 'message');
  const token = message === undefined ? undefined : tokenPattern.exec(message)?.[1];
  if (token !== undefined && token in errorMessages) return errorMessages[token];
  const code = stringField(error, 'code');
  if (code !== undefined && code in authErrorMessages) return authErrorMessages[code];
  return sl.genericError;
}
