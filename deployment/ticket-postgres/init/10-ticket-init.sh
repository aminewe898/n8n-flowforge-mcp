#!/usr/bin/env bash
set -Eeuo pipefail
# No tracing. Never echo secret values or pass passwords as command arguments.
for task_secret in /run/secrets/ticket_admin_password /run/secrets/ticket_runtime_password; do
  if [[ ! -r "$task_secret" ]]; then
    echo 'Required ticket database secret file is missing or unreadable.' >&2
    exit 1
  fi
  task_value="$(< "$task_secret")"
  if [[ ${#task_value} -lt 32 || "$task_value" == *$'\n'* || "$task_value" == *$'\r'* \
        || "$task_value" == REPLACE* || "$task_value" == CHANGE* || "$task_value" == '<'* ]]; then
    echo 'Secret files require distinct real single-line passwords of at least 32 characters.' >&2
    exit 1
  fi
  unset task_value
done
task_admin="$(< /run/secrets/ticket_admin_password)"
TICKET_RUNTIME_PASSWORD="$(< /run/secrets/ticket_runtime_password)"
if [[ "$task_admin" == "$TICKET_RUNTIME_PASSWORD" ]]; then
  echo 'Admin and runtime passwords must be different.' >&2
  exit 1
fi
unset task_admin
export TICKET_RUNTIME_PASSWORD
psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=postgres \
  --file=/opt/ticket/bootstrap/00_roles.sql
unset TICKET_RUNTIME_PASSWORD
psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=ticket_system \
  --file=/opt/ticket/bootstrap/10_apply.sql
