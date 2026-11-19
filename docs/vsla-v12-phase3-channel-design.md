# VSLA v1.2 Phase 3: USSD and SMS channel design

This is a design boundary only. BOAT must not send SMS, open a USSD session, store a telecom credential, or call a provider until a group has selected an approved provider and an authorized deployment change is made.

## Channel roles

| Need | USSD | SMS |
| --- | --- | --- |
| Member balance or meeting reminder | Opt-in, PIN-protected read-only enquiry | Opt-in notification with no balance or sensitive personal data |
| Collection acknowledgement | Never a source of truth; show a receipt reference only after the server posts it | Send only after the financial event is posted; include amount only where the member has opted in |
| Loan request | Capture an intent only; the server creates a draft and applies the normal approval policy | Not supported through free text |
| Offline collection | Not supported | Not supported |

## Required server boundary before activation

1. A provider adapter must accept a provider event ID and map it to a BOAT idempotency key. Duplicate callbacks must be harmless.
2. Every financial action must call the existing v1.2 server-side controls. A text message, USSD request, or provider callback must never write ledger tables directly.
3. USSD requires a member PIN with rate limiting, lockout, and audited reset. Never expose another member's records.
4. SMS delivery events must be write-only audit records. Phone numbers and provider tokens must use the platform's protected secret/configuration store, never browser storage.
5. Provider webhooks require signature verification, replay protection, a timestamp window, and a dead-letter/review queue.
6. Any failed or ambiguous callback remains pending for staff review; it must not be treated as a posted collection.

## Data minimisation

- SMS must not include full balances, loan details, national IDs, or member lists by default.
- Use a receipt/reference and a short action label; send monetary amounts only after explicit member consent and local policy approval.
- Retain provider payloads only for the approved audit period, redacting credentials and PINs.

## Rollout sequence

1. Approve a provider and country-specific consent/retention rules.
2. Add a provider sandbox adapter and contract tests for retries, duplicate delivery, invalid signatures, and delayed callbacks.
3. Pilot read-only reminders and statements with a small consenting group.
4. Enable confirmations only after delivery, audit, and opt-out controls are accepted.
5. Consider USSD transaction intents only after the pilot has demonstrated that server-side approval and reconciliation controls remain effective.
