# Habit backfill regression fixtures

These fixtures are anonymized copies of real application exports used to catch
schema and format differences that hand-built test databases can miss.

Each file is stored as gzip-compressed, base64-encoded text (`.gz.b64`). Tests
decode and decompress it back to the exact anonymized export bytes before
parsing/conversion.

Anonymization preserves IDs, timestamps, relationships, flags, numeric values,
row counts, database schemas, and backup structure. User-authored names,
descriptions, questions, notes/comments, units, icons, and Loop UUIDs were
replaced deterministically before the fixtures were added to the repository.