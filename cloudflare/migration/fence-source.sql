CREATE OR REPLACE FUNCTION champions.cloudflare_source_read_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Storage moved to Cloudflare. Refresh the game page.' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION champions.cloudflare_source_read_only() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cloudflare_source_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON champions.documents FOR EACH STATEMENT EXECUTE FUNCTION champions.cloudflare_source_read_only();
