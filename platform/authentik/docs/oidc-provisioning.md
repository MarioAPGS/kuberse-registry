# OIDC Provisioning

This document explains how the decentralized OIDC provisioning system works in the Kuberse platform. Any module that needs SSO can declare its OIDC requirements via a ConfigMap, and the system automatically creates the provider in Authentik and distributes credentials via Vault.

## Core Principle

**No OIDC credentials are manually created or copied.** Modules declare their OIDC requirements via a labeled ConfigMap. The OIDC Provisioner Job discovers these, creates the providers in Authentik, and writes the credentials to each module's Vault path.

## End-to-End OIDC Provisioning Flow

```mermaid
sequenceDiagram
    participant Mod as Module (Helm chart)
    participant CM as ConfigMap<br/>kuberse.net/authentik-oidc=true
    participant Job as OIDC Provisioner<br/>(PostSync Job)
    participant Auth as Authentik API
    participant Vault as Vault
    participant VSO as VSO
    participant Sec as K8s Secret<br/>(module OIDC creds)

    Note over Mod,CM: 1. Module declares its OIDC needs
    Mod->>CM: Create ConfigMap with oidc-config.yaml<br/>(name, slug, redirectUris, vault.secretPath)

    Note over Job,Auth: 2. Provisioner discovers and creates (PostSync)
    Job->>Job: Patch CoreDNS for DNS hairpin
    Job->>Auth: Wait for Authentik to be ready
    Job->>Job: Discover ConfigMaps labeled<br/>kuberse.net/authentik-oidc=true
    Job->>Auth: Create OAuth2 provider (if not exists)
    Job->>Auth: Create application (if not exists)

    Note over Job,Vault: 3. Write credentials to Vault
    Job->>Vault: Write to secret/<module>/oidc<br/>{clientID, clientSecret, issuer, slug}

    Note over VSO,Sec: 4. Module consumes credentials
    VSO->>Vault: Read secret/<module>/oidc
    VSO->>Sec: Create K8s Secret with OIDC creds
    Sec->>Mod: Module configures OIDC login
```

## How to Register a Module for OIDC

A module creates a ConfigMap with the label `kuberse.net/authentik-oidc: "true"` containing an `oidc-config.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-module-authentik-oidc
  namespace: platform
  labels:
    kuberse.net/authentik-oidc: "true"
data:
  oidc-config.yaml: |
    name: My Module                         # Provider name in Authentik
    slug: my-module                          # URL slug for the application
    redirectUris:
      - url: "https://my-module.kuberse.net/callback"
        matchingMode: strict
    provider:
      authorizationFlow: default-provider-authorization-implicit-consent
      invalidationFlow: default-provider-invalidation-flow
      subMode: hashed_user_id
      extraScopes:
        - groups                             # Include group memberships in JWT
    application:
      launchUrl: "https://my-module.kuberse.net"
    vault:
      secretPath: "my-module/oidc"           # Where to write clientID/clientSecret
```

### OIDC Config Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name for the OAuth2 provider in Authentik |
| `slug` | Yes | URL-safe identifier for the application |
| `redirectUris` | Yes | List of allowed redirect URIs after authentication |
| `provider.authorizationFlow` | No | Authentik flow slug (default: `default-provider-authorization-implicit-consent`) |
| `provider.invalidationFlow` | No | Logout flow slug (default: `default-provider-invalidation-flow`) |
| `provider.subMode` | No | Subject mode (default: `hashed_user_id`) |
| `provider.extraScopes` | No | Additional scopes beyond `openid`, `email`, `profile` |
| `application.launchUrl` | No | URL shown in Authentik's application library |
| `vault.secretPath` | Yes | Vault KV v2 path where credentials are written |

### What Gets Written to Vault

For each discovered OIDC config, the provisioner writes to `secret/<vault.secretPath>`:

```json
{
  "clientID": "auto-generated-by-authentik",
  "clientSecret": "auto-generated-by-authentik",
  "issuer": "https://auth.kuberse.net/application/o",
  "slug": "my-module"
}
```

## Modules Using OIDC

| Module | ConfigMap | Vault Path | Redirect URI |
|--------|-----------|------------|--------------|
| ArgoCD | `argocd-authentik-oidc` | `secret/argocd/oidc` | ArgoCD Dex callback |
| Grafana | (via config) | `secret/grafana/oidc` | Grafana OAuth callback |
| Kiops | (via config) | `secret/kiops/oidc` | Kiops OAuth callback |

## DNS Hairpin

The OIDC Provisioner Job patches CoreDNS to resolve `auth.kuberse.net` to the NGINX Ingress Controller's ClusterIP. Without this, in-cluster pods trying to reach the OIDC endpoints via the external hostname would hit Cloudflare Access and get blocked with an HTML login page instead of a JSON response.

```mermaid
graph LR
    subgraph "Without Hairpin"
        POD1["Pod (OIDC client)"] -->|"auth.kuberse.net"| CF["Cloudflare Access<br/>(blocks with HTML)"]
    end

    subgraph "With Hairpin"
        POD2["Pod (OIDC client)"] -->|"auth.kuberse.net<br/>(resolves to ClusterIP)"| NGINX["NGINX Ingress"] --> AUTH["Authentik<br/>(returns JSON)"]
    end
```

The hairpin is:
- **Idempotent** -- skips if already configured with the correct IP
- **Applied before OIDC provisioning** -- ensures providers can be verified immediately
- **Triggers a CoreDNS restart** after patching and waits for rollout to complete

### Vault Permissions for OIDC Writing

The Authentik role has special write permissions to allow the provisioner to write OIDC credentials to any module's Vault path:

```hcl
# Read own secrets
path "secret/data/authentik/*" {
  capabilities = ["read"]
}

# Write OIDC credentials to any module's /oidc subpath
path "secret/data/+/oidc" {
  capabilities = ["create", "read", "update"]
}
```

The `+` wildcard matches a single path segment, so `secret/data/argocd/oidc`, `secret/data/grafana/oidc`, etc. are all allowed.

## Storing Initial Secrets

Before deploying Authentik, store the required secrets in Vault:

```bash
# Config secrets (SECRET_KEY and BOOTSTRAP_TOKEN)
kubectl exec -it vault-0 -n platform -- vault kv put \
  secret/authentik/config \
  AUTHENTIK_SECRET_KEY="$(openssl rand -hex 32)" \
  AUTHENTIK_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)"

# Database secrets
kubectl exec -it vault-0 -n platform -- vault kv put \
  secret/authentik/db \
  PG_CONNECTION_STRING="postgresql://authentik:your-password@postgres.platform.svc.cluster.local:5432/authentik" \
  AUTHENTIK_POSTGRESQL__PASSWORD="your-password"
```

The `admin_password` and `admin_email` values are stored in the shared `kuberse-config` secret, which is created during the `kuberse setup` flow.
