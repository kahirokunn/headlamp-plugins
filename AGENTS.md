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
- **Reference code (`refs/` directory)**:
  - `refs/headlamp`: Upstream Headlamp core repository (frontend, backend, docs, etc.), included here as a read-only reference.
  - `refs/plugins`: Upstream official Headlamp plugins, included as examples of recommended patterns.
  - When in doubt about `KubeObject` usage, Kubernetes API access, multi-cluster patterns, or UI conventions, **always look at the code under `refs/` first and copy its patterns** instead of inventing new ones.

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
  - Respect the **DRY (Don't Repeat Yourself)** and **YAGNI (You Aren't Gonna Need It)** principles: avoid duplicating logic or structures, extract shared behavior into reusable functions, hooks, components, or utility modules, and avoid adding features or abstractions before there is a clear, concrete need.
  - Define variables, helpers, and components only when they are actually needed instead of in anticipation of possible future use.
  - Export only the symbols that are required by other modules; do not add `export` just because something might be used from the outside in the future.
  - For React performance and compatibility with React Compiler, **do not use** `useCallback` or `useMemo` in new or updated code; prefer plain functions and components and rely on the compiler's optimizations instead.
- **Knative terminology**
  - In the `knative` plugin, always refer to Knative Service resources as **"KService"** in component names, variable and type names, comments, and user-facing strings.
  - Reserve the plain term **"Service"** for generic usage or for the Kubernetes `Service` resource; when you need to be explicit, prefer **"Kubernetes Service"** versus **"KService"** to avoid confusion.
- **Type usage**
  - Prefer concrete, specific types and avoid `any` in new code.
  - Prefer leveraging TypeScript's type inference for local variables and obvious return types to keep code concise; use explicit annotations mainly for public APIs (exported functions, components, hooks, and modules) and when inference is unclear.
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

- **KubeObject-based API access**
  - Prefer modeling Kubernetes and Knative resources as `KubeObject` classes (from the Headlamp plugin SDK) instead of adding new RTK Query slices or calling `ApiProxy` directly.
  - **Do not introduce new usages of `ApiProxy.request()` or `ApiProxy.clusterRequest()` from plugin components or API helpers.** For Kubernetes resources, always go through `KubeObject` and its `apiEndpoint` / hooks instead.
  - When you need a new resource, define a TypeScript interface that extends `KubeObjectInterface`, then create a class that extends `KubeObject<YourInterface>` and sets `kind`, `apiName`, `apiVersion`, and `isNamespaced`.
  - Fetch data using the `KubeObject` class methods and hooks such as `useList`, `useGet`, `apiList`, and `apiGet`, and use instance methods like `delete`, `update`, and `patch` for mutations, instead of RTK Query.
  - Look at the upstream Headlamp code under `refs/headlamp/frontend/src/lib/k8s` and the official plugins under `refs/plugins/*/src/resources` (for example `refs/plugins/cert-manager/src/resources/certificateRequest.ts`) as primary reference implementations.
  - Example:

```ts
import type { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

// Define the shape of the resource returned by the Kubernetes API
export interface KnativeKService extends KubeObjectInterface {
  spec: {
    // ...
  };
  status?: {
    // ...
  };
}

// Define a KubeObject wrapper for the resource
export class KService extends KubeObject<KnativeKService> {
  static kind = 'Service';
  static apiName = 'services';
  static apiVersion = 'serving.knative.dev/v1';
  static isNamespaced = true;

  get spec() {
    return this.jsonData.spec;
  }

  get status() {
    return this.jsonData.status;
  }
}
```

- **API response validation**
  - Do not introduce new heavy schema validation layers (such as `zod/mini`) for Kubernetes API responses in this repository; `KubeObject` helpers and TypeScript interfaces should be the primary way to describe API shapes.
  - When additional validation is required, prefer small, focused type guards or manual checks close to where the data is used instead of large shared schema hierarchies.
  - `zod/mini` may still be used for form validation where it adds clear value (see **Form implementation** below), but avoid building new Zod-based validation for fetch APIs.

- **Error handling**
  - When dealing with Kubernetes API errors, use Headlamp's `ApiError` type (from the plugin SDK) and helpers such as `KubeObject.getErrorMessage(err)` where appropriate.
  - Components and hooks that fetch data via `KubeObject` should handle loading and error states in the UI and surface user-friendly messages; avoid throwing raw errors from React components.
  - For multi-cluster calls, handle errors per cluster gracefully so that a failure in one cluster does not break the entire view; follow patterns from the upstream Headlamp code in `refs/headlamp/frontend/src/lib/k8s` and the official plugins under `refs/plugins`.

- **Form implementation**
  - **All forms MUST be implemented using `react-hook-form` with `zod/mini` for validation.**
  - Use `@hookform/resolvers/zod` to integrate `zod/mini` schemas with `react-hook-form`.
  - Define form validation schemas using `zod/mini` (following the same functional composition patterns as API response validation).
  - Derive form data types from Zod schemas using `z.infer<typeof SchemaName>`.
  - Use `useForm` hook with `resolver: zodResolver(schema)` for form validation.
  - Example:

```ts
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod/mini';

// Define form schema
const CreateServiceSchema = z.object({
  name: z.string().check(z.minLength(1), 'Name is required'),
  namespace: z.string().check(z.minLength(1), 'Namespace is required'),
  replicas: z.optional(z.number().check(z.min(1), 'Replicas must be at least 1')),
});

type CreateServiceFormData = z.infer<typeof CreateServiceSchema>;

function CreateServiceForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateServiceFormData>({
    resolver: zodResolver(CreateServiceSchema),
  });

  const onSubmit = (data: CreateServiceFormData) => {
    // Handle form submission
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Form fields */}
    </form>
  );
}
```

- **Multi-cluster support**
  - **All views MUST be multi-cluster compatible.** Do not create single-cluster-only views.
  - **Always use the `useClusters()` hook** from `src/hooks/useClusters.ts` to get cluster names. Do not use `getCluster()` directly in components or views.
  - The `useClusters()` hook automatically handles:
    - Selected clusters (if any are selected in the UI)
    - Current cluster (if no clusters are selected)
    - All available clusters (as a fallback)
  - When making API calls that support multiple clusters, pass the cluster array returned by `useClusters()`.
  - For **resource list views** (tables showing K8s/Knative resources), always include a **`Cluster` column** whose value is the resource's origin cluster.
    - The `Cluster` column should only be **rendered when there are two or more clusters** (e.g. `const showClusterColumn = clusters.length > 1` and conditionally render the header and cells).
    - Sorting by `Cluster` should be supported when the column is present.
  - **Never select an arbitrary cluster by index** (for example, do **not** use `clusters[0]` as the active cluster). Instead, either:
    - Use an explicit cluster identifier from route parameters or component props, or
    - Iterate over all clusters returned by `useClusters()` and handle them explicitly (for example, by aggregating results or rendering per-cluster sections).
  - Example:

```ts
import { useClusters } from '../hooks/useClusters';

export default function MyComponent() {
  const clusters = useClusters();
  const hasCluster = clusters.length > 0;

  const { data, isLoading } = useFetchDataQuery(
    { clusters },
    { skip: !hasCluster }
  );

  if (!hasCluster) {
    return <div>No cluster selected</div>;
  }

  // Render multi-cluster data...
}
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
  - Before committing, run `npx knip --fix` to detect and remove unused exports and other dead code.

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
    - **Multi-cluster support**: Always use `useClusters()` hook instead of `getCluster()` for all views
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
