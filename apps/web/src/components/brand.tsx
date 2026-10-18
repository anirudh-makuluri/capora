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
  Cloud,
  Search,
  FileText,
  PackageSearch,
  Gamepad2,
} from 'lucide-react';
import type { Capability } from '@capora/types';
import { AgoraArt } from './agora-art';
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="36" height="36" fill="#b8684c" />
      <rect width="36" height="36" fill="#26364c" />
      <path d="M22 11v5h-4v4h4v5l-9-7z" fill="#48d4d0" />
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
  Cloud,
  Search,
  FileText,
  MapPin,
  PackageSearch,
  Gamepad2,
];
export function ProviderIcon({
  capability,
  large = false,
}: {
  capability: Pick<Capability, 'id' | 'type'>;
  large?: boolean;
}) {
  const ids = [
    'gleif_entities',
    'crossref_research',
    'document_fingerprint',
    'code_scan',
    'worldbank_indicators',
    'github_repository',
    'retail_demand',
    'documentverify',
    'supplychain_radar',
    'patentlens',
    'aws_lambda_estimate',
    'brave_search',
    'context_scrape',
    'azure_maps_geocode',
    'sd_repo_analysis',
    'riot_recent_matches',
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
// Reuse the approved marketplace SVG; this workspace illustration is static and decorative.
export function MarketplaceArt() {
  return (
    <div className="agora-landing workspace-market-art" aria-hidden="true">
      <div className="ag-game ag-phase-4">
        <AgoraArt />
      </div>
    </div>
  );
}
