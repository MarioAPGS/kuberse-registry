# Authentik

> Centralized SSO/Identity Provider with decentralized OIDC provisioning and Vault integration.

| Property | Value |
|----------|-------|
| **Chart** | `platform/charts/authentik/` |
| **Sync Wave** | 1 |
| **Namespace** | `platform` |
| **Image** | `ghcr.io/goauthentik/server:latest` |
| **Dependencies** | Vault (Wave 1), PostgreSQL (Wave 1), Ingress NGINX (Wave 1) |
| **URL** | `https://auth.kuberse.net` |

## Overview

Authentik is the centralized identity provider for the Kuberse platform. It provides SSO (Single Sign-On) via OIDC for all platform services that need user authentication (ArgoCD, Grafana, Kiops, etc.).

The module deploys three components:
- **Server** -- Django application serving the admin UI and OIDC/SAML endpoints
- **Worker** -- Celery background task processor
- **Redis** -- In-memory cache/broker for task queue and sessions

The key architectural feature is **decentralized OIDC provisioning**: each module that needs OIDC declares its requirements via a labeled ConfigMap, and an automated PostSync Job discovers these configs, creates providers/applications in Authentik, and writes the resulting credentials (`clientID`, `clientSecret`) to each module's Vault path.

## Architecture

```mermaid
graph TB
    subgraph "Platform Namespace"
        subgraph "Authentik Pod"
            INIT["Init Container<br/>wait-for-secrets"]
            SERVER["Authentik Server<br/>(Django, port 9000)"]
            WORKER["Authentik Worker<br/>(Celery)"]
        end
        REDIS["Redis 7<br/>(cache/broker)"]
        
        subgraph "Secrets"
            KC["kuberse-config<br/>(admin_password, admin_email)"]
            CS["authentik-config-secrets<br/>(SECRET_KEY, BOOTSTRAP_TOKEN)"]
            DS["authentik-db-secrets<br/>(PG_CONNECTION_STRING, PG_PASSWORD)"]
        end

        subgraph "OIDC Provisioner"
            JOB["PostSync Job<br/>provision-oidc.py"]
            BP["Blueprints ConfigMap<br/>(groups, scope mappings)"]
        end

        SVC["Service authentik-server<br/>:9000 / :9443"]
        ING["Ingress<br/>auth.kuberse.net"]
    end

    subgraph "Vault"
        VC1["secret/authentik/config"]
        VC2["secret/authentik/db"]
        VO["secret/argocd/oidc<br/>secret/grafana/oidc<br/>secret/kiops/oidc"]
    end

    subgraph "Consumer Modules"
        OIDC_CM["ConfigMap<br/>label: kuberse.net/authentik-oidc=true<br/>(ArgoCD, Grafana, Kiops...)"]
    end

    VC1 -->|"VSO syncs"| CS
    VC2 -->|"VSO syncs<br/>(pgdb + cbdb labels)"| DS
    KC -->|"admin_password<br/>admin_email"| SERVER
    CS -->|"SECRET_KEY<br/>BOOTSTRAP_TOKEN"| SERVER
    DS -->|"PG password"| SERVER
    DS -->|"PG password"| WORKER

    INIT -->|"waits for"| DS
    INIT -->|"then starts"| SERVER

    SERVER --> REDIS
    WORKER --> REDIS
    SERVER --- SVC --- ING

    BP -->|"auto-applied<br/>on startup"| SERVER
    JOB -->|"discovers"| OIDC_CM
    JOB -->|"creates providers/apps"| SERVER
    JOB -->|"writes clientID/clientSecret"| VO
```

## Resources Created

| Resource | Name | Description |
|----------|------|-------------|
| Deployment | `authentik-server` | Django server with init container |
| Deployment | `authentik-worker` | Celery worker with init container |
| Deployment | `authentik-redis` | Redis 7 cache/broker |
| Service | `authentik-server` | ClusterIP on ports 9000 (HTTP) and 9443 (HTTPS) |
| Service | `authentik-redis` | ClusterIP on port 6379 |
| Ingress | `authentik` | Routes `auth.kuberse.net` to port 9000 |
| ServiceAccount | `authentik-sa` | Single SA for all Authentik resources |
| ConfigMap | `authentik-blueprints` | YAML blueprints auto-applied on startup (groups, scope mappings) |
| ConfigMap | `authentik-oidc-provisioner-script` | Embeds `provision-oidc.py` |
| Job | `authentik-oidc-provisioner` | ArgoCD PostSync hook -- creates OIDC providers and writes creds to Vault |
| VaultConnection | `vault-connection` | Connection to Vault server |
| VaultAuth | `authentik-auth` | Kubernetes auth with `authentik-role` |
| VaultStaticSecret | `authentik-config-vault` | Syncs `secret/authentik/config` to `authentik-config-secrets` |
| VaultStaticSecret | `authentik-db-vault` | Syncs `secret/authentik/db` to `authentik-db-secrets` (dual-labeled `pgdb` + `cbdb`) |
| ConfigMap | `authentik-vault-role` | Labeled `vault: setup-creds` for Vault CronJob discovery |

## Credential Sources

Authentik requires credentials from **three sources**:

### 1. Shared `kuberse-config` Secret

Created during the platform setup (CLI `kuberse setup`), this shared secret provides bootstrap credentials:

| Key | Environment Variable | Description |
|-----|---------------------|-------------|
| `admin_password` | `AUTHENTIK_BOOTSTRAP_PASSWORD` | Admin user password |
| `admin_email` | `AUTHENTIK_BOOTSTRAP_EMAIL` | Admin user email |

These values are set by the operator during the initial `kuberse setup` flow. Authentik uses them to create the initial admin user on first boot.

### 2. Vault: `secret/authentik/config`

Synced to K8s Secret `authentik-config-secrets`:

| Key | Environment Variable | Description |
|-----|---------------------|-------------|
| `AUTHENTIK_SECRET_KEY` | `AUTHENTIK_SECRET_KEY` | Django signing key (50+ chars) |
| `AUTHENTIK_BOOTSTRAP_TOKEN` | `AUTHENTIK_BOOTSTRAP_TOKEN` | API token used by the OIDC provisioner Job |

### 3. Vault: `secret/authentik/db`

Synced to K8s Secret `authentik-db-secrets` with dual labels (`pgdb` + `cbdb`):

| Key | Environment Variable | Description |
|-----|---------------------|-------------|
| `PG_CONNECTION_STRING` | (used by provisioners) | `postgresql://authentik:pass@postgres.platform:5432/authentik` |
| `AUTHENTIK_POSTGRESQL__PASSWORD` | `AUTHENTIK_POSTGRESQL__PASSWORD` | PostgreSQL password for Authentik |

The `pgdb` label triggers automatic database creation via the PostgreSQL provisioner CronJob. The `cbdb` label triggers automatic connection registration in CloudBeaver.

## Startup Sequence

```mermaid
sequenceDiagram
    participant Vault as Vault
    participant VSO as VSO
    participant DS as K8s Secret<br/>authentik-db-secrets
    participant Init as Init Container<br/>wait-for-secrets
    participant Server as Authentik Server
    participant BP as Blueprints
    participant Job as OIDC Provisioner Job

    VSO->>Vault: Read secret/authentik/db
    VSO->>DS: Create authentik-db-secrets

    Init->>Init: kubectl get secret authentik-db-secrets
    Note over Init: Polls every 5s until secret exists
    Init->>Server: Secret found, exit 0

    Server->>Server: Start Django + apply blueprints
    BP->>Server: Create groups (admin, developer)<br/>Create groups scope mapping

    Note over Job: ArgoCD PostSync hook
    Job->>Job: Patch CoreDNS for DNS hairpin
    Job->>Server: Wait for Authentik to be ready
    Job->>Job: Discover ConfigMaps labeled<br/>kuberse.net/authentik-oidc=true
    Job->>Server: Create OAuth2 providers + applications
    Job->>Vault: Write clientID/clientSecret to each module's Vault path
```

## Blueprints

Authentik auto-applies YAML blueprints from `/blueprints/custom/` on startup. The chart mounts a ConfigMap with a blueprint that creates:

| Resource | Name | Purpose |
|----------|------|---------|
| Group | `admin` | Admin group (not superuser) |
| Group | `developer` | Developer group |
| Scope Mapping | `groups` | Returns group names in the `groups` JWT claim |

OIDC providers and applications are **not** managed by blueprints -- they are handled by the OIDC Provisioner Job instead.

## Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| `image.tag` | `latest` | Authentik version |
| `server.replicas` | `1` | Server replicas |
| `worker.replicas` | `1` | Worker replicas |
| `service.httpPort` | `9000` | HTTP port |
| `service.httpsPort` | `9443` | HTTPS port |
| `ingress.host` | `auth.kuberse.net` | Public hostname |
| `postgresql.host` | `postgres.platform.svc.cluster.local` | PostgreSQL host |
| `postgresql.name` | `authentik` | Database name |
| `vault.configSecretPath` | `authentik/config` | Vault path for config secrets |
| `vault.dbSecretPath` | `authentik/db` | Vault path for DB secrets |
| `oidcProvisioner.discoveryLabel` | `kuberse.net/authentik-oidc` | Label used to discover OIDC ConfigMaps |

## Debugging

```bash
# Check Authentik pods
kubectl get pods -n platform -l app.kubernetes.io/name=authentik

# Server logs
kubectl logs -f deploy/authentik-server -n platform

# Worker logs
kubectl logs -f deploy/authentik-worker -n platform

# Init container logs (if stuck in Init)
kubectl logs deploy/authentik-server -n platform -c wait-for-secrets

# OIDC provisioner Job logs
kubectl logs job/authentik-oidc-provisioner -n platform

# Check if secrets exist
kubectl get secret authentik-config-secrets authentik-db-secrets kuberse-config -n platform

# Check VaultStaticSecret sync status
kubectl describe vaultstaticsecret authentik-config-vault authentik-db-vault -n platform

# Verify Authentik is healthy
kubectl exec -it deploy/authentik-server -n platform -- ak healthcheck
```

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Pod stuck in `Init:0/1` | `authentik-db-secrets` doesn't exist | Check Vault sync: `kubectl describe vaultstaticsecret authentik-db-vault -n platform` |
| OIDC provisioner fails | Authentik not ready or token invalid | Check logs: `kubectl logs job/authentik-oidc-provisioner -n platform` |
| "Connection refused" from OIDC clients | DNS hairpin not configured | Check CoreDNS: `kubectl get cm coredns -n kube-system -o yaml` |
| OIDC login redirects to Cloudflare Access | DNS hairpin missing/stale IP | Re-run provisioner or check ingress controller ClusterIP |
