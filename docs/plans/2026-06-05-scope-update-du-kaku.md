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

Result cards must show **seats + luggage count + luggage size** (standardized across models so cards are comparable). Provisional approach (to minimize partner effort): **per-vehicle partner input** for luggage count/size, with a **class-level default fallback** when a partner leaves it blank. Platform-standard taxonomy vs partner-input is **not finalized** (§4.2).

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

> Open: whether to implement via Stripe Connect (application-fee split) or a single account + our-DB calculation + manual monthly remittance (§4.4). The model above assumes platform-collect + our-DB calc.

---

## 3. Pre-auth vs. payment (clarified) — both exist

- **In-app Stripe payment** (§1.4) = the **rental cost** (car usage + add-ons + insurance).
- **Pre-authorization hold** = a **separate** security hold against **damage / hit-and-run**, **not** part of the booking/usage cost.
- **Both coexist.** The pre-auth handoff (proposal slice 7 / §9 item 2) is **not** replaced by the in-app payment.

---

## 4. Open questions (resolve before MVP-vs-later triage)

1. **Document verification mechanism** — manual admin review vs automated IDV (OCR / 3rd-party)? Encryption + retention policy for passport / IDP images? *(Du to circle back with team.)*
2. **Luggage standardization** — platform-standard taxonomy vs per-partner input (§1.2)?
3. **Class-combo availability** — confirm the per-(operator, location, class, time) inventory-count approach and how it interacts with the existing exclusion constraint (§1.1).
4. **Stripe integration shape** — Stripe Connect vs single account + manual payout for the 4% split (§2)?
5. **MVP-vs-later triage** — which of §1.1–1.5 are genuinely required for the Qiao demo vs. fast-follow. *(Next working session.)*

---

## 5. Impact note

These five additions **materially expand** the proposal's ~18–23 dev-day estimate (§5/§7) — payment + Stripe webhooks, document upload/verification, a third admin portal, dual-search, and an add-ons entity are each substantial. The slice plan (§6) is **not** re-baselined here; that happens after the §4 triage.

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

**待确认问题（需大家反馈）：**

1. 证件验证方式：人工审核 vs 自动识别（OCR / 第三方）？护照 / 驾照照片的加密存储与保留期限政策？
2. 行李信息：由平台统一定义标准，还是各合作商自行填写？
3. 车型套餐如何防止超卖（取车前无具体车辆，需按 门店 × 车型 × 时间段 做库存计数）？
4. Stripe 接入方式：用 Stripe Connect，还是单一账户 + 每月手动打款来实现 4% 分账？
5. 哪些功能属于 MVP 必需、哪些可作为后续迭代？（下次讨论）
