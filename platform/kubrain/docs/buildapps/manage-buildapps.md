# Manage BuildApps

BuildApps are managed from the Catalog after creation. Select a BuildApp entity to open the details panel and use the available actions.

## Find a BuildApp

1. Open `/nodes`.
2. Use the search box to find the BuildApp name.
3. Click the entity in the graph.
4. Review the details panel.

## Edit Values

BuildApp entities expose an edit action in the details panel. The edit modal loads the current BuildApp values, lets you update them, and saves the changes.

After saving, ArgoCD applies the desired state through GitOps sync.

Use this when you need to:

- Add or remove services.
- Change resource requests or limits.
- Add ports.
- Update secrets or environment configuration.
- Change storage sizes or images.

## Delete a BuildApp

BuildApp entities also expose a delete action. Deleting a BuildApp removes the environment and its associated platform resources.

The backend handles cleanup for:

- BuildApp catalog entities
- ArgoCD application resources
- Namespace/resources belonging to the BuildApp
- Vault policies, roles, and secrets associated with the BuildApp

## Inspect Runtime State

If the BuildApp has an ArgoCD application, open its ArgoCD resource graph from the entity details panel. Use that view to inspect workloads, manifests, logs, health, and sync state.

## Practical Advice

- Keep BuildApp names short and DNS-compatible.
- Prefer explicit resource requests/limits to avoid noisy-neighbor problems.
- Put reusable configuration in the JSON values rather than editing live resources.
- For permanent changes, update the BuildApp values instead of changing Kubernetes resources directly.
