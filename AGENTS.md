## AGENTS – Guidelines for Contributors and AI assistants

This document describes how to work with this repository, both for **human contributors** and for **AI / LLM-based agents**.

### 1. Repository overview

- **Project**: Headlamp plugins
  - `envoy-gateway`: Envoy Gateway plugin for Headlamp
  - `knative`: Knative Services plugin for Headlamp
- **Per-package structure** (typical):
  - `src/`: TypeScript & React source code (this is what you edit)
  - `dist/`: Compiled bundle (DO NOT edit manually)
  - `node_modules/`: Dependencies (managed by the package manager)

---

### 2. Language policy

- **Source code (strong rule)**
  - Use **English only** for:
    - Identifiers (variable / function / component / type names)
    - Comments and JSDoc / TSDoc
    - Log / error messages and user-facing strings
- **Documentation**
  - Prefer **English** for README and public documentation.
  - Japanese comments in PRs / Issues are OK, but avoid mixing languages within the same sentence or identifier.
- **Git commits / PRs**
  - Commit messages, PR titles, and PR descriptions should be written in **English**.

---

### 3. Coding conventions

- **Tech stack**
  - Use **TypeScript** for all new code.
  - Use **React function components** and hooks (no new class components).
- **Style**
  - Follow existing code style in each package.
  - Prefer explicit types over `any`; keep TypeScript strict where reasonable.
  - Keep components small and composable; extract shared logic into `components/common` or `src/api` as appropriate.
  - Respect the **DRY (Don't Repeat Yourself)** principle: avoid duplicating logic or structures, and extract shared behavior into reusable functions, hooks, components, or utility modules.
- **Type usage**
  - Prefer concrete, specific types and avoid `any` in new code.
  - When you need to accept unknown input, use `unknown` first and then narrow the type with proper checks.
  - Make use of TypeScript utility types (built-in and custom) to avoid duplication and keep types DRY.
  - When defining type aliases:
    - Give them meaningful, domain-relevant names.
    - Make the intention of the type clear from its name and structure.
  - Example:

```ts
// Good
type UserData = {
  id: string;
  createdAt: Date;
};

// Bad
type Data = any;
```

- **Behavior**
  - Avoid breaking changes to existing public APIs unless explicitly intended.
  - Be careful with UX: Headlamp is a desktop app; avoid blocking UI and long, synchronous operations on the main thread.
  - Keep data shown in the UI as close to real-time as reasonably possible (for example, refresh on focus, react to watch/stream updates, or use polling when necessary).
  - When using polling (for example with `setInterval`), do not hard-code interval values in each file; define them in a shared configuration module (e.g. under `src/config`) and import them from there.

---

### 4. Dependencies and build

- **Per-package dependencies**
  - Each plugin (`envoy-gateway`, `knative`) is an independent package.
  - When adding a dependency, modify the **corresponding** `package.json` and run the appropriate install command (e.g. `npm install <pkg>` in that directory).
- **Do not edit generated files**
  - Never modify files under:
    - `dist/`
    - `node_modules/`
  - Instead, change the TypeScript/React source under `src/` and rebuild.
- **Build & test (example)**
  - From each package directory:
    - `npm install`
    - `npm run build` (or other scripts defined in `package.json`)
  - If a lint or test script exists, run it before opening a PR.

---

### 5. Guidelines for human contributors

- **Before implementing changes**
  - Skim the relevant `README.md` to understand what the plugin does.
  - Check existing components under `src/components` and `src/api` and reuse patterns when possible.
- **When changing behavior**
  - Prefer small, focused PRs.
  - Update or add documentation (README, comments, or user-facing copy) if behavior changes.
  - Add or update tests if a test setup exists for the affected area.
- **When in doubt**
  - Open a GitHub Issue or Draft PR to discuss design or large refactors before implementing.

---

### 6. Guidelines for AI / LLM-based agents

These rules are specifically for tools like GitHub Copilot, Cursor Agents, or other automated systems acting on this repository.

- **Scope of edits**
  - Edit only files under `src/` (and configuration files like `package.json`, `tsconfig.json`, etc.) unless explicitly instructed otherwise.
  - **Do not edit**:
    - `dist/`
    - `node_modules/`
    - Asset files (e.g. videos) except when explicitly asked.
- **Language**
  - Generate **English** for all code, comments, and commit messages.
  - Documentation you add should be in English.
- **Consistency**
  - Match existing patterns:
    - Component layout and prop naming
    - API calling conventions under `src/api`
    - Error handling and notification patterns (`useNotify` hooks, etc.)
- **Safety and minimality**
  - Prefer the **smallest change** that achieves the requested behavior.
  - Do not introduce speculative refactors or unrelated style changes.
  - Avoid adding dependencies unless strictly necessary; prefer using what is already available.
- **Build / lint**
  - After non-trivial changes, ensure the project (or changed package) can still build.
  - Fix new TypeScript or lint errors you introduced.

---

### 7. How to extend this document

- If you notice recurring patterns or rules that are not yet documented, feel free to:
  - Propose additions to this file in a PR, or
  - Open an Issue describing suggested changes to `AGENTS.md`.

The goal of this document is to make it easy and safe for both humans and AI agents to contribute to this repository in a consistent way.
