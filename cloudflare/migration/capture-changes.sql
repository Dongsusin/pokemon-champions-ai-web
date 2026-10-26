CREATE TABLE IF NOT EXISTS champions.cloudflare_migration_journal(a text NOT NULL,b text NOT NULL,c text NOT NULL DEFAULT '',PRIMARY KEY(a,b,c));
ALTER TABLE champions.cloudflare_migration_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON champions.cloudflare_migration_journal FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION champions.capture_cloudflare_migration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
IF TG_OP='DELETE' THEN INSERT INTO champions.cloudflare_migration_journal VALUES(OLD.namespace,OLD.collection,OLD.key) ON CONFLICT DO NOTHING; ELSE INSERT INTO champions.cloudflare_migration_journal VALUES(NEW.namespace,NEW.collection,NEW.key) ON CONFLICT DO NOTHING; END IF;
RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION champions.capture_cloudflare_migration() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cloudflare_migration_capture AFTER INSERT OR UPDATE OR DELETE ON champions.documents FOR EACH ROW EXECUTE FUNCTION champions.capture_cloudflare_migration();
