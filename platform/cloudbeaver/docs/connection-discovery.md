# Connection Discovery

This document explains how CloudBeaver automatically discovers and registers database connections from Kubernetes Secrets and ConfigMaps across the cluster.

## Core Principle

**No connection is manually configured in CloudBeaver.** Modules declare their database connections via labeled Kubernetes resources. The onboarding CronJob discovers these resources and registers the connections automatically in CloudBeaver's `data-sources.json`.

## End-to-End Discovery Flow

```mermaid
sequenceDiagram
    participant Mod as Module (Helm chart)
    participant Vault as Vault
    participant VSO as VSO
    participant Sec as K8s Secret<br/>(labeled cbdb=KEY)
    participant CJ as CronJob<br/>cloudbeaver-db-onboarding
    participant DS as data-sources.json
    participant CB as CloudBeaver

    Note over Mod,Vault: 1. Module stores connection string in Vault
    Mod->>Vault: vault kv put secret/my-module/config<br/>PG_CONNECTION_STRING=postgresql://user:pass@host:5432/mydb

    Note over VSO,Sec: 2. VSO syncs secret with cbdb label
    VSO->>Vault: Read secret/my-module/config
    Vault->>VSO: {PG_CONNECTION_STRING: postgresql://...}
    VSO->>Sec: Create Secret with label cbdb=PG_CONNECTION_STRING

    Note over CJ,CB: 3. CronJob discovers and registers (every 5 min)
    CJ->>CJ: kubectl get secrets -A -l cbdb
    CJ->>Sec: Read PG_CONNECTION_STRING value
    CJ->>CJ: Parse: user, password, host, port, dbname
    CJ->>DS: Write connection entry to data-sources.json
    CJ->>CJ: Compute SHA-256 hash of all connections
    CJ->>CB: Patch Deployment annotation (triggers restart if hash changed)
```

## Discovery Sources

### Source 1: Secrets labeled `cbdb=<key>` (preferred)

The label value specifies which data key holds the `postgresql://` connection string. The script parses the URI to extract host, port, database, username, and password. CloudBeaver saves the password and connects without prompting.

- **Connection ID format**: `cb-auto-{namespace}-{secret_name}`
- **Password**: Saved in `data-sources.json` (`save-password: true`)

### Source 2: ConfigMaps labeled `cloudbeaver=connection` (legacy)

Individual data keys provide connection parameters. No password is stored -- CloudBeaver prompts the user at connection time.

- **Connection ID format**: `cb-auto-{namespace}-{database}`
- **Password**: Not stored (`save-password: false`)
- **Required keys**: `name`, `host`, `port`, `database`, `username`, `driver`, `provider`

### Merge Rules

- All `cb-auto-*` connections are removed from `data-sources.json` on each run
- New connections from both sources are merged in
- Manually created connections (without the `cb-auto-` prefix) are preserved
- If a Secret and ConfigMap produce the same connection ID, the Secret wins

## Registering a Connection

### Method 1: Secret with `cbdb` label (recommended)

Create a Secret with the `cbdb` label. The label value is the data key holding the connection string:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-service-db
  namespace: platform
  labels:
    cbdb: PG_CONNECTION_STRING      # data key holding the URI
    pgdb: PG_CONNECTION_STRING      # optional: also triggers postgres provisioning
type: Opaque
stringData:
  PG_CONNECTION_STRING: "postgresql://myservice:MyStr0ngP4ss@postgres.platform.svc.cluster.local:5432/myservice_db"
```

The **dual-label pattern** (`cbdb` + `pgdb`) allows a single Secret to trigger both:
- **PostgreSQL database provisioning** (via the postgres chart's CronJob -- see [Database Provisioning](../../postgres/docs/database-provisioning.md))
- **CloudBeaver connection registration** (via this CronJob)

The two CronJobs are completely independent -- no coupling between charts.

### Method 2: With VaultStaticSecret (recommended for production)

In practice, modules use VaultStaticSecret to sync their secrets from Vault. The `cbdb` label is added to the VaultStaticSecret's destination:

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
      cbdb: PG_CONNECTION_STRING    # triggers CloudBeaver registration
      pgdb: PG_CONNECTION_STRING    # triggers PostgreSQL provisioning
  refreshAfter: 30s
  vaultAuthRef: my-module-auth
```

### Method 3: ConfigMap with `cloudbeaver=connection` label (legacy)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-service-cb-connection
  namespace: platform
  labels:
    cloudbeaver: connection
data:
  name: "My Service DB"
  host: "postgres.platform.svc.cluster.local"
  port: "5432"
  database: "myservice_db"
  username: "myservice"
  driver: "postgres-jdbc"
  provider: "postgresql"
```

No password is stored -- CloudBeaver will prompt for credentials at connection time.

## How the CronJob Works

### Discovery Flow

```mermaid
flowchart TD
    A["CronJob runs<br/>(every 5 min)"] --> B["Discover cbdb-labeled Secrets"]
    B --> C["Discover cloudbeaver=connection ConfigMaps"]
    C --> D["Parse connection strings<br/>from Secrets"]
    D --> E["Build connection entries<br/>from ConfigMaps"]
    E --> F["Merge: remove old cb-auto-*<br/>add new connections"]
    F --> G["Write data-sources.json<br/>to workspace PVC"]
    G --> H["Compute SHA-256 hash<br/>of all connections"]
    H --> I{"Hash changed<br/>vs Deployment annotation?"}
    I -->|Yes| J["Patch Deployment annotation<br/>(triggers rolling restart)"]
    I -->|No| K["No restart needed"]
```

### Change Detection

The script computes a SHA-256 hash of all discovered connections (both sources, normalized and sorted). It compares this hash against the `cloudbeaver/connections-hash` annotation on the Deployment's pod template. If the hash differs, the Deployment is patched to trigger a rolling restart. If unchanged, no restart occurs.

This ensures CloudBeaver only restarts when connections actually change, not on every CronJob run.

> **Restart impact:** CloudBeaver reads `data-sources.json` only at startup, so a restart is required when connections change. The Deployment uses `Recreate` strategy, which causes ~30 seconds of downtime. Active user sessions are lost during the restart.

### CronJob Permissions

| Scope | Resources | Actions |
|-------|-----------|---------|
| **Cluster-wide** | secrets, configmaps, namespaces | get, list |
| **Namespace `platform`** | deployments | get, patch |

### Namespace Filtering

The `dbOnboarding.namespaceToSearch` setting controls which namespaces the CronJob scans:

| Value | Behavior |
|-------|----------|
| `null` (default) | Scan **all** namespaces |
| `["*"]` | Scan **all** namespaces |
| `[]` (empty list) | Discovery **disabled** |
| `["platform", "apps"]` | Scan **only** listed namespaces |

## Modules Using Connection Discovery

| Module | Secret | Labels | Database Registered |
|--------|--------|--------|-------------------|
| Authentik | `authentik-db-secrets` (VaultStaticSecret) | `cbdb: PG_CONNECTION_STRING`, `pgdb: PG_CONNECTION_STRING` | authentik DB |
| Kubrain | `kubrain-secrets` (VaultStaticSecret) | `cbdb: PG_CONNECTION_STRING`, `pgdb: PG_CONNECTION_STRING` | kubrain DB |

These modules use the dual-label pattern, so a single Secret triggers both PostgreSQL database provisioning and CloudBeaver connection registration.

## Comparison with PostgreSQL Provisioner

| Aspect | PostgreSQL Provisioner | CloudBeaver Onboarding |
|--------|----------------------|----------------------|
| **Label** | `pgdb=<key>` | `cbdb=<key>` |
| **What it does** | Creates database + user in PostgreSQL | Registers connection in CloudBeaver UI |
| **CronJob name** | `postgres-db-provisioner` | `cloudbeaver-db-onboarding` |
| **Schedule** | Every 5 minutes | Every 5 minutes |
| **Also runs at startup** | No | Yes (init container) |
| **Restart on changes** | N/A | Yes (patches Deployment annotation) |
| **Legacy source** | N/A | `cloudbeaver=connection` ConfigMaps |

Both systems are independent and can be triggered from the same Secret using dual labels.
