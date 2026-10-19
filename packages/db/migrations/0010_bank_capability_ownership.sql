-- Consolidate only the trusted first-party bootstrap catalog. Keep legacy providers and payments.
INSERT INTO providers(id,user_id,name,description,reputation,created_at)
SELECT 'provider_capora_bank',id,'Capora Bank','Capora-operated capabilities and Base Sepolia financial services. TESTNET / SIMULATED FUNDS.',0,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM users WHERE id='user_demo' ON CONFLICT DO NOTHING;

UPDATE capabilities SET provider_id='provider_capora_bank',version=version+1
WHERE id IN ('gleif_entities','crossref_research','worldbank_indicators','github_repository','code_scan','document_fingerprint','aws_lambda_estimate','brave_search','context_scrape','azure_maps_geocode','sd_repo_analysis','riot_recent_matches')
AND endpoint='builtin://' || id AND provider_id='provider_' || id
AND EXISTS (
  SELECT 1 FROM providers previous JOIN providers bank ON bank.id='provider_capora_bank'
  WHERE previous.id=capabilities.provider_id AND previous.user_id=bank.user_id AND previous.name='Capora'
)
-- Defer a listing while its old seller still has unresolved escrow. A later catalog sync retries it.
AND NOT EXISTS (
  SELECT 1 FROM bank_escrows e JOIN purchases p ON p.id=e.purchase_id
  WHERE p.capability_id=capabilities.id AND e.state NOT IN ('released','refunded')
);
