INSERT INTO playbooks (
  key,
  name,
  category,
  risk_level,
  requires_scopes,
  schema_version,
  spec,
  is_published,
  created_at,
  updated_at
)
VALUES (
  'system.test_ping',
  'System Test Ping',
  'BASE',
  'LOW',
  ARRAY[]::text[],
  '1.0',
  '{"steps":[{"name":"ping","action":"/bin/true"}]}'::jsonb,
  'true',
  now(),
  now()
)
ON CONFLICT (key) DO NOTHING;
