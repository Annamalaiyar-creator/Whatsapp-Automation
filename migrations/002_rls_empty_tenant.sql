-- A pooled connection that ran a tenant transaction before reports app.tenant_id as '' afterwards.
-- Treat '' like "no tenant selected" so queries return no rows instead of failing on ''::uuid.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'sessions', 'team_members', 'bot_numbers', 'routing_config_versions',
                           'routing_config_active', 'calls', 'tasks', 'notifications', 'audit_log'] LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
                     WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

DROP POLICY tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
