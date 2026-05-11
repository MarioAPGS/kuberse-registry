# Routes Reference

| Route | Name | Description |
|-------|------|-------------|
| `/` | Redirect | Redirects to `/nodes` |
| `/nodes` | Catalog | Interactive catalog graph with search, filters, details, and entity actions |
| `/nodes/argocd?app=<app-name>` | ArgoCD Resources | Live ArgoCD/Kubernetes resource graph for one application |
| `/buildapp` | Create BuildApp | Form and JSON editor for creating a BuildApp development environment |
| `/docs` | Docs List | Lists registered `kind: Doc` catalog entities |
| `/docs/:entityRef` | Docs Viewer | Renders markdown documentation for one Doc entity |

## Sidebar Navigation

The global sidebar provides quick access to:

| Menu Item | Route |
|-----------|-------|
| Catalog | `/nodes` |
| BuildApp | `/buildapp` |
| Docs | `/docs` |
| Theme toggle | Switches dark/light theme and persists the preference locally |

![Kubrain navigation menu](../images/kubrain-navigation-menu.png)
