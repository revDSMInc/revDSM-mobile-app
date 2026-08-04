# 07 — Activity Logging (`logEvent`)

How rep actions are logged in the RevDSM sales SPA. This is *product analytics / audit logging*,
not error logging — every meaningful action (open a job builder, change a field, view a tab,
apply a filter) becomes a row in the **user activity log**, replayed later by managers as an
activity timeline per lead/rep.

---

## What it is

One function. You call it, it POSTs one row to the backend.

```js
import { logEvent } from 'src/utils/logger';

logEvent(actionType, details);
```

- **arg 1** — the verb: `'view'`, `'change'`, `'click'`, `'submit'`, `'add'`, `'navigate'`, …
- **arg 2** — an object with 4 things: `user_id`, `module_type`, `created_by`, `meta`

Defined in [src/utils/logger.js](../src/utils/logger.js) → calls `addLog()` in
[src/api/logger.js](../src/api/logger.js) → `POST /user-activity-log/v1/create`.

---

## Simplest possible example

Rep opens the pitch book, and you want a log row for it:

```js
import { logEvent } from 'src/utils/logger';
import { useAuthContext } from 'src/auth/hooks';

const { user } = useAuthContext();

logEvent('view', {
  user_id: user._id,
  module_type: 'pitch_book',
  created_by: user._id,
  meta: { page: 3 },
});
```

That's the whole call. Fire and forget — no `await` needed.

---

## What actually leaves the browser

`logEvent` does **not** send what you typed. It enriches the payload first:

```jsonc
{
  "user_id":     "665f...",
  "action_type": "view",          // ← your arg 1
  "module_type": "pitch_book",    // ← your arg 2
  "created_by":  "665f...",
  "meta": {
    "page":   3,                  // ← yours
    "leadId": "6712...",          // ← ADDED: read from localStorage.leadId
    "lat":    40.71,              // ← ADDED: only if it's 9am–7pm ET
    "long":  -74.00
  }
}
```

Only these five top-level keys are ever sent. Anything else you need must go inside `meta`.

---

## The 3 rules inside it

1. **No `user_id` → nothing is sent.** It silently returns. (Unless you pass `isPublic: true`.)
2. **`meta.leadId` fills itself in** from `localStorage.leadId` — the lead the rep is currently
   working. Skipped for 4 modules: `leads_list`, `system`, `lms`, `self_gen_lead`.
3. **`lat`/`long` attach only between 9am and 7pm America/New_York.** Outside those hours, no
   coordinates. A denied/failed GPS lookup is a `console.warn` only — the log still goes out.

---

## A second example — a field change

The most common real usage. Rep changes gutter size from 5" to 6":

```js
logEvent('change', {
  user_id: user._id,
  module_type: 'job_builder',
  created_by: user._id,
  meta: {
    fieldName: 'gutterSize',
    oldValue: '5"',
    newValue: '6"',
  },
});
```

Note there is no `leadId` in `meta` — it is injected automatically, because `job_builder` is not
in the exclusion list.

---

**See also:** [04-api-and-data.md](04-api-and-data.md) (axios & the `endpoints` map).
