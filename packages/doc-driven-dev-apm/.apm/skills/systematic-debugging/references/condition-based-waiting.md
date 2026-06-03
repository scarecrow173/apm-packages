# Condition-Based Waiting

Replace arbitrary timeouts with condition polling for reliable async operations.

## The Problem

```typescript
// BAD: Arbitrary timeout — works on fast machines, fails on slow ones
await new Promise(resolve => setTimeout(resolve, 2000));
expect(element).toBeVisible();
```

Arbitrary timeouts are:
- Too short on slow machines (flaky tests)
- Too long on fast machines (slow tests)
- Never the right number

## The Solution

Wait for a specific condition to be true, with a timeout as a safety net:

```typescript
// GOOD: Wait for condition, timeout is safety net
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options?: { timeout?: number; interval?: number }
): Promise<void> {
  const timeout = options?.timeout ?? 5000;
  const interval = options?.interval ?? 100;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}
```

## Usage Examples

### Waiting for UI State

```typescript
// Wait for loading to finish
await waitFor(() => !document.querySelector('.spinner'));

// Wait for element to appear
await waitFor(() => document.querySelector('[data-testid="result"]') !== null);
```

### Waiting for Process State

```typescript
// Wait for server to be ready
await waitFor(async () => {
  try {
    const res = await fetch('http://localhost:3000/health');
    return res.ok;
  } catch {
    return false;
  }
});
```

### Waiting for File System

```typescript
// Wait for file to be written
await waitFor(() => fs.existsSync(outputPath));
```

## Key Rules

- **Always have a timeout** — never poll forever
- **Poll a specific condition** — not "wait and hope"
- **Short poll interval** — 50-100ms is typical
- **Descriptive error on timeout** — include what condition wasn't met
- **Condition should be side-effect free** — just checking, not changing state

## When to Use

- Test setup waiting for servers/services
- UI tests waiting for async operations
- Integration tests waiting for eventual consistency
- Replacing any `sleep()` or `setTimeout` used for synchronization
