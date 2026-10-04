import { DomainError } from '@capora/types';
import { MAX_PAYLOAD_BYTES } from '@capora/config';

export async function boundedJson(response: Response, maxBytes = MAX_PAYLOAD_BYTES): Promise<unknown> {
  if (!response.body) throw new DomainError('PROVIDER_FAILURE', 'Provider returned an empty response.', 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new DomainError(
          'PROVIDER_OUTPUT_TOO_LARGE',
          'Provider response exceeds the gateway limit.',
          502,
        );
      }
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      throw new DomainError('PROVIDER_FAILURE', 'Provider must return valid JSON.', 502);
    }
  } finally {
    reader.releaseLock();
  }
}
