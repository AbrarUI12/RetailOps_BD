# Portfolio demo script

The checked-in [`retailops-demo.webm`](media/retailops-demo.webm) is a silent, deterministic product tour. Record the narrated version in 2–4 minutes with this script.

## 0:00–0:25 — Product quality

- Sign in as `owner@demo.local`.
- Show the live dashboard, Dhaka business-day metrics and responsive shell.
- Open the command palette with `Ctrl/Cmd+K` and search for a product or order.

## 0:25–1:05 — Business system

- Open Products and show variants, pricing and per-branch availability.
- Open Inventory and show the immutable movement history.
- Add a product in POS, explain paisa-exact totals, split tender and the receipt.
- Briefly show the generated FastAPI/OpenAPI documentation.

## 1:05–1:50 — Flagship offline flow

1. Load POS while online, then set the browser network to offline.
2. Complete a sale and show the local receipt plus **1 pending**.
3. Reload `/pos`; point out that the app, receipt, queue and optimistic stock survived.
4. Restore the network and show **Syncing → Synced**.
5. Open Sales or Reports to show the canonical server sale and reconciled stock.

Explain that one `client_transaction_id` crosses IndexedDB, the retry queue and PostgreSQL. A lost response returns the original result instead of creating a second sale or stock movement.

## 1:50–2:25 — Bangladesh-specific operations

- Create a Facebook/manual COD order from a Bangladeshi phone number.
- Show normalized phone lookup, delivery history and explainable COD risk.
- Confirm to reserve stock, book the courier, then show its normalized timeline.
- Show an RTO/return disposition and explain why only sellable units return to stock.

## 2:25–2:50 — Engineering close

- Show Reports, the audit trail and conflict resolution in Sync Center.
- Show CI, the architecture/offline sequence diagrams and the test commands.
- Close on Docker/Render deployment and the public demo credentials.

## Reproduce the silent tour

With the seeded API on port 8000 and the frontend on port 5174:

```bash
cd frontend
npm run media:demo -- http://localhost:5174 ../docs/media
```

Set `DEMO_SCENE_MS` to change the pacing. The default recording is about 2 minutes 15 seconds.
