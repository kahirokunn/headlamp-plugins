## Headlamp Plugins

This repository contains multiple plugins for [Headlamp](https://github.com/headlamp-k8s/headlamp), a Kubernetes web UI.
Each plugin is an independent package with its own README and documentation.

### Plugins in this repository

- **Envoy Gateway plugin**
  - Directory: `envoy-gateway/`
  - Details, installation, and demo: see `envoy-gateway/README.md`

- **Knative plugin**
  - Directory: `knative/`
  - Details, installation, and demo: see `knative/README.md`

### Repository layout

- `envoy-gateway/` – Envoy Gateway Headlamp plugin (see `envoy-gateway/README.md`)
- `knative/` – Knative Services Headlamp plugin (see `knative/README.md`)
- `AGENTS.md` – Guidelines for contributors and AI / LLM-based agents

For development, build, and usage instructions, please refer to each plugin's own `README.md` and `package.json`.
