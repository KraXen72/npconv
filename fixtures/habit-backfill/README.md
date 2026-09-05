# Habit backfill regression fixtures

These tests use anonymized copies of real application exports so they catch
schema and format differences that hand-built test databases can miss.

The following files must exist in this directory:

- `fixture-stt-anonymized.backup`
- `fixture-uhabits-anonymized.db`
- `fixture-timejot-anonymized.db`

The test suite intentionally fails with a clear missing-fixture error if any of
them are absent.

Anonymization preserves IDs, timestamps, relationships, flags, numeric values,
row counts, database schemas, and backup structure. User-authored names,
descriptions, questions, notes/comments, units, icons, and Loop UUIDs were
replaced deterministically.
