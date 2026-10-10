\set ON_ERROR_STOP on
\getenv runtime_password TICKET_RUNTIME_PASSWORD
BEGIN;
CREATE ROLE ticket_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE ticket_n8n LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;
-- psql quotes the secret as a SQL literal; not argv, source text or echoed output.
SELECT format('ALTER ROLE ticket_n8n PASSWORD %L', :'runtime_password') \gexec
\unset runtime_password
COMMIT;
CREATE DATABASE ticket_system OWNER ticket_owner;
REVOKE ALL ON DATABASE ticket_system FROM PUBLIC;
-- No application access to template/maintenance databases, also blocked by pg_hba.
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
ALTER ROLE ticket_n8n IN DATABASE ticket_system SET search_path = pg_catalog, ticket_intake;
ALTER ROLE ticket_n8n IN DATABASE ticket_system SET statement_timeout = '15s';
ALTER ROLE ticket_n8n IN DATABASE ticket_system SET lock_timeout = '5s';
ALTER ROLE ticket_n8n IN DATABASE ticket_system SET idle_in_transaction_session_timeout = '15s';
