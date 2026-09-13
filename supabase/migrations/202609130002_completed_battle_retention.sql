-- Compact finished battle payloads after their replay grace period. Results,
-- ratings, reward receipts, usage aggregates and account saves are retained.
-- This migration defines the function only; it neither invokes it nor installs
-- a cron job. Schedule it separately for the active ranked namespace.
create or replace function champions.prune_completed_battles(pnamespace text default 'ranked')
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cutoff_ms bigint := floor(extract(epoch from statement_timestamp()) * 1000)::bigint - 86400000;
  pruned_at_ms bigint := floor(extract(epoch from statement_timestamp()) * 1000)::bigint;
  battle record;
  compact_players jsonb;
  compact_match jsonb;
  pruned_count integer := 0;
begin
  if pnamespace is null or pnamespace !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Invalid ranked storage namespace';
  end if;

  for battle in
    select d.key, d.payload
    from champions.documents d
    where d.namespace = pnamespace
      and d.collection = 'matches'
      and d.payload->>'id' = d.key
      and d.payload->>'phase' = 'finished'
      and d.payload->>'payloadPrunedAt' is null
      and case when jsonb_typeof(d.payload->'players') = 'array'
        then jsonb_array_length(d.payload->'players') = 2 else false end
      and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(d.payload->'players') = 'array'
          then d.payload->'players' else '[]'::jsonb end) p
        where jsonb_typeof(p) is distinct from 'object'
          or p->>'uid' is null or p->>'uid' !~ '^[a-zA-Z0-9_-]{1,128}$'
      )
      and case
        when jsonb_typeof(d.payload->'finishedAt') = 'number'
          and d.payload->>'finishedAt' ~ '^[0-9]{1,16}$'
        then (d.payload->>'finishedAt')::bigint
        else null
      end < cutoff_ms
    order by d.key
    limit 100
    for update skip locked
  loop
    -- Malformed imported rows need manual inspection, never broad cleanup.
    if jsonb_typeof(battle.payload->'players') is distinct from 'array' then
      continue;
    end if;
    if jsonb_array_length(battle.payload->'players') <> 2 then
      continue;
    end if;
    if exists (
      select 1 from jsonb_array_elements(battle.payload->'players') p
      where jsonb_typeof(p) is distinct from 'object'
        or p->>'uid' is null or p->>'uid' !~ '^[a-zA-Z0-9_-]{1,128}$'
    ) then
      continue;
    end if;

    select jsonb_agg(jsonb_build_object(
      'uid', p.value->'uid', 'name', p.value->'name',
      'isGuest', coalesce(p.value->'isGuest', 'false'::jsonb),
      'rating', p.value->'rating', 'team', '[]'::jsonb
    ) order by p.ordinality)
    into compact_players
    from jsonb_array_elements(battle.payload->'players') with ordinality p(value, ordinality);

    select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
    into compact_match
    from jsonb_each(battle.payload) f
    where f.key = any(array[
      'id', 'format', 'phase', 'revision', 'timelineRevision', 'createdAt',
      'finishedAt', 'winner', 'reason', 'result', 'usageRecordedAt'
    ]);
    compact_match := compact_match || jsonb_build_object(
      'players', compact_players, 'state', null, 'deadlineAt', null,
      'timelineChunks', 0, 'timelineBytes', 2,
      'selections', '{}'::jsonb, 'pendingActions', '{}'::jsonb,
      'requests', '[]'::jsonb, 'payloadPrunedAt', pruned_at_ms
    );

    -- Use a literal prefix and the exact revision/chunk suffix shape. LIKE
    -- would treat '_' in a match ID as a wildcard; prefix alone could also
    -- touch another match whose ID starts with this one.
    delete from champions.documents t
    where t.namespace = pnamespace and t.collection = 'timelines'
      and left(t.key, length(battle.key) + 1) = battle.key || '_'
      and substring(t.key from length(battle.key) + 2) ~ '^[0-9]+_[0-9]+$';
    update champions.documents
    set payload = compact_match
    where namespace = pnamespace and collection = 'matches' and key = battle.key;
    pruned_count := pruned_count + 1;
  end loop;
  return pruned_count;
end;
$$;

revoke all on function champions.prune_completed_battles(text) from public, anon, authenticated;
grant execute on function champions.prune_completed_battles(text) to champions_server;
