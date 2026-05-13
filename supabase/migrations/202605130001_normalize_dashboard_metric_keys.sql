create or replace function normalize_dashboard_metric_key(metric_key text)
returns text
language sql
immutable
as $$
  select case lower(regexp_replace(coalesce(metric_key, ''), '[\s_-]+', '', 'g'))
    when 'rides' then 'rides'
    when 'ride' then 'rides'
    when 'ridescount' then 'rides'
    when 'trip' then 'rides'
    when 'trips' then 'rides'
    when 'tripscount' then 'rides'
    when 'passengers' then 'passengers'
    when 'registeredpassengers' then 'passengers'
    when 'registeredpassengerscount' then 'passengers'
    when 'efficiency' then 'efficiency'
    when 'servicequality' then 'serviceQuality'
    when 'quality' then 'serviceQuality'
    when 'issues' then 'issues'
    when 'issuescount' then 'issues'
    when 'issuesrate' then 'issuesRate'
    when 'affectedrate' then 'affectedRate'
    when 'affectedpassengers' then 'affectedPassengers'
    when 'affectedpassengerscount' then 'affectedPassengers'
    else metric_key
  end;
$$;

update targets_history
set metric_key = normalize_dashboard_metric_key(metric_key)
where metric_key is distinct from normalize_dashboard_metric_key(metric_key);

update kpi_thresholds current_threshold
set metric_key = normalize_dashboard_metric_key(current_threshold.metric_key)
where current_threshold.metric_key is distinct from normalize_dashboard_metric_key(current_threshold.metric_key)
  and not exists (
    select 1
    from kpi_thresholds existing_threshold
    where existing_threshold.metric_key = normalize_dashboard_metric_key(current_threshold.metric_key)
  );

delete from kpi_thresholds duplicate_threshold
where duplicate_threshold.metric_key is distinct from normalize_dashboard_metric_key(duplicate_threshold.metric_key)
  and exists (
    select 1
    from kpi_thresholds canonical_threshold
    where canonical_threshold.metric_key = normalize_dashboard_metric_key(duplicate_threshold.metric_key)
  );

create or replace function normalize_dashboard_metric_key_trigger()
returns trigger
language plpgsql
as $$
begin
  new.metric_key = normalize_dashboard_metric_key(new.metric_key);
  return new;
end;
$$;

drop trigger if exists normalize_targets_history_metric_key on targets_history;
create trigger normalize_targets_history_metric_key
before insert or update of metric_key on targets_history
for each row execute function normalize_dashboard_metric_key_trigger();

drop trigger if exists normalize_kpi_thresholds_metric_key on kpi_thresholds;
create trigger normalize_kpi_thresholds_metric_key
before insert or update of metric_key on kpi_thresholds
for each row execute function normalize_dashboard_metric_key_trigger();
