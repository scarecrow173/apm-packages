# APM Usage

## Producer workflow

```bash
apm compile --validate
apm compile --dry-run
apm audit
apm pack --archive -o dist
```

## Consumer workflow

From a repository that should use this package:

```bash
apm install <owner>/<repo>#v0.1.0
```

For local testing:

```bash
  apm install ..
```

## Versioning

Use immutable Git tags for reproducible installs.

Recommended initial tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Consumers should avoid installing from a moving branch such as `main` unless they explicitly want live updates.

## Targets

This package sets:

```yaml
target:
  - codex
  - copilot
```

Change this in `apm.yml` if you also want Claude, Cursor, OpenCode, Gemini, or Windsurf output.
