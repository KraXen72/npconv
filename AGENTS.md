## General
- Avoid hacks or quick patches; prefer correct, maintainable fixes. When a workaround is necessary, explain why and propose a better follow-up.
- Maintain performance and readability.

## Tooling / workflow
- Use `pnpm` for installs and scripts (this repo uses pnpm).
- The project uses Vite for bundling. Prefer Vite-compatible solutions (e.g., `import`/`import.meta.url`) for assets.
- The `public/` directory should be avoided where possible — let Vite handle static assets. If a file truly must be served at project root (e.g. a wasm file required at runtime), either configure Vite to copy it or place it under `src` and use `import.meta.url`/`new URL(...)`.

## TypeScript
- Strive for proper typing: prefer `type`/`interface` definitions and generics where appropriate.
- Minimize use of `any`. When importing third-party modules without types, add an ambient declaration under `src/types/` (example: `src/types/sqljs.d.ts`) rather than scattering `any` across the codebase.
- When touching files, fix resulting type errors rather than silencing them, unless there is a clear, documented exception.
- Keep `strict: true`, apart from `strictNullChecks`, which is false.
- If a single feature requires a pragmatic loosening, prefer adding a narrow suppression or declaration rather than disabling strictness globally.
- Run `pnpm lint` and `pnpm build` (or the relevant dev scripts) after edits.
- If you create a type declaration file, place it under `src/types/` and ensure `tsconfig.json` includes `src` so it's picked up.
