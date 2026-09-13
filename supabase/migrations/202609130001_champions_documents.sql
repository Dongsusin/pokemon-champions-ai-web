-- Server-only JSON documents used by Firebase-authenticated API functions.
-- Keep this schema out of Supabase's exposed API schemas. The application never
-- receives this role's password, a database URL, or a Supabase service-role key.
create schema if not exists champions;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'champions_server') then
    create role champions_server nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

create table if not exists champions.documents (
  namespace text not null check (namespace ~ '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$'),
  collection text not null check (collection ~ '^[a-zA-Z0-9_-]{1,128}$'),
  key text not null check (key ~ '^[a-zA-Z0-9_-]{1,128}$'),
  payload jsonb not null,
  primary key (namespace, collection, key)
);

alter table champions.documents enable row level security;
alter table champions.documents force row level security;

revoke all on schema champions from public, anon, authenticated;
revoke all on all tables in schema champions from public, anon, authenticated;
revoke all on all sequences in schema champions from public, anon, authenticated;
alter default privileges in schema champions revoke all on tables from public, anon, authenticated;
alter default privileges in schema champions revoke all on sequences from public, anon, authenticated;

grant usage on schema champions to champions_server;
grant select, insert, update, delete on champions.documents to champions_server;

drop policy if exists champions_server_documents on champions.documents;
create policy champions_server_documents on champions.documents
  for all to champions_server using (true) with check (true);

-- LOGIN and its rotated password are configured separately through the server
-- secret setup. This migration deliberately contains no credentials.
