#!/bin/sh
set -eu

: "${POSTGRES_MCP_USER:?POSTGRES_MCP_USER is required}"
: "${POSTGRES_MCP_PASSWORD:?POSTGRES_MCP_PASSWORD is required}"

case "$POSTGRES_MCP_USER$POSTGRES_MCP_PASSWORD" in
  *[!A-Za-z0-9_-]*)
    echo 'MCP database credentials must use only letters, digits, underscores, or hyphens.' >&2
    exit 1
    ;;
esac

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --set owner="$POSTGRES_USER" \
  --set pg_db="$POSTGRES_DB" \
  --set mcp_user="$POSTGRES_MCP_USER" \
  --set mcp_password="$POSTGRES_MCP_PASSWORD" <<'SQL'
CREATE ROLE :"mcp_user" LOGIN PASSWORD :'mcp_password';
GRANT CONNECT ON DATABASE :"pg_db" TO :"mcp_user";
GRANT USAGE ON SCHEMA public TO :"mcp_user";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"mcp_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT ON TABLES TO :"mcp_user";
SQL
