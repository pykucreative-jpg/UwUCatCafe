CREATE TABLE IF NOT EXISTS employees (
 user_id text PRIMARY KEY, username text NOT NULL, ic_name text NOT NULL, ssn text,
 proof bytea, proof_type text, hired_by text, hired_by_name text, hired_at timestamptz,
 rank text, plus_count integer NOT NULL DEFAULT 0, minus_count integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'active', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS logs (
 id bigserial PRIMARY KEY, request_id text UNIQUE, category text NOT NULL,
 actor_id text NOT NULL, actor_name text NOT NULL, target_id text, target_name text,
 reason text NOT NULL DEFAULT '', details jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending',
 channel_id text, created_at timestamptz NOT NULL DEFAULT now(), delivered boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS logs_category_date ON logs(category, created_at DESC);
CREATE INDEX IF NOT EXISTS logs_target_date ON logs(target_id, created_at DESC);
CREATE TABLE IF NOT EXISTS leaves (
 id bigserial PRIMARY KEY, user_id text NOT NULL, ic_name text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 reason text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending',
 channel_id text NOT NULL, approved_by text, approved_by_name text,
 old_nick text, applied_nick text, error text, retry_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_leave ON leaves(user_id) WHERE status IN ('pending','scheduled','active','starting','ending');
CREATE TABLE IF NOT EXISTS tickets (
 id bigserial PRIMARY KEY, user_id text NOT NULL, ic_name text NOT NULL, kind text NOT NULL,
 subject text NOT NULL, body text NOT NULL, channel_id text UNIQUE, message_id text,
 leave_id bigint REFERENCES leaves(id), status text NOT NULL DEFAULT 'open',
 created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_ticket ON tickets(user_id,kind) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS ticket_messages (
 message_id text PRIMARY KEY, ticket_id bigint NOT NULL REFERENCES tickets(id),
 author_id text NOT NULL, author_name text NOT NULL, body text NOT NULL, attachments jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL, edited_at timestamptz, deleted boolean NOT NULL DEFAULT false
);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS displayed_leave_status text;
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS blacklist (
 id bigserial PRIMARY KEY, ssn text NOT NULL, ic_name text NOT NULL,
 photo bytea NOT NULL, photo_type text NOT NULL, reason text NOT NULL,
 added_by text NOT NULL, added_by_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz, removed_by text, removed_by_name text
);
CREATE INDEX IF NOT EXISTS blacklist_active_ssn ON blacklist(ssn,created_at DESC) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS notifications (
 id bigserial PRIMARY KEY, channel_id text NOT NULL, user_id text, title text NOT NULL,
 body text NOT NULL, delivered boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now()
);
