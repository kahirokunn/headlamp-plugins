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
  - Respect the **DRY (Don't Repeat Yourself)** and **YAGNI (You Aren't Gonna Need It)** principles: avoid duplicating logic or structures, extract shared behavior into reusable functions, hooks, components, or utility modules, and avoid adding features or abstractions before there is a clear, concrete need.
  - For React performance and compatibility with React Compiler, **do not use** `useCallback` or `useMemo` in new or updated code; prefer plain functions and components and rely on the compiler's optimizations instead.
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

- **API implementation with RTK Query**
  - **All API calls MUST be implemented using RTK Query** (`@reduxjs/toolkit/query/react`). Do not use `ApiProxy.request()` directly in components or API helpers.
  - Define all API endpoints in a centralized RTK Query API slice (e.g., `src/api/knativeRtkApi.ts`).
  - Use `createApi` to create the API slice with appropriate `reducerPath` and `tagTypes`.
  - Define endpoints using `build.query` for read operations and `build.mutation` for write operations.
  - **All endpoints MUST support multi-cluster operations** by accepting `clusters: string[]` in their arguments.
  - Inside `queryFn`, use `ApiProxy.clusterRequest()` for individual cluster requests (this is internal implementation detail).
  - Example:

```ts
import { createApi } from '@reduxjs/toolkit/query/react';
import * as ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import * as z from 'zod/mini';

// Define schema based on actual API response structure
const ServiceSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.optional(z.string()),
  }),
  spec: z.object({
    template: z.object({ /* ... */ }),
  }),
});

type Service = z.infer<typeof ServiceSchema>;

// Multi-cluster aware type
type ServiceWithCluster = Service & { cluster: string };

// Arguments for multi-cluster queries
type GetServiceArgs = {
  clusters: string[];
  namespace: string;
  name: string;
};

// Error type
type ApiError = {
  kind: 'ValidationError' | 'ApiError' | 'NotFound' | 'UnknownError';
  message: string;
};

const emptyBaseQuery: BaseQueryFn<unknown, unknown, ApiError> = async () => ({
  error: {
    kind: 'UnknownError',
    message: 'Base query is not used; endpoints use queryFn.',
  },
});

export const knativeRtkApi = createApi({
  reducerPath: 'knativeRtkApi',
  baseQuery: emptyBaseQuery, // Use empty base query; endpoints use queryFn
  tagTypes: ['Service'],
  endpoints: build => ({
    getService: build.query<ServiceWithCluster[], GetServiceArgs>({
      async queryFn({ clusters, namespace, name }) {
        const results: ServiceWithCluster[] = [];

        for (const cluster of clusters) {
          try {
            const response = await ApiProxy.clusterRequest(
              `/apis/serving.knative.dev/v1/namespaces/${namespace}/services/${name}`,
              { method: 'GET', cluster }
            );
            const parsed = ServiceSchema.safeParse(response);
            if (!parsed.success) {
              // Continue to next cluster on validation error
              continue;
            }
            results.push({ ...parsed.data, cluster });
          } catch (error) {
            // Continue to next cluster on API error
            continue;
          }
        }

        return { data: results };
      },
      providesTags: (result) =>
        result
          ? result.map(service => ({
              type: 'Service' as const,
              id: `${service.cluster}/${service.metadata.namespace ?? ''}/${service.metadata.name}`,
            }))
          : [],
    }),
  }),
});

// Export hooks for use in components
export const { useGetServiceQuery } = knativeRtkApi;
```

- **API response validation**
  - Use **`zod/mini`** for validating all API responses inside RTK Query `queryFn`.
  - **All API responses MUST be validated through a Zod schema** before use.
  - **All API response type definitions MUST be derived from Zod schemas** using `z.infer<typeof SchemaName>`.
  - Do not use type assertions (`as`) directly on API responses; instead, parse and validate them with Zod schemas first.
  - **Do not call `.parse()` / `.parseAsync()` on Zod schemas. Always use `.safeParse()` and handle the result (`success` / `error`) explicitly.**
  - **Schema design principle**: Define schemas based on the **actual structure of data returned from the API**, not necessarily the CRD definition. For example, even if a CRD defines `spec` as optional (for PATCH operations), if the API always returns it (due to mutating webhooks, defaults, etc.), make it required in the schema.
  - **Important**: `zod/mini` keeps only a small set of methods (for example `.safeParse()` and `.check()`) and moves most validation helpers (like `.min()`, `.max()`, `.trim()`, etc.) to top‑level functions. In this repository, **prefer the functional API over method chaining**:
    - For optional / nullable, prefer `z.nullable(z.optional(z.string()))` (Zod Mini style) instead of the regular-Zod style `z.string().optional().nullable()`.
    - For checks like `min` / `max`, prefer `.check()` with functional checks, e.g. `z.string().check(z.minLength(5), z.maxLength(10))` instead of `z.string().min(5).max(10)`.

- **Error handling in RTK Query**
  - RTK Query endpoints should return `{ data }` on success or `{ error }` on failure (RTK Query standard pattern).
  - Define **domain‑specific error types** (for example `KnativeApiError` with variants like `'ValidationError' | 'ApiError' | 'NotFound' | 'UnknownError'`) rather than using `string` or `any`.
  - In `queryFn`, catch errors and convert them to the error type using a helper function (e.g., `toApiError()`).
  - For multi-cluster queries, handle errors per cluster gracefully (continue processing other clusters even if one fails).
  - UI/components should consume RTK Query hooks and check `isError` or `error` properties rather than using `try`/`catch`.
  - Example error handling:

```ts
import { ApiError } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

type KnativeApiError = {
  kind: 'ValidationError' | 'ApiError' | 'NotFound' | 'UnknownError';
  message: string;
};

function toApiError(error: unknown, fallbackMessage: string): KnativeApiError {
  if (error instanceof ApiError) {
    return { kind: 'ApiError', message: error.message || fallbackMessage };
  }
  if (error instanceof Error) {
    return { kind: 'ApiError', message: error.message || fallbackMessage };
  }
  return { kind: 'UnknownError', message: fallbackMessage };
}

// In queryFn:
async queryFn({ cluster, namespace, name }) {
  try {
    const response = await ApiProxy.clusterRequest(/* ... */);
    const parsed = ServiceSchema.safeParse(response);
    if (!parsed.success) {
      return {
        error: { kind: 'ValidationError', message: 'Invalid Service response' },
      };
    }
    return { data: { ...parsed.data, cluster } };
  } catch (error) {
    return { error: toApiError(error, 'Failed to fetch Service') };
  }
}
```

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
