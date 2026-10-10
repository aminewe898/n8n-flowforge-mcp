# Phase 1: separate ticket PostgreSQL deployment preparation

Review files only. No Docker command has been run by Codex, no database has been
started, no SQL has been applied and no existing n8n container/workflow has been changed.
The supplied environment is n8n 2.40.5 in Docker, container `n8n`, port 5678. Nothing
here changes its storage, environment, startup configuration or published port.

## Deployment decision

- Official image `postgres:18.6-bookworm`, PostgreSQL major 18. Current official
  documentation lists 18.6 and support through 2030-11-14. Use a reviewed current
  18.x patch release for later maintenance; do not switch major tags on this volume.
- Independent Compose project `ticket-db-v1`, only service `ticket-postgres`, container
  `ticket-postgres-v1`. Existing n8n is deliberately absent from Compose.
- Persistent named volume `ticket-pg18-data` at `/var/lib/postgresql`. PostgreSQL 18
  PGDATA is `/var/lib/postgresql/18/docker`; an older image's volume convention must
  not be copied unchanged. This is a new application volume, not n8n's data volume.
- Dedicated internal bridge `ticket-db-private`. Initially only PostgreSQL joins it.
  No host port mappings. n8n joins only in a separately authorized integration step.
- Dedicated database `ticket_system`, owner `ticket_owner` (NOLOGIN, no elevated flags).
- Runtime `ticket_n8n` (LOGIN, no superuser/create DB/create role/replication/bypass RLS,
  connection limit 10). Bootstrap admin `ticket_bootstrap` is the official-image
  superuser, used only for first initialization/maintenance over the Unix socket.
- pg_hba allows TCP only for ticket_n8n -> ticket_system using SCRAM; remote admin and
  other database/role combinations are rejected. Local admin is trust-authenticated
  inside this container; Docker exec/socket access is an administrative trust boundary.
- V1 transport is an isolated same-host Docker bridge with SCRAM authentication, not
  TLS-encrypted queries. No public database access. Add TLS before crossing untrusted
  networks; do not publish 5432 or enable ignore-certificate-errors to work around it.

Compose file-based secrets are host files mounted into the container, not an encrypted
secret vault. Protect their host ACLs and backups. `.env.example` contains placeholders
for file paths only. Actual secret files, `.env` and backups are ignored. Do not place
passwords in Compose, command arguments, committed files, workflow JSON or chat.

The fixed image tag permits explicit patch review. After an approved pull, record
its RepoDigest and optionally pin that reviewed digest for identical redeployments;
no digest was invented or resolved using Docker during preparation.

## Files and initialization order

| File | Purpose |
|---|---|
| compose.yaml | Standalone PG service, internal network, named PG18 volume, health check, secrets |
| .env.example | Required secret-file-path placeholders only |
| New-LocalSecrets.ps1 | Optional Windows helper; generates two different random 256-bit passwords and a path-only .env; refuses overwrites; not run |
| pg_hba.conf | Local bootstrap access, application-only SCRAM TCP access |
| init/10-ticket-init.sh | Official-image first-empty-volume hook; validates secret files, creates roles/database, applies migrations |
| bootstrap/00_roles.sql | Roles, runtime password read from transient init environment, database and role settings |
| bootstrap/10_apply.sql | SET ROLE ticket_owner and sequential migrations |
| migrations/001_schema.sql | Eight V1 tables, keys/indexes/triggers and owner-only auxiliary helpers |
| migrations/002_phase1_operations.sql | Atomic ingest_message and read-only lookup_message |
| migrations/003_grants.sql | Phase-1 least-privilege grants |
| healthcheck.sh | Read-only metadata checks that initialization and function grants completed |

On the FIRST APPROVED startup on an empty volume, Docker's official entrypoint initializes
the separate PG cluster, reads the bootstrap secret, and runs 10-ticket-init.sh. The
script reads the separate runtime secret, creates the non-login owner/runtime role,
creates ticket_system, applies 001, 002 and 003, then discards its transient secret variable.
SQL uses psql literal quoting, not password interpolation into a shell command. No
shell tracing or statement logging is enabled; error-statement logging is suppressed
to avoid logging parameterized PII/password SQL. Diagnostics should use sanitized codes.

Init scripts run only on an empty data directory. Restarting or changing secret files
does NOT rerun migrations or rotate role passwords. An interrupted initialization
requires inspection and a targeted repair; never assume unhealthy means an empty DB,
rerun all migrations blindly, or delete a persistent volume. Health checks require
the Phase-1 functions/grants, so a partially initialized service stays unhealthy.

Each SQL migration is one-shot and transactional, except cluster bootstrap CREATE DATABASE,
which PostgreSQL requires outside a transaction. SQL guards reject the wrong database,
owner or major version. Do not apply these files to n8n's own persistence/database.

## PostgreSQL 18 review of the previous schema

Identity columns, core gen_random_uuid(), JSONB, bytea, composite FKs, partial unique
indexes, PL/pgSQL, advisory transaction locks and SKIP LOCKED are supported in PG18.
No pgcrypto or other extension is required. Review changes in the deployment copy:

1. Explicit PG18/ticket_system/ticket_owner guard and default PUBLIC function denial.
2. Add processed_messages.intake_id FK/index so a duplicate voice received under new
   message IDs persistently maps to the original intake. No ninth table is introduced.
3. Safe fixed search_path for every helper; Phase-1 operations are SECURITY DEFINER
   owned by non-superuser ticket_owner, with schema-qualified object references.
4. Grant runtime only the two Phase-1 capabilities. Earlier broad direct table access
   is unnecessary for ingress and is deliberately absent.

Existing claim/renew/purge helpers stay owner-only, SECURITY INVOKER, and must NOT be
used by n8n in this phase. In particular, the purge helper still requires the later
transactional wrapper for cancelling dependent work and queuing notices. No schedules
or automatic purge/workers are deployed by this preparation.

Static review only: PostgreSQL has not compiled or executed the SQL. Concurrent/replay
and privilege integration tests are a gate before connecting production workflows.
The repository npm check tests the existing builder, not these PostgreSQL migrations.

## Phase-1 operation contracts

`ingest_message(bot_id bigint, update_id bigint, operator_user_id bigint, chat_id bigint,
message_id bigint, kind text, sanitized_message jsonb, nonsecret_policy jsonb) -> jsonb`

IDs are real values bound at runtime as decimal strings; no operator placeholders are
hardcoded into SQL or workflow logic. This database capability does not authenticate
Telegram headers or enforce the actual operator allowlist by itself: the later Webhook
workflow must perform both checks before calling it. Possession of ticket_n8n credentials
is already a trusted application boundary. The future workflow must never copy raw
webhook envelopes/headers or request-controlled policy into this function.

Accepted kind is voice or text. Unsupported updates are acknowledged/ignored by ingress.
Voice payload keys: fileId and fileUniqueId (required); mimeType, sizeBytes,
durationSeconds, sentAt (optional). Text payload: text (required), replyToMessageId,
sentAt (optional). sentAt is an ISO timestamp with timezone generated from Telegram's
epoch timestamp by deterministic normalization; identifiers are decimal strings where
needed. Unknown payload keys are rejected; raw headers, credentials and audio are not
accepted. Required policy path: retryPolicy.stageMaxAttempts, integer 1..20. Store only
trusted nonsecret configuration such as configVersion, priority/audio/AI/worker policies.

Atomic behavior:
- Brief bot-scoped advisory lock serializes ingress identity decisions in V1.
- Unique bot/update and bot/chat/message keys enforce message idempotency.
- Same message replay returns duplicate_message and never resets attempts/checkpoints.
- Conflicting ID mappings or same-ID changed kind/operator/text/reply/voice identity
  produce a controlled integrity error, not an overwrite.
- New voice inserts/reuses stable bot/operator/file_unique_id intake identity. New
  intake gets exactly one download job; repeated voice gets duplicate_voice, a new
  handled message row linked to the old intake, and NO new intake/job/ticket.
- New text inserts one operator_reply job. No pending-interaction consumption yet.
- Return accepted/duplicate_message/duplicate_voice and durable reconciliation fields.
- Any failure rolls back inbox, intake mapping and work insertion together.

`lookup_message(bot_id bigint, update_id bigint DEFAULT NULL, chat_id bigint DEFAULT NULL,
message_id bigint DEFAULT NULL) -> jsonb`

Read-only, though deliberately VOLATILE for fresh snapshots when called inside ingestion.
Specify an update ID, a complete chat/message pair, or both consistently. Returns found
plus stored message/intake/ticket/work IDs and statuses; no email/transcript/audio data.
It does not select the audio column. Conflicting lookup identifiers are rejected.
After an uncertain write, call lookup using the SAME identifiers. If found, return
stored state. If absent after any in-flight transaction resolves, retry the SAME
ingest call; unique keys/advisory lock reconcile concurrent completion. Never create a
replacement identity or assume a network error proves rollback.

Future Postgres node query templates (not executed):

```sql
SELECT ticket_intake.ingest_message(
  $1::bigint,$2::bigint,$3::bigint,$4::bigint,$5::bigint,
  $6::text,$7::jsonb,$8::jsonb) AS receipt;
SELECT ticket_intake.lookup_message(
  $1::bigint,$2::bigint,$3::bigint,$4::bigint) AS receipt;
```

The runtime can connect and use the schema, execute these two functions, and nothing
else through explicit grants. It cannot SELECT/INSERT/UPDATE/DELETE tables, access
sequences, CREATE objects/temp tables, assume ticket_owner, call worker/purge helpers,
or administer roles/databases. Those capabilities can be expanded with narrowly scoped
functions in a later reviewed phase; no blanket future-function grants.

## Exact proposed commands: do not run before deployment approval

Run in this deployment directory on the Docker host/context that actually owns container
`n8n`. These are a runbook, not commands executed during this request. For a remote
engine, secret/bind paths must exist on the engine host; adjust the file delivery first.

### A. Later read-only Docker preflight

```powershell
Set-Location 'C:\Users\amine\Documents\n8n-codex-builder\deployment\ticket-postgres'
docker context show
docker compose version
docker inspect n8n --format '{{.Id}} {{.State.Status}}'
docker inspect n8n --format '{{json .NetworkSettings.Networks}}'
docker container inspect ticket-postgres-v1 --format '{{json .Config.Labels}}'
docker network inspect ticket-db-private --format '{{json .Labels}}'
docker volume inspect ticket-pg18-data --format '{{json .Labels}}'
```

Missing new container/network/volume is expected on first deployment. If any exists,
inspect ownership/data and stop for review; do not overwrite/adopt it blindly. Avoid
unfiltered n8n docker inspect because its environment may contain secrets. Record
existing n8n identity/status/networks before proceeding. Confirm free disk/backup space.

### B. Later local secret preparation and PostgreSQL startup

```powershell
.\New-LocalSecrets.ps1
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml pull ticket-postgres
docker compose --env-file .env -f compose.yaml up -d --no-recreate --wait --wait-timeout 180 ticket-postgres
docker compose --env-file .env -f compose.yaml ps
docker inspect n8n --format '{{.Id}} {{.State.Status}}'
docker network inspect ticket-db-private --format '{{json .Containers}}'
docker compose --env-file .env -f compose.yaml images
```

This startup creates the NEW network/volume/container and automatically applies the
reviewed bootstrap/migrations on a NEW EMPTY volume. It does not connect/recreate n8n.
No --remove-orphans, compose down -v, volume removal, n8n stop/recreate, or host 5432 mapping.
Do not execute the helper with verbose tracing/transcription of secret variables. It
refuses existing files. Windows helper creates restrictive secrets-directory ACLs for
the current user/SYSTEM; verify Docker Desktop can read them without broadening access.
For Linux/remote deployment use equivalent protected secret files with mode 0600 and
paths in .env; the helper is not a cross-host secret-delivery mechanism.

Read-only post-init verification, later:

```powershell
docker compose exec -T ticket-postgres psql -X -v ON_ERROR_STOP=1 -U ticket_bootstrap -d ticket_system -c "SELECT version(), current_database();"
docker compose exec -T ticket-postgres psql -X -v ON_ERROR_STOP=1 -U ticket_bootstrap -d ticket_system -c "SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolcanlogin FROM pg_roles WHERE rolname IN ('ticket_owner','ticket_n8n');"
docker compose exec -T ticket-postgres psql -X -v ON_ERROR_STOP=1 -U ticket_bootstrap -d ticket_system -c "SELECT has_database_privilege('ticket_n8n','ticket_system','CONNECT') AS can_connect, has_database_privilege('ticket_n8n','ticket_system','TEMP') AS can_temp, has_table_privilege('ticket_n8n','ticket_intake.tickets','INSERT') AS can_insert;"
docker compose exec -T ticket-postgres psql -X -v ON_ERROR_STOP=1 -U ticket_bootstrap -d ticket_system -c "SELECT has_function_privilege('ticket_n8n','ticket_intake.lookup_message(bigint,bigint,bigint,bigint)','EXECUTE') AS can_lookup;"
```

Expected runtime: connect=true, temp=false, insert=false, lookup=true; owner cannot
log in and neither owner nor runtime has elevated flags. Verify table count eight,
ownership ticket_owner, no published port, and only database on new network. Real
runtime-login/function/replay tests come later against synthetic fixtures in an
isolated database; these metadata checks are not sufficient integration testing.

### C. Separate later n8n integration step, NOT authorized/executed now

```powershell
docker network connect ticket-db-private n8n
docker network inspect ticket-db-private --format '{{json .Containers}}'
```

This command DOES change n8n's network attachments, even though it does not recreate
or stop it, and must wait for a separate approval. Check network mode is attachable:
host/none/container sharing modes need a different integration plan. On later recreate
of n8n, its existing deployment must explicitly preserve this extra network, in a
separately reviewed change; this Compose project never manages n8n.

After attachment, manually create a Postgres credential in n8n: host ticket-postgres,
port 5432, database ticket_system, user ticket_n8n, runtime password entered directly
in credential UI. SSL is off only for this isolated-bridge V1 plan. The existing
Telegram credential remains untouched. Do not use the bootstrap credential in n8n.

## Backup and restore

Named volume is persistence, not a backup. Proposed minimum is daily encrypted custom
format pg_dump, copied off this Docker host, with a tested restore and an agreed RPO.
Logical backups include transcripts/contact/ticket data and temporarily retained audio.
Retention for dumps/WAL/snapshots must match the audio/privacy policy; deleting live
audio cannot remove older backup copies. No live volume-directory copy is considered
a valid database backup. Production PITR/WAL archiving is a separately reviewed option.

Example later manual backup, no password-bearing arguments and no binary stdout
redirection through Windows PowerShell:

```powershell
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$taskRemote = '/tmp/ticket-system-' + $taskStamp + '.dump'
$taskBackup = './backups/ticket-system-' + $taskStamp + '.dump'
docker compose exec -T ticket-postgres pg_dump -U ticket_bootstrap -d ticket_system --format=custom --no-owner --no-acl --file=$taskRemote
docker compose cp ('ticket-postgres:' + $taskRemote) $taskBackup
Get-FileHash -LiteralPath $taskBackup -Algorithm SHA256
```

Check both Docker exit codes before trusting the file. Protect/encrypt/copy the dump
off-host, verify integrity and only then remove its exact temporary container file
with a reviewed maintenance command. Backups/secret files are not committed. Keep
bootstrap/runtime secrets in a separate protected recovery store; pg_dump does not
back up roles/passwords. Recreate roles from bootstrap and reapply grants after a
production restore. Do not use pg_dumpall output containing role password hashes as
an unprotected substitute. Password rotation is explicit maintenance, not editing .env.

Restore drill below targets a NEW database, never ticket_system or n8n's database:

```powershell
docker compose exec -T ticket-postgres createdb -U ticket_bootstrap --owner=ticket_owner ticket_system_restore
docker compose exec -T ticket-postgres psql -X -v ON_ERROR_STOP=1 -U ticket_bootstrap -d postgres -c "REVOKE ALL ON DATABASE ticket_system_restore FROM PUBLIC;"
docker compose cp $taskBackup ticket-postgres:/tmp/ticket-system-restore.dump
docker compose exec -T ticket-postgres pg_restore -U ticket_bootstrap --role=ticket_owner --dbname=ticket_system_restore --no-owner --no-acl --exit-on-error /tmp/ticket-system-restore.dump
docker compose exec -T ticket-postgres psql -X -v ON_ERROR_STOP=1 -U ticket_bootstrap -d ticket_system_restore -c "REVOKE ALL ON SCHEMA ticket_intake FROM PUBLIC; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ticket_intake FROM PUBLIC;"
```

Stop if restore DB already exists; do not add drop/clean flags. Verify table counts,
FKs, ticket/intake links, checkpoints and function ownership in the restore database.
It is not reachable by ticket_n8n under this pg_hba plan and has no runtime grants.
For production recovery, select restored DB/credential routing only after separate
review; 003_grants.sql's production database guard must not be bypassed casually.
Major upgrades require dump/restore or pg_upgrade; never point PG19 at the PG18 volume.

## Still needed before an actual deployment

- Confirmation of the Docker host/context and permission to create ONLY the new PG
  service/network/volume and apply these migrations.
- Confirmation that fixed names ticket-db-v1/ticket-postgres-v1/ticket-db-private/
  ticket-pg18-data/ticket_system/ticket_owner/ticket_n8n do not conflict.
- Review of backup destination/retention, available disk and resource limits.
- Actual secrets generated locally, not provided to Codex in chat.
- Later integration approval for attaching n8n; actual Telegram operator IDs and n8n
  Postgres credential ID are not needed to start this isolated database phase.

## Official sources

- https://www.postgresql.org/support/versioning/
- https://hub.docker.com/_/postgres
- https://www.postgresql.org/docs/18/sql-createfunction.html
- https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html
- https://www.postgresql.org/docs/18/auth-pg-hba-conf.html
- https://docs.docker.com/reference/compose-file/networks/
- https://docs.docker.com/reference/compose-file/volumes/
- https://docs.docker.com/compose/how-tos/use-secrets/
