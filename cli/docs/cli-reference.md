# Kuberse CLI Reference

## Commands

| Command | Description |
|---------|-------------|
| `kuberse init` | Bootstrap a new platform from your host machine. Supports `minikube` (local) and `k3s` (remote multi-node over SSH) cluster modes. |
| `kuberse init proxmox` | (Not yet implemented) Provision Debian VMs on a Proxmox host. |
| `kuberse setup` | Continue bootstrap from inside the kuberse-cli pod. Automatically invoked by `init`; run manually only to retry after a failure. |
| `kuberse update [--artifacts]` | Sync your registry fork with upstream and resolve new placeholders. (`--artifacts` is currently a stub for Gitea.) |
| `kuberse plugin install <ref>` | Install a plugin from an OCI registry or Git repository. |
| `kuberse plugin update <name>` | Re-pull the latest artifacts for an installed plugin. |
| `kuberse plugin list` | List all installed plugins. |
| `kuberse plugin status <name>` | Show details about a specific plugin. |
| `kuberse plugin uninstall <name> [--yes]` | Remove a plugin and clean up its resources. |
| `kuberse plugin registry-login <registry>` | Authenticate to an OCI registry for plugin operations. |
| `kuberse plugin validate <dir>` | Validate a plugin template directory against the expected layout. |
| `kuberse secrets seed` | Interactively provide secrets required by platform modules. |
| `kuberse cli` | Attach to the kuberse-cli pod (wrapper around `kubectl exec`). Use this to re-enter the pod after `init` exits. |
| `kuberse status` | Show platform status (coming soon). |
| `kuberse --version` | Print the installed Kuberse version. |

---

## Detailed Command Reference

### `kuberse init`

Bootstraps a new Kuberse platform. You run this from your local machine.

**Cluster modes:**

- **minikube** -- Spins up a local single-node cluster using Minikube and Docker.
- **k3s** -- Deploys a multi-node k3s cluster on remote machines over SSH.

---

### `kuberse update`

```
kuberse update [--artifacts]
```

Syncs your registry fork with the upstream Kuberse registry, resolves any new template placeholders (values like `${BASE_DOMAIN}` that get substituted with your environment-specific configuration), and commits/pushes the result.

| Flag | Description |
|------|-------------|
| `--artifacts` | Additionally mirror OCI artifacts from `ghcr.io` to your internal registry (Gitea environments only). **Note:** this flag is currently a stub and does not perform mirroring yet. |

---

### `kuberse plugin install`

```
kuberse plugin install REFERENCE [OPTIONS]
```

Install a plugin into your platform.

**Install modes:**

- **Mirror mode** (OCI reference): The CLI pulls the plugin's OCI manifest and Helm chart from the source registry, copies ("mirrors") them into your platform's registry, places ArgoCD Application manifests into your registry repo, and commits. ArgoCD then deploys the plugin.
- **Git mode** (HTTPS URL): The CLI pushes the repo into your Gitea instance and triggers a CI pipeline to build and publish the plugin. You then install it via its OCI reference once the build completes.

**REFERENCE** can be:

| Format | Behavior |
|--------|----------|
| `oci://<registry>/<path>:<tag>` | Pulls the plugin directly from an OCI registry (mirror mode — copies artifacts into your platform's registry). |
| `https://<host>/<org>/<repo>.git` | Mirrors the Git repo into your Gitea instance and triggers the CI pipeline (Gitea Actions) to build it. |

Any other format exits with an error.

**Options:**

| Flag | Description |
|------|-------------|
| `--yes`, `-y` | Skip confirmation prompts. |
| `--registry-token TEXT` | Token for the source OCI registry. Env: `KUBERSE_REGISTRY_TOKEN` |
| `--registry-username TEXT` | Username for the source registry. Env: `KUBERSE_REGISTRY_USERNAME` (default: `token`) |

**Example:**

```bash
# Install from OCI registry
kuberse plugin install oci://ghcr.io/kuberse/plugins/monitoring:v1.2.0

# Install from Git (triggers CI build)
kuberse plugin install https://github.com/myorg/my-plugin.git
```

After a Git-mode install, the CLI prints the OCI reference you can use once the pipeline completes.

---

### `kuberse plugin update`

```
kuberse plugin update NAME [OPTIONS]
```

Re-pulls the latest artifacts for an already-installed plugin and updates manifests in your registry repo.

| Flag | Description |
|------|-------------|
| `--yes`, `-y` | Skip confirmation prompts. |
| `--registry-token TEXT` | Token for source OCI registry. Env: `KUBERSE_REGISTRY_TOKEN` |
| `--registry-username TEXT` | Username. Env: `KUBERSE_REGISTRY_USERNAME` (default: `token`) |

---

### `kuberse plugin uninstall`

```
kuberse plugin uninstall NAME [--yes/-y]
```

Removes a plugin in two stages:

1. Deletes plugin files from the registry repo (the GitOps repository that ArgoCD watches), commits, and pushes. ArgoCD then prunes the associated Kubernetes resources.
2. Best-effort removal of OCI artifacts from the destination registry.

---

### `kuberse plugin registry-login`

```
kuberse plugin registry-login REGISTRY [OPTIONS]
```

Authenticates to an OCI registry. Credentials are applied to all available tools (`oras`, `docker`, `helm`, `crane`).

| Flag | Description |
|------|-------------|
| `-u`, `--username TEXT` | Registry username (default: `token`). |
| `-p`, `--password TEXT` | Registry password/token. Prompted interactively if not provided. Env: `KUBERSE_REGISTRY_TOKEN` |

---

### `kuberse plugin validate`

```
kuberse plugin validate TEMPLATE_DIR
```

Validates a plugin template directory. Checks:

- `plugin.yaml` conforms to the expected schema
- ArgoCD app-of-apps structure is present
- Application manifests use correct OCI reference format

Use this when authoring plugins to catch issues before publishing.

---

### `kuberse secrets seed`

Discovers which secrets are needed by your installed platform modules, prompts you for values, and writes them into Vault.

This command also runs automatically after `kuberse plugin install` to collect any secrets the new plugin requires.

---

## Configuration on Disk

Inside the kuberse-cli pod, configuration lives at `/etc/kuberse/`. The following values are set during `init` and used by all CLI commands:

| Key | Purpose |
|-----|---------|
| `cluster_mode` | `minikube` or `k3s` |
| `git_provider` | Git hosting backend (e.g., Gitea, GitHub) |
| `git_base_url` | Internal Git URL |
| `git_base_url_external` | External Git URL (if different) |
| `registry_url` | OCI registry URL |
| `base_domain` | Base domain for platform services |
| `admin_email` | Platform admin email |
| `admin_password` | Platform admin password |
| `org_name` | Organization name |
| `github_token` | GitHub token (if using GitHub as upstream) |

The registry repo is cloned at `/workspace/registry`. Plugin repos are cloned under `/workspace/plugins/<repo>`.

---

## Required Binaries

### On your host (for `kuberse init`)

- `kubectl`
- **Minikube mode:** `minikube`, `docker`
- **k3s mode:** `ssh`, `scp`

### On the CLI pod (for all other commands)

| Binary | Required | Purpose |
|--------|----------|---------|
| `oras` | Yes | OCI artifact operations |
| `helm` | Yes | Chart management |
| `git` | Yes | Repository operations |
| `kubectl` | Yes | Cluster interaction |
| `vault` | Yes | Secrets management |
| `crane` | No | Image mirroring (used by `update --artifacts`) |
