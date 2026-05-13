# Kuberse Plugins

## What is a plugin?

A plugin extends a running Kuberse platform with new capabilities -- monitoring, networking, AI tools, or anything you can package as Helm charts. Plugins are distributed as **OCI artifacts** and installed with a single command:

```bash
kuberse plugin install oci://ghcr.io/<owner>/<plugin-name>-plugin:latest
```

Once installed, ArgoCD automatically deploys everything. No manual `kubectl apply` or `helm install` required.

A plugin publishes exactly three kinds of artifact:

| Artifact | Description |
|----------|-------------|
| **OCI manifest** | A tarball containing `plugin.yaml` (the descriptor) + ArgoCD Application manifests + optional Backstage catalog entities |
| **OCI Helm chart** | A single umbrella chart that bundles all subcharts |
| **Container images** | Zero or more custom images (only if your subcharts deploy custom workloads) |

---

## Prerequisites

### For plugin authors (local development)

- `helm` 3.x -- chart linting and template rendering
- `git` -- version control
- `python3` + `pyyaml` -- for running validation scripts locally
- A GitHub account with access to push to GHCR (GitHub Container Registry)

### For plugin consumers (installing plugins)

All tools are pre-installed in the `kuberse-cli` pod. If running off-cluster:

- `oras` -- OCI artifact operations
- `helm` -- chart pull/push
- `git` -- registry repo management
- `crane` -- image mirroring (preferred) or `docker` (fallback)
- `kubectl` -- cluster access

---

## Glossary

| Term | Meaning |
|------|---------|
| **Registry repo** | The Git repository that ArgoCD watches for manifests. Named `kuberse` by convention, hosted in Gitea (or GitHub). Plugins are installed into `plugins/<name>/` within this repo. |
| **Umbrella chart** | A single Helm chart that bundles all plugin subcharts as dependencies. Each subchart is toggled via a `<subchart>.enabled` condition. |
| **OCI manifest artifact** | The tarball published by CI containing `plugin.yaml`, ArgoCD Applications, and optional Backstage entities. This is NOT the Helm chart -- it's the metadata/manifest bundle. |
| **Source registry** | Where the plugin author publishes artifacts (typically `ghcr.io`). |
| **Destination registry** | The user's own registry (in-cluster Gitea or their own GHCR). Artifacts are mirrored here during install. |
| **Platform config** | Key-value pairs stored in the Kubernetes Secret `kuberse-config` (namespace `platform`), mounted at `/etc/kuberse/` in the CLI pod. Contains `registry_url`, `org_name`, `base_domain`, etc. View current values with `kubectl -n platform get secret kuberse-config -o yaml`. |

---

## Plugin anatomy

> A complete working example is available at [`plugins/_template/`](../_template/). Use it as a starting point for new plugins.

### Directory structure

Every plugin follows this layout (matching `_template/`):

```
my-plugin/
├── .gitignore                            # *.tgz, Chart.lock
├── .github/workflows/publish.yaml        # CI workflow
├── README.md
├── plugin.yaml                           # the plugin descriptor
├── argocd-app-of-apps.yaml               # top-level ArgoCD app-of-apps
├── hello/                                # one directory per subchart
│   └── argocd-app.yaml                   # ArgoCD Application for this component
└── src/
    └── my-plugin/                        # one umbrella per plugin
        └── chart/
            ├── Chart.yaml                # umbrella chart definition
            ├── values.yaml               # all subcharts disabled by default
            └── charts/
                └── hello/                # vendored subchart
                    ├── Chart.yaml
                    ├── values.yaml
                    └── templates/
                        ├── deployment.yaml
                        └── service.yaml
```

The key directories:

- **`src/<name>/chart/`** -- The Helm umbrella chart. CI detects charts by pattern-matching `src/*/chart/`.
- **Root level** (`plugin.yaml`, `argocd-app-of-apps.yaml`, `<subchart>/argocd-app.yaml`) -- Everything at the root (outside `src/` and `.github/`) gets packed by CI into the OCI manifest artifact and copied into `plugins/<name>/` in the user's registry repo at install time.

> **Note:** In some older plugins you may see these manifest files inside a `template/` subdirectory. Both layouts are supported, but the flat layout (as in `_template/`) is preferred and matches what first-party plugins like `kuberse-observability` use.

### The plugin descriptor (`plugin.yaml`)

This is the plugin's identity card. The CLI reads it to know what to mirror and where to copy manifests.

```yaml
apiVersion: kuberse.io/v1
kind: Plugin
metadata:
  name: my-plugin              # becomes the directory name under plugins/<name>/
  version: 1.0.0               # auto-bumped by CI from conventional commits
  description: "Short description of what this plugin does"
  author: your-github-username
spec:
  manifests:
    argocd: "."                 # points to the manifest root (required)

  artifacts:
    images: []                  # full image refs that need mirroring
    charts:
      - oci://ghcr.io/<owner>/my-plugin-plugin/charts/my-plugin:latest

  placeholders:                 # tokens the CLI resolves before committing
    - REGISTRY_URL
    - GIT_BASE_URL
    - ORG_NAME
    - BASE_DOMAIN
```

**Important fields:**

| Field | Purpose |
|-------|---------|
| `metadata.name` | Must match the repo name. Becomes the directory `plugins/<name>/` in the registry repo |
| `spec.manifests.argocd` | Path (relative to artifact root) where ArgoCD manifests live. Use `"."` |
| `spec.artifacts.images` | Full image references the CLI must mirror (e.g. `ghcr.io/org/my-image:1.0.0`) |
| `spec.artifacts.charts` | OCI chart references. CI rewrites `:latest` to the concrete version at publish time |
| `spec.placeholders` | Tokens like `${REGISTRY_URL}` that the CLI substitutes with values from platform config |

**About the version placeholder:** You do NOT need to list the version placeholder (e.g. `MY_PLUGIN_VERSION`) in `spec.placeholders`. The CLI auto-generates it during chart mirroring by converting the chart name to `SCREAMING_SNAKE_CASE` + `_VERSION` (e.g. `my-plugin` becomes `${MY_PLUGIN_VERSION}`, `kuberse-observability` becomes `${KUBERSE_OBSERVABILITY_VERSION}`). Use this pattern in your ArgoCD Applications' `targetRevision` field.

### The umbrella chart

Plugins use the **umbrella chart pattern**: one parent chart bundles all subcharts as dependencies. Each subchart is disabled by default and enabled selectively by its ArgoCD Application.

**`src/my-plugin/chart/Chart.yaml`:**

```yaml
apiVersion: v2
name: my-plugin
description: My awesome plugin
type: application
version: 0.1.0
appVersion: "1.0.0"

dependencies:
  - name: hello
    version: 0.1.0
    condition: hello.enabled
```

**`src/my-plugin/chart/values.yaml`:**

```yaml
hello:
  enabled: false
```

**Why one umbrella?** ArgoCD treats each Helm chart as a single sync unit. One umbrella keeps the Application count low, lets users enable subcharts individually, and makes the OCI registry contract simple: one chart per plugin.

### Subchart conventions

- **No `enabled` gate inside subchart templates.** The `condition` in `Chart.yaml` handles this -- Helm prunes disabled subcharts before rendering.
- **Resource limits/requests are mandatory** on every container.
- **Sync waves:** plugins sit at wave `2` (after the platform is up).
- **Vault integration:** subcharts needing secrets ship `VaultConnection`, `VaultAuth`, `VaultStaticSecret`, and a `vault-role-configmap` labeled `vault: setup-creds`.

### ArgoCD manifests

#### App-of-apps (`argocd-app-of-apps.yaml`)

This is the entry point. The platform's `bootstrap.yaml` discovers it via `plugins/*/argocd-app-of-apps.yaml`.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: bootstrap-my-plugin
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "2"
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: ${GIT_BASE_URL}/kuberse    # "kuberse" is the registry repo name (fixed convention)
    targetRevision: main
    path: plugins/my-plugin
    directory:
      recurse: false
      include: "{*/argocd-app.yaml}"
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

**Rules:**
- File **must** be named `argocd-app-of-apps.yaml`.
- `syncOptions` **must** include `ServerSideApply=true`.
- `repoURL` uses `${GIT_BASE_URL}/kuberse` -- the registry repo is always named `kuberse` by convention.

#### Per-component Application (`<subchart>/argocd-app.yaml`)

Each subchart gets its own ArgoCD Application in a subdirectory matching the subchart name:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: hello
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "2"
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    chart: my-plugin
    repoURL: oci://${REGISTRY_URL}/${ORG_NAME}/charts/my-plugin
    targetRevision: ${MY_PLUGIN_VERSION}
    helm:
      values: |
        hello:
          enabled: true
  destination:
    server: https://kubernetes.default.svc
    namespace: my-plugin
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

**Rules:**
- `metadata.name` must match the directory name.
- The `values` block enables **only** the matching subchart by name.
- `repoURL` points to the umbrella chart: `oci://${REGISTRY_URL}/${ORG_NAME}/charts/<plugin-name>`. All Applications point at the **same chart** -- only the enabled subchart differs.
- `targetRevision` uses the auto-generated version placeholder (see "About the version placeholder" above).

**OCI path explanation:**

| Context | Path | Example |
|---------|------|---------|
| Source (GHCR, published by CI) | `ghcr.io/<owner>/<plugin>-plugin/charts/<chart-name>` | `ghcr.io/marioapgs/kuberse-observability-plugin/charts/kuberse-observability` |
| Destination (user's Gitea registry) | `<registry-host>/<org>/charts/<plugin-name>` | `gitea-http.platform.svc.cluster.local:3000/myorg/charts/kuberse-observability` |

The CLI handles the path transformation during mirroring. In your templates, always use `${REGISTRY_URL}/${ORG_NAME}/charts/<plugin-name>` -- the CLI resolves the placeholders to the destination paths.

#### Image overrides for mirrored images

If your subchart uses custom images listed in `spec.artifacts.images`, override the image repository in the Application's helm values so workloads pull from the user's registry:

```yaml
helm:
  values: |
    hello:
      enabled: true
      image:
        repository: ${REGISTRY_URL}/${ORG_NAME}/my-image-name
```

The CLI mirrors images to `<registry>/<org>/<image-name>` (only the last path segment of the source image is preserved).

### Backstage catalog (optional)

To register your plugin in the Backstage software catalog, add `catalog-info.yaml` files. These are **optional** -- the `_template` omits them for simplicity.

**Root `catalog-info.yaml`** (Location entity):
```yaml
apiVersion: backstage.io/v1alpha1
kind: Location
metadata:
  name: my-plugin
spec:
  targets:
    - ./*/catalog-info.yaml
```

**Per-component (`hello/catalog-info.yaml`):**
```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: hello
  namespace: my-plugin
spec:
  type: service
  lifecycle: production
  owner: group:default/admins
```

**Cross-namespace references:** when using `dependsOn`, always qualify with the namespace:

```yaml
# Wrong -- resolves against the same namespace
dependsOn:
  - component:ingress-nginx

# Correct -- explicit namespace
dependsOn:
  - component:platform/ingress-nginx
```

### Secrets

Two files serve different purposes:

| File | Purpose | Format | Read by |
|------|---------|--------|---------|
| `secrets-expected.json` | Machine-readable. The CLI reads this during install and prompts the user for values, then seeds them into Vault. | JSON array | CLI (`kuberse plugin install`) |
| `expected-secrets.txt` | Human-readable. Documents what Vault paths/keys a subchart expects. For developer reference only. | Free-form text | Humans |

**`secrets-expected.json` example** (ship alongside your `argocd-app.yaml`):

```json
[
  {
    "path": "secret/my-plugin/config",
    "data": {
      "API_KEY": "{API_KEY}",
      "DATABASE_URL": "{DATABASE_URL}"
    }
  }
]
```

Values wrapped in `{PLACEHOLDER}` will be prompted during install. Literal values are written directly.

---

## How installation works

When you run `kuberse plugin install oci://ghcr.io/<owner>/my-plugin-plugin:1.0.0`, the CLI executes this pipeline:

1. **Pre-flight checks** -- verifies `oras`, `helm`, `git` are available and the registry repo is clean.
2. **Authentication** -- logs into the source registry (GHCR) and the destination registry (user's Gitea or GHCR).
3. **Download** -- `oras pull` fetches the OCI manifest artifact into a temp directory.
4. **Validate** -- checks `plugin.yaml` against the `kuberse.io/v1` schema.
5. **Idempotency check** -- if already installed, prompts for reinstall/upgrade/downgrade.
6. **Mirror images** -- copies each image from source to destination registry using `crane copy`.
7. **Mirror charts** -- `helm pull` + `helm push` to the user's registry, then tags as `:latest`. Also computes the version placeholder (e.g. `MY_PLUGIN_VERSION=0.1.0`).
8. **Copy manifests** -- copies the manifest files into `plugins/<name>/` in the registry repo.
9. **Resolve placeholders** -- substitutes `${REGISTRY_URL}`, `${ORG_NAME}`, `${BASE_DOMAIN}`, `${MY_PLUGIN_VERSION}`, etc. with actual values from platform config + the chart version computed in step 7.
10. **Write install record** -- saves metadata to `plugins/<name>/install-record.json`.
11. **Commit and push** -- commits to the registry repo with `feat: install plugin <name> v<ver>`.
12. **Seed secrets** -- scans for `secrets-expected.json` and populates Vault.
13. **ArgoCD reconciles** -- discovers the new manifests and deploys everything.

On failure, the registry repo is reset (`git checkout -- . && git clean -fd`). Mirrored OCI artifacts are not rolled back.

---

## Working with plugins

### Installing

```bash
# From OCI (recommended)
kuberse plugin install oci://ghcr.io/<owner>/my-plugin-plugin:latest

# Pin to a specific version for production
kuberse plugin install oci://ghcr.io/<owner>/my-plugin-plugin:1.4.1

# From git (clones into Gitea, triggers CI, then install via OCI)
kuberse plugin install https://github.com/<owner>/my-plugin.git

# Skip confirmation prompts
kuberse plugin install oci://ghcr.io/<owner>/my-plugin-plugin:latest --yes
```

### Listing installed plugins

```bash
kuberse plugin list
```

Shows a table of all installed plugins with name, version, install date, and source.

### Checking plugin status

```bash
kuberse plugin status my-plugin
```

Shows detailed info including mirrored images and charts.

### Updating

```bash
kuberse plugin update my-plugin
```

Re-pulls the latest artifacts from the source and overwrites the manifests. ArgoCD picks up the changes on its next refresh.

### Uninstalling

```bash
kuberse plugin uninstall my-plugin

# Skip confirmation
kuberse plugin uninstall my-plugin --yes
```

Two-stage cleanup:
1. Removes `plugins/<name>/` from the registry repo and commits. ArgoCD prunes the in-cluster resources.
2. Best-effort deletion of mirrored OCI artifacts from the destination registry.

### Authenticating to a registry

```bash
kuberse plugin registry-login ghcr.io
```

Logs in across all available OCI tools (`oras`, `docker`, `helm`, `crane`).

### Validating a plugin locally

```bash
kuberse plugin validate .
```

Checks the plugin directory against the canonical layout. Reports all violations without short-circuiting.

---

## Building a new plugin from scratch

A complete working template is available at [`plugins/_template/`](../_template/). Copy it and rename to start your plugin.

### Step 1: Copy and rename

```bash
cp -r plugins/_template my-new-plugin
cd my-new-plugin
```

Then rename all occurrences. The naming convention for the version placeholder is:
- Plugin name: `my-new-plugin` (lowercase, hyphens)
- Version placeholder: `${MY_NEW_PLUGIN_VERSION}` (uppercase, hyphens become underscores, append `_VERSION`)

```bash
# Rename the plugin name
mv src/my-plugin src/my-new-plugin
find . -type f \( -name "*.yaml" -o -name "*.yml" \) -exec sed -i 's/my-plugin/my-new-plugin/g' {} +
find . -type f \( -name "*.yaml" -o -name "*.yml" \) -exec sed -i 's/MY_PLUGIN/MY_NEW_PLUGIN/g' {} +

# Set your GitHub username/org
find . -type f \( -name "*.yaml" -o -name "*.yml" \) -exec sed -i 's/YOUR_GITHUB_USERNAME/your-actual-username/g' {} +
```

### Step 2: Add your subcharts

Replace `src/my-new-plugin/chart/charts/hello/` with your actual components. For each subchart:
1. Add it as a dependency in the umbrella `Chart.yaml` with `condition: <name>.enabled`
2. Add `<name>: { enabled: false }` in the umbrella `values.yaml`
3. Create `<name>/argocd-app.yaml` at the root with the Application enabling that subchart

### Step 3: Validate locally

```bash
# Lint the umbrella
helm lint src/my-new-plugin/chart

# Verify all subcharts disabled produces empty output
helm template t src/my-new-plugin/chart | grep -c '^kind:'    # should be 0

# Verify enabling a subchart produces resources
helm template t src/my-new-plugin/chart \
  --set hello.enabled=true \
  --debug | grep -c '^kind:'                               # should be > 0

# Validate plugin.yaml
python3 -c "
import yaml
d = yaml.safe_load(open('plugin.yaml'))
assert d['apiVersion'] == 'kuberse.io/v1' and d['kind'] == 'Plugin'
assert 'argocd' in d['spec']['manifests']
print('plugin.yaml OK')
"
```

### Step 4: Push and publish

```bash
git init && git add -A
git commit -m "feat: initial plugin release"
git remote add origin https://github.com/<owner>/my-new-plugin.git
git push -u origin main
```

The CI workflow (`.github/workflows/publish.yaml`) will:
1. Compute the version from conventional commits
2. Package the umbrella chart and push to GHCR
3. Tag the chart with both the version and `:latest`
4. Rewrite `:latest` in `plugin.yaml` to the concrete version
5. Push the manifest artifact to GHCR
6. Tag the git commit `v<version>`

### Step 5: Install on a cluster

```bash
kuberse plugin install oci://ghcr.io/<owner>/my-new-plugin-plugin:latest
```

---

## Versioning

### How versions are determined

The CI workflow (`plugin-release.yaml`) derives versions automatically from conventional commits:

| Commit prefix | Bump |
|---------------|------|
| `BREAKING CHANGE` or `!:` | major |
| `feat:` | minor |
| `fix:`, `perf:`, `refactor:` | patch |
| anything else | patch |

### The `:latest` tag

Two registries, two meanings:

- **Source registry (GHCR):** `:latest` is a moving alias updated by every CI run. Always points to the most recent release.
- **User's registry (Gitea):** `:latest` points to whatever version the user last installed. The CLI creates this alias so ArgoCD Applications targeting `targetRevision: latest` can resolve.

### Bumping subcharts

Each subchart has its own `Chart.yaml:version`. The umbrella references it via `dependencies[].version`. **Bump them together** -- Helm requires both to match.

### Force republish

To republish without changing source files (e.g., after a transient registry failure):

```bash
gh workflow run publish.yaml -f force-rebuild=true
```

---

## Git-mode install

For plugins hosted on GitHub (or any git host), you can install directly from the git URL:

```bash
kuberse plugin install https://github.com/<owner>/my-plugin.git
```

What happens:
1. The CLI clones the repo into the configured Gitea instance
2. Workflow references are automatically rewritten to point at the local Gitea org (e.g. `uses: MarioAPGS/kuberse/...@main` becomes `uses: <local-org>/kuberse/...@main`)
3. The CI pipeline is triggered via Gitea Actions
4. Once the pipeline publishes the OCI artifact, install it with the OCI reference shown in the CLI output

**Prerequisite:** the central `kuberse` repo (containing `plugin-release.yaml`) must already be mirrored in the same Gitea org.

---

## The CI workflow (`plugin-release.yaml`)

Your plugin's `.github/workflows/publish.yaml` delegates all packaging logic to a **shared reusable workflow** hosted at `MarioAPGS/kuberse/.github/workflows/plugin-release.yaml`. This is the upstream Kuberse organization's repo -- you reference it directly. When installing via git-mode, the CLI rewrites this reference to your local Gitea org automatically (you don't need to change it).

What the shared workflow does:
1. **Version** -- computes next semver from conventional commits
2. **Detect changes** -- diffs against previous tag to find changed charts/images
3. **Build charts** -- `helm package` + `helm push` for each changed chart, then `oras tag :latest`
4. **Build images** -- `docker buildx build --push` (if any `src/<app>/containers/` dirs exist)
5. **Publish manifest** -- rewrites `:latest` chart refs in `plugin.yaml` to concrete versions, then `oras push` the manifest artifact

---

## Troubleshooting

### `cannot get digest for revision latest`

**Symptom:** ArgoCD shows `ComparisonError` after install.

**Cause:** the user's registry has the chart with a version tag but no `:latest` alias.

**Fix:** manually tag from inside the cluster:

```bash
kubectl -n platform run oras-tag --rm -i --restart=Never \
  --image=ghcr.io/oras-project/oras:v1.2.0 --command -- sh -c '
echo <gitea-password> | oras login gitea-http.platform.svc.cluster.local:3000 \
  -u <gitea-user> --password-stdin --plain-http
oras tag --plain-http \
  gitea-http.platform.svc.cluster.local:3000/<org>/charts/<plugin-name>:<version> \
  latest
'
```

Get credentials from: `kubectl -n argocd get secret gitea-oci-creds -o yaml` (base64-decode `username` and `password`).

> **Note on the Gitea OCI path:** Gitea's container registry uses the pattern `<host>/<owner>/<package-path>`. When the CLI mirrors charts, it pushes to `<host>/<org>/charts/<plugin-name>`. The `${ORG_NAME}` placeholder resolves to your org name.

### Pods stuck in `Init:0/2`

**Cause:** the `wait-for-vault-secret` initContainer is waiting for secrets to be materialized by Vault Secrets Operator.

**Fix:** seed the expected secrets via the Kuberse API:

```bash
curl -X POST http://<kuberse-api-host>/api/platform/secrets/<vault-path>/<key> \
  -H 'Content-Type: application/json' \
  -d '{"<field>":"<value>"}'
```

Check the subchart's `expected-secrets.txt` for the required Vault paths and keys.

### ArgoCD reports `not found` for a non-latest revision

**Cause:** the `repoURL` in the Application is malformed.

**Fix:** verify the Application has the correct OCI chart reference:

```yaml
spec:
  source:
    chart: my-plugin                                              # chart name
    repoURL: oci://<host>/<org>/charts/my-plugin                  # OCI base path
    targetRevision: "0.1.0"                                       # concrete version
```

### New subchart added but never deployed

**Cause:** every subchart that should be deployed needs a corresponding `<sub-app>/argocd-app.yaml` in the manifest. There is no automatic discovery -- if the file doesn't exist, ArgoCD won't create the Application.

### Plugin reinstall doesn't pick up new chart version

**Cause:** the chart version in `plugin.yaml` wasn't updated by CI.

**Fix:** verify the new version exists: `oras repo tags ghcr.io/<owner>/my-plugin-plugin/charts/my-plugin`. If not, rerun CI with `force-rebuild=true`.

### PostgreSQL `Authentication failed` / `database does not exist`

**Cause:** the platform's `postgres-db-provisioner` CronJob only discovers Secrets with the label `pgdb: PG_CONNECTION_STRING`. Vault-synced Secrets don't inherit this label by default.

**Fix:** add the label in your `VaultStaticSecret` destination:

```yaml
spec:
  destination:
    name: my-app-secrets
    create: true
    labels:
      pgdb: PG_CONNECTION_STRING
```

The provisioner runs every 5 minutes and will create the database/role automatically.

---

## Platform config reference

The CLI resolves placeholders using values from the platform config (`/etc/kuberse/` in the CLI pod, sourced from `Secret/kuberse-config` in the `platform` namespace).

| Placeholder | Config key | Example value |
|-------------|-----------|---------------|
| `${REGISTRY_URL}` | `registry_url` | `gitea-http.platform.svc.cluster.local:3000` |
| `${GIT_BASE_URL}` | `git_base_url` | `http://gitea-http.platform.svc.cluster.local:3000/myorg` |
| `${ORG_NAME}` | `org_name` | `myorg` |
| `${BASE_DOMAIN}` | `base_domain` | `example.com` |
| `${<PLUGIN>_VERSION}` | *(auto-generated)* | `0.1.0` (from chart version during mirroring) |

To inspect current values from inside the cluster:

```bash
kubectl -n platform get secret kuberse-config -o jsonpath='{.data}' | \
  python3 -c "import sys,json,base64; d=json.load(sys.stdin); [print(f'{k}={base64.b64decode(v).decode()}') for k,v in d.items()]"
```

---

## Internal architecture (reference)

### Manager objects

The plugin system is built on four managers in `cli/kuberse_cli/managers/`:

| Manager | Responsibility |
|---------|----------------|
| `GitManager` | URL normalization, clone, commit/push, fetch/merge |
| `OciManager` | Registry login (oras/docker/helm/crane), artifact download, image/chart mirroring, `:latest` tagging |
| `RegistryManager` | Install records, manifest copying, plugin directory management |
| `PlaceholderManager` | Token substitution (`${...}` -> actual values), unresolved placeholder detection |

### Module map

```
cli/kuberse_cli/
├── features/plugin/
│   ├── command.py          # All plugin subcommands (install, update, list, status, uninstall)
│   └── validate.py         # plugin.yaml schema + canonical layout validation
├── managers/
│   ├── git.py              # GitManager
│   ├── oci.py              # OciManager
│   ├── placeholders.py     # PlaceholderManager
│   └── registry.py         # RegistryManager
```

### Canonical layout rules (enforced by `kuberse plugin validate`)

1. App-of-apps file **must** be named `argocd-app-of-apps.yaml`
2. `repoURL` **must** use `${GIT_BASE_URL}` or `${REGISTRY_URL}/${ORG_NAME}` placeholders -- no hardcoded hosts
3. `targetRevision` **must** use `${<PLUGIN_UPPER>_VERSION}` placeholder or a literal chart version
4. `syncOptions` **must** include `ServerSideApply=true` on every Application
5. No hardcoded literals (`kuberse-registry`, `ghcr.io`, `MarioAPGS`, etc.) in committed manifests
