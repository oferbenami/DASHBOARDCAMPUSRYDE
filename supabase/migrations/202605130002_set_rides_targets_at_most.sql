update targets_history
set direction = 'at_most'
where normalize_dashboard_metric_key(metric_key) = 'rides'
  and direction is distinct from 'at_most';

create or replace function normalize_dashboard_target_row_trigger()
returns trigger
language plpgsql
as $$
begin
  new.metric_key = normalize_dashboard_metric_key(new.metric_key);

  if new.metric_key = 'rides' then
    new.direction = 'at_most';
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_targets_history_metric_key on targets_history;
create trigger normalize_targets_history_metric_key
before insert or update of metric_key, direction on targets_history
for each row execute function normalize_dashboard_target_row_trigger();
