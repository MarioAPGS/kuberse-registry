# Kubernetes Replicator

> Cross-namespace secret and ConfigMap replication using the Mittwald Kubernetes Replicator.

| Property | Value |
|----------|-------|
| **Chart Path** | External (not in this repo) |
| **Sync Wave** | 0 |
| **Namespace** | `kube-system` (deployed into kube-system, chart managed in `helm/platform/`) |
| **Upstream Chart** | `kubernetes-replicator` v2.9.2 from `helm.mittwald.de` |
| **Dependencies** | Namespaces (Wave -1) |

## Overview

Deploys the [Mittwald Kubernetes Replicator](https://github.com/mittwald/kubernetes-replicator) — a controller that watches for Secrets and ConfigMaps annotated with replication directives and copies them to specified namespaces.

The chart is located at `helm/platform/kubernetes-replicator/` and discovered by the platform app-of-apps.

## Why It Exists

The primary use case is replicating the `github-registry-secret` (Docker pull credentials for GitHub Container Registry) from the `argocd` namespace (where it is created during setup) to all other namespaces. Without this, pods in `platform`, `networking`, `observability`, and `apps` would fail to pull private images from `ghcr.io`.

## How Replication Works

A Secret or ConfigMap is marked for replication using the annotation:

```yaml
metadata:
  annotations:
    replicator.v1.mittwald.de/replicate-to: "*"
```

The `"*"` value replicates to all namespaces. You can also specify specific namespaces:

```yaml
replicator.v1.mittwald.de/replicate-to: "platform,networking,observability"
```

## Usage in Kuberse

During the `setup-minikube.sh` bootstrap, the GitHub registry secret is created with:

```bash
kubectl create secret docker-registry github-registry-secret \
  --namespace argocd \
  --docker-server=ghcr.io \
  --docker-username=$GITHUB_USER \
  --docker-password=$GITHUB_TOKEN

kubectl annotate secret github-registry-secret \
  --namespace argocd \
  replicator.v1.mittwald.de/replicate-to='*'
```

The Kubernetes Replicator then copies this secret to all namespaces, making it available for `imagePullSecrets` in any module's Deployment.

## ArgoCD Application

Defined in the platform app-of-apps. The ArgoCD Application deploys into `kube-system`:

```yaml
source:
  repoURL: https://helm.mittwald.de
  chart: kubernetes-replicator
  targetRevision: 2.9.2
destination:
  namespace: kube-system
```

## Interactions with Other Modules

| Module | Interaction |
|--------|------------|
| **Kiops** | Consumes replicated `github-registry-secret` for image pulls |
| **Kuberse API** | Consumes replicated `github-registry-secret` for image pulls |
| **All private image users** | Any module pulling from private registries benefits |

## Vault Integration

**None.** The Kubernetes Replicator has no secrets and no Vault dependency.

## Debugging

```bash
# Check replicator pod
kubectl get pods -n kube-system | grep replicator

# View replicator logs
kubectl logs -f deploy/kubernetes-replicator -n kube-system

# Verify the source secret has the replication annotation
kubectl get secret github-registry-secret -n argocd -o jsonpath='{.metadata.annotations}'

# Check if the secret was replicated to a target namespace
kubectl get secret github-registry-secret -n platform
kubectl get secret github-registry-secret -n networking
kubectl get secret github-registry-secret -n observability

# List all secrets with the replication annotation
kubectl get secrets --all-namespaces -o json | \
  jq '.items[] | select(.metadata.annotations["replicator.v1.mittwald.de/replicate-to"] != null) | .metadata | {name, namespace}'
```
