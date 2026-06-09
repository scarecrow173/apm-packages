# Defense in Depth

Add validation at multiple layers after finding and fixing the root cause.

## Purpose

After fixing a root cause, add defensive checks at multiple layers to prevent similar issues from reaching users undetected in the future.

## The Pattern

```
Layer 1: Input validation (catch bad data early)
    ↓
Layer 2: Business logic assertions (catch invalid state)
    ↓
Layer 3: Output validation (catch bad responses)
    ↓
Layer 4: Monitoring/alerting (catch issues in production)
```

## When to Apply

After fixing a root cause, ask:
- Could a similar bad value reach this point again?
- What if the fix is accidentally reverted?
- What if a different caller sends similar bad data?

If yes to any, add defensive layers.

## Implementation

### Layer 1: Input Validation

```typescript
function processUser(user: User) {
  if (!user?.id) throw new Error('User ID required');
  if (!user?.email) throw new Error('User email required');
  // ... proceed with validated data
}
```

### Layer 2: Assertions

```typescript
function calculateDiscount(price: number, percentage: number) {
  assert(price >= 0, 'Price must be non-negative');
  assert(percentage >= 0 && percentage <= 100, 'Percentage must be 0-100');
  const discount = price * (percentage / 100);
  assert(discount <= price, 'Discount cannot exceed price');
  return discount;
}
```

### Layer 3: Output Validation

```typescript
function buildApiResponse(data: ProcessedData) {
  const response = serialize(data);
  // Validate response matches schema before sending
  validateSchema(response, ResponseSchema);
  return response;
}
```

### Layer 4: Monitoring

- Log unexpected states with structured data
- Set up alerts for error rate increases
- Track metrics that would indicate regression

## Key Rules

- Defense in depth is NOT a substitute for fixing the root cause
- Apply after the fix, not instead of it
- Each layer should be independent (one failing shouldn't bypass others)
- Don't over-validate — focus on the boundaries where bugs crossed
