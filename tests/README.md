# Running tests

Use the project's Node 24 and pnpm environment:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:coverage
pnpm test:shuffle
pnpm lint
pnpm build
```

`test:coverage` uses Vitest's V8 provider and reports statements, branches,
functions, and lines. Open `coverage/index.html` to inspect missed branches;
JSON reports are also available in `coverage/`. Reports include all source
files, including files no test imports. PR CI runs coverage and uploads the
report. `test:shuffle` checks independence with a reproducible shuffle seed;
use `pnpm test:shuffle --sequence.seed=42` to choose another order.

Most tests are alongside their source files. `habit-real-fixtures.test.ts`
contains integration regressions against the committed anonymized backups in
`fixtures/habit-backfill/`. The NewPipe/LibreTube suite also declares its
committed JSON/ZIP fixture names explicitly. Import `@tests/helpers/fixtures`
and use `fixtureFile('habit-backfill/example.db')` or `readFixture('example.zip')`.
Vitest supplies the fixture directory from its config location, so paths do not
depend on the test location or working directory. Tests do not depend on `_artifacts`
or local, untracked backups.

# Test conventions

- Name tests as “expected result when condition”; separate Arrange, Act, and
  Assert with blank lines.
- Prefer small, specific inputs, real `File` objects, and real SQLite/ZIP
  libraries. Keep real-backup tests for compatibility regressions.
- Put recurring setup in `beforeEach`. Share initialization of the SQLite WASM
  module, but create fresh databases, files, and stores for every test.
- `helpers/sqlite.ts` records real database allocations and closes every handle
  after each test, including allocations made by application code. The tracked
  constructor inherits sql.js without replacing its behavior. Resource lifetime
  tests must assert closure before this fallback cleanup runs.
- `setup.ts` clears the singleton log store and fixes `Date` for each test.
  Other timers and library operations remain real; no library mocks are used.
- `GatedFile` controls when a real file read completes. Release it explicitly to
  test upload races without sleeps or timing assumptions.
- Assert output content and preservation of existing records, rather than just
  successful execution or row counts. Exact database schema assertions are
  appropriate where Android backup compatibility depends on them.

# Remaining coverage gaps

Browser regressions use Playwright and exercise workflow selection, WASM startup,
file uploads, both directions of habit type conversion and filling, boolean range
copying, invalid inputs, live preview values, mobile layout, and downloaded SQLite content.
Mobile tests focus every editor control at 320px and 390px widths, and import
mapping controls at 320px. They verify the graph stays in the same 640px viewport. They use a
synthetic fruit-named backup and the existing anonymized real fixture.

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium binary.
Failure traces are saved under `test-results/`.

NewPipe/LibreTube still has untested branches for legacy input variants and
several recoverable errors. STT's malformed timestamp fallback contains branches
that cannot recover a numeric value: `parseInt` already accepts a numeric prefix
before a trailing `f`. These should be reviewed as implementation behavior before
adding tests merely to increase coverage. There is no coverage percentage gate;
the report is evidence for selecting meaningful regression cases.
