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

- **API response validation**
  - Use **`zod/mini`** for validating all API responses from `ApiProxy.request()`.
  - **All `ApiProxy.request()` responses MUST be validated through a Zod schema** before use.
    - Exception: for operations where the response body is **never used at all** (e.g. simple PATCH/DELETE helpers that only care about HTTP success), you may `await ApiProxy.request(...)` directly without Zod validation, but **you must not parse-and-discard the body using `z.unknown().parseAsync(...)`**.
  - **All API response type definitions MUST be derived from Zod schemas** using `z.infer<typeof SchemaName>`.
  - Do not use type assertions (`as`) directly on `ApiProxy.request()` responses; instead, parse and validate them with Zod schemas first.
  - **Do not call `.parse()` / `.parseAsync()` on Zod schemas in plugin code. Always use `.safeParse()` (or `.safeParseAsync()` if available) and handle the result (`success` / `error`) explicitly.**
  - **Schema design principle**: Define schemas based on the **actual structure of data returned from the API**, not necessarily the CRD definition. For example, even if a CRD defines `spec` as optional (for PATCH operations), if the API always returns it (due to mutating webhooks, defaults, etc.), make it required in the schema.
  - **Important**: `zod/mini` keeps only a small set of methods (for example `.safeParse()` and `.check()`) and moves most validation helpers (like `.min()`, `.max()`, `.trim()`, etc.) to top‑level functions. In this repository, **prefer the functional API over method chaining**:
    - For optional / nullable, prefer `z.nullable(z.optional(z.string()))` (Zod Mini style) instead of the regular-Zod style `z.string().optional().nullable()`.
    - For checks like `min` / `max`, prefer `.check()` with functional checks, e.g. `z.string().check(z.minLength(5), z.maxLength(10))` instead of `z.string().min(5).max(10)`.
  - Example:

```ts
import * as z from 'zod/mini';
import * as ApiProxy from '@kinvolk/headlamp-plugin/lib/ApiProxy';

// Define schema based on actual API response structure
// (note: zod/mini does not support method chaining)
const ServiceSchema = z.object({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.optional(z.string()),
  }),
  // spec is required here because the API always returns it
  // (mutating webhooks, defaults, etc. ensure it exists)
  spec: z.object({
    template: z.object({ /* ... */ }),
    // ... other spec fields
  }),
});

// Derive type from schema
type Service = z.infer<typeof ServiceSchema>;

// Result type for API helpers
type ApiResult<T> =
  | { isSuccess: true; data: T }
  | { isSuccess: false; errorMessage: string };

// Validate response without throwing
export async function getService(namespace: string, name: string): Promise<ApiResult<Service>> {
  const response = await ApiProxy.request(`/api/v1/namespaces/${namespace}/services/${name}`, {
    method: 'GET',
  });
  const parsed = ServiceSchema.safeParse(response);
  if (!parsed.success) {
    return { isSuccess: false, errorMessage: 'Invalid Service response' };
  }
  return { isSuccess: true, data: parsed.data };
}
```

- **Error handling for API wrappers**
  - `ApiProxy.request()` throws `ApiError` for non‑OK HTTP responses, but **plugin-level API helpers must not use `throw` to represent expected API or validation failures**. Instead, always convert outcomes into explicit, typed result objects (for example the `ApiResult<T>` pattern above).
  - For operations that do not need the response body (e.g. simple PATCH/DELETE helpers), prefer **non-throwing wrappers** that:
    - simply `await ApiProxy.request(...)` to ensure the HTTP call succeeds (do **not** call `z.unknown().parseAsync(...)` just to “consume” the response), and
    - return an explicit result object such as `{ isSuccess: boolean; errorMessage?: string }` instead of throwing.
  - UI/components should consume these helpers by checking the boolean flag (for example `if (!result.isSuccess) { notifyError(...) }`) rather than relying on `try`/`catch` for expected API failures.

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
