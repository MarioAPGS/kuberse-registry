# my-plugin

A minimal Kuberse plugin. Deploys a hello-world nginx pod.

## Quick start

1. Copy this directory to a new repository
2. Rename `my-plugin` to your plugin name everywhere
3. Replace `YOUR_GITHUB_USERNAME` with your GitHub user/org
4. Push to GitHub -- CI publishes the OCI artifacts automatically

## Local validation

```bash
helm lint src/my-plugin/chart
helm template t src/my-plugin/chart --set hello.enabled=true --debug
```

## Install

```bash
kuberse plugin install oci://ghcr.io/<owner>/my-plugin-plugin:latest
```
