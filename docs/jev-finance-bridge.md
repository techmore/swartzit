# JEV finance bridge

This project can support a local JEV MCP bridge for daily balance checks and
bill planning, but it must be a read-only assistant. Bank credentials and
session cookies stay inside the user-controlled browser profile. They must
never be sent to Swartzit, written to the repository, or included in MCP
tool output.

## First release

The bridge should expose these tools:

- `finance_accounts` — list the account names and institutions the user has
  explicitly approved for this session.
- `finance_snapshot` — read visible balances and the timestamp shown by the
  bank, returning normalized values with the source URL and capture time.
- `finance_transactions` — read a bounded, user-selected date range and
  return merchant, date, amount, and account labels. Redact account numbers.
- `finance_screenshot` — capture a screenshot only after an explicit request;
  mask account numbers, routing numbers, addresses, and card details before
  saving it locally.
- `finance_daily_brief` — compare current balances with the approved bill
  calendar and return a short cash-availability brief.
- `finance_month_plan` — produce a draft monthly plan with due dates,
  expected income, bills, and a buffer. It must never submit a payment or
  change an account.

Every tool call should return an audit receipt containing the source domain,
capture time, fields read, and redaction status. It must not return cookies,
passwords, MFA codes, full account numbers, or unrestricted page text.

## Browser boundary

JEV should use the existing user-controlled Brave/Ego Lite session. The MCP
server should request a handoff before opening a bank, before submitting any
login or MFA step, and before capturing a screenshot. If the user takes back
control, the operation stops. A browser tab may remain open for the user, but
the bridge must not persist the tab's authentication state.

The adapter should support site-specific selectors only in local configuration
and should fail closed when a selector is missing or a page is unexpected.
Do not scrape a bank through a background HTTP client or bypass bot/MFA
controls. For a durable deployment, prefer an institution-approved read-only
aggregation connection and import only the minimum fields needed for planning.

## Storage and retention

The bridge keeps normalized snapshots in an encrypted local store, separate
from the Swartzit database. Default retention is 30 days for balances and 90
days for transactions. Screenshots are disabled by default, stored outside the
repository, and deleted after 7 days. Logs contain event type, domain, timing,
row counts, and error class only; never raw HTML, URLs with query strings,
tokens, account numbers, or screenshots.

## Guardrails

- Read-only scope; no transfers, bill payments, account changes, or message
  sending.
- Explicit account/domain allowlist and an approval prompt for each new bank.
- No financial advice claims. Plans are arithmetic drafts using user-supplied
  income, due dates, and buffer targets.
- Missing, stale, or conflicting data is reported as unknown rather than
  guessed.
- Daily checks should notify only on a material change: a new bill, a due date
  inside the warning window, a balance change beyond the configured threshold,
  or a failed capture.

## Suggested implementation stages

1. Add a local MCP process with the tool contracts above and an encrypted
   snapshot store; ship a fake provider for tests.
2. Add Ego Lite/Brave handoff and screenshot redaction with fixture pages.
3. Add one bank adapter only after the user chooses the institution and
   confirms its read-only fields.
4. Add a daily scheduler and monthly planner UI. Keep all plans drafts until
   the user exports them.

This bridge is intentionally separate from Swartzit. Swartzit may display a
user-approved summary, but it must not receive credentials, cookies,
screenshots, or raw transaction feeds.

## Existing Jev/browser projects

There are already two relevant open-source projects:

- [`@jkudish/jev-browser`](https://github.com/jkudish/jev-browser) provides a
  Jev-driven Playwright browser agent, CLI, library, and MCP server. Its login
  design supports origin-locked password injection, scrubs secrets from traces,
  refuses to submit after a password fill, and suppresses screenshots on
  credential runs.
- [`jev-ego`](https://github.com/romaluev/jev-ego) adapts Jev's typed action
  loop to ego lite. It uses indexed actions such as `CLICK`, `TYPE_TEXT`,
  `SELECT`, `WAIT`, and `DONE` through `ego-browser`, rather than raw browser
  selectors or coordinates.

For this project, `jev-ego` is the closer browser fit because ego lite is the
browser already available on the Mac. `jev-browser` is a useful reference for
credential handling and trace redaction. Neither project should be pointed at
a bank until the read-only scope, origin allowlist, screenshot policy, and
user handoff rules above are enforced. Jev's decision output is a navigation
signal, not authorization to submit a payment or change an account.
