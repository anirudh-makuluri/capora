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
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      body.error?.code ?? body.code ?? 'REQUEST_FAILED',
      body.error?.message ?? body.message ?? 'The request failed.',
      response.status,
    );
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
      ]);
    },
  });
}
export function exampleInput(capability: Capability): Record<string, unknown> {
  const props = capability.inputSchema.properties as Record<string, { type?: string }> | undefined;
  const defaults: Record<string, unknown> = {
    company: 'Acme Robotics',
    region: 'Arizona',
    query: 'robotics',
    repository: 'acme-robotics/control-plane',
    code: 'const query = `SELECT * FROM users WHERE id = ${req.query.id}`;\neval(req.body.code);',
    document: 'synthetic-commercial-filing.pdf',
    timeRange: '2026-Q3',
  };
  return Object.fromEntries(
    Object.entries(props ?? {})
      .filter(([key]) => key !== 'demoFailure')
      .map(([key, schema]) => [
        key,
        defaults[key] ?? (schema.type === 'number' ? 1 : schema.type === 'boolean' ? false : 'example'),
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
