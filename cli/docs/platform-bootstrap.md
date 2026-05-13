# Platform Bootstrap Guide

## Overview

Kuberse bootstraps a complete platform in two stages:

1. **`kuberse init`** - Runs on your host machine. Creates or connects to a Kubernetes cluster, deploys a CLI pod into it, then hands off to the next phase.
2. **`kuberse setup`** - Runs inside the CLI pod. Performs the actual platform bootstrap: installs all components, seeds secrets, and configures GitOps.

Two cluster modes are supported:

- **minikube** - Single-node local cluster using Docker. Best for development.
- **k3s** - Multi-node cluster on remote VMs via SSH. Best for staging/production-like environments.

---

## Phase 1: `kuberse init` (on host)

### Configuration prompts

When you run `kuberse init`, you are prompted for:

| Prompt | Description |
|--------|-------------|
| Cluster mode | `minikube` or `k3s` |
| Git provider | `github` or `gitea` (in-cluster) |
| Base domain | e.g. `example.local` or `dev.mycompany.com` |
| Admin email | Used for Authentik and certificates |
| Admin password | Shared across ArgoCD, Postgres, and Authentik |
| GitHub org + PAT | (GitHub mode only) Organization name and personal access token |
| k3s hosts + SSH | (k3s mode only) Server/worker IPs, SSH user, and key path |

### Cluster setup

**Minikube mode:**

- Deletes any existing minikube profile
- Starts a fresh cluster with the Docker driver, allocating maximum available CPU and memory
- Configures `--insecure-registry=10.0.0.0/8` to allow in-cluster registry access

**k3s mode:**

- Connects to all hosts via SSH and uninstalls any previous k3s installation
- Installs k3s on the server node
- Joins worker nodes to the cluster
- Fetches the kubeconfig and writes it to `~/.kube/config-kuberse`

### CLI pod deployment

After the cluster is ready, `kuberse init`:

1. Creates the `platform` namespace
2. Creates a Secret containing your configuration values
3. Creates a ServiceAccount with `cluster-admin` privileges
4. Deploys the `kuberse-cli` Pod (image from ghcr.io)
5. Waits for the pod to reach `Ready` status

### Handoff

Once the pod is running, `kuberse init` execs into it and automatically runs `kuberse setup`. You will see the setup output streamed to your terminal.

---

## Phase 2: `kuberse setup` (in-pod)

The setup phase runs the following steps in order:

### 1. Provider setup

- **GitHub:** No action needed - GitHub is already available externally.
- **Gitea:** Installs Gitea via Helm into the cluster, providing an in-cluster Git and OCI registry.

### 2. Fork registry

- **GitHub:** Forks the `MarioAPGS/kuberse` registry repository into your organization.
- **Gitea:** Mirrors the registry repository into the local Gitea instance.

### 3. Clone

Clones the forked/mirrored registry to `/workspace/registry` inside the pod.

### 4. Resolve placeholders

Substitutes configuration placeholders throughout the cloned repository:

- `${REGISTRY_URL}` - OCI registry URL
- `${GIT_BASE_URL}` - Git server base URL
- `${ORG_NAME}` - Organization/owner name
- `${BASE_DOMAIN}` - Your chosen base domain
- `${ADMIN_EMAIL}` - Admin email address
- `${ADMIN_USERNAME}` - Derived from admin email
- `${ADMIN_PASSWORD}` - Admin password
- `${GIT_PROVIDER}` - `github` or `gitea`
- `${CLUSTER_MODE}` - `minikube` or `k3s`
- `${GIT_BASE_URL_EXTERNAL}` - External Git URL (if different from internal)

### 5. Mirror artifacts (Gitea only)

Copies all required Helm charts and container images from `ghcr.io` into the local Gitea OCI registry. This enables fully self-contained operation.

### 6. Push configuration

Commits all resolved changes and pushes them back to the registry repository.

### 7. Deploy Vault

Renders and applies the Vault Helm umbrella chart directly (not via ArgoCD). Vault is deployed first to ensure secrets are available before any consumer starts.

### 8. Initialize and unseal Vault

- Runs `vault operator init` with 5 key shares and a threshold of 3
- Unseals all Vault pods
- Enables the `kv-v2` secrets engine
- Enables Kubernetes authentication
- Creates the VSO (Vault Secrets Operator) policy and role

### 9. Seed Vault secrets

Writes initial secrets into Vault:

- PostgreSQL credentials
- Authentik credentials (reuses the admin password from init)

### 10. Install ArgoCD

- Pre-seeds the ArgoCD admin password (bcrypt-hashed)
- Applies the upstream ArgoCD `install.yaml` manifest (ArgoCD cannot be deployed via its own GitOps -- it's a chicken-and-egg problem, so it's installed directly)

### 11. Configure ArgoCD credentials

Creates repository credentials and registry secrets in the `argocd` namespace so ArgoCD can pull from your Git provider and OCI registry.

### 12. Deploy bootstrap

Applies `bootstrap.yaml`, which creates the ArgoCD Application-of-Applications. This triggers ArgoCD to sync all platform components.

### 13. Trigger module-config Job

Creates a one-shot Job from the `vault-module-config` CronJob template. This immediately creates Vault policies and Kubernetes auth roles for each platform module (postgres, authentik, kuberse-api, etc.) so their `VaultStaticSecret` resources can authenticate and sync. Without this, modules would wait up to 5 minutes for the CronJob's first scheduled run.

### 14. Summary

Prints the platform credentials:

```
Platform bootstrap complete!

  ArgoCD:    https://argocd.<base-domain>
  Authentik: https://auth.<base-domain>

  Admin password (ArgoCD, Postgres, Authentik): <your-password>
```

---

## Why Vault is deployed before ArgoCD

In an earlier approach, Vault was deployed by ArgoCD alongside its consumers (like Authentik and PostgreSQL). This caused race conditions: consumers would start before Vault was ready, fail to find their secrets, and crash-loop.

The current approach eliminates this:

1. Vault is deployed and fully initialized
2. Secrets are seeded
3. ArgoCD starts
4. Consumers find their secrets on first sync

No retries, no timing dependencies.

---

## Idempotency

Re-running `kuberse setup` is safe. Every phase uses upsert semantics or server-side-apply patterns. If a resource already exists, it is updated rather than duplicated. If a step was already completed successfully, it either no-ops or overwrites with the same values.

This means if the process fails partway through, you can simply re-run it.

---

## k3s mode specifics

### Prerequisites

- Debian or Ubuntu VMs (minimum recommended: 2 CPU, 4 GB RAM, 40 GB disk per node)
- SSH access from your host (public key authentication)
- `sudo` without password prompt on all nodes
- Port **6443/TCP** open between all nodes and from your host to the server
- Internet access on nodes (downloads from `get.k3s.io`)

### Configuration details

- Traefik and ServiceLB are **disabled** (Kuberse provides its own ingress stack)
- Kubeconfig is written to `~/.kube/config-kuberse` (not `~/.kube/config`)

### After init

Export the kubeconfig to interact with the cluster:

```bash
export KUBECONFIG=$HOME/.kube/config-kuberse
kubectl get nodes
```

---

## DNS requirements

Kuberse serves platform UIs (ArgoCD, Authentik, Vault, etc.) at `<service>.<base_domain>`. How DNS works depends on your setup:

- **Minikube + local domain (e.g. `kuberse.local`):** Add entries to `/etc/hosts` pointing to `$(minikube ip)`, or use `minikube tunnel` and point to `127.0.0.1`.
- **k3s + real domain:** Configure wildcard DNS (`*.<base_domain>`) to point to your server node's IP (or a load balancer in front of your nodes).
- **k3s + Cloudflare Tunnel (via networking plugin):** DNS is managed automatically by the tunnel.

---

## Troubleshooting tips

### CLI pod doesn't start

Check if the image can be pulled:

```bash
kubectl describe pod -n platform -l app=kuberse-cli
```

The pod image is hosted on `ghcr.io`. Ensure your cluster has internet access or configure image pull secrets.

### k3s wait hangs during init

- Verify port **6443/TCP** is reachable from your host to the server node
- Confirm the server host IP matches the certificate SANs
- Check SSH connectivity: `ssh -i <key> <user>@<host> "sudo k3s kubectl get nodes"`

### Monitoring after setup

Check that all ArgoCD applications are syncing:

```bash
kubectl get applications -n argocd
```

Healthy output shows all apps as `Synced` and `Healthy`. Apps in `Progressing` are still deploying; give them a few minutes.

### Something failed partway through

Re-run is safe:

```bash
kuberse setup
```

Or start fresh from the host:

```bash
kuberse init
```
