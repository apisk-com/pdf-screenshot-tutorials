# Release notes 2.4

This release adds a CSV export and fixes two bugs in the import step. ✅

## Changes

| Area | Change | Ticket |
|---|---|---|
| Export | New CSV export for reports | OPS-112 |
| Import | Dates in `DD.MM.YYYY` format work again | OPS-118 |
| API | `GET /reports/:id` returns 404 for a deleted report, not 500 | OPS-121 |

## Upgrade

Run the migration before you start the new version:

```bash
npm run migrate -- --to 2.4 && npm start
```

The export uses the same filter object as the report list:

```js
const csv = await exportReport({ from: '2026-11-01', to: '2026-11-30', format: 'csv' });
```

> The old `/export` route stays available until version 3.0.

## Known issues

- Exports with more than 100,000 rows can take more than one minute.
- The PDF export does not print charts yet. 📊
