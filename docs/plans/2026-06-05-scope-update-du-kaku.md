# Marketplace MVP — Scope Update (Du + Kaku alignment, 2026-06-05)

**Date:** 2026-06-05
**Status:** Recorded for decision history. **MVP-vs-later triage still pending** — this captures the 1st Du + Kaku alignment meeting; it does NOT yet re-baseline the slice plan (§6 of the proposal).
**Amends:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` — §1 (Out-of-MVP), §2 (search/booking model), §9 items 16/19, §10 items 9/12. Where this doc and the proposal disagree on the items below, **this doc wins**; everything else in the proposal still holds.
**Source:** 1st alignment meeting with Du + Kaku, 2026-06-05.

---

## Summary

Four things the proposal lists as **Out-of-MVP / post-MVP** are now pulled **IN**: online payment, license/passport upload + verification, and commission/revenue-share. Plus two new design directions (dual search model, luggage attributes). The scope expansion is material — see §5.

---

## 1. Confirmed changes

### 1.1 Dual search-result model: map + flat list (NEW; must coexist with storefront-first)

After the renter submits search params (pickup/dropoff location, date range, etc.), the primary result is a **map + left-side list** showing, across **all partners and their locations**:

- **specific vehicles** (identified by number plate), and
- **class-combo deals** — a vehicle *class* (e.g. "minivan") where the **exact car is assigned by the partner on pickup day** based on availability.

This is **in addition to**, not a replacement of, the storefront-first flow already built in slice 5 (search → store card → pick a car at that store). **Schema + code must support both flows so we can switch between them.**

> **Reverses** §2 "Search result shape" and §10 item 12, which rejected a flat cross-operator vehicle list as the primary result. Both models are now first-class.

**Design implication — class-combo availability (open).** A class-combo booking has no `assigned_vehicle_id` at booking time, so the per-vehicle Postgres exclusion constraint (§2) cannot enforce it. This needs a **per-(operator, location, class, time-range) inventory-count** availability model alongside the existing exclusion constraint. See §4.3.

### 1.2 Luggage capacity on result cards (NEW vehicle attribute)

Result cards must show **seats + luggage count + luggage size** (standardized across models so cards are comparable). Provisional approach (to minimize partner effort): **per-vehicle partner input** for luggage count/size, with a **class-level default fallback** when a partner leaves it blank. **Decision (2026-06-05): both layers** — per-vehicle partner input is primary; platform supplies a **class-level default backup** when the partner leaves the field empty.

### 1.3 Renter document upload + verification gate (NEW; was Out-of-MVP)

Renter must **upload International Driving Permit** (and possibly passport) photo; stored **securely** in our DB/storage. A **verification interface** checks validity (expiry date + other fields) and the renter **cannot book/reserve until verification passes**.

> **Pulls in** "license/IDP/photo upload" from §1 Out-of-MVP. Verification mechanism (manual vs automated) + storage/retention policy is open (§4.1).

### 1.4 Multi-step reservation wizard with in-app Stripe payment (NEW; was Out-of-MVP)

Booking becomes a **multi-step wizard**:

1. date range,
2. **paid add-ons** (baby seat, etc.) — NEW fee-bearing entity, distinct from §9.19 `fee_schedules` (overtime / cleaning / no-fuel), which are *potential* post-rental charges,
3. insurance options selection,
4. final confirmation,
5. **payment via Stripe**.

> **Pulls in** "online payment" from §1 Out-of-MVP. Add-ons are a new selectable, priced entity chosen at booking time.

### 1.5 Platform admin portal + revenue / commission tracking (NEW; was post-MVP)

A **third dashboard**, separate from the renter portal and the operator portal, for platform operations. Includes a **partner revenue tab**: aggregate each partner's successful Stripe payments to compute the **monthly payout**.

> **Reverses** §9 item 16 ("commission/revenue-share is post-MVP; no money flows through the platform; payment is at-store"). Money now flows through the platform.

---

## 2. Money-flow model (clarified)

- The renter **pays exactly the price shown** — the 4% platform fee is **not** added on top.
- Platform's Stripe **collects the full amount**.
- On the Stripe **payment-success webhook**, persist a payment event in our DB, **tagged with the partner-business id** (passed as a parameter / metadata when the Stripe payment session is created).
- Platform **retains 4%** of the paid amount; **remittance to partner = paid amount − 4%**.
- Per-partner aggregation of these events drives the **monthly payout** figure in the admin revenue tab.
- A business may have **multiple stores**; attribution is at the **business** level via the id carried on each transaction.

> **Decision (2026-06-05): no Stripe Connect.** All payments route to a **single platform Stripe account**; remittance to partners is **computed on the backend and paid manually at month-end** (the model above).

---

## 3. Pre-auth vs. payment (clarified) — both exist

- **In-app Stripe payment** (§1.4) = the **rental cost** (car usage + add-ons + insurance).
- **Pre-authorization hold** = a **separate** security hold against **damage / hit-and-run**, **not** part of the booking/usage cost.
- **Both coexist.** The pre-auth handoff (proposal slice 7 / §9 item 2) is **not** replaced by the in-app payment.

---

## 4. Questions

**Resolved 2026-06-05:**

- **Luggage standardization (was Q2)** → both layers: per-vehicle partner input primary, class-level default backup when empty (§1.2).
- **Stripe integration shape (was Q4)** → no Connect; single platform Stripe account; manual month-end remittance computed on the backend (§2).

**Still open:**

1. **Document verification — storage/retention.** Interim mechanism decided: **manual** admin review for MVP (see §5). Still open: encryption + retention policy for passport / IDP images, and whether to add automated IDV later. *(Du to circle back with team.)*
2. **Class-combo availability model** — confirm the per-(operator, location, class, time) inventory-count approach and how it interacts with the existing exclusion constraint (§1.1). *(Designed-for now, built post-demo — see §5.)*

> **MVP-vs-later triage (was Q5): resolved 2026-06-05 — see §5.**

---

## 5. MVP-vs-later triage + re-baselined slice plan (resolved 2026-06-05)

**Demo goal:** a tourist can discover → book → **pay**, and a partner can see their sales + our 4%. The **payment → commission** thread is the spine; everything else is discovery polish.

| New item | Demo | Scope |
|---|---|---|
| Wizard + add-ons + Stripe payment (§1.4) | **MVP** | The business model. Stripe **test keys** for the demo. |
| Platform admin + revenue tab (§1.5) | **MVP** | Partner pitch; read-only aggregates over `payment_events`. |
| Doc upload + verification (§1.3) | **MVP-lite** | Upload + **manual** admin verify gates booking; automated IDV deferred. |
| Luggage attributes (§1.2) | **MVP** | Cheap, high tourist value. |
| Map + flat list over **specific** vehicles (§1.1) | **MVP-lite** | New presentation over slice-5 data. |
| **Class-combo** deals (§1.1) | **Fast-follow** | New inventory-count availability model; designed-for now, built post-demo. |

**Design-for-later commitments (build now so post-demo is additive — no migration churn):**

1. **Stripe = webhook is the source of truth.** The Checkout Session is created **server-side** with `metadata` (partner-business id + booking id); payment is recorded only on the **signed `checkout.session.completed` webhook** (idempotent), never the client redirect. That row drives the 4% calc.
2. **Booking fulfillment mode** (`SPECIFIC` | `CLASS_COMBO`) column added now — only `SPECIFIC` is exercised for the demo; the availability service + search read-models are shaped so a per-(operator, location, class, time) inventory-count path drops in later.
3. **`payment_events` table complete from day one** (operator_id, booking_id, gross, 4% fee, net, stripe ids, status) so the revenue tab is a query post-demo.
4. **Document verification is manual** for the demo (admin review); automated IDV is fast-follow.

**Re-baselined slice order (supersedes proposal §6):**

finish **6** booking → **7** notifications + pre-auth → **luggage + map/list view** → **doc upload + manual verify** → **payment + add-ons + `payment_events`** → **admin revenue tab** → **8** demo seed + E2E.

*Post-demo fast-follow:* class-combo deals + inventory availability, automated IDV, richer admin portal.

**Impact:** these additions **materially expand** the proposal's ~18–23 dev-day estimate (§5/§7) — payment + webhooks, document verification, the third admin portal, and the dual-search presentation are each substantial. Re-estimate after slice 6 lands.

---

## 6. 发送给团队的中文摘要 (Summary for team — 中文)

**6月5日 与 Du、Kaku 第一次对齐会议 — 范围更新**

**已确认的变更：**

1. 搜索结果页改为「地图 + 左侧列表」，同时展示各合作商不同门店下的：**具体车辆（带车牌）** 和 **车型套餐**（如「面包车」，具体车辆由合作商在取车当天根据可用情况决定）。需同时保留原「先选门店再选车」的流程——架构上两种流程都要支持，方便后续切换。
2. 搜索结果卡片除座位数外，还要显示**可放行李数量和行李尺寸**（需跨车型标准化）。暂定方案：由各合作商为每辆车自行填写，未填写时用该车型的默认值兜底（平台统一标准 vs 合作商填写，尚未定）。
3. 用户必须上传**国际驾照**（可能还有护照）照片并安全存储；预订前需通过一个**验证界面**核验有效期等信息，**验证通过后才能预订**。
4. 预订改为**多步骤向导**：日期范围 → 付费增值项（如儿童座椅等）→ 保险选择 → 最终确认 → **Stripe 支付**。
5. 新增**第三个后台：平台管理后台**（独立于用户端和合作商端），含各合作商**营收统计页**：基于 Stripe 成功支付汇总每个合作商的销售额，用于每月结算。

**资金流（已澄清）：**

- 用户支付的就是页面显示的金额，平台 4% **不额外加价**。
- 平台 Stripe **收取全款**；支付成功回调时在我方数据库记录该笔交易，并标记所属合作商（创建支付时作为参数传入）。
- 平台抽取 **4%**，应付合作商 = 实付金额 − 4%；按合作商汇总用于每月打款（一个公司可有多家门店，按**公司**维度归集）。

**押金 vs 支付（已澄清）：** 两者并存。Stripe 支付 = 用车租金；预授权押金 = 针对**车损 / 肇事逃逸**的单独冻结，不属于租金。

**已确认（6月5日补充）：** 行李信息=合作商按车填写为主、平台按车型默认值兜底；Stripe=不用 Connect，统一进平台账户，月底后台计算手动打款。

**MVP 范围已划定（6月5日，详见英文版 §5）：** 演示先做——预订向导+增值项+Stripe 支付、平台后台营收页、行李信息、地图/列表（先展示具体车辆）、证件**人工审核**；**车型套餐**与**自动证件识别**为演示后快速跟进（但 schema 现在就预留，避免返工）。

**待确认问题（需大家反馈）：**

1. 证件照片的**加密存储与保留期限**政策？（验证方式 MVP 先用人工审核，自动识别后续再议）
2. 车型套餐如何防止超卖（取车前无具体车辆，需按 门店 × 车型 × 时间段 做库存计数）？
