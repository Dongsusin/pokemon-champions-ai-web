-- Manual PostgreSQL validation; NOT executed by the JavaScript test.
-- Run the entire file on ONE connection. Every assertion must pass and the final
-- ROLLBACK must complete. On any error, roll back/close that connection.
-- Uses existing champions.documents with synthetic rows in random namespaces.
-- Does not alter schema, overwrite existing rows, or query ordinary game namespaces.
-- Requires INSERT/SELECT on champions.documents; UPDATE only touches its own fixture.
-- The tagged query is captured from createPostgresStore().readUnchangedMatch().
-- validateRankedDatabaseBudget.mjs checks it byte-for-byte against the emitted SQL.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

DO $budget_fixture$
DECLARE
  fixture_namespace text := 'budget_review_' || substr(md5(random()::text || clock_timestamp()::text || pg_backend_pid()::text), 1, 24);
  other_namespace text := fixture_namespace || '_other';
  query_text text := $adapter_sql$
SELECT (payload - 'state' - 'requests' - 'players')
            || jsonb_build_object('players', (SELECT jsonb_agg(p.value - 'team' ORDER BY p.ordinality)
              FROM jsonb_array_elements(payload->'players') WITH ORDINALITY p(value, ordinality))) AS status_match
            FROM champions.documents WHERE namespace = $1 AND collection = $2 AND key = $3
              AND payload->'players' @> jsonb_build_array(jsonb_build_object('uid', $4::text))
              AND payload->>'roomId' IS NULL AND payload->>'phase' IN ('select','battle')
              AND payload->'revision' = to_jsonb($5::bigint) AND payload->'timelineRevision' = to_jsonb($6::bigint)
              AND CASE WHEN jsonb_typeof(payload->'deadlineAt') = 'number'
                THEN (payload->>'deadlineAt')::numeric > $7::numeric ELSE false END
$adapter_sql$;
  base_payload jsonb;
  source_payload jsonb;
  expected_projection jsonb;
  projection jsonb;
  baseline jsonb;
  after_reads jsonb;
  case_namespace text;
  test_case record;
  returned_rows integer;
  checked integer := 0;
  original_bytes integer;
  compact_bytes integer;
BEGIN
  base_payload := jsonb_build_object(
    'id', 'eligible', 'format', 'single', 'phase', 'battle',
    'revision', 2, 'timelineRevision', 3, 'createdAt', 900000,
    'deadlineAt', 1000001, 'timelineChunks', 0,
    'players', jsonb_build_array(
      jsonb_build_object('uid', 'fixture_z', 'name', 'Synthetic Z', 'nickname', '',
        'isGuest', false, 'rating', 1000, 'team', jsonb_build_array(jsonb_build_object('captureId', 'synthetic_z', 'privateTeam', true))),
      jsonb_build_object('uid', 'fixture_a', 'name', 'Synthetic A', 'nickname', '',
        'isGuest', false, 'rating', 1000, 'team', jsonb_build_array(jsonb_build_object('captureId', 'synthetic_a', 'privateTeam', true)))
    ),
    'state', jsonb_build_object('syntheticPrivateState', repeat('x', 60000)),
    'requests', jsonb_build_array(jsonb_build_object('id', 'synthetic_request', 'hash', 'synthetic_hash')),
    'selections', jsonb_build_object('fixture_z', jsonb_build_array(0, 1, 2), 'fixture_a', jsonb_build_array(3, 4, 5)),
    'pendingActions', jsonb_build_object('player', jsonb_build_array(jsonb_build_object('type', 'move', 'moveIndex', 0))),
    'result', null
  );

  -- Plain INSERT, never an upsert: an unexpected key collision aborts.
  INSERT INTO champions.documents (namespace, collection, key, payload)
  SELECT fixture_namespace, 'matches', variants.key,
    jsonb_set(variants.payload, '{id}', to_jsonb(variants.key))
  FROM (VALUES
    ('eligible', base_payload),
    ('select_phase', base_payload || '{"phase":"select"}'::jsonb),
    ('null_room', base_payload || '{"roomId":null}'::jsonb),
    ('room_match', base_payload || '{"roomId":"synthetic_room"}'::jsonb),
    ('finished', base_payload || '{"phase":"finished"}'::jsonb),
    ('other_phase', base_payload || '{"phase":"waiting"}'::jsonb),
    ('expired', base_payload || '{"deadlineAt":999999}'::jsonb),
    ('equal_deadline', base_payload || '{"deadlineAt":1000000}'::jsonb),
    ('missing_deadline', base_payload - 'deadlineAt'),
    ('null_deadline', base_payload || '{"deadlineAt":null}'::jsonb),
    ('string_deadline', base_payload || '{"deadlineAt":"1000001"}'::jsonb),
    ('boolean_deadline', base_payload || '{"deadlineAt":true}'::jsonb),
    ('array_deadline', base_payload || '{"deadlineAt":[]}'::jsonb),
    ('string_revision', base_payload || '{"revision":"2"}'::jsonb),
    ('string_timeline', base_payload || '{"timelineRevision":"3"}'::jsonb)
  ) AS variants(key, payload);

  -- Decoys prove namespace and collection predicates without reading user rows.
  INSERT INTO champions.documents (namespace, collection, key, payload) VALUES
    (other_namespace, 'matches', 'eligible', base_payload || '{"revision":9}'::jsonb),
    (other_namespace, 'matches', 'foreign_only', base_payload || '{"id":"foreign_only"}'::jsonb),
    (fixture_namespace, 'players', 'wrong_collection_only', base_payload || '{"id":"wrong_collection_only"}'::jsonb);

  SELECT jsonb_agg(jsonb_build_array(namespace, collection, key, payload) ORDER BY namespace, collection, key)
    INTO baseline
    FROM champions.documents
    WHERE namespace IN (fixture_namespace, other_namespace);

  FOR test_case IN
    SELECT * FROM (VALUES
      ('first participant', false, 'eligible', 'fixture_z', 2::bigint, 3::bigint, 1000000::bigint, true),
      ('second participant', false, 'eligible', 'fixture_a', 2, 3, 1000000, true),
      ('selection phase', false, 'select_phase', 'fixture_z', 2, 3, 1000000, true),
      ('explicit null room', false, 'null_room', 'fixture_z', 2, 3, 1000000, true),
      ('outsider', false, 'eligible', 'fixture_outsider', 2, 3, 1000000, false),
      ('wrong namespace same key', true, 'eligible', 'fixture_z', 2, 3, 1000000, false),
      ('other namespace own revision', true, 'eligible', 'fixture_z', 9, 3, 1000000, true),
      ('only another namespace has this key', false, 'foreign_only', 'fixture_z', 2, 3, 1000000, false),
      ('only another collection has this key', false, 'wrong_collection_only', 'fixture_z', 2, 3, 1000000, false),
      ('missing match', false, 'absent_fixture', 'fixture_z', 2, 3, 1000000, false),
      ('match revision mismatch', false, 'eligible', 'fixture_z', 1, 3, 1000000, false),
      ('timeline revision mismatch', false, 'eligible', 'fixture_z', 2, 4, 1000000, false),
      ('room match', false, 'room_match', 'fixture_z', 2, 3, 1000000, false),
      ('finished match', false, 'finished', 'fixture_z', 2, 3, 1000000, false),
      ('unsupported phase', false, 'other_phase', 'fixture_z', 2, 3, 1000000, false),
      ('past deadline', false, 'expired', 'fixture_z', 2, 3, 1000000, false),
      ('equal deadline', false, 'equal_deadline', 'fixture_z', 2, 3, 1000000, false),
      ('timestamp reaches deadline', false, 'eligible', 'fixture_z', 2, 3, 1000001, false),
      ('timestamp after deadline', false, 'eligible', 'fixture_z', 2, 3, 1000002, false),
      ('missing deadline', false, 'missing_deadline', 'fixture_z', 2, 3, 1000000, false),
      ('null deadline', false, 'null_deadline', 'fixture_z', 2, 3, 1000000, false),
      ('string deadline', false, 'string_deadline', 'fixture_z', 2, 3, 1000000, false),
      ('boolean deadline', false, 'boolean_deadline', 'fixture_z', 2, 3, 1000000, false),
      ('array deadline', false, 'array_deadline', 'fixture_z', 2, 3, 1000000, false),
      ('string stored revision', false, 'string_revision', 'fixture_z', 2, 3, 1000000, false),
      ('string stored timeline revision', false, 'string_timeline', 'fixture_z', 2, 3, 1000000, false)
    ) AS cases(label, use_other_namespace, match_key, uid, revision, timeline_revision, at_ms, should_match)
  LOOP
    case_namespace := CASE WHEN test_case.use_other_namespace THEN other_namespace ELSE fixture_namespace END;
    projection := null;
    EXECUTE query_text INTO projection
      USING case_namespace, 'matches'::text, test_case.match_key, test_case.uid,
        test_case.revision, test_case.timeline_revision, test_case.at_ms;
    GET DIAGNOSTICS returned_rows = ROW_COUNT;
    IF returned_rows <> (CASE WHEN test_case.should_match THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION 'Compact match SQL predicate failed: %', test_case.label;
    END IF;
    IF NOT test_case.should_match THEN
      IF projection IS NOT NULL THEN
        RAISE EXCEPTION 'Denied compact read returned a payload: %', test_case.label;
      END IF;
    ELSE
      SELECT payload INTO STRICT source_payload
        FROM champions.documents
        WHERE namespace = case_namespace AND collection = 'matches' AND key = test_case.match_key;
      -- Independent expected shape, removing nested paths without aggregate SQL.
      expected_projection := (source_payload - 'state' - 'requests')
        #- '{players,0,team}' #- '{players,1,team}';
      IF projection IS DISTINCT FROM expected_projection THEN
        RAISE EXCEPTION 'Compact shape or live metadata mismatch: %', test_case.label;
      END IF;
      IF projection ? 'state' OR projection ? 'requests'
        OR projection->'players'->0 ? 'team' OR projection->'players'->1 ? 'team'
        OR projection->'players'->0->>'uid' IS DISTINCT FROM 'fixture_z'
        OR projection->'players'->1->>'uid' IS DISTINCT FROM 'fixture_a' THEN
        RAISE EXCEPTION 'Private payload or participant order failure: %', test_case.label;
      END IF;
      IF octet_length(projection::text) >= octet_length(source_payload::text) / 20 THEN
        RAISE EXCEPTION 'Synthetic compact payload exceeds budget: %', test_case.label;
      END IF;
    END IF;
    checked := checked + 1;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_array(namespace, collection, key, payload) ORDER BY namespace, collection, key)
    INTO after_reads
    FROM champions.documents
    WHERE namespace IN (fixture_namespace, other_namespace);
  IF after_reads IS DISTINCT FROM baseline THEN
    RAISE EXCEPTION 'Projection reads changed persisted synthetic records';
  END IF;

  -- An action submission does not increment the match revision. Re-reading must
  -- still return fresh metadata, while preserving full state/teams/receipts.
  UPDATE champions.documents
    SET payload = jsonb_set(payload, '{pendingActions,opponent}',
      '[{"type":"move","moveIndex":1}]'::jsonb)
    WHERE namespace = fixture_namespace AND collection = 'matches' AND key = 'eligible'
    RETURNING payload INTO STRICT source_payload;
  IF source_payload IS DISTINCT FROM jsonb_set(base_payload, '{pendingActions,opponent}',
    '[{"type":"move","moveIndex":1}]'::jsonb) THEN
    RAISE EXCEPTION 'Synthetic submission changed unrelated state, teams or receipts';
  END IF;
  EXECUTE query_text INTO projection
    USING fixture_namespace, 'matches'::text, 'eligible'::text, 'fixture_z'::text,
      2::bigint, 3::bigint, 1000000::bigint;
  GET DIAGNOSTICS returned_rows = ROW_COUNT;
  expected_projection := (source_payload - 'state' - 'requests')
    #- '{players,0,team}' #- '{players,1,team}';
  IF returned_rows <> 1 OR projection IS DISTINCT FROM expected_projection
    OR projection->'pendingActions'->'opponent' IS DISTINCT FROM '[{"type":"move","moveIndex":1}]'::jsonb THEN
    RAISE EXCEPTION 'Same-revision submission was not read afresh';
  END IF;
  checked := checked + 1;
  original_bytes := octet_length(source_payload::text);
  compact_bytes := octet_length(projection::text);
  RAISE NOTICE 'PASS compact match SQL: % cases, synthetic full % bytes, compact % bytes. Final rollback follows.',
    checked, original_bytes, compact_bytes;
END;
$budget_fixture$;

ROLLBACK;
