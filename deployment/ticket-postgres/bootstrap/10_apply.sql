\set ON_ERROR_STOP on
-- All objects owned by a non-login, non-superuser application owner.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SET ROLE ticket_owner;
\i /opt/ticket/migrations/001_schema.sql
\i /opt/ticket/migrations/002_phase1_operations.sql
\i /opt/ticket/migrations/003_grants.sql
RESET ROLE;
