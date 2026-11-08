import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dashboard, Capability, Session } from '@capora/types';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...(options?.method ? { method: options.method } : {}),
    ...(options?.body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }
      : {}),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    // An edge failure can return HTML after a mutation has already reached the server.
    // Preserve the uncertain outcome; never replay a purchase automatically.
    const readOnly = !options?.method || ['GET', 'HEAD'].includes(options.method.toUpperCase());
    throw new ApiError(
      response.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'INVALID_RESPONSE',
      readOnly
        ? 'Capora returned an unreadable response. Please try again shortly.'
        : 'Capora could not confirm the result. Check the existing transaction or refresh its status before trying again.',
      response.status,
    );
  }
  if (!response.ok) {
    const envelope = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const details =
      envelope.error && typeof envelope.error === 'object'
        ? (envelope.error as Record<string, unknown>)
        : envelope;
    throw new ApiError(
      typeof details.code === 'string' ? details.code : 'REQUEST_FAILED',
      typeof details.message === 'string' ? details.message : 'The request failed.',
      response.status,
    );
  }
  return body as T;
}
export const useSession = () =>
  useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/auth/session'),
    retry: false,
    staleTime: 5_000,
  });
export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard'), refetchInterval: 2000 });
export const useCapabilities = (search = '') =>
  useQuery({
    queryKey: ['capabilities', search],
    queryFn: () => api<Capability[]>(`/capabilities${search ? `?${search}` : ''}`),
  });
export function useAction<T, V>(fn: (variables: V) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['dashboard'] }),
        client.invalidateQueries({ queryKey: ['capabilities'] }),
        client.invalidateQueries({ queryKey: ['provider-capabilities'] }),
        client.invalidateQueries({ queryKey: ['admin'] }),
      ]);
    },
  });
}
export function exampleInput(capability: Capability): Record<string, unknown> {
  const props = capability.inputSchema.properties as
    Record<string, { type?: string; default?: unknown; enum?: unknown[] }> | undefined;
  const required = capability.inputSchema.required as string[] | undefined;
  return Object.fromEntries(
    Object.entries(props ?? {})
      .filter(([key, schema]) => required?.includes(key) || schema.default !== undefined)
      .map(([key, schema]) => [
        key,
        schema.default ??
          schema.enum?.[0] ??
          (schema.type === 'integer' || schema.type === 'number'
            ? 1
            : schema.type === 'boolean'
              ? false
              : schema.type === 'object'
                ? {}
                : schema.type === 'array'
                  ? []
                  : 'example'),
      ]),
  );
}

export const time = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const latency = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s` : `${ms}ms`;
