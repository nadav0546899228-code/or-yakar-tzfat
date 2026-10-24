-- סכימת מערכת אור יקר צפת. כל השינויים תוספתיים (IF NOT EXISTS) ובטוחים להרצה חוזרת.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS institutions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  manager_user_id INTEGER,
  color TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT,
  pin_hash TEXT,
  roles TEXT[] NOT NULL DEFAULT '{}',
  institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_pin BOOLEAN NOT NULL DEFAULT FALSE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lock_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  locked_permanent BOOLEAN NOT NULL DEFAULT FALSE,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  language TEXT NOT NULL DEFAULT 'he',
  last_login_at TIMESTAMPTZ,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  donor_id INTEGER,
  impersonator_id INTEGER,
  active_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id INTEGER,
  impersonator_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details JSONB
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log (at DESC);

CREATE TABLE IF NOT EXISTS providers (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mode TEXT NOT NULL DEFAULT 'sandbox',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secrets_enc TEXT,
  auto_sync BOOLEAN NOT NULL DEFAULT FALSE,
  last_sync_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT,
  imported INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  triggered_by INTEGER
);

CREATE TABLE IF NOT EXISTS purposes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  default_amount NUMERIC(12,2),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  goal NUMERIC(14,2),
  start_date DATE,
  end_date DATE,
  institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  donation_url TEXT,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS donors (
  id SERIAL PRIMARY KEY,
  title TEXT,
  first_name TEXT,
  last_name TEXT,
  id_number TEXT,
  phone TEXT,
  phone2 TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  country TEXT DEFAULT 'ישראל',
  language TEXT NOT NULL DEFAULT 'he',
  currency TEXT NOT NULL DEFAULT 'ILS',
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  is_overseas BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  recruiter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  spouse_name TEXT,
  father_name TEXT,
  mother_name TEXT,
  notes TEXT,
  no_contact BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS donors_phone_idx ON donors (phone);
CREATE INDEX IF NOT EXISTS donors_idnum_idx ON donors (id_number);

CREATE TABLE IF NOT EXISTS donor_links (
  id SERIAL PRIMARY KEY,
  donor_id INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS donor_dates (
  id SERIAL PRIMARY KEY,
  donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'yahrzeit',
  person_name TEXT,
  relation TEXT,
  hebrew_day INTEGER,
  hebrew_month TEXT,
  gregorian_date DATE,
  notify BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS interactions (
  id SERIAL PRIMARY KEY,
  donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'call',
  summary TEXT,
  outcome TEXT,
  follow_up_date DATE,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  file_name TEXT,
  file_data TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS standing_orders (
  id SERIAL PRIMARY KEY,
  donor_id INTEGER REFERENCES donors(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  type TEXT NOT NULL DEFAULT 'credit',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ILS',
  day_of_month INTEGER,
  start_date DATE,
  end_date DATE,
  months_total INTEGER,
  months_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  last_charge_date DATE,
  next_charge_date DATE,
  failures INTEGER NOT NULL DEFAULT 0,
  institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  purpose_id INTEGER REFERENCES purposes(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  recruiter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bank_code TEXT,
  branch_code TEXT,
  account_masked TEXT,
  card_last4 TEXT,
  token_ref TEXT,
  cancel_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  notes TEXT,
  synced_at TIMESTAMPTZ,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS so_source_ext_idx ON standing_orders (source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  donor_id INTEGER REFERENCES donors(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  type TEXT NOT NULL DEFAULT 'receipt46',
  number TEXT,
  external_id TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ILS',
  lang TEXT NOT NULL DEFAULT 'he',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tax_report_number TEXT,
  tax_report_status TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'active',
  pdf_url TEXT,
  sent_via TEXT[] NOT NULL DEFAULT '{}',
  related_document_id INTEGER,
  is_annual BOOLEAN NOT NULL DEFAULT FALSE,
  sandbox BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS doc_provider_ext_idx ON documents (provider, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  serial TEXT,
  donor_id INTEGER REFERENCES donors(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  kind TEXT NOT NULL DEFAULT 'one_time',
  method TEXT NOT NULL DEFAULT 'credit',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ILS',
  amount_ils NUMERIC(12,2) NOT NULL DEFAULT 0,
  installments INTEGER NOT NULL DEFAULT 1,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'paid',
  institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
  purpose_id INTEGER REFERENCES purposes(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  standing_order_id INTEGER REFERENCES standing_orders(id) ON DELETE SET NULL,
  recruiter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  check_number TEXT,
  check_bank TEXT,
  check_due_date DATE,
  card_last4 TEXT,
  failure_reason TEXT,
  approved BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by INTEGER,
  signature_data TEXT,
  dedication TEXT,
  notes TEXT,
  created_by INTEGER,
  synced_at TIMESTAMPTZ,
  raw JSONB,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tx_source_ext_idx ON transactions (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tx_date_idx ON transactions (date DESC);
CREATE INDEX IF NOT EXISTS tx_donor_idx ON transactions (donor_id);

CREATE TABLE IF NOT EXISTS pledges (
  id SERIAL PRIMARY KEY,
  donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ILS',
  reason TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_tasks (
  id SERIAL PRIMARY KEY,
  donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT 'follow_up',
  priority INTEGER NOT NULL DEFAULT 2,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  outcome TEXT,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  standing_order_id INTEGER REFERENCES standing_orders(id) ON DELETE SET NULL,
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tzedaka_boxes (
  id SERIAL PRIMARY KEY,
  code TEXT,
  location_name TEXT NOT NULL,
  address TEXT,
  neighborhood TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  collection_interval_days INTEGER NOT NULL DEFAULT 60,
  last_collected_at DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS box_collections (
  id SERIAL PRIMARY KEY,
  box_id INTEGER REFERENCES tzedaka_boxes(id) ON DELETE CASCADE,
  collected_at DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  collector_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS spiritual_orders (
  id SERIAL PRIMARY KEY,
  donor_id INTEGER REFERENCES donors(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'prayer',
  name_for TEXT NOT NULL,
  mother_name TEXT,
  request TEXT,
  location TEXT,
  start_date DATE,
  end_date DATE,
  amount NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending',
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  contact_name TEXT,
  contact_phone TEXT,
  source TEXT NOT NULL DEFAULT 'office',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  date DATE,
  location TEXT,
  goal NUMERIC(14,2),
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS event_guests (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  donor_id INTEGER REFERENCES donors(id) ON DELETE SET NULL,
  name TEXT,
  phone TEXT,
  invited BOOLEAN NOT NULL DEFAULT TRUE,
  rsvp TEXT NOT NULL DEFAULT 'pending',
  seats INTEGER NOT NULL DEFAULT 1,
  table_no TEXT,
  pledged_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  arrived BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS aid_requests (
  id SERIAL PRIMARY KEY,
  family_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  kind TEXT NOT NULL DEFAULT 'holiday',
  description TEXT,
  amount_requested NUMERIC(12,2),
  amount_approved NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'new',
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'brochure',
  url TEXT,
  description TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS automations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  template TEXT,
  threshold NUMERIC(12,2),
  days_before INTEGER NOT NULL DEFAULT 0,
  material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS messages_out (
  id BIGSERIAL PRIMARY KEY,
  donor_id INTEGER REFERENCES donors(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  to_addr TEXT,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  automation_id INTEGER,
  dedupe_key TEXT,
  sent_by INTEGER,
  error TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS msg_dedupe_idx ON messages_out (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER,
  roles TEXT[] NOT NULL DEFAULT '{}',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_by INTEGER[] NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id SERIAL PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT,
  subject TEXT,
  message TEXT,
  handled BOOLEAN NOT NULL DEFAULT FALSE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS donor_otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS error_log (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'server',
  path TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  user_id INTEGER,
  count INTEGER NOT NULL DEFAULT 1,
  first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users (google_sub) WHERE google_sub IS NOT NULL;
