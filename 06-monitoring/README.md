# Section 06 — Monitoring and Observability

> You cannot fix what you cannot see.
> Monitoring tells you what is happening.
> Observability tells you why it is happening.

---

## Topics in This Section

| File | Topic | Level |
|------|-------|-------|
| [Prometheus / Grafana](javascript:dvGo('prometheus-grafana')) | Prometheus + Grafana — Metrics | Intermediate |
| [Loki logging](javascript:dvGo('loki-logging')) | Loki + Alloy — Centralized Logging | Intermediate |
| [Alerting](javascript:dvGo('alerting')) | AlertManager — Alerts and Notifications | Advanced |
| [Observability stack](javascript:dvGo('observability-stack')) | Full observability stack | Advanced |

---

## The Three Pillars of Observability

```
Metrics  → Numbers over time (CPU %, response time, error rate)
Logs     → Text records of events (what happened, when, why)
Traces   → Path of a request through multiple services
```

---

## Standard Stack (Cloud Native)

```
Metrics:  Prometheus + Grafana
Logs:     Loki + Grafana (same UI for metrics and logs!)
Traces:   Jaeger / Tempo
Alerts:   AlertManager → Slack, PagerDuty, email
Agent:    Alloy (Grafana Agent) — collects everything
```

---

## Why This Stack?

| Tool | Why Use It |
|------|-----------|
| **Prometheus** | Pull-based metrics, powerful query language (PromQL), used everywhere |
| **Grafana** | Beautiful dashboards, works with Prometheus + Loki + many others |
| **Loki** | Like Prometheus but for logs — simple, cheap, fast |
| **AlertManager** | Routes alerts, deduplicates, silences during maintenance |
| **Alloy** | Modern replacement for Prometheus Agent + Grafana Agent |

---

## CloudWatch (AWS)

If you are on AWS, CloudWatch is already there:
- Metrics from all AWS services (free)
- Custom metrics from your apps
- Log groups and log streams
- Alarms → SNS → Slack/PagerDuty

Use CloudWatch for AWS metrics + Prometheus/Grafana for application metrics.

---

[← Back to Main](/) | [Next: Advanced →](/advanced/)
