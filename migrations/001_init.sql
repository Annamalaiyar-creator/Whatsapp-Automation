-- Core multi-tenant schema.
-- Every client company is a tenant. Every tenant-owned row carries tenant_id, and row-level security
-- only lets the app see rows whose tenant_id matches the app.tenant_id setting of the current transaction.

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Console users (people who log in to the console).
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          text NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL CHECK (role IN ('owner', 'manager', 'agent')),
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- People who receive calls, callbacks and escalations (salespeople, managers, CEO).
CREATE TABLE team_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              text NOT NULL,
  phone             text,
  crm_ref           text,
  role              text NOT NULL CHECK (role IN ('salesperson', 'manager', 'ceo', 'support')),
  backup_member_id  uuid REFERENCES team_members(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'away', 'on_leave')),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_members_tenant ON team_members (tenant_id);

-- Numbers the bot answers on. With call forwarding, each salesperson gets their own bot number,
-- so the platform knows whose customer is calling.
CREATE TABLE bot_numbers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  e164            text NOT NULL UNIQUE,
  channel         text NOT NULL CHECK (channel IN ('phone', 'whatsapp')),
  team_member_id  uuid REFERENCES team_members(id) ON DELETE SET NULL,
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bot_numbers_tenant ON bot_numbers (tenant_id);

-- Routing rules, working hours and the escalation ladder, stored as one versioned document.
-- Saving never overwrites: it adds a new version, so every change can be reviewed and rolled back.
CREATE TABLE routing_config_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  config      jsonb NOT NULL,
  note        text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);

CREATE TABLE routing_config_active (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel         text NOT NULL,
  bot_number_id   uuid REFERENCES bot_numbers(id) ON DELETE SET NULL,
  team_member_id  uuid REFERENCES team_members(id) ON DELETE SET NULL,
  caller_phone    text NOT NULL,
  forward_reason  text,
  config_version  integer,
  decision        jsonb NOT NULL,
  human_answered  boolean NOT NULL DEFAULT false,
  simulated       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calls_tenant_created ON calls (tenant_id, created_at DESC);

-- Callback tasks and their position on the escalation ladder.
CREATE TABLE tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  call_id             uuid REFERENCES calls(id) ON DELETE SET NULL,
  kind                text NOT NULL DEFAULT 'callback',
  caller_phone        text NOT NULL,
  original_member_id  uuid REFERENCES team_members(id) ON DELETE SET NULL,
  assigned_member_id  uuid REFERENCES team_members(id) ON DELETE SET NULL,
  escalation_level    integer NOT NULL DEFAULT 0,
  due_at              timestamptz,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'escalation_exhausted')),
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);
CREATE INDEX tasks_due ON tasks (status, due_at);
CREATE INDEX tasks_tenant ON tasks (tenant_id, created_at DESC);

-- Messages waiting to be sent to team members (WhatsApp/SMS). A sender adapter will deliver them.
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id     uuid REFERENCES tasks(id) ON DELETE SET NULL,
  member_id   uuid REFERENCES team_members(id) ON DELETE SET NULL,
  via         text NOT NULL CHECK (via IN ('whatsapp', 'sms')),
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX notifications_tenant ON notifications (tenant_id, created_at DESC);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant ON audit_log (tenant_id, created_at DESC);

-- Row-level security: the app only ever sees the current tenant's rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'sessions', 'team_members', 'bot_numbers', 'routing_config_versions',
                           'routing_config_active', 'calls', 'tasks', 'notifications', 'audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
                     WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- Logins happen before the tenant is known, so these few lookups run as narrow SECURITY DEFINER functions.
CREATE FUNCTION auth_user_by_email(p_email text)
RETURNS TABLE (id uuid, tenant_id uuid, name text, role text, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.name, u.role, u.password_hash FROM users u WHERE lower(u.email) = lower(p_email)
$$;

CREATE FUNCTION auth_create_session(p_token_hash text, p_user_id uuid, p_expires_at timestamptz)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO sessions (token_hash, user_id, tenant_id, expires_at)
  SELECT p_token_hash, u.id, u.tenant_id, p_expires_at FROM users u WHERE u.id = p_user_id
$$;

CREATE FUNCTION auth_session(p_token_hash text)
RETURNS TABLE (user_id uuid, tenant_id uuid, name text, email text, role text, tenant_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.name, u.email, u.role, t.name
  FROM sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = u.tenant_id
  WHERE s.token_hash = p_token_hash AND s.expires_at > now()
$$;

CREATE FUNCTION auth_delete_session(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM sessions WHERE token_hash = p_token_hash OR expires_at <= now()
$$;

-- Lets the escalation worker find which tenants have overdue tasks, without seeing the tasks themselves.
CREATE FUNCTION tenants_with_overdue_tasks()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT t.tenant_id FROM tasks t WHERE t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at <= now()
$$;

REVOKE ALL ON FUNCTION auth_user_by_email(text), auth_create_session(text, uuid, timestamptz), auth_session(text),
  auth_delete_session(text), tenants_with_overdue_tasks() FROM PUBLIC;
