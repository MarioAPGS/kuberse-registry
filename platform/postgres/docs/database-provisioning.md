# Database Provisioning

This document explains how the automated database provisioning system works in the Kuberse platform. Any module that needs a PostgreSQL database can request one simply by adding a label to its Kubernetes Secret.

## Core Principle

**No database is manually created.** Modules declare their database needs via a labeled Kubernetes Secret containing a connection string. The provisioner CronJob discovers these secrets and automatically creates the required users and databases.

## End-to-End Provisioning Flow

```mermaid
sequenceDiagram
    participant Mod as Module (Helm chart)
    participant Vault as Vault
    participant VSO as VSO
    participant Sec as K8s Secret<br/>(labeled pgdb=KEY)
    participant CJ as CronJob<br/>postgres-db-provisioner
    participant PG as PostgreSQL

    Note over Mod,Vault: 1. Module stores connection string in Vault
    Mod->>Vault: vault kv put secret/my-module/config<br/>PG_CONNECTION_STRING=postgresql://user:pass@host:5432/mydb

    Note over VSO,Sec: 2. VSO syncs secret with pgdb label
    VSO->>Vault: Read secret/my-module/config
    Vault->>VSO: {PG_CONNECTION_STRING: postgresql://...}
    VSO->>Sec: Create Secret with label pgdb=PG_CONNECTION_STRING

    Note over CJ,PG: 3. Provisioner discovers and creates (every 5 min)
    CJ->>CJ: kubectl get secrets -A -l pgdb
    CJ->>Sec: Read PG_CONNECTION_STRING value
    CJ->>CJ: Parse: user, password, host, port, dbname
    CJ->>CJ: Validate host/port match local PostgreSQL
    CJ->>PG: CREATE USER (or ALTER USER password)
    CJ->>PG: CREATE DATABASE (if not exists)
    CJ->>PG: GRANT ALL PRIVILEGES
```

## How to Request a Database

To have a database automatically provisioned, a module needs a Kubernetes Secret with:

1. A **label** `pgdb: <KEY>` where `<KEY>` is the name of the data field containing the connection string
2. A **data field** with that key name, containing a `postgresql://` connection string

### Label-Based Discovery

The label `pgdb` tells the provisioner **which data key** in the Secret holds the connection string. The label value and the data key must match:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-module-secrets
  namespace: my-namespace
  labels:
    pgdb: PG_CONNECTION_STRING   # <-- label value = data key name
type: Opaque
stringData:
  PG_CONNECTION_STRING: "postgresql://myuser:mypassword@postgres.platform.svc.cluster.local:5432/mydb"
  OTHER_CONFIG: "some-other-value"    # ignored by the provisioner
```

### Connection String Format

```
postgresql://user:password@host:port/dbname
```

| Field | Description | Requirements |
|-------|-------------|--------------|
| `user` | Database user to create | Required, cannot be empty |
| `password` | User password | Required, cannot be empty |
| `host` | PostgreSQL hostname | Must match the platform PostgreSQL instance (see validation below) |
| `port` | PostgreSQL port | Must match the configured port (default: 5432) |
| `dbname` | Database to create | Required, cannot be `postgres`, `template0`, or `template1` |

### With Vault and VSO (Recommended)

In practice, modules use VaultStaticSecret to sync their secrets from Vault. The `pgdb` label is added to the VaultStaticSecret's destination so the resulting Kubernetes Secret is labeled correctly:

```yaml
apiVersion: secrets.hashicorp.com/v1beta1
kind: VaultStaticSecret
metadata:
  name: my-module-vault-secret
  namespace: my-namespace
spec:
  type: kv-v2
  mount: secret
  path: my-module/config
  destination:
    name: my-module-secrets
    create: true
    labels:
      pgdb: PG_CONNECTION_STRING    # <-- added to the resulting K8s Secret
  refreshAfter: 30s
  vaultAuthRef: my-module-auth
```

## How the Provisioner CronJob Works

### Discovery Flow

```mermaid
flowchart TD
    A["CronJob runs<br/>(every 5 min)"] --> B["Connect to PostgreSQL<br/>as admin (from postgres-secrets)"]
    B --> C["kubectl get secrets -A -l pgdb"]
    C --> D{Secrets found?}
    D -->|No| Z["Done (0 requests)"]
    D -->|Yes| E["For each Secret:"]
    E --> F["Read label value (pgdb=KEY)"]
    F --> G["Decode data[KEY]<br/>= connection string"]
    G --> H["Parse: user, password,<br/>host, port, dbname"]
    H --> I{"Validate:<br/>host/port match?<br/>DB not reserved?"}
    I -->|Fail| J["Log error, skip"]
    I -->|Pass| K["CREATE USER<br/>(or ALTER password)"]
    K --> L["CREATE DATABASE<br/>(if not exists)"]
    L --> M["GRANT ALL PRIVILEGES"]
    M --> N{More secrets?}
    J --> N
    N -->|Yes| E
    N -->|No| Z2["Done"]
```

### Validation Rules

Before provisioning, the script validates each connection string:

| Check | Rule | Accepted Values |
|-------|------|-----------------|
| **Host** | Must target the local PostgreSQL instance | FQDN (`postgres.platform.svc.cluster.local`), short name (`postgres`), `localhost`, `127.0.0.1` |
| **Port** | Must match the configured port | `5432` (default) |
| **Database name** | Must not be reserved | Any name except `postgres`, `template0`, `template1` |

Connection strings targeting a different PostgreSQL server are silently skipped (logged as validation error).

### Idempotent Operations

All provisioning operations are idempotent -- running the CronJob multiple times with the same secrets produces the same result:

| Operation | First Run | Subsequent Runs |
|-----------|-----------|-----------------|
| User creation | `CREATE USER` with password | `ALTER USER` to ensure password matches |
| Database creation | `CREATE DATABASE` with owner | No-op (already exists) |
| Privileges | `GRANT ALL PRIVILEGES` | No-op (already granted) |

### CronJob Permissions

The provisioner has a dedicated ServiceAccount `postgres-db-provisioner` with:

| Scope | Resources | Actions |
|-------|-----------|---------|
| **Cluster-wide** | secrets, namespaces | get, list |

This allows it to discover labeled secrets across all namespaces (or a filtered subset).

### Namespace Filtering

The `dbProvisioner.namespaceToSearch` setting controls which namespaces the provisioner scans:

| Value | Behavior |
|-------|----------|
| `null` (default) | Scan **all** namespaces |
| `[]` (empty list) | Provisioning **disabled** |
| `["platform", "apps"]` | Scan **only** listed namespaces |

## Modules Using Database Provisioning

| Module | Secret | Label | Connection String Key | Database Created |
|--------|--------|-------|----------------------|------------------|
| Kiops | `kiops-secrets` (VaultStaticSecret) | `pgdb: PG_CONNECTION_STRING` | `PG_CONNECTION_STRING` | kiops DB |
| Authentik | `authentik-db-secrets` (VaultStaticSecret) | `pgdb: PG_CONNECTION_STRING` | `PG_CONNECTION_STRING` | authentik DB |
| Kubrain | `kubrain-secrets` (VaultStaticSecret) | `pgdb: PG_CONNECTION_STRING` | `PG_CONNECTION_STRING` | kubrain DB |

Each module stores its `PG_CONNECTION_STRING` in Vault (e.g. `secret/kiops/config`). The VSO syncs it to a Kubernetes Secret with the `pgdb` label, and the provisioner automatically creates the database and user.

## CloudBeaver Integration

Modules can also use the label `cbdb: PG_CONNECTION_STRING` on the same secret to trigger automatic registration in CloudBeaver (a web-based database management UI). CloudBeaver has its own CronJob that discovers secrets with the `cbdb` label using the same pattern. A single secret can carry both labels:

```yaml
labels:
  pgdb: PG_CONNECTION_STRING    # triggers PostgreSQL provisioning
  cbdb: PG_CONNECTION_STRING    # triggers CloudBeaver registration
```

## Vault Integration

PostgreSQL admin credentials follow the standard Vault integration pattern:

| Resource | Name | Purpose |
|----------|------|---------|
| VaultConnection | `vault-connection` | Connection to `http://vault.platform.svc.cluster.local:8200` |
| VaultAuth | `postgres-auth` | Kubernetes auth with `postgres-role` and `postgres-sa` |
| VaultStaticSecret | `postgres-vault-secret` | Syncs `secret/postgres/config` to `postgres-secrets` with transformation |
| ConfigMap | `postgres-vault-role` | Labeled `vault: setup-creds` for discovery by the Vault CronJob |

The VaultStaticSecret uses a transformation to extract only the needed keys:

```yaml
transformation:
  excludeRaw: true
  templates:
    POSTGRES_USER:
      text: "{{ .Secrets.POSTGRES_USER }}"
    POSTGRES_PASSWORD:
      text: "{{ .Secrets.POSTGRES_PASSWORD }}"
```

## Storing Admin Credentials in Vault

Before deploying PostgreSQL, store the admin credentials in Vault:

```bash
kubectl exec -it vault-0 -n platform -- vault kv put \
  secret/postgres/config \
  POSTGRES_USER=admin \
  POSTGRES_PASSWORD=your-secure-password
```

Module-specific connection strings are stored in each module's own Vault path:

```bash
# Example: store Kiops database credentials
kubectl exec -it vault-0 -n platform -- vault kv put \
  secret/kiops/config \
  PG_CONNECTION_STRING="postgresql://kiops:kiops-password@postgres.platform.svc.cluster.local:5432/kiops" \
  OTHER_KEY=other-value
```
