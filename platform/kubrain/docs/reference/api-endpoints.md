# API Endpoints Reference

This reference lists the user-facing API areas that power Kubrain's UI. Most users interact through the frontend, but these endpoints explain what each screen uses.

## Catalog

| Method | Path | Used By |
|--------|------|---------|
| `GET` | `/api/v1/entities` | Load catalog entities and relations |
| `GET` | `/api/v1/entities/:entityRef` | Load one entity for the details panel |
| `GET` | `/api/v1/entities/:entityRef/relations` | Load relationships for one entity |
| `PATCH` | `/api/v1/entities/:entityRef/store` | Update persistent entity store/status |
| `DELETE` | `/api/v1/entities/:entityRef` | Delete an entity |

## ArgoCD Resources

| Method | Path | Used By |
|--------|------|---------|
| `GET` | `/api/v1/argocd/:app` | Application overview |
| `GET` | `/api/v1/argocd/:app/nodes` | Resource graph |
| `POST` | `/api/v1/argocd/:app/sync` | Sync application |
| `GET` | `/api/v1/argocd/:app/:resource` | Resource details |
| `GET` | `/api/v1/argocd/:app/:resource/manifest` | View resource manifest |
| `GET` | `/api/v1/argocd/:app/:resource/logs` | View logs |
| `POST` | `/api/v1/argocd/:app/:resource/sync` | Sync resource subtree |
| `DELETE` | `/api/v1/argocd/:app/:resource` | Delete live resource |

## BuildApps

| Method | Path | Used By |
|--------|------|---------|
| `POST` | `/api/v1/buildapp` | Create BuildApp |
| `GET` | `/api/v1/buildapp` | List BuildApps |
| `GET` | `/api/v1/buildapp/:name/values` | Load BuildApp values for editing |
| `PATCH` | `/api/v1/buildapp/:name/values` | Save edited values |
| `GET` | `/api/v1/buildapp/:name/status` | Read BuildApp health/sync status |
| `DELETE` | `/api/v1/buildapp/:name` | Delete BuildApp |

## Docs

| Method | Path | Used By |
|--------|------|---------|
| `GET` | `/api/v1/docs` | List Doc entities |
| `GET` | `/api/v1/docs/:entityRef` | Load one Doc entity |
| `GET` | `/api/v1/docs/:entityRef/content?path=<file>` | Fetch markdown content |

## Platform Secrets

Kubrain also exposes operator-facing Vault secret endpoints. These are not currently exposed as a dedicated frontend page.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/vault/secrets/platform/*` | Store platform secrets under Vault KV v2 |
