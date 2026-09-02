# Coverage Heuristics by Feature Type

Condition checklists that formal techniques miss. Identify which patterns the
feature contains, then apply every matching checklist. A feature usually matches
three or four.

---

## Forms and Data Entry

- Submit empty; submit with only required fields; submit fully populated.
- Each required field omitted individually.
- Validation timing: on blur, on change, or on submit? Consistent across fields?
- Error messages: specific to the field, attached to the field, cleared when fixed.
- Focus moves to the first error on failed submit.
- Whitespace trimming; case handling; special characters preserved on save.
- Paste into every field (including paste with formatting from a document).
- Autofill / password manager interaction.
- Double-click submit - one record or two?
- Submit while offline; submit then lose connection before the response.
- Navigate away with unsaved changes - warning shown?
- Refresh after successful submit - does it re-submit?
- Values round-trip: save, reload, and confirm every field shows what was saved.
- Cancel restores the original values and does not persist a partial edit.
- Character counters match the actual enforced limit.
- Disabled/read-only fields cannot be edited via devtools and are not accepted
  by the API if modified.

## Authentication and Sessions

- Valid login; wrong password; nonexistent user; correct password wrong case.
- Error message does not reveal whether the account exists.
- Rate limiting / lockout after N failures; lockout duration; unlock path.
- Password reset: valid token, expired token, already-used token, token for a
  different user; reset invalidates existing sessions.
- Session expiry mid-action; "remember me" duration; logout in one tab affects
  other tabs.
- Deep link while logged out redirects to login, then back to the target.
- Deactivated or deleted user with a still-valid session token.
- Role change while logged in - do permissions update without re-login?
- MFA: correct code, expired code, reused code, backup codes.
- Concurrent sessions on multiple devices.

## Lists, Tables, and Pagination

- Empty state: no records ever; all records filtered out (different messages).
- One record; exactly one page; exactly one page + one record; many pages.
- Sort each column ascending and descending; sort stability; sort with nulls;
  sort persists across pagination.
- Filter combinations; filters cleared; filter + sort + search together.
- Filter/sort/page state preserved on back navigation and on refresh.
- Deleting the last item on the last page - does pagination handle it?
- A record modified by another user while the list is open.
- Long values: truncation, wrapping, tooltips showing the full value.
- Bulk select: select all on page vs select all matching filter; act on a
  selection that includes an item the user cannot modify.
- Row counts match the actual number of records and the exported file.

## Search

- Exact match; partial match; no results; single result.
- Case insensitivity; accented characters; leading/trailing spaces.
- Special characters and operators in the query (`"`, `*`, `-`, `AND`).
- Very long query; single character; empty query.
- Results respect permissions - a user must not find records they cannot open.
- Debounce behavior: rapid typing does not produce stale results.
- Result ranking is sensible for the obvious query.
- Search across a field that was just updated (index freshness).

## File Upload and Download

- Allowed types accepted; disallowed types rejected with a clear message.
- Correct extension, wrong content (a `.exe` renamed to `.pdf`).
- Zero-byte file; file at the size limit; file one byte over.
- Very long filename; unicode filename; filename with spaces and symbols.
- Multiple files at once; drag-and-drop as well as the file picker.
- Cancel mid-upload; lose connection mid-upload; upload then delete immediately.
- Progress indicator accuracy; the UI during a slow upload.
- Downloaded file opens, has the right name, and matches what was uploaded.
- Uploaded file is not publicly accessible by guessing its URL.

## Permissions and Multi-Tenancy

- Every role x every operation (see the CRUD matrix technique).
- Cross-tenant object access by direct ID - the highest-value test in this list.
- Forbidden actions hidden in the UI **and** rejected by the API.
- Error responses do not leak the existence or contents of forbidden objects.
- Permission changes take effect without requiring a re-login.
- Shared or delegated access, if the product has it, and its revocation.

## Payments and Money

- Every amount checked to the cent, including tax, discount, and rounding.
- Currency symbol, decimal separator, and thousands separator per locale.
- Zero-amount and negative-amount cases; refunds; partial refunds.
- Declined card; expired card; insufficient funds; 3DS challenge.
- Double-charge prevention on double-submit and on retry.
- Failure between payment success and order creation - reconciliation.
- Receipt content matches the charge; invoice numbering.
- Amounts match across UI, email, PDF, export, and the payment provider.

## Notifications, Emails, and Webhooks

- Triggered exactly once per event, not zero or twice.
- Correct recipients; no recipient who should not receive it.
- Content renders correctly, including in plain-text email clients.
- Links in the message work, point to the right record, and respect permissions.
- Preference/opt-out is honored.
- Behavior when the delivery provider fails - retried or silently dropped?
- Timing: immediate, batched, or digest.

## Dashboards, Reports, and Exports

- Numbers reconcile with the underlying list or detail views.
- Date range boundaries are inclusive/exclusive as specified.
- Timezone consistency between filter, chart axis, and export.
- Empty period; period with one data point; very large period.
- Export contains the same rows and columns as the filtered view.
- Export encoding handles unicode; CSV escaping handles commas and quotes.
- Long-running report generation: progress, timeout, and the failure message.

## Real-Time and Async Operations

- The UI reflects completion without a manual refresh.
- Reconnection after a dropped websocket.
- Ordering of rapid updates; a stale update arriving after a newer one.
- Optimistic UI updates that later fail on the server - is the UI rolled back?
- A job that fails halfway - partial results, retry, and user visibility.

## Accessibility (run on every UI feature)

- Full keyboard operation: reach and activate every control with Tab/Enter/Space.
- Visible focus indicator; logical focus order.
- Focus moves into a modal on open and returns to the trigger on close;
  focus is trapped inside the modal.
- Escape closes modals and dropdowns.
- Every input has a programmatically associated label.
- Errors are announced to screen readers, not conveyed by color alone.
- Text contrast meets 4.5:1; UI component contrast meets 3:1.
- Page zoom to 200% without loss of content or function.
- Images have alt text; decorative images are marked as such.

## Responsive and Cross-Browser

- Layouts at 320px, 768px, 1024px, 1440px, and a very wide viewport.
- Touch targets large enough; hover-only interactions have a touch equivalent.
- Mobile keyboard type per field (email, numeric, tel).
- Orientation change mid-flow.
- The browser matrix agreed with the team, plus the oldest supported version.

## Localization and Time

- Longest translated string does not break the layout (German is a good probe).
- RTL layout if supported.
- Date, number, and currency formats per locale.
- Timezone: user in a different timezone than the server; DST transition days;
  dates near midnight; a user who changes their timezone setting.
- Untranslated strings falling back to the default language.
