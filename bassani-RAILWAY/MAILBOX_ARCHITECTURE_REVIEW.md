# Mailbox Synchronisation Architecture Review

**Scope:** Phase 11 (Mailbox Integration) — `graph_client.py`, `graph_subscription.py`, `imap_client.py`, `inbox_service.py`, `inbox_routes.py`, `onboarding_inbox_routes.py`, `orders_inbox_routes.py`, and the startup wiring in `server.py`.
**Date:** 2026-08-04
**Reviewed against:** current code, not the original 11.0–11.6 spec in `PRODUCTION_ROADMAP.md` (the implementation has diverged from and in most places exceeded that spec).

## Calibration note

The review brief benchmarks this against Dynamics 365 / SAP / NetSuite / Salesforce at "thousands of tenants, millions of emails, multiple M365 tenants, high availability." That is not what this system is or needs to become: it's a **single-tenant B2B portal for one distributor, on Railway, syncing three shared mailboxes at human-scale volume** (tens to low hundreds of messages/day per mailbox). Applying multi-tenant SaaS patterns (Kafka, per-tenant sharding, distributed workers) here would be pure over-engineering — it contradicts the project's own standing rule against designing for hypothetical future requirements, and Rule 10 (no new external services without an explicit decision).

So this review does two things: it calls out real defects and real risk at your actual scale, and it separates "genuinely worth doing" from "correct for a platform 100x this size, wrong for you." Where a recommendation only makes sense at SaaS scale, it's labelled as such rather than presented as a gap.

---

## 1. Executive Summary

The Graph + IMAP dual-backend design is a genuinely good architectural call for this business — no DNS changes required to start, a working fallback path while blocked on Azure credentials, and now that credentials exist, push-based Graph delivery with IMAP kept live as a safety net. The multi-mailbox generalisation (`inbox_service.py`, parameterised by `collection`/`mailbox` slug) done in 11.C is the right shape: one ingest pipeline, three mailboxes, no per-mailbox fork.

The problem is that generalisation didn't fully happen. **The original Sales Inbox (`inbox_routes.py`) still runs a hand-rolled, pre-11.C copy of the ingest logic that was never migrated to the shared service**, and it carries a thread-grouping bug that the shared service already fixed for the other two mailboxes five weeks ago (11.4.3, 2026-07-05). This is very likely the direct cause of the "some emails don't sync correctly" symptom that prompted this review — see Critical Issues, #1.

Beyond that, the system is missing the two things every production Graph mail integration eventually needs and doesn't have yet: **encryption at rest for the mailbox credentials it stores** (Client Secret and IMAP/SMTP passwords sit in MongoDB as plaintext strings), and **a self-healing story for Graph subscription failure** (renewal failure is a log line, not an alert, and the only Graph reconciliation sweep runs once at process startup — there is no ongoing periodic catch-up for Graph the way IMAP gets one every 60 seconds).

Neither of these needs an enterprise-scale answer. Both are small, contained fixes.

## 2. Overall Architecture Rating: 6.5/10

Strong foundational choices (dual backend, shared ingest service, R2 offload for attachments, idempotent dedup indexes, staggered catch-up to avoid 429 storms, correct STARTTLS/SSL branching for SMTP). Held down by: one mailbox route not actually using the shared service it was supposed to migrate to, plaintext secrets at rest, no periodic Graph reconciliation, and zero automated test coverage on any of this code. Fixing the first two items alone would move this to 8/10 for a system at this scale.

## 3. Comparison Against Enterprise ERP Systems

| Capability | Dynamics/Salesforce/NetSuite | Bassani Portal | Gap severity here |
|---|---|---|---|
| Delta query sync | Yes (`/delta` with `$deltatoken`) | No — full re-fetch of a 72h window on catch-up | Low at this volume; see §9 |
| Change notifications (webhook) | Yes | Yes, per-mailbox, `clientState` verified | Matches |
| Rich/lifecycle notifications | Yes (subscription-expiring reminders) | No — silent renewal, no expiry-warning webhook | Medium |
| Batch requests (`$batch`) | Yes | No — every Graph call is its own HTTP round trip | Low at this volume; see §9 |
| Distributed worker pool / queue | Yes (Celery/SQS/Service Bus equivalent) | `asyncio.create_task` in-process loops | Correct choice at this scale, wrong at SaaS scale — see calibration note |
| Multi-tenant mailbox isolation | Yes | N/A — single tenant by design | Not applicable |
| Full-text search over mail | Yes (dedicated search index) | Mongo `$regex` over 3 fields | Fine at hundreds of messages; won't scale past low thousands |
| Conversation/thread reconstruction | Yes, robust | Yes for two of three mailboxes; the third has a known bug (see §4) | High — active correctness bug |
| Secrets management | Vault/KMS-backed | Plaintext in MongoDB | High |
| E2E test coverage on mail sync | Yes | None found | Medium-high |

## 4. Critical Issues

### 4.1 Sales Inbox runs stale, duplicated ingest logic — likely root cause of your sync bug

`inbox_routes.py` lines 134–393 define local `_ingest_message`/`_ingest_imap_message` functions that predate the `inbox_service.py` extraction (11.C, 2026-07-05). `orders_inbox_routes.py` and `onboarding_inbox_routes.py` both correctly import and call `inbox_service.ingest_graph_message`/`ingest_imap_message`. Sales Inbox does not — it still calls its own copies.

The bug: `inbox_routes.py:210-215` matches thread ancestors with `{"graph_conversation_id": conv_id, "is_reply": False}` — only the original root. `inbox_service.py:168-173` was fixed in 11.4.3 to match *any* prior message in the conversation, specifically because Graph delivers webhook notifications with no ordering guarantee, so the "root" can arrive after a reply. The old logic silently creates a second, orphaned thread whenever that race occurs — which reads externally as "this email didn't sync" or "this reply is missing."

**Fix:** delete the duplicate functions in `inbox_routes.py`; route its webhook handler, `/poll`, and any other callers through `inbox_service.ingest_graph_message` / `ingest_imap_message`, exactly as the other two mailboxes already do. This also removes ~250 lines of duplicated code. Low risk, high value — do this first.

### 4.2 Mailbox credentials stored in plaintext at rest

`settings_routes.py` stores `ms_client_secret`, `imap_password`, and `smtp_password` as plain strings in `portal_settings` (lines 233-243, 293-300). They're redacted (`••••••••`) on `GET` responses, which protects against accidental exposure in the UI/API, but the values sitting in the database are not encrypted — anyone with MongoDB access (a backup file, a misconfigured connection string, a compromised admin session) reads the Azure Client Secret and mailbox passwords in clear text. This is out of step with Annex 11-style expectations you've already committed to elsewhere in this codebase (Phase 13 e-signature work) and with basic secrets hygiene for anything holding an OAuth2 client secret.

**Fix:** encrypt these three-to-five fields at the field level before write (Fernet/AES-GCM with a key from a Railway env var, e.g. `SETTINGS_ENCRYPTION_KEY`), decrypt only in `imap_client.load_config_from_db`/`graph_client.set_runtime_credentials`. This is a contained change — one helper module, called at the two or three write/read sites in `settings_routes.py`. Not a KMS/Vault integration; that would be over-engineering for one encryption key on one Railway service.

### 4.3 No ongoing reconciliation sweep for Graph — only IMAP gets one

IMAP mailboxes get a permanent 60-second poll loop (`server.py:449-480`) that re-fetches the 72-hour window every cycle, so even a total ingest failure self-heals within a minute. Graph mailboxes get exactly one reconciliation: the startup catch-up (`server.py:410-432`), which runs once per deploy. After that, Graph relies entirely on the webhook subscription staying alive and the (silent) 12-hour renewal loop succeeding.

If `ensure_subscription` fails silently for long enough that the subscription lapses (`graph_subscription.py:150-159` — the only visible symptom is `logger.error("graph_subscription_create_failed...")`), Graph mail simply stops arriving until someone notices the inbox has gone quiet and manually calls `POST /api/inbox/poll`, or the server redeploys. There's no periodic Graph-side safety net analogous to IMAP's.

**Fix:** add a low-frequency (e.g. every 30–60 min) Graph reconciliation poll alongside the renewal loop — same `_graph_catchup_filter()` window, same staggered-ingest pattern already written for startup. This is cheap (one Graph list call per mailbox per cycle) and closes the actual reliability gap without needing lifecycle-notification webhooks.

## 5. High-Priority Improvements

- **Alert on subscription renewal/creation failure.** Right now it's `logger.error(...)` and nothing else. Given Phase 6 (Observability, Sentry) is already live, this should be a first-class Sentry capture with mailbox context, not a log line hoping someone reads it.
- **Zero test coverage.** No test file exists for `graph_client.py`, `imap_client.py`, or `inbox_service.py` (only `backend/test_odoo.py` exists anywhere in the backend, and it's unrelated). The ingest and thread-matching logic is exactly the kind of thing that regresses silently (as §4.1 demonstrates) — a handful of unit tests against `inbox_service.ingest_graph_message`/`ingest_imap_message` with mocked Graph/IMAP responses covering out-of-order delivery, duplicate delivery, and reply-before-root would have caught 4.1 outright.
- **Global Graph credential/token singleton assumes one Azure app registration for all shared mailboxes.** `graph_client.py`'s `_runtime_creds`/`_token_cache` are module-level globals, not keyed per mailbox. That's fine as long as one Azure app registration (with Mail.Read/Mail.Send application permissions) covers `sales@`/`orders@`/onboarding's shared mailbox, which the design implies. If a future mailbox needs a *different* tenant or app registration, this breaks silently (last `load_config_from_db` call wins). Worth a one-line comment now, and a keyed-by-mailbox refactor only if that need actually arises.
- **`asyncio.create_task` background loops have no supervision.** If `_imap_poll_loop`, `_graph_renewal_loop`, or the delayed-subscription task ever raises outside its own try/except (e.g. a bug in the exception handler itself), the task dies and nothing restarts it or reports it — the process looks healthy while a background loop is silently gone. A lightweight watchdog (a periodic check that logs "loop alive" and a Sentry alert if a heartbeat timestamp goes stale) is proportionate here; a full task-supervisor framework is not.

## 6. Medium-Priority Improvements

- **In-process poll lock (`_poll_running[0]`) isn't distributed.** Fine on a single Railway instance (the current deployment). If this service ever runs 2+ replicas, both would poll independently and could double-ingest — the unique `imap_message_id`/`graph_message_id` index prevents duplicate *storage*, but you'd get duplicate mark-as-read races and duplicate attachment R2 writes. Not worth fixing pre-emptively; worth a one-line note in `server.py` so a future "let's scale to 2 dynos" decision doesn't silently reintroduce this.
- **`$regex` search (`inbox_routes.py:538-545`) doesn't search `body_html`, only preview/subject/from.** Reasonable trade-off today; will feel like a missing feature once threads run long.
- **Attachment storage is genuinely split by design** (Graph → R2 eager, IMAP → capped Mongo BSON Binary) — this is documented as deliberate in `CLAUDE.md` with a known follow-up (TTL index for IMAP attachments post-archive). Not new, just flagging it's still open.
- **No structured metrics on ingest throughput/failure rate** — you have logs, but nothing counts "messages ingested/hour" or "Graph fetch failures/hour" as a queryable metric. At current volume this is a nice-to-have, not urgent.

## 7. Low-Priority Improvements

- `graph_client.py`'s `_with_retry` only retries on 429; a transient 503/504 from Graph is not retried at all — one bad network blip loses that particular fetch until the next catch-up cycle picks it up. Cheap to extend the retry predicate.
- No use of Graph's immutable ID header (`Prefer: IdType="ImmutableId"`). Irrelevant unless messages get moved between folders by an Outlook rule, which would change the message ID under the default (non-immutable) scheme. Worth adding only if folder-move behavior is ever observed.
- `send_reply`/`send_mail` always send as `"Bassani Health"` display name — fine for a single shared identity; not worth parameterising until there's a reason to.

## 8. Industry Best Practices You're Missing (and which ones matter here)

| Practice | Matters at your scale? |
|---|---|
| Delta query instead of windowed re-fetch | No — 72h window re-fetch of a few dozen messages is negligible cost |
| `$batch` requests | No — call volume is far below where round-trip overhead matters |
| Full-text search index (Elastic/Atlas Search) | Not yet — revisit if a single mailbox thread count crosses ~5-10k |
| Dead-letter queue for failed ingests | Partially — the reconciliation-sweep fix in §4.3 covers this without needing a formal DLQ |
| Encrypted secrets at rest | **Yes — do this** (§4.2) |
| Automated test coverage on sync logic | **Yes — do this** (§5) |
| Distributed locking for polling | No — single instance today |

## 9. Microsoft Graph Best Practices You're Missing

- **Delta queries** (`GET /users/{mailbox}/mailFolders/inbox/messages/delta`) would replace the windowed `receivedDateTime ge {cutoff}` re-fetch with a token-based incremental sync. At your message volume this buys you nothing measurable — the current approach already avoids re-processing via the unique dedup index, so the "cost" of the non-delta approach is a handful of extra Graph API calls per catch-up cycle, well within any throttling budget.
- **Lifecycle notifications** (`lifecycleNotificationUrl` on the subscription, listening for `reauthorizationRequired`/`subscriptionRemoved`) would replace the 12-hour blind-renewal loop with an event telling you exactly when Graph is about to drop the subscription. This is a genuinely good upgrade and pairs naturally with the §4.3 fix — but the periodic-reconciliation fix in §4.3 gets you most of the reliability win without adding a second webhook endpoint to build and secure.
- **`$batch`** for the "fetch message + list attachments + fetch each attachment" sequence in `ingest_graph_message` (currently 2-4 sequential HTTP calls per message) would cut latency and API call count. Worth doing opportunistically, not urgently.
- You're already doing the important things right: `Prefer` for immutable-ish behaviour isn't used but isn't needed yet, `clientState` validation on the webhook is correctly implemented (`inbox_routes.py:421-434`, and equivalently in the other two route files) — this is the correct Graph-recommended anti-spoofing mechanism (Graph doesn't cryptographically sign notifications; `clientState` matching is the documented pattern), 429 handling honours `Retry-After`, and the validation-token handshake is handled correctly.

## 10. Recommended Architectural Changes

In priority order:
1. Migrate `inbox_routes.py` onto `inbox_service.py` (§4.1) — removes the active bug and ~250 lines of dead-weight duplication.
2. Field-level encryption for stored credentials (§4.2).
3. Periodic Graph reconciliation sweep, mirroring the existing IMAP 60s loop (§4.3).
4. Sentry-backed alerting on subscription failure (§5).
5. A small `tests/test_inbox_service.py` covering the thread-matching edge cases that caused §4.1, so this class of bug can't reappear unnoticed.

Nothing here requires a queue, a worker fleet, or a schema rewrite. That's a feature of the current design, not a gap.

## 11. Suggested Folder/Project Structure Improvements

Current structure is already reasonable (`services/graph_client.py`, `services/graph_subscription.py`, `services/imap_client.py`, `services/inbox_service.py`, three thin `routes/*_inbox_routes.py` files). The only structural fix needed is behavioral, not organizational: making `inbox_routes.py` actually use `inbox_service.py` (it already imports `resolve_customer` from it — it just never migrated the two ingest functions). No new modules or directories are warranted at this scale.

## 12. Suggested Database Improvements

The existing indexes (`server.py:_make_inbox_indexes`) are well chosen: unique+sparse on both `graph_message_id` and `imap_message_id`, compound indexes on `(status, received_at)` and `(thread_root_id, status)`, TTL on `expires_at` for archived threads. Two additions worth making:
- A text index (`from_email`, `subject`, `body_preview`) to replace the `$regex` scan in `list_inbox` once thread counts grow — not urgent today.
- None of the three inbox collections currently need sharding, capped collections, or a separate mail-store service. Don't add any of that pre-emptively.

## 13. Suggested Synchronisation Workflow (target state)

```
Graph webhook  ──┐
                 ├─→ ingest_graph_message() [inbox_service.py] ─┐
Graph reconcile ─┘  (idempotent on graph_message_id)            │
   (new, §4.3)                                                  ├─→ MongoDB (dedup index)
IMAP 60s poll  ────→ ingest_imap_message() [inbox_service.py] ──┘        │
                     (idempotent on imap_message_id)                     │
                                                                          ▼
                                                          thread-grouped aggregation
                                                          (build_list_pipeline)
```

All three mailboxes already share the aggregation and read-state logic. The only missing arrow is the Graph reconciliation branch, and the only wrong arrow is Sales Inbox currently bypassing `inbox_service.py` entirely.

## 14. Suggested Retry Strategy

- Graph 429 → already correct (honours `Retry-After`, capped retries).
- Graph 5xx/network errors → currently unretried; add exponential backoff (e.g. 3 attempts, 1s/3s/9s) alongside the existing 429 path in `_with_retry`.
- IMAP transient drops (`imaplib.IMAP4.abort`) → already handled correctly as a warning-level, self-healing case (next 60s cycle reconnects).
- Failed single-message ingest (e.g. Graph 404 on fetch) → correctly treated as terminal/non-actionable already (`inbox_routes.py:148-155`, mirrored logic needed in the migrated version).

No dead-letter table is needed at this volume — the reconciliation sweep (§4.3) plus existing dedup indexes give you the same safety net a DLQ would, without the extra infrastructure.

## 15. Suggested Monitoring and Logging Strategy

- Promote subscription create/renew failures from `logger.error` to an explicit Sentry capture with mailbox slug as a tag — this is a one-line change (`sentry_sdk.capture_message` or letting the existing logging integration pick up ERROR-level logs, if that's how Sentry is wired elsewhere in this codebase).
- Add a simple `/api/monitor/data`-style counter for "last successful ingest per mailbox" — you already have `OrderMonitor.js`/`monitor_routes.py` as a working pattern for this kind of ops-visible metric; extending it to mailbox health is a natural, in-house fit rather than a new observability stack.
- No APM/distributed tracing needed at this scale.

## 16. Suggested Production Deployment Architecture

Current: single Railway service running FastAPI with in-process `asyncio` background tasks. **This is the right architecture for this workload.** The only real deployment-shape risk is the §6 note about horizontal scaling (multiple replicas would double-poll) — if Railway autoscaling or a manual scale-out to 2+ instances is ever on the table, that's the point to revisit the poll-lock design (e.g. a Mongo-based lease/lock document), not before.

## 17. Roadmap From Current State to "Enterprise-Grade at Your Actual Scale"

| Step | Effort | Depends on |
|---|---|---|
| 1. Migrate Sales Inbox onto `inbox_service.py` | Small (a few hours) | Nothing — do first |
| 2. Encrypt stored mailbox credentials | Small | A `SETTINGS_ENCRYPTION_KEY` Railway env var |
| 3. Graph periodic reconciliation sweep | Small | Step 1 (reuses the same ingest call) |
| 4. Sentry alerting on subscription failure | Small | Existing Sentry setup |
| 5. Unit tests for `inbox_service.py` thread-matching | Medium | Steps 1–3 stable |
| 6. Graph lifecycle notifications (replaces blind 12h renewal) | Medium | Step 3 in place as a safety net first |
| 7. `$batch` for message+attachment fetch | Medium, opportunistic | None |
| 8. Full-text search index | Only if thread volume crosses ~5-10k | None |
| 9. Distributed poll locking | Only if horizontally scaled | A decision to run 2+ replicas |

Steps 1–4 are the real work. Everything after that is scale-triggered, not scale-anticipated.
