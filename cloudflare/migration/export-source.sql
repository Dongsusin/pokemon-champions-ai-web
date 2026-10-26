CREATE OR REPLACE FUNCTION public.cloudflare_migration_export(p_kind text DEFAULT 'manifest', p_cursor jsonb DEFAULT '[]'::jsonb, p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 OR jsonb_typeof(p_cursor) <> 'array' THEN RAISE EXCEPTION 'invalid export request'; END IF;
 IF p_kind = 'manifest' THEN
  SELECT jsonb_build_object('kind','documents','count',count(*),'bytes',coalesce(sum(octet_length(payload::text)),0),'hash',md5(coalesce(string_agg(md5(jsonb_build_array(namespace,collection,key,payload)::text),'' ORDER BY namespace,collection,key),''))) INTO result FROM champions.documents;
 ELSIF p_kind = 'catalog' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(groups) ORDER BY namespace,collection),'[]'::jsonb) INTO result FROM (SELECT namespace,collection,count(*) FROM champions.documents GROUP BY namespace,collection) groups;
 ELSIF p_kind = 'documents' THEN
  IF jsonb_array_length(p_cursor)<>3 OR (p_cursor->>1='gameData' AND p_limit>10) THEN RAISE EXCEPTION 'invalid scoped cursor'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('namespace',namespace,'collection',collection,'key',key,'payload',payload) ORDER BY namespace,collection,key),'[]'::jsonb) INTO result FROM (SELECT namespace,collection,key,payload FROM champions.documents WHERE namespace=p_cursor->>0 AND collection=p_cursor->>1 AND key>p_cursor->>2 ORDER BY namespace,collection,key LIMIT p_limit) records;
 ELSIF p_kind = 'journal' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY a,b,c),'[]'::jsonb) INTO result FROM (SELECT a,b,c FROM champions.cloudflare_migration_journal WHERE jsonb_array_length(p_cursor)=0 OR (a,b,c)>(p_cursor->>0,p_cursor->>1,p_cursor->>2) ORDER BY a,b,c LIMIT p_limit) j;
 ELSIF p_kind = 'delta' THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('namespace',namespace,'collection',collection,'key',key,'payload',payload)),'[]'::jsonb) INTO result FROM champions.documents WHERE namespace=p_cursor->>0 AND collection=p_cursor->>1 AND key=p_cursor->>2;
 ELSE RAISE EXCEPTION 'invalid export kind'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cloudflare_migration_export(text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cloudflare_migration_export(text,jsonb,integer) TO service_role;
ALTER FUNCTION public.cloudflare_migration_export(text,jsonb,integer) SET statement_timeout='45s';
