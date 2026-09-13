-- The active production namespace is ranked. This free database-local job
-- retains results while compacting finished replay payloads after 24 hours.
create extension if not exists pg_cron;
select cron.schedule(
  'champions-completed-battle-retention',
  '15 * * * *',
  $$select champions.prune_completed_battles('ranked');$$
);
