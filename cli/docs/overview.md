# Kuberse Overview

## What is Kuberse

Kuberse is a platform bootstrapper that gives you a production-ready environment with a single command:

- A Kubernetes cluster
- ArgoCD for GitOps-driven continuous delivery
- A GitOps repository (called the "registry repo") containing all ArgoCD Application manifests
- OCI-served Helm charts for every component

The Kuberse CLI runs inside the cluster as a privileged pod. It orchestrates cluster setup, chart packaging, and ArgoCD configuration so you go from zero to a fully declarative platform in minutes.

## Installation

Kuberse is distributed as a Python CLI. You do **not** need a pre-existing Kubernetes cluster -- `kuberse init` creates one for you.

**Host requirements:**

- `kubectl` installed
- **Minikube mode:** Docker and `minikube` installed
- **k3s mode:** `ssh` and `scp` available, plus reachable Debian/Ubuntu VMs
- A GitHub account (for GitHub provider) or nothing extra (Gitea runs in-cluster)

## Repositories

Kuberse is split across several repositories:

| Repository | Purpose |
|---|---|
| **kuberse-helm** | Helm charts and CLI source code. This is the upstream project repo maintained by the Kuberse team. |
| **kuberse** (registry repo) | ArgoCD Application templates with `${PLACEHOLDER}` values. `kuberse init` forks this into your GitHub org or Gitea instance, resolves placeholders, and it becomes your GitOps source of truth. |
| **kuberse-networking** | First-party plugin for ingress, DNS, and service mesh components. |
| **kuberse-observability** | First-party plugin for monitoring, logging, and tracing. |
| **kuberse-ai** | First-party plugin for ML/AI workloads. |

## The Umbrella-Chart Pattern

This is the central architectural concept in Kuberse.

All platform subcharts (vault, postgres, ingress-nginx, authentik, etc.) live inside **one umbrella chart** called `platform`. Every subchart is **disabled by default**.

Each ArgoCD Application resource points at the **same** umbrella chart but enables exactly one subchart through its `helm.values` block. For example, the vault Application sets `vault.enabled: true` while everything else stays off.

**Why this matters:**

- **One OCI artifact** — the entire platform ships as a single chart archive.
- **One version** — all components share the same chart version, eliminating drift.
- **One mirror operation** — airgapped environments pull a single artifact.
- **Shared templates** — common helpers (labels, annotations, resource defaults) are defined once.

Plugins follow the same pattern. Each plugin repository contains its own umbrella chart with disabled-by-default subcharts.

## Git Providers

Kuberse supports two git backends that determine where your registry lives and how artifacts are served:

| Aspect | GitHub | Gitea |
|---|---|---|
| Registry location | Your GitHub fork of `kuberse` | In-cluster Gitea repository |
| OCI registry | GitHub Container Registry (ghcr.io) | Gitea's built-in OCI/container registry |
| Artifact source | Pulled from the internet | Fully self-contained in the cluster |
| Airgap capable | No (requires internet for pulls) | Yes (fully airgapped) |

Choose GitHub for convenience during development. Choose Gitea when you need a hermetic, airgapped deployment.

## plugin.yaml Descriptor

Each plugin repository contains a `plugin.yaml` at its root that declares:

- **name** — identifier used in Application references
- **version** — semver version of the plugin
- **chart** — path to the umbrella chart within the repo
- **components** — list of subcharts the plugin provides, each with a name and default enabled state
- **dependencies** — platform components or other plugins this plugin requires

Kuberse reads this file during bootstrap to wire up the correct ArgoCD Applications for each plugin.

## Sync Waves

Kuberse uses ArgoCD sync waves to control deployment order:

| Wave | What deploys | Why |
|---|---|---|
| -1 | Namespaces | Must exist before any resource targeting them |
| 0 | App-of-apps, Replicator | Coordination layer that spawns child Applications |
| 1 | Platform components | Core services (vault, ingress-nginx, postgres, authentik, etc.) |
| 2 | Plugins, runners | Higher-level workloads that depend on platform services |

Lower waves fully sync before higher waves begin, guaranteeing that dependencies are healthy before dependents roll out.

## Three Levels of App-of-Apps

Kuberse uses a layered app-of-apps hierarchy to manage all deployed resources:

1. **bootstrap.yaml** — The single root Application created during initial setup. It targets the registry repo and generates the next level.

2. **Per-category app-of-apps** — bootstrap.yaml produces one Application per category (e.g., `argocd/platform/argocd-app-of-apps.yaml`, `argocd/plugins/<name>/argocd-app-of-apps.yaml`). Each category Application watches its subdirectory.

3. **Per-service Applications** — Each category app-of-apps renders individual Application resources (e.g., `argocd/platform/vault/argocd-app.yaml`). These are the leaf nodes that actually deploy Helm releases from the umbrella chart.

This three-tier structure means adding a new component only requires dropping a new Application manifest into the correct category directory in your registry repo. ArgoCD discovers and deploys it automatically.

## Next Steps

- [CLI Reference](cli-reference.md) — full list of commands and flags
- [Platform Bootstrap](platform-bootstrap.md) — step-by-step guide to your first deployment
