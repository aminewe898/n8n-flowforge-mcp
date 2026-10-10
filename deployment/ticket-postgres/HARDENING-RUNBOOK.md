Backend hardening 006, deployed PostgreSQL 18.6 / n8n 2.40.5.

Old migrations 001–005 remain byte-for-byte unchanged. Current policy is owner-managed in ticket_intake.backend_policy: interactions 48h, audio hard eligibility 72h, successful transcript/extraction grace 60m, batch 50 (maximum 100). TI-05 calls the atomic maintenance capability once per minute. Leased/contested rows are skipped and retried next minute; eligibility does not mean guaranteed physical deletion at the exact TTL under downtime or live leases. Audio purge retains transcript/extraction/hash/size/MIME/provenance and preserves the business revision once transcription exists. Before transcription, hard expiry moves dependent queued/expired work to operator review. Backups are separate retention artifacts (see below).

Reproducible migration command (already applied; do not blindly reapply):

```powershell
node planning/ticket-intake-v1/build-hardening-migration.mjs
node planning/ticket-intake-v1/build-hardening-tests.mjs
node deployment/ticket-postgres/tests/hardening-isolated.mjs
node deployment/ticket-postgres/tests/backup-restore-proof.mjs pre006
node planning/ticket-intake-v1/apply-hardening-production.mjs
node deployment/ticket-postgres/tests/backup-restore-proof.mjs post006
```

The apply script checks the isolated suite checksum, provisions NOLOGIN capabilities from bootstrap/20_backend_roles.sql, applies 006 as ticket_owner in one transaction with lock timeout, and compares all original business columns. A first-empty-volume install still bootstraps Phase 1; later operator-reviewed migrations 004/005 and then 006 must be applied in order. Existing init scripts/migrations were not retroactively rewritten.

Backup command, repeat during a quiet interval:

```powershell
node deployment/ticket-postgres/tests/backup-restore-proof.mjs daily
```

It uses `docker exec ticket-postgres-v1 pg_dump -U ticket_bootstrap -d ticket_system -Fc`, writes outside the workspace to `%LOCALAPPDATA%\CodexTicketBackups`, creates a uniquely named template0 database, restores with `pg_restore --exit-on-error`, compares row fingerprints/counts/function definitions/owners/effective ACLs/constraints/indexes/sequences, verifies runtime write denial, then removes the disposable DB. Database CONNECT ACLs are applied separately because a non --create archive excludes database-level ACLs. Roles must already exist; no password/credential objects are exported. The report is machine-readable under deployment/ticket-postgres/tests/backup-restore-<label>-result.json. Comparison normalizes NULL ACL to its effective acldefault; an explicit owner-only ACL and implicit owner-only ACL have the same privileges.

Never use --create/--clean against ticket_system. A real recovery must use a separate new database first, inspect role grants/schema/migration history, verify data, then perform a separately approved connection cutover. Do not alter n8n's persistence database. Backup automation/off-host replication is not installed by this sprint; schedule this command through the operator's existing backup mechanism, and alert on failure.

Backups contain customer data and any audio present at snapshot time. Protect host ACLs; encrypt storage/off-host copies. Active-database audio purge does not erase previous backups or PostgreSQL WAL snapshots. Keep backups containing audio no later than the earliest audio_stored_at+72h among their contents, or produce approved audio-free archival backups before retaining them longer. No backup or production cleanup was automatically deleted by this sprint. Backup retention/off-host/encryption policy remains an explicit operational risk until configured; do not claim whole-estate 72h audio erasure.

Read-only health:

```sql
SELECT ticket_intake.automation_health($1::bigint,$2::bigint,$3::bigint);
```

Use trusted scope from authenticated server config. Alert on overdue interactions/expired leases, oldest queue age, failed/uncertain delivery, and last maintenance age >5m. No payload-heavy n8n history is needed. TI-05 errors are generic and history saving is disabled; database last_maintenance_at is the durable heartbeat. At busy outcome the last successful timestamp is not advanced.

Uncertain delivery handling must be an explicit delivery-admin action via the frozen contract. View metadata, check Telegram chat manually, then mark_delivered/retry_once/cancel with UUID idempotency and exact updatedAt. Retry warns about duplicates; there is no Telegram send idempotency guarantee. Preserve historical receipt. Do not rewrite dispatch markers or reset attempts manually.

n8n installed defaults inspected: JSON body reader max16MiB; execution pruning enabled, max age336h/count10000, hard-delete buffer1h, soft pass60m/hard pass15m. Finished execution deletion includes binary blobs; old annotated executions are exempt. Worker workflows disable successful/error/manual/progress payload saving. Existing saved or abandoned binary artifacts are not proven completely absent, and pruning is separate from ticket audio retention. Do not enable debug/provider payload logging. No n8n container restart or persistence mutation was performed.

Security action remaining: n8n publishes 5678 on all host interfaces. Review firewall and reverse proxy; restrict direct access and route only necessary webhook/UI paths over HTTPS. No firewall/container change or external webhook simulation was performed. Consider smaller per-webhook body limits in the existing proxy; current installed reader is bounded at16MiB. Phase-2 rejects voice >10,000,000 bytes, duration>600s and MIME outside audio/ogg/audio/opus/application/ogg before download; downloaded bytes additionally require OggS and actual length bound. Sanitized SQL payload is <=32KiB; text <=8000 code points. TI-01 authenticates Header Auth before logic, authorizes configured user/chat/private/human, strips all untrusted extra fields, uses parameter binding, and acknowledges persistence failures as503.

Only maintenance TI-05 was created. TI-00–TI-04 retain their existing published workflow versions. Production cleanup is proposal-only in planning/ticket-intake-v1/hardening-cleanup.proposed.sql; do not run without explicit approval and fresh guard review/backup.
