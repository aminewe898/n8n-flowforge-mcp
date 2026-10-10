#!/usr/bin/env bash
set -euo pipefail
# Read-only metadata check, not a workflow execution or ticket insertion.
task_ready="$(psql --no-psqlrc --set=ON_ERROR_STOP=1 --username=ticket_bootstrap \
  --dbname=ticket_system --tuples-only --no-align --command="
SELECT 1
WHERE current_setting('server_version_num')::integer / 10000 = 18
  AND to_regprocedure('ticket_intake.ingest_message(bigint,bigint,bigint,bigint,bigint,text,jsonb,jsonb)') IS NOT NULL
  AND to_regprocedure('ticket_intake.lookup_message(bigint,bigint,bigint,bigint)') IS NOT NULL
  AND has_function_privilege('ticket_n8n',
    'ticket_intake.ingest_message(bigint,bigint,bigint,bigint,bigint,text,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_table_privilege('ticket_n8n', 'ticket_intake.tickets', 'INSERT');")"
[[ "$task_ready" == '1' ]]
