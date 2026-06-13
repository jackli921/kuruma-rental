# #521 — Two-branch reconciliation (for review)

**Date:** 2026-06-11
**Author:** session handoff review
**Status:** DECIDED 2026-06-11 — **Option A** (keep `feat/521-provider-login`, port auth's OAuth/callback/session wiring onto it as a reference, not a transplant)
**Related:** plan `docs/plans/2026-06-10-issue-521-provider-login-operator-access.md` (approved), issue #521

---

## TL;DR

Two separate worktrees were both started on issue #521 and have drifted apart.
They each built **one half** of the feature, on **incompatible foundations**, and
**both claim database migration 0048**. They cannot both be merged. We have to pick
one as the base, fold the useful parts of the other into it, and abandon the loser.

**Recommendation: keep `feat/521-provider-login` as the base.** It matches the approved
plan and is the only branch that can actually create an invite. Treat `feat/521-provider-auth`
as a reference implementation and port its login flow onto the login branch.

---

## What is #521, in one paragraph

Today anyone who signs in with Google becomes a *renter*. Issue #521 adds a second
front door so a **car-rental operator** (a business that lists vehicles) can sign in and
reach their management dashboard. We don't let people self-declare as operators — that
would be a security hole. Instead, a platform admin **invites** an operator by email,
the operator signs in with that same Google email, and the system **grants** them
operator access. Two moving parts: *creating the invite* and *redeeming it at login*.

---

## What each branch actually built

Both branches branched from the same commit and both add the same two database tables
(`operator_memberships` = who is an operator, `provider_invites` = pending invitations).
But they split the work down the middle:

### `feat/521-provider-login` — the **invite-creation** half (5 commits, `a386a1f`)
- `POST /admin/provider-invites` — the admin endpoint that mints an invite.
- A demo seed so the runbook has a working invite out of the box.
- `ProviderInviteService` + repositories + integration test (the partial-unique race fence).
- **Cannot log a provider in yet** — that was its planned next step ("Slice B").

### `feat/521-provider-auth` — the **login/redeem** half (6 commits, `6bc422f`)
- Google OAuth callback that reads the invite and grants operator access.
- Intent + invite-token threading through `/auth/google/start` and the callback cookies.
- A `email_verified` gate (won't grant to an unverified Google email).
- `ProviderAccessService` + `session.ts` carrying `operatorId` / `operatorSlug`.
- **Cannot create an invite at all** — no admin endpoint and no seed. Invites only
  exist inside its tests.

> In plain terms: **login** built the part that makes the key; **auth** built the part
> that opens the lock. Neither branch is a working door on its own.

---

## Why they can't just be merged together

It is not as simple as "combine both halves," because the *foundation* underneath them
differs. They describe the same two tables in **different files, with different columns**:

| Foundation | `provider-login` | `provider-auth` |
|---|---|---|
| Table-definition file | `shared/db/provider-access.ts` | `shared/db/operator-access.ts` |
| Membership has a `status` (ACTIVE/REVOKED)? | **Yes** | No |
| Race protection on concurrent accept | **Partial-unique index** (the approved design) | Plain unique on userId (weaker) |
| Invite has a `status` + audit columns (who invited / who accepted)? | **Yes** | No (just an `acceptedAt` timestamp) |
| Token column | `tokenHash` (clean name) | physically still `token` (a known debt) |
| Migration 0048 contents | 36-line SQL, own snapshot | 29-line SQL, different snapshot |

Both grab the **0048** migration slot with **different SQL**. That is a hard conflict:
whichever merges second has to be regenerated and renumbered, and its table shape has
to be reconciled with the first. The repository *interfaces* also differ, so the
business logic of one branch will not compile against the other's data layer unchanged.

### Merge-base note (which trunk to reconcile against)

Both branches were cut from **`marketplace-pivot`** (`a59d12b…`), not from `main` —
`main` is the older production trunk and is *behind* `marketplace-pivot`. Per the
project's branching model and the approved plan, **`marketplace-pivot` is the trunk to
reconcile against**, and the live tip is one commit ahead of the shared base (#511,
`26bd31d`, web-only, no migration). Practical consequence: rebase onto
`origin/marketplace-pivot` first, and **regenerate the migration slot late** — only after
the rebase is clean — so 0048 lands as the next free number against the real trunk state
(`db:generate` then `db:verify`, never hardcode the number; see the drizzle gotcha in CLAUDE.md).

---

## Which foundation is "right"?

The approved plan (locked with the reviewer on 2026-06-10, §3–§6) specifies, word for word:

- membership `status` enum with a **partial-unique-on-ACTIVE index** as "the race fence
  for concurrent invite acceptance" (plan §4),
- invite `status` enum **plus `invitedByUserId` / `acceptedByUserId`** audit columns (§4),
- the acceptance writes happen in one transaction with the **membership INSERT first** so
  the partial-unique index aborts a double-accept, and **on conflict the callback re-reads
  the winner** instead of trusting the stale snapshot (§6, flagged as an architect HIGH).

That is exactly **`provider-login`'s** schema. **`provider-auth`'s** leaner schema drops the
status/audit/partial-unique design and carries explicit deferred debt (the `token` column
rename, a dead `findRedeemableByEmail`). So on *data model* the login branch is the one that
matches what was approved; the auth branch quietly re-decided it.

The counter-point in auth's favour: its leaner model is arguably more YAGNI, and — more
importantly — **its login flow already works end-to-end and is tested.** The OAuth callback
glue (intent cookies, the verified-email gate, redirects, session plumbing) is the genuinely
fiddly part of this feature, and auth has it built. That is real, hard-to-rebuild work.

---

## The options

### Option A (recommended) — base on `provider-login`, port auth's login flow onto it
- **Keep:** login's approved schema, the admin invite endpoint, the demo seed, the green
  repo/service/integration tests.
- **Port as a *reference*, not a transplant.** Auth is read for *how to wire the behaviour*,
  not copied wholesale. The pieces worth lifting are the **cookie-based intent threading,
  the verified-email gate, the callback redirect logic, the slug/session minting, and the
  callback tests** (`auth/routes/auth.ts`). What must **not** come over as-is:
  - auth's **leaner schema** (`operator-access.ts`) — login's approved `provider-access.ts`
    stays;
  - auth's **`ProviderAccessService` grant body** — it does three separate writes (see
    Option B); login's grant must use the one-`runTx` acceptance the plan mandates.
- **Adapt** to login's richer invite shape: set `status='ACCEPTED'` + `acceptedByUserId`
  (not auth's `acceptedAt`), and put the three writes in **one raw `runTx`**, membership
  INSERT first, re-read the winner on `23505`. This *is* login's planned Slice B; auth is
  the worked example for the OAuth plumbing only.
- **Cost:** medium. You re-implement the grant + auth wiring on the approved data model,
  guided by a working example of the fiddly OAuth glue.
- **Why:** login is the only branch that can create invites at all, its schema is what was
  approved, and the auth plumbing ports cleanly because the plan (§6) already pseudocodes
  it against login's exact table shape.

### Option B — base on `provider-auth`, bolt an admin endpoint on
- **Keep:** auth's end-to-end login *plumbing*.
- **Add / rebuild — more than it first looks:**
  1. an admin invite-creation endpoint + seed (auth completely lacks both);
  2. **upgrade auth's schema** to add the status/audit/partial-unique race fence the plan requires; and
  3. **replace auth's core grant path.** Auth does **not** satisfy the approved acceptance
     path: its grant is **three separate sequential repo calls** —
     `memberships.create()` → `invites.markAccepted()` → `users.setOperatorAccess()` in
     `services/provider-access.ts` — **not** the single raw `runTx` the plan mandates (§6,
     flagged an architect HIGH). Auth's own integration test says so verbatim: *"The
     acceptance is not yet a single tx (deferred…)."* So Option B is **not** "working login
     plus an admin endpoint" — the transactional grant, the very thing the plan calls out as
     the risky part, is still unbuilt on this branch.
- **Cost:** high. You throw away login's tested admin endpoint + seed, **and** rewrite both
  auth's schema and its grant path — i.e. you rebuild the hardest, already-approved part on
  top of a branch that diverged from it. Net: more work than Option A, and you re-litigate a
  locked schema decision.
- **Why you might still pick it:** only if shipping *any* live provider login today outranks
  correctness — and even then the non-transactional grant is a real double-accept risk, not
  a cosmetic gap.

### Option C — discard both, rebuild clean from the plan
- Not recommended. Both branches contain correct, tested work; a clean rebuild throws away
  ~11 commits of green tests for no architectural gain over Option A.

---

## Recommendation

**Option A.** Carry `feat/521-provider-login` forward. Cannibalize `feat/521-provider-auth`
as the reference for the OAuth grant flow, then stop work on it (leave its worktree in place —
per session rules we do not delete a worktree we did not create without an explicit go).

Concretely, the next steps become login's existing Slice B plan (plan §6 / §9):
1. `email_verified` → `GoogleProfile` gate in `auth/google.ts`.
2. Thread `intent` + invite-token cookies through `/auth/google/start` and `/callback`.
3. `OperatorGrantService` with the 3-write acceptance in **one raw `runTx`**, membership
   INSERT first, re-read winner on `23505`.
4. `operatorRoleToUserRole` typed projection in shared.
5. Single JWT-mint path; `operatorSlug` always derived from `operatorId`.
6. `GET /provider-invites/:token/preview` + the web `/provider/invite/$token` page.
7. `/manage/$operatorSlug` guard + minimal dashboard landing.

---

## Verdict (2026-06-11)

**Option A**, confirmed in review. Keep `feat/521-provider-login` as the base; port only
auth's OAuth/callback/session wiring onto it **as a reference**. Auth's schema and its
non-transactional grant body do **not** come over — login's approved `provider-access.ts`
schema and the one-`runTx` acceptance from plan §6 are authoritative.

Review notes that sharpened this doc:
- Option B was understated: auth's grant is three separate writes, not one `runTx`, and its
  own test defers the transaction — so Option B must *rebuild the core grant path*, not just
  add an endpoint.
- Option A's port is a reference, not a transplant — schema/service stay on the login branch.
- Reconcile against `marketplace-pivot` (the shared base), not `main`; regenerate the
  migration slot late.

`feat/521-provider-auth` is now superseded for #521. Per session rules its worktree is left
in place (not deleted without an explicit go); no further work lands on it.
