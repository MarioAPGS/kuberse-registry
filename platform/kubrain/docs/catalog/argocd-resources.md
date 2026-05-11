# ArgoCD Resources

Kubrain can open a live resource map for an ArgoCD application. This view is useful when you want to move from the high-level catalog entity to the Kubernetes objects actually managed by GitOps.

Open it from the Catalog details panel when an entity exposes the ArgoCD action, or directly with:

```text
/nodes/argocd?app=<app-name>
```

## What You Can Do

| Action | Description |
|--------|-------------|
| View resource graph | See the live Kubernetes resources that belong to an ArgoCD application |
| Filter resources | Search or narrow the graph by kind/status |
| Inspect resource details | Click a resource to inspect health, sync, metadata, and relationships |
| View manifests | Read the live manifest for a resource |
| View logs | Open logs for supported workload resources |
| Sync resources | Trigger ArgoCD sync for a resource subtree |
| Delete live resources | Delete a live resource when needed |

## How to Use It

1. Open the **Catalog** at `/nodes`.
2. Click an entity that is linked to an ArgoCD application.
3. Select the ArgoCD resources action from the details panel.
4. Use the graph to inspect workloads, services, config, secrets, jobs, and other resources.
5. Click a resource to open its detail panel.

## Important GitOps Behavior

Deleting a live resource from this view does not remove it from Git. If the resource still exists in the desired state, ArgoCD can recreate it on the next sync.

Use delete only for operational recovery or temporary cleanup. For permanent removal, change the source manifests in Git.

## When to Use This View

- A catalog entity appears unhealthy and you need to inspect its Kubernetes resources.
- You want to see why ArgoCD reports an app as out of sync.
- You need logs or manifests without opening ArgoCD separately.
- You want a visual resource graph instead of a flat resource list.
