# Root Cause Tracing

Trace bugs backward through the call stack to find the original trigger.

## The Technique

When you find a bad value deep in the code, don't fix it there. Trace backward:

```
WHERE does the bad value appear?
    ↓
WHAT called this function with the bad value?
    ↓
WHERE did the caller get that value?
    ↓
WHAT set that value incorrectly?
    ↓
(Keep going until you find the SOURCE)
```

## Step-by-Step

1. **Identify the symptom** — what is wrong and where do you see it?
2. **Find the immediate cause** — what variable/state has the wrong value?
3. **Trace one level up** — who set that variable? Who called this function?
4. **Repeat** until you find the original source of the wrong data
5. **Fix at the source** — not at the symptom location

## Example

```
Symptom: User sees "undefined" in their profile name

Step 1: Profile component renders user.name which is undefined
Step 2: user object comes from useUser() hook
Step 3: useUser() gets data from /api/user endpoint
Step 4: API returns { name: null } when user hasn't set name
Step 5: Root cause — API returns null, but component expects string

Fix: Handle null in API response (not suppress in component)
```

## Key Rules

- **Never fix at the symptom** — the symptom is just where you noticed the problem
- **Keep tracing** — if you haven't found the source, you haven't found the root cause
- **One hop at a time** — don't skip levels in the call stack
- **Document the trace** — write down each hop so you don't lose your place
- **Fix once, at the source** — a source fix prevents all downstream symptoms
