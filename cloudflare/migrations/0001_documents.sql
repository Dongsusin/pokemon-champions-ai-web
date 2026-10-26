CREATE TABLE IF NOT EXISTS documents(namespace TEXT NOT NULL, collection TEXT NOT NULL, key TEXT NOT NULL, version TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace,collection,key));
CREATE TABLE IF NOT EXISTS document_slots(namespace TEXT NOT NULL, collection TEXT NOT NULL, key TEXT NOT NULL, slot TEXT NOT NULL, data TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(namespace,collection,key,slot));
CREATE TABLE IF NOT EXISTS collection_versions(namespace TEXT NOT NULL, collection TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY(namespace,collection));
CREATE TABLE IF NOT EXISTS transaction_guard(id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
CREATE INDEX IF NOT EXISTS session_expiry ON documents(namespace,collection,json_extract(payload,'$.expiresAt')) WHERE collection='sessions';
CREATE INDEX IF NOT EXISTS usage_owner ON documents(namespace,collection,json_extract(payload,'$.owner')) WHERE collection='pokemonUsageEvents';
CREATE INDEX IF NOT EXISTS factory_order ON documents(namespace,collection,json_extract(payload,'$.floor') DESC,json_extract(payload,'$.recordedAt'),key) WHERE collection='factoryPersonalBest';
CREATE TABLE IF NOT EXISTS document_slot_overflow(namespace TEXT NOT NULL,collection TEXT NOT NULL,key TEXT NOT NULL,slot TEXT NOT NULL,part INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(namespace,collection,key,slot,part));
