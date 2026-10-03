import {
  Activity,
  Database,
  Fingerprint,
  ScanLine,
  Radar,
  MapPin,
  Scale,
  CircuitBoard,
  FileCheck2,
  Network,
} from 'lucide-react';
import type { Capability } from '@capora/types';
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="currentColor" />
      <path
        d="M28 12H18L10 20L18 28H28M22 12L14 20L22 28"
        stroke="#c8ef83"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
const icons = [
  Activity,
  Database,
  Fingerprint,
  ScanLine,
  Scale,
  MapPin,
  Radar,
  FileCheck2,
  Network,
  CircuitBoard,
];
export function ProviderIcon({
  capability,
  large = false,
}: {
  capability: Pick<Capability, 'id' | 'type'>;
  large?: boolean;
}) {
  const ids = [
    'datapulse_headcount',
    'companyintel_premium',
    'verifycorp',
    'securescan_advanced',
    'legalarchive',
    'geointel',
    'retail_demand',
    'documentverify',
    'supplychain_radar',
    'patentlens',
  ];
  const idx = ids.indexOf(capability.id);
  const Icon = icons[idx >= 0 ? idx : capability.type === 'agent' ? 3 : 1];
  return (
    <span
      className={`provider-icon provider-color-${(idx < 0 ? 1 : idx) % 5} ${large ? 'provider-icon-large' : ''}`}
    >
      <Icon size={large ? 30 : 22} strokeWidth={1.7} />
    </span>
  );
}
export function NetworkArt() {
  return (
    <svg viewBox="0 0 440 250" className="network-art" aria-hidden="true">
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#97aa86" opacity=".32" />
        </pattern>
      </defs>
      <rect width="440" height="250" fill="url(#grid)" />
      <g fill="none" stroke="#9ab57c" strokeWidth="1">
        <path d="M222 125H300Q318 125 318 107V54H369M222 125H338V192H377M222 125H143Q125 125 125 143V204H73M222 125H116V58H67M222 125V42M222 125V226" />
        <circle cx="222" cy="125" r="65" strokeDasharray="4 5" opacity=".4" />
        <circle cx="222" cy="125" r="93" opacity=".2" />
      </g>
      <rect x="192" y="95" width="60" height="60" rx="15" fill="#c8ef83" />
      <path
        d="M235 111H218L205 125L218 139H235M225 111L212 125L225 139"
        fill="none"
        stroke="#173a29"
        strokeWidth="3"
      />
      <g fill="#183c2c" stroke="#678d54">
        <rect x="38" y="34" width="52" height="46" rx="10" />
        <rect x="342" y="30" width="52" height="46" rx="10" />
        <rect x="349" y="168" width="52" height="46" rx="10" />
        <rect x="46" y="181" width="52" height="46" rx="10" />
      </g>
      <g stroke="#c4d7b2" fill="none" strokeWidth="1.5">
        <ellipse cx="64" cy="48" rx="10" ry="4" />
        <path d="M54 48V64C54 69 74 69 74 64V48M54 57C54 62 74 62 74 57" />
        <path d="M360 43L351 54L360 65M376 43L385 54L376 65M370 41L366 67" />
        <path d="M364 189L371 180L382 183L385 194L378 202L367 200ZM371 186L378 188L377 195L370 193Z" />
        <rect x="60" y="194" width="23" height="19" rx="3" />
        <path d="M66 189V194M77 189V194M66 200H69M74 200H77M66 207H77" />
      </g>
      <g fill="#c8ef83">
        <circle cx="222" cy="42" r="4" />
        <circle cx="222" cy="226" r="4" />
        <circle cx="318" cy="108" r="3" />
        <circle cx="125" cy="143" r="3" />
      </g>
    </svg>
  );
}
