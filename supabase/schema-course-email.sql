-- Record successful access-email submission separately from code creation so
-- Stripe retries can safely resume delivery without creating a second code.
alter table public.access_codes add column if not exists access_email_sent_at timestamptz;
