import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { object } from './shared';

export const documentFingerprint: CapabilityDefinition = {
  metadata: {
    id: 'document_fingerprint',
    name: 'Document Fingerprint',
    type: 'agent',
    category: 'Verification',
    description:
      'Compute a SHA-256 digest and UTF-8 byte count of your supplied text. Optionally compare an expected digest to detect changes. Processes actual content. It does not verify issuer identity, authenticity, OCR or legal validity.',
    priceCents: 10,
    latency: 100,
    tags: ['document', 'integrity', 'SHA-256', 'tool'],
    documentationUrl: '/developers',
    schema: object(
      {
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 100000,
          default: 'Document content to fingerprint.',
        },
        expectedSha256: { type: 'string', minLength: 64, maxLength: 64 },
      },
      ['text'],
    ),
    dataSchema: object(
      {
        sha256: { type: 'string', minLength: 64, maxLength: 64 },
        bytes: { type: 'integer', minimum: 1 },
        matchesExpected: { type: ['boolean', 'null'] },
      },
      ['sha256', 'bytes', 'matchesExpected'],
    ),
  },
  validateInput(input) {
    if (input.expectedSha256 !== undefined && !/^[a-fA-F0-9]{64}$/.test(String(input.expectedSha256)))
      throw new DomainError(
        'INVALID_CAPABILITY_INPUT',
        'expectedSha256 must contain 64 hexadecimal characters.',
      );
  },
  async execute(input) {
    const bytes = new TextEncoder().encode(String(input.text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const data = {
      sha256,
      bytes: bytes.byteLength,
      matchesExpected:
        input.expectedSha256 === undefined ? null : sha256 === String(input.expectedSha256).toLowerCase(),
    };
    const source = 'Capora SHA-256 fingerprint v1';

    return { data, source };
  },
};
