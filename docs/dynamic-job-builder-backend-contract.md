# Dynamic Job Builder — Backend Config Contract (Gutter & LeafFilter)

> **Purpose.** The mobile Dynamic Job Builder is fully schema-driven: every check,
> dependency, allocation and warning is evaluated by the engine from backend config.
> This document specifies **exactly what the backend must return** so the
> Gutter/LeafFilter checks flow — with a complete, copy-pasteable example.
>
> Audience: backend + web/mobile. Engine reference (mobile):
> `src/utils/dynamic-job-builder/engine/*`. Web reference:
> `mhalt-revDSM-sales-frontend/src/components/dynamic-job-builder/engine/*`.
> Status: the mobile engine + renderer are wired to consume everything below
> (parity pass completed 2026-07-07). What remains is the backend returning
> config in this shape.

---

## 0. The two endpoints (both required — `isDynamicJobBuilderEnabled` = both)

| System | Endpoint | Drives | Mobile hook |
|---|---|---|---|
| **A — Calculator Form Schema** | `GET /calculator-form-schemas/deal-center` → `{ data: [entity, …] }` | the priced calculator; produces `dealCenterData` | `useCalculatorSchema` |
| **B — Job Builder Products config** | `GET /company/v1/job-builder-products` → `{ code: 200, data: { verticals[], products[] } }` | the job builder verticals/tabs/fields + all rules | `useDynamicCalculatorSchemas` |

If **either** returns nothing configured, the app shows a **not-configured** state
(there is no mock fallback anymore). System B is the focus of this doc; System A is
summarized in §1 because System B's `dcField` references resolve against it.

---

## 1. System A → `dealCenterData` (how `dcField` resolves)

`build-deal-center-data.ts` flattens the calculator schema + the confirmed result
into a **flat map** the engine reads. A `dcField` in System B resolves against, in
priority order:

1. a calculator field **`id`** (`field.id`), or
2. that field's legacy **`name`** / **`pricingKey`** alias, or
3. a top-level **result-outcome** key (e.g. `resultType`, `contractPrice`,
   `versatile`, `pineapple`, `downPayment`), or
4. a raw **lead** field (lowest priority).

**Consequences the backend must honor:**
- Give each gutter/leaffilter **footage** field on System A a **stable `id`** (and/or
  `name`) — these become the `dcField` keys used in System B (below we use readable
  names like `gutter6Ft1`, `versa6Ft1`, `versaMaxFt1`; use whatever ids/names you
  publish, just keep them consistent between the two schemas).
- **A footage of 0 must be emitted as an entry with value `0`** (not omitted) for the
  "hide this size" behavior to trigger — see §3.1. An *absent* key means "not entered"
  and the size shows with its fallback budget.
- The **Sale-clause** warning needs the outcome available: the result modal must put a
  key such as `resultType` (`"sale"` / `"demo"`) into `resultData`.

Footage-key vocabulary used in the examples (align these to your real ids/names):

| Category | Keys (per size / width / story) |
|---|---|
| Gutter footage | `gutter5DsE`, `gutter6Ft1`, `gutter7DsE`, `gutter8Inch`, `downspoutFootage` |
| LeafFilter footage | `versa6Ft1..3`, `versa7Ft1..3`, `filter45Ft1..3`, `versaMaxFt1` |
| Extras (locked qty) | gutter: `wedges`,`straps`,`modifyHeight`,`groundSpout`,`replaceCorner`,`extendedSplashGuard`; LF: `csr`,`cornersFilter`,`sawzallHanger`,`removeProtection`,`ribbedRoof` |
| Outcome | `resultType`, `contractPrice`, `downPayment`, … |

---

## 2. System B config shape (the object the engine walks)

```jsonc
{
  "verticals": [
    {
      "id": "gutters-roofline",
      "label": "Gutters / Roofline",
      "icon": "home", "color": "#22c55e",
      "productId": "gutters-roofline",
      "tabs": [ /* Tab objects — §3, §4 */ ]
    }
  ],
  "products": [ /* optional product/color-swatch catalog */ ]
}
```

**Tab** → `{ id, label, lockedByDefault?, dcField?, dependencies?, sections?, combinations?, fields?, isSummary?, showGrandTotalSummary? }`
**Section** → `{ id, label?, sectionType: "simple"|"combination", allowMultipleCombinations?, defaultItem?, dependencies?, warningConfig?, fields: [] }`
**Field** → `{ id, type, key, label?, unit?, required?, defaultValue?, options?, multiSelect?, palette?, colorKey?, dcField?, dcFields?, dcAggregate?, metrics?, statusMessages?, dependencies?, optionVisibility?, optionShowFields?, gridConfig?, combinationScope?, fields? }`

Field `type` ∈ `allocation, toggle, optionList, dropdown, swatch, colorSelection, text, number, locationGrid, roomPicker, sectionLabel, combinationSummary, textarea, stack, accordion`.

### 2.1 Rule groups (the unit of every check)

```jsonc
{ "match": "all" | "any",          // default "all"
  "rules": [
    { "source": "dealCenter" | "state",   // default "dealCenter"
      "field": "<dcKey or state field key>",   // OR "fields": [...]
      "fieldId": "<'field_…' id ref>",          // OR "fieldIds": [...] (state only)
      "operator": "<see below>",
      "value": <operand>,
      "allocationMetric": "used" | "available" | "remaining" }   // allocation ops only
  ] }
```

**Operators:** `truthy, falsy, gt, gte, lt, lte, eq, neq, in, notIn, exists,
anyNonZero, allNonZero, overAllocated, incompleteAllocation, perfectlyAllocated`.

**Where rule groups attach:** `field.dependencies.visibleWhen`,
`field.dependencies.requiredWhen`, `tab.dependencies.visibility.when`,
`section.dependencies.visibleWhen`, `field.optionVisibility["<opt>"]`,
`gridConfig.columns[].visibleWhen`, `warningConfig.visibleWhen`,
allocation `metric.valueSource.contributors[].when`.
`field.optionShowFields["<opt>"] = ["<fieldId>", …]` reveals fields when a
dropdown option is picked.

### 2.2 Allocation field (budget/used/remaining)

```jsonc
{
  "id": "field_alloc_6in", "type": "allocation", "key": "_alloc_6in",
  "label": "6\" K-Style Gutter", "unit": "ft",
  "metrics": [
    { "id": "avail", "label": "Avail", "role": "budget",
      "valueSource": { "type": "dealCenter", "dcFields": ["gutter6Ft1"], "dcAggregate": "sum", "fallback": 0 } },
    { "id": "used", "label": "Used", "role": "consumed",
      "valueSource": { "type": "contributors", "aggregate": "sum",
        "contributors": [
          { "scope": "combination",
            "when": { "match": "all", "rules": [ { "source": "state", "field": "size", "operator": "eq", "value": "6\"" } ] },
            "sources": [ { "fieldKey": "measurements", "aggregate": "gridTotal" } ] } ] } },
    { "id": "left", "label": "Left", "role": "balance",
      "valueSource": { "type": "computed", "formula": "subtract", "operands": ["avail", "used"] } }
  ],
  "statusMessages": { "enabled": true, "tolerance": 0.1,
    "over": "OVER {amount}{unit}", "perfect": "Perfectly allocated!", "incomplete": "{amount}{unit} remaining" }
}
```

- **Which sizes appear** is automatic: if `dealCenterData` has the `dcFields` key(s)
  and they resolve to `0`, the card is **excluded** (`isAllocationExcluded`) and its
  balance no longer gates the tab. Emit `0` footage to hide a size.
- **Legacy short form** (equivalent to the classic Avail/Used/Left) if you don't need
  custom metrics: `{ "type":"allocation", "dcFields":["gutter6Ft1"], "dcAggregate":"sum", "avail":0, "unit":"ft" }`.
- **Completion:** a visible, active allocation is complete only when
  `|remaining| ≤ tolerance` (status `success`). This is what enforces "allocation must
  net to zero."

---

## 3. GUTTER tab (complete example)

Encodes: which sizes appear, allocation balancing, size toggle limited to available
sizes, `partial` required once measured, miters/end-caps/color required once measured,
downspout required when any downspout qty entered, per-story measurement grid.

```jsonc
{
  "id": "gutter", "label": "Gutter", "lockedByDefault": false,
  "sections": [
    {
      "id": "gutter_runs", "label": "Gutter Runs", "sectionType": "combination",
      "allowMultipleCombinations": true,
      "defaultItem": { "size": "", "color": "", "measurements": null, "partial": "", "mitersOut": "", "mitersIn": "", "endCapsR": "", "endCapsL": "" },
      "fields": [
        /* one allocation card per size — auto-hides when that footage is 0 */
        { "id": "field_alloc_5in", "type": "allocation", "key": "_alloc_5in", "label": "5\" K-Style", "unit": "ft",
          "dcFields": ["gutter5DsE"], "dcAggregate": "sum",
          "metrics": [
            { "id": "avail", "role": "budget", "label": "Avail", "valueSource": { "type": "dealCenter", "dcFields": ["gutter5DsE"], "dcAggregate": "sum", "fallback": 0 } },
            { "id": "used", "role": "consumed", "label": "Used", "valueSource": { "type": "contributors", "aggregate": "sum",
              "contributors": [ { "scope": "combination", "when": { "rules": [ { "source": "state", "field": "size", "operator": "eq", "value": "5\"" } ] }, "sources": [ { "fieldKey": "measurements", "aggregate": "gridTotal" } ] } ] } },
            { "id": "left", "role": "balance", "label": "Left", "valueSource": { "type": "computed", "formula": "subtract", "operands": ["avail", "used"] } }
          ],
          "statusMessages": { "enabled": true, "tolerance": 0.1 } },
        { "id": "field_alloc_6in", "type": "allocation", "key": "_alloc_6in", "label": "6\" K-Style", "unit": "ft",
          "dcFields": ["gutter6Ft1"], "dcAggregate": "sum",
          "metrics": [
            { "id": "avail", "role": "budget", "label": "Avail", "valueSource": { "type": "dealCenter", "dcFields": ["gutter6Ft1"], "dcAggregate": "sum", "fallback": 0 } },
            { "id": "used", "role": "consumed", "label": "Used", "valueSource": { "type": "contributors", "aggregate": "sum",
              "contributors": [ { "scope": "combination", "when": { "rules": [ { "source": "state", "field": "size", "operator": "eq", "value": "6\"" } ] }, "sources": [ { "fieldKey": "measurements", "aggregate": "gridTotal" } ] } ] } },
            { "id": "left", "role": "balance", "label": "Left", "valueSource": { "type": "computed", "formula": "subtract", "operands": ["avail", "used"] } }
          ],
          "statusMessages": { "enabled": true, "tolerance": 0.1 } },

        /* SIZE — only sizes with footage are offered (optionVisibility) */
        { "id": "field_size", "type": "toggle", "key": "size", "label": "Gutter Size", "required": true,
          "options": ["5\"", "6\"", "7\"", "8\""],
          "optionVisibility": {
            "5\"": { "rules": [ { "source": "dealCenter", "field": "gutter5DsE", "operator": "anyNonZero" } ] },
            "6\"": { "rules": [ { "source": "dealCenter", "field": "gutter6Ft1", "operator": "anyNonZero" } ] },
            "7\"": { "rules": [ { "source": "dealCenter", "field": "gutter7DsE", "operator": "anyNonZero" } ] },
            "8\"": { "rules": [ { "source": "dealCenter", "field": "gutter8Inch", "operator": "anyNonZero" } ] }
          } },

        /* COLOR — required only once measurements are entered */
        { "id": "field_color", "type": "swatch", "key": "color", "label": "Color", "palette": "gutter",
          "dependencies": { "requiredWhen": { "rules": [ { "source": "state", "fieldId": "field_measurements", "operator": "anyNonZero" } ] } } },

        /* MEASUREMENTS — 6 locations × up-to-3 stories; a story column hides unless that story has footage */
        { "id": "field_measurements", "type": "locationGrid", "key": "measurements", "label": "Measurements",
          "gridConfig": { "rowHeaderLabel": "Location", "unit": "ft",
            "rows": [ {"key":"left","label":"Left Side"}, {"key":"right","label":"Right Side"}, {"key":"front","label":"Front"}, {"key":"rear","label":"Rear"}, {"key":"garage","label":"Garage"}, {"key":"other","label":"Other"} ],
            "columns": [
              { "key": "s1", "label": "1st" },
              { "key": "s2", "label": "2nd" },
              { "key": "s3", "label": "3rd", "visibleWhen": { "rules": [ { "source": "dealCenter", "field": "storyCount", "operator": "gte", "value": 3 } ] } }
            ] } },

        /* PARTIAL — required once anything is measured */
        { "id": "field_partial", "type": "toggle", "key": "partial", "label": "Gutter Partial?", "options": ["Yes", "No"],
          "dependencies": { "requiredWhen": { "rules": [ { "source": "state", "fieldId": "field_measurements", "operator": "anyNonZero" } ] } } },

        { "id": "field_miters_lbl", "type": "sectionLabel", "key": "_miters", "title": "Miters & End Caps" },
        { "id": "field_mo", "type": "number", "key": "mitersOut", "label": "# Miters (Outside)",
          "dependencies": { "requiredWhen": { "rules": [ { "source": "state", "fieldId": "field_measurements", "operator": "anyNonZero" } ] } } },
        { "id": "field_mi", "type": "number", "key": "mitersIn", "label": "# Miters (Inside)",
          "dependencies": { "requiredWhen": { "rules": [ { "source": "state", "fieldId": "field_measurements", "operator": "anyNonZero" } ] } } },
        { "id": "field_ecr", "type": "number", "key": "endCapsR", "label": "# End Caps (Right)",
          "dependencies": { "requiredWhen": { "rules": [ { "source": "state", "fieldId": "field_measurements", "operator": "anyNonZero" } ] } } },
        { "id": "field_ecl", "type": "number", "key": "endCapsL", "label": "# End Caps (Left)",
          "dependencies": { "requiredWhen": { "rules": [ { "source": "state", "fieldId": "field_measurements", "operator": "anyNonZero" } ] } } }
      ]
    },

    /* DOWNSPOUTS — type + color required only when any downspout quantity > 0 */
    {
      "id": "downspouts", "label": "Downspouts & Accessories", "sectionType": "combination",
      "allowMultipleCombinations": true,
      "defaultItem": { "dsType": "", "dsColor": "", "footage": "", "aElbows": "", "bElbows": "" },
      "fields": [
        { "id": "field_ds_type", "type": "toggle", "key": "dsType", "label": "Downspout Type", "options": ["2x3", "3x4", "4x5"],
          "dependencies": { "requiredWhen": { "rules": [ { "source": "state", "fields": ["footage","aElbows","bElbows"], "operator": "anyNonZero" } ] } } },
        { "id": "field_ds_color", "type": "swatch", "key": "dsColor", "label": "Color", "palette": "gutter",
          "dependencies": { "requiredWhen": { "rules": [ { "source": "state", "fields": ["footage","aElbows","bElbows"], "operator": "anyNonZero" } ] } } },
        { "id": "field_ds_ft", "type": "number", "key": "footage", "label": "Footage" },
        { "id": "field_ds_a", "type": "number", "key": "aElbows", "label": "A Elbows" },
        { "id": "field_ds_b", "type": "number", "key": "bElbows", "label": "B Elbows" }
      ]
    },

    /* EXTRAS — locked qty from Deal Center; color required only when qty > 0 */
    {
      "id": "gutter_extras", "label": "Extras", "sectionType": "simple",
      "fields": [
        { "id": "field_replace_corner", "type": "number", "key": "replaceCorner", "label": "Replace Corner", "locked": true, "dcField": "replaceCorner", "defaultValue": 0 },
        { "id": "field_replace_corner_color", "type": "swatch", "key": "replaceCornerColor", "label": "Replace Corner Color", "palette": "gutter",
          "dependencies": {
            "visibleWhen":  { "rules": [ { "source": "dealCenter", "field": "replaceCorner", "operator": "gt", "value": 0 } ] },
            "requiredWhen": { "rules": [ { "source": "dealCenter", "field": "replaceCorner", "operator": "gt", "value": 0 } ] } } }
      ]
    }
  ]
}
```

---

## 4. LEAFFILTER tab (complete example)

Encodes: allocation per width + Versa Max separate, **Versa ↔ Versa Max mutual
exclusivity**, **4 & 5″ → exact-size reveal**, required profile/color, and the
**`< 2.5″` + Versa Max + Sale** clause warning.

```jsonc
{
  "id": "leaffilter", "label": "LeafFilter", "lockedByDefault": false,
  "sections": [
    {
      "id": "lf_runs", "label": "Guard Runs", "sectionType": "combination",
      "allowMultipleCombinations": true,
      "defaultItem": { "gutterOpeningWidth": "", "lfProfile": "", "gutterProfile": "", "lfColor": "", "exactSize": "", "measurements": null },
      "fields": [
        /* allocation per Versa width (sum of its 3 story footages) */
        { "id": "field_alloc_v6", "type": "allocation", "key": "_alloc_v6", "label": "Versa 6\"", "unit": "ft",
          "dcFields": ["versa6Ft1","versa6Ft2","versa6Ft3"], "dcAggregate": "sum",
          "metrics": [
            { "id": "avail", "role": "budget", "label": "Avail", "valueSource": { "type": "dealCenter", "dcFields": ["versa6Ft1","versa6Ft2","versa6Ft3"], "dcAggregate": "sum", "fallback": 0 } },
            { "id": "used", "role": "consumed", "label": "Used", "valueSource": { "type": "contributors", "aggregate": "sum",
              "contributors": [ { "scope": "combination",
                "when": { "match": "all", "rules": [ { "source": "state", "field": "lfProfile", "operator": "eq", "value": "Versa" }, { "source": "state", "field": "gutterOpeningWidth", "operator": "eq", "value": "6\"" } ] },
                "sources": [ { "fieldKey": "measurements", "aggregate": "gridTotal" } ] } ] } },
            { "id": "left", "role": "balance", "label": "Left", "valueSource": { "type": "computed", "formula": "subtract", "operands": ["avail", "used"] } }
          ],
          "statusMessages": { "enabled": true, "tolerance": 0.1 } },
        /* Versa Max allocation — separate budget */
        { "id": "field_alloc_vmax", "type": "allocation", "key": "_alloc_vmax", "label": "Versa Max", "unit": "ft",
          "dcFields": ["versaMaxFt1"], "dcAggregate": "sum",
          "metrics": [
            { "id": "avail", "role": "budget", "label": "Avail", "valueSource": { "type": "dealCenter", "dcFields": ["versaMaxFt1"], "dcAggregate": "sum", "fallback": 0 } },
            { "id": "used", "role": "consumed", "label": "Used", "valueSource": { "type": "contributors", "aggregate": "sum",
              "contributors": [ { "scope": "combination", "when": { "rules": [ { "source": "state", "field": "lfProfile", "operator": "eq", "value": "Versa Max" } ] }, "sources": [ { "fieldKey": "measurements", "aggregate": "gridTotal" } ] } ] } },
            { "id": "left", "role": "balance", "label": "Left", "valueSource": { "type": "computed", "formula": "subtract", "operands": ["avail", "used"] } }
          ],
          "statusMessages": { "enabled": true, "tolerance": 0.1 } },

        /* PROFILE — Versa vs Versa Max, each shown only when its footage exists (mutual exclusivity by availability) */
        { "id": "field_lf_profile", "type": "toggle", "key": "lfProfile", "label": "LeafFilter Profile", "required": true,
          "options": ["Versa", "Versa Max"],
          "optionVisibility": {
            "Versa":     { "rules": [ { "source": "dealCenter", "fields": ["versa6Ft1","versa7Ft1","filter45Ft1"], "operator": "anyNonZero" } ] },
            "Versa Max": { "rules": [ { "source": "dealCenter", "field": "versaMaxFt1", "operator": "anyNonZero" } ] }
          } },

        /* WIDTH — a dropdown so we can use optionShowFields to reveal exact-size for "4 & 5\"" */
        { "id": "field_width", "type": "dropdown", "key": "gutterOpeningWidth", "label": "Gutter Opening Width", "required": true,
          "options": ["6\"", "7\"", "4 & 5\""],
          "optionVisibility": {
            "6\"":     { "rules": [ { "source": "dealCenter", "field": "versa6Ft1", "operator": "anyNonZero" } ] },
            "7\"":     { "rules": [ { "source": "dealCenter", "field": "versa7Ft1", "operator": "anyNonZero" } ] },
            "4 & 5\"": { "rules": [ { "source": "dealCenter", "field": "filter45Ft1", "operator": "anyNonZero" } ] }
          },
          "optionShowFields": { "4 & 5\"": ["field_exact_size"] } },
        { "id": "field_exact_size", "type": "dropdown", "key": "exactSize", "label": "Exact Size", "options": ["4\"", "5\""], "required": true },

        { "id": "field_gutter_profile", "type": "toggle", "key": "gutterProfile", "label": "Existing Gutter Profile", "required": true,
          "options": ["K-Style", "Half-Round", "Fascia"] },
        { "id": "field_lf_color", "type": "swatch", "key": "lfColor", "label": "LeafFilter Color", "palette": "leaffilter", "required": true },

        { "id": "field_lf_meas", "type": "locationGrid", "key": "measurements", "label": "Measurements",
          "gridConfig": { "rowHeaderLabel": "Location", "unit": "ft",
            "rows": [ {"key":"left","label":"Left Side"}, {"key":"right","label":"Right Side"}, {"key":"front","label":"Front"}, {"key":"rear","label":"Rear"}, {"key":"garage","label":"Garage"}, {"key":"other","label":"Other"} ],
            "columns": [ {"key":"s1","label":"1st"}, {"key":"s2","label":"2nd"}, {"key":"s3","label":"3rd"} ] } },

        /* Business-rule warning — blocks completion + shows banner when
           width < 2.5, profile is Versa Max, and the deal outcome is a Sale. */
        { "id": "field_clause_note", "type": "stack", "key": "_clause", "fields": [],
          "warningConfig": {
            "enabled": true,
            "message": "Ensure the Agreement has the Special Can't-Guarantee Cleaning/Sealing Clause.",
            "color": "#f59e0b",
            "visibleWhen": { "match": "all", "rules": [
              { "source": "state", "field": "gutterOpeningWidth", "operator": "eq", "value": "< 2.5" },
              { "source": "state", "field": "lfProfile", "operator": "eq", "value": "Versa Max" },
              { "source": "dealCenter", "field": "resultType", "operator": "eq", "value": "sale" }
            ] } } }
      ]
    }
  ]
}
```

---

## 5. What makes a tab "complete" (engine gating, for QA)

`isTabComplete` (mobile `engine/tab-validation.ts`, web parity) marks a tab complete
only when **all** hold, for every **visible** section/field:
1. every **required & visible** field has a non-empty value (`requiredWhen`/`required`,
   respecting `visibleWhen`; a `locationGrid` needs total > 0; toggles with **all**
   options hidden are skipped);
2. every **visible, active** allocation is within tolerance (status `success`);
3. no active `warningConfig` (`visibleWhen` true) on a section / stack / accordion.
Summary tabs are always complete. Hidden sections/fields don't gate.

---

## 6. Backend checklist

- [ ] `GET /calculator-form-schemas/deal-center` returns configured gutter/leaffilter
      categories whose fields carry stable `id` (+ `name`) and `price{cost,par,retail}`.
- [ ] Footage entries are emitted with numeric values **including `0`** (so unavailable
      sizes hide via allocation exclusion).
- [ ] The result modal puts `resultType` (`"sale"`/`"demo"`) into `resultData`.
- [ ] `GET /company/v1/job-builder-products` returns `{ code: 200, data: { verticals } }`
      with the Gutter/LeafFilter tabs shaped as §3/§4, `dcField`s matching the System-A
      ids/names, and a `storyCount` (or equivalent) dcKey if you gate story columns.
- [ ] Rule `value` types match operands (numbers for `gt/gte/lt/lte`; exact strings for
      `eq`/`in` — mind escaped quotes like `"6\""`).
