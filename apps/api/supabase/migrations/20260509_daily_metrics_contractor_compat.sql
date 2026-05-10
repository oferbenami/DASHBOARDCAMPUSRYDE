create table if not exists daily_metrics_contractor (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  service_type text not null check (service_type in ('pickup','dropoff')),
  contractor_id uuid not null references contractors(id) on delete cascade,
  rides_count integer not null default 0,
  taxi_count integer not null default 0,
  taxi_passengers integer not null default 0,
  large_vehicle_count integer not null default 0,
  large_vehicle_passengers integer not null default 0,
  registered_passengers integer not null default 0,
  issues_count integer not null default 0,
  affected_passengers integer not null default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(service_date, service_type, contractor_id)
);

create index if not exists idx_daily_metrics_contractor_date_type
on daily_metrics_contractor(service_date, service_type);

create index if not exists idx_daily_metrics_contractor_contractor
on daily_metrics_contractor(contractor_id);

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_daily_metrics_contractor_updated_at on daily_metrics_contractor;
create trigger update_daily_metrics_contractor_updated_at
before update on daily_metrics_contractor
for each row execute function update_updated_at_column();
