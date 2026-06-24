# Operator Onboarding — Pre-Commitment Discovery Checklist

> Adapted from an AI-deployment "brutal health check" playbook. The point isn't
> to win the operator — it's to **kill bad deals at the cheapest stage** (before
> we've migrated their fleet or promised a go-live date). Run this before
> agreeing to onboard any new rental operator into the marketplace (epic #385).
>
> The single highest-signal move: **ask for 3-5 real records, not descriptions.**
> An operator's claimed data maturity is always rosier than reality. Whether they
> hand them over fast, stall, or can't produce them at all — that *is* the answer.

## 1. Data — where the fleet really lives

- [ ] Where is their fleet/availability/pricing data today? One connectable DB, or
      spread across spreadsheets + a legacy tool + staff memory?
- [ ] **Get 3-5 real vehicle records** (plate, class, rates, availability, photos,
      shaken/insurance expiry). Real exports, not a verbal description.
- [ ] Is the data maintained — a named owner updating it — or stale with fields
      nobody can explain?
- [ ] **APPI line (Japan, non-negotiable):** renter PII — licenses, passports, the
      document uploads behind #459 — is personal information under 個人情報保護法.
      Confirm we may lawfully hold and process it before anything touches it.

## 2. Systems — what we have to integrate with

- [ ] What's the age of their current booking system? Does it expose an **API**, or
      is it screen-only with an undocumented backing DB?
- [ ] Who holds access credentials, and **when can we actually get them**?
- [ ] **Approval lead time is the #1 hidden killer on Japan projects.** What sign-off
      (IT, compliance, the operator's own management) does integration require, and
      how long does it really take? A one-day technical task can wait three months on
      approval. Put that number in the project timeline on day one — or the schedule
      is fiction from the start.

## 3. People — who actually uses this

- [ ] Whose daily workflow changes once they're live on the platform (counter staff,
      dispatcher, owner)?
- [ ] Do those front-line people know about this project? Supportive, neutral, or
      resistant?
- [ ] **Can we sit with the front-line staff before building?** If the operator won't
      grant access, or the front line is visibly resisting, risk is maxed: a tool
      built without the user becomes a shelf ornament nobody touches.

## 4. Expectations — the success criteria (most-skipped, top failure cause)

- [ ] Is success defined as a **quantifiable, verifiable** metric (e.g. "manual
      double-booking incidents → 0", "listing setup time 2 days → 2 hours") — not a
      vague "be more efficient"?
- [ ] What's the **Plan B** if the target isn't hit?
- [ ] Is there a real business pain driving this, or is it a "we adopted the platform"
      vanity goal?
- [ ] **Write the success metric into the agreement as something we can demo and sign
      off.** Fuzzy success criteria are a buried mine for the end-of-project dispute.

---

**Reading the result:** ~20 questions answered honestly tell you 80% of whether an
onboarding will succeed. A clean run = proceed. Stalls on §1 samples, an unknown §2
approval timeline, or §3 no-access — surface them as deal risks *before* committing,
not after.
