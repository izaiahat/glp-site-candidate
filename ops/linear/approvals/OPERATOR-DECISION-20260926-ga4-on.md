# Operator decision: GA4 on (2026-09-26, Izaiah, TUI)

Verbatim: "keep ga4 on any way - we want to collect as much data as possible. dont worry about state specific laws."

Coordinator implementation scope:
- Enable GA4 (G-2WQ42JY0WK, property 541440529) default-on sitewide, matching the PostHog default-on/acknowledge-only notice model.
- ACCEPTED RISK (operator): the pinned Google SDK may complete or retry an already-in-flight request after a visitor opts out (reports/ops/ga4-pr3-callback-diagnostic-20260926/RESULT.json). The strict "zero post-withdrawal transport" oracle is replaced by: after opt-out/GPC, no NEW GA loads, events or page_views on subsequent pages. Automatic user_engagement accepted.
- State-specific consent/health-data regimes (IR-2 on PR #8) are waived by the operator.
- Retained, not state-specific: no quiz answers, health conditions, medication selections, form values, email or other PII sent to Google (FTC Health Breach Notification Rule / GoodRx-BetterHelp precedent and Google Analytics terms, which can terminate the property); query strings stripped; Google Signals and ads personalization off. GPC and the opt-out link still stop future collection.
