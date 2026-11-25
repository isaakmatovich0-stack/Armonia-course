-- Only opt-in new application writes are queued. Existing orders are never
-- backfilled or automatically resent. Apply before deploying the application.
alter table public.store_orders add column if not exists recovery_managed boolean not null default false;
create table if not exists public.store_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders(id),
  kind text not null check (kind in ('receipt','supplier')),
  state text not null default 'pending' check (state in ('pending','running','done','review','skipped')),
  snapshot jsonb not null,
  lease_token uuid,
  lease_until timestamptz,
  started_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, kind)
);
alter table public.store_delivery_jobs add column if not exists next_attempt_at timestamptz not null default now();
alter table public.store_delivery_jobs enable row level security;
create index if not exists store_delivery_jobs_queue on public.store_delivery_jobs (state, lease_until, created_at);

create or replace function public.store_enqueue_delivery_jobs() returns trigger language plpgsql set search_path = public as $$
begin
  if new.recovery_managed then
    insert into public.store_delivery_jobs (order_id, kind, snapshot)
      values (new.id, 'receipt', to_jsonb(new)), (new.id, 'supplier', to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists store_order_delivery_outbox on public.store_orders;
create trigger store_order_delivery_outbox after insert on public.store_orders for each row execute function public.store_enqueue_delivery_jobs();

-- Limit the lease to longer than a serverless function can run. Supplier work
-- with an uncertain outcome is never automatically re-sent after a lease loss.
create or replace function public.store_claim_delivery_job(p_order_id uuid default null)
returns setof public.store_delivery_jobs language plpgsql set search_path = public as $$
declare j public.store_delivery_jobs%rowtype;
begin
  select * into j from public.store_delivery_jobs
    where (p_order_id is null or order_id = p_order_id)
      and ((state = 'pending' and next_attempt_at <= now()) or (state = 'running' and lease_until < now()))
    order by created_at, kind for update skip locked limit 1;
  if not found then return; end if;
  if j.started_at is not null and (j.kind = 'supplier' or j.started_at < now() - interval '23 hours') then
    return query update public.store_delivery_jobs set state='review', lease_token=null, lease_until=null,
      last_error='Outcome uncertain; verify with provider before taking action.', updated_at=now() where id=j.id returning *;
    return;
  end if;
  return query update public.store_delivery_jobs set state='running', lease_token=gen_random_uuid(),
    lease_until=now()+interval '10 minutes', attempts=attempts+1, updated_at=now() where id=j.id returning *;
end $$;

-- Lock the order and job while crossing the point after which a supplier may
-- charge. Staff status edits are rejected while that request is in flight.
create or replace function public.store_begin_delivery_job(p_job_id uuid,p_token uuid)
returns boolean language plpgsql set search_path = public as $$
declare j public.store_delivery_jobs%rowtype; o public.store_orders%rowtype;
begin
  select * into j from public.store_delivery_jobs where id=p_job_id;
  if not found then return false; end if;
  select * into o from public.store_orders where id=j.order_id for update;
  select * into j from public.store_delivery_jobs where id=p_job_id for update;
  if j.state <> 'running' or j.lease_token is distinct from p_token or j.lease_until <= now() then return false; end if;
  if (j.kind = 'supplier' and o.status <> 'paid') or (j.kind = 'receipt' and o.status in ('refunded','cancelled')) then
    update public.store_delivery_jobs set state='skipped', lease_token=null,lease_until=null,last_error='Order no longer paid.',updated_at=now() where id=j.id;
    return false;
  end if;
  if j.kind='receipt' and j.started_at is not null and j.started_at < now() - interval '23 hours' then
    update public.store_delivery_jobs set state='review',lease_token=null,lease_until=null,last_error='Email outcome uncertain; verify with provider.',updated_at=now() where id=j.id;
    return false;
  end if;
  update public.store_delivery_jobs set started_at=coalesce(started_at,now()),updated_at=now() where id=j.id;
  return true;
end $$;

create or replace function public.store_block_status_during_delivery() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status and exists (
    select 1 from public.store_delivery_jobs where order_id=old.id and kind='supplier'
      and state='running' and started_at is not null and lease_until > now()
  ) then raise exception 'Supplier submission is in progress; wait before changing this order status.'; end if;
  return new;
end $$;
drop trigger if exists store_order_delivery_status_guard on public.store_orders;
create trigger store_order_delivery_status_guard before update of status on public.store_orders for each row execute function public.store_block_status_during_delivery();

revoke all on function public.store_claim_delivery_job(uuid) from public, anon, authenticated;
revoke all on function public.store_begin_delivery_job(uuid,uuid) from public, anon, authenticated;
grant execute on function public.store_claim_delivery_job(uuid) to service_role;
grant execute on function public.store_begin_delivery_job(uuid,uuid) to service_role;
grant select, insert, update, delete on public.store_delivery_jobs to service_role;
