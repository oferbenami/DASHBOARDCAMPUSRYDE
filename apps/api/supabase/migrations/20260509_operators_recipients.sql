create table if not exists operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  operator_code text unique not null,
  legal_name text,
  phone text,
  email text,
  status text default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  deleted_at timestamp with time zone
);

create table if not exists operator_recipients (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  recipient_type text default 'other' check (
    recipient_type in ('operations','finance','alerts','reports','other')
  ),
  is_primary boolean default false,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  deleted_at timestamp with time zone
);

create index if not exists idx_operator_recipients_operator_id
on operator_recipients(operator_id);

create index if not exists idx_operator_recipients_email
on operator_recipients(email);

create unique index if not exists one_primary_recipient_per_operator_type
on operator_recipients(operator_id, recipient_type)
where is_primary = true and deleted_at is null;

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_operators_updated_at on operators;
create trigger update_operators_updated_at
before update on operators
for each row execute function update_updated_at_column();

drop trigger if exists update_operator_recipients_updated_at on operator_recipients;
create trigger update_operator_recipients_updated_at
before update on operator_recipients
for each row execute function update_updated_at_column();
