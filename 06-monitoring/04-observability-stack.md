# Full Observability Stack

> **Level:** Advanced
> **Prerequisites:** Prometheus & Grafana, Loki, AlertManager
> **You will learn:** PLG + Tempo stack, SLOs/SLAs, distributed tracing, complete Helm deploy, dashboards-as-code

---

## The Three Pillars of Observability

```
Metrics (Prometheus)
  → "Something is wrong"
  → CPUUtilization = 95%, error_rate = 2.3%

Logs (Loki)
  → "What happened"
  → 2026-05-20T14:32:01Z ERROR payment failed: card declined

Traces (Tempo / Jaeger)
  → "Why it happened / where it slowed"
  → request → API Gateway (10ms) → fn-payments (850ms) → DynamoDB (5ms)
                                          ↑ bottleneck here

Together: from symptom → root cause in minutes
```

---

## Complete Stack Architecture

```
Internet → App → Prometheus ← scrape ← Exporters
                     │
              AlertManager → Slack / PagerDuty
                     │
                  Grafana (dashboards)
                     │
              ┌──────┴──────┐
           Loki            Tempo
       (logs, LogQL)   (traces, TraceQL)
              │              │
        Promtail/Alloy    OpenTelemetry
       (log collector)    (trace collector)
```

---

## Deploy Full Stack with Helm

```bash
# Single Helm chart deploys: Prometheus + Grafana + AlertManager + Loki + Promtail

helm repo add grafana https://grafana.github.io/helm-charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# 1. Deploy kube-prometheus-stack (Prometheus + Grafana + AlertManager)
helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  -f monitoring-values.yaml

# 2. Deploy Loki + Promtail
helm upgrade --install loki grafana/loki-stack \
  --namespace monitoring \
  -f loki-values.yaml

# 3. Deploy Tempo (distributed tracing)
helm upgrade --install tempo grafana/tempo \
  --namespace monitoring \
  -f tempo-values.yaml

# Verify all components
kubectl get pods -n monitoring
kubectl get svc -n monitoring
```

---

## Helm Values — Grafana + Prometheus

```yaml
# monitoring-values.yaml

grafana:
  adminPassword: "{{ vault_grafana_password }}"
  persistence:
    enabled: true
    size: 10Gi

  ingress:
    enabled: true
    annotations:
      kubernetes.io/ingress.class: alb
      alb.ingress.kubernetes.io/scheme: internet-facing
    hosts:
      - grafana.internal.myapp.com

  # Pre-load datasources
  additionalDataSources:
    - name: Loki
      type: loki
      url: http://loki:3100
      isDefault: false

    - name: Tempo
      type: tempo
      url: http://tempo:3100
      isDefault: false
      jsonData:
        tracesToLogs:
          datasourceUid: loki
          filterByTraceID: true

prometheus:
  prometheusSpec:
    retention: 30d
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 100Gi

    # Scrape all ServiceMonitors in all namespaces
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false

alertmanager:
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 10Gi
```

---

## ServiceMonitor — Instrument Your App

```yaml
# k8s/servicemonitor-payments.yaml
# Prometheus automatically discovers this and scrapes /metrics

apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: payments-service
  namespace: production
  labels:
    release: kube-prometheus-stack   # must match Prometheus selector
spec:
  selector:
    matchLabels:
      app: payments
  endpoints:
    - port: metrics
      path: /metrics
      interval: 30s
      scrapeTimeout: 10s
```

```python
# app/metrics.py — expose Prometheus metrics in Python app

from prometheus_client import Counter, Histogram, Gauge, start_http_server
import time

# Counters (only go up)
payments_total = Counter(
    'payments_total',
    'Total payments processed',
    ['status', 'currency']
)

# Histograms (latency distribution)
request_duration = Histogram(
    'http_request_duration_seconds',
    'Request duration in seconds',
    ['method', 'endpoint', 'status'],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
)

# Gauges (can go up and down)
active_connections = Gauge('active_connections', 'Current active connections')

# Start metrics endpoint on port 9090
start_http_server(9090)

# Usage in handler
def process_payment(amount, currency):
    with request_duration.labels(method='POST', endpoint='/payments', status='200').time():
        # ... process payment ...
        payments_total.labels(status='success', currency=currency).inc()
```

---

## SLO — Service Level Objectives

```yaml
# k8s/slo-rules.yaml
# SLO: 99.9% of requests succeed (error budget: 43.2 min/month)

apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: slo-payments
  namespace: monitoring
spec:
  groups:
    - name: slo.payments
      rules:
        # Success rate over 1 hour
        - record: job:payments_success_rate:ratio_rate1h
          expr: |
            sum(rate(http_requests_total{job="payments", status!~"5.."}[1h]))
            /
            sum(rate(http_requests_total{job="payments"}[1h]))

        # Success rate over 30 days
        - record: job:payments_success_rate:ratio_rate30d
          expr: |
            sum(rate(http_requests_total{job="payments", status!~"5.."}[30d]))
            /
            sum(rate(http_requests_total{job="payments"}[30d]))

        # Error budget remaining (99.9% SLO)
        - record: job:payments_error_budget_remaining
          expr: |
            1 - (
              (1 - job:payments_success_rate:ratio_rate30d)
              / (1 - 0.999)
            )

        # Alert when error budget < 10%
        - alert: PaymentsSLOErrorBudgetLow
          expr: job:payments_error_budget_remaining < 0.10
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Payments SLO error budget is {{ $value | humanizePercentage }} remaining"
            description: "At this burn rate, the SLO will be breached before month end"
```

---

## Distributed Tracing with OpenTelemetry

```python
# app/tracing.py — instrument Python app with OpenTelemetry → Tempo

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

# Configure OTLP exporter → Tempo
provider = TracerProvider()
exporter = OTLPSpanExporter(
    endpoint="http://tempo.monitoring.svc:4317",
    insecure=True
)
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)

# Auto-instrument HTTP requests and FastAPI
RequestsInstrumentor().instrument()
FastAPIInstrumentor.instrument_app(app)

tracer = trace.get_tracer("payments-service")

# Manual span for business logic
def process_payment(payment_id: str, amount: float):
    with tracer.start_as_current_span("process_payment") as span:
        span.set_attribute("payment.id",       payment_id)
        span.set_attribute("payment.amount",   amount)
        span.set_attribute("payment.currency", "USD")

        # Nested span for DB call
        with tracer.start_as_current_span("dynamodb.put_item") as db_span:
            db_span.set_attribute("db.system", "dynamodb")
            db_span.set_attribute("db.operation", "put_item")
            # ... DB call ...
```

```yaml
# k8s/tempo-values.yaml
tempo:
  storage:
    trace:
      backend: s3
      s3:
        bucket: company-tempo-traces
        region: us-east-1

  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318
```

---

## Grafana Dashboards as Code

```python
# scripts/create_dashboard.py
# Create Grafana dashboards via API (alternative to JSON files)

import requests
import json

GRAFANA_URL = "http://grafana.internal.myapp.com"
GRAFANA_TOKEN = "glsa_xxxx"

dashboard = {
    "dashboard": {
        "title": "Payments Service SLO",
        "refresh": "30s",
        "panels": [
            {
                "title": "Success Rate (30d)",
                "type": "stat",
                "gridPos": {"h": 4, "w": 6, "x": 0, "y": 0},
                "targets": [{
                    "expr": "job:payments_success_rate:ratio_rate30d * 100",
                    "legendFormat": "Success Rate %"
                }],
                "options": {
                    "thresholds": {
                        "steps": [
                            {"value": None,  "color": "red"},
                            {"value": 99.9,  "color": "green"}
                        ]
                    }
                }
            },
            {
                "title": "Error Budget Remaining",
                "type": "gauge",
                "gridPos": {"h": 4, "w": 6, "x": 6, "y": 0},
                "targets": [{
                    "expr": "job:payments_error_budget_remaining * 100",
                    "legendFormat": "Error Budget %"
                }],
                "options": {
                    "minValue": 0,
                    "maxValue": 100
                }
            }
        ]
    },
    "overwrite": True,
    "folderId": 0
}

resp = requests.post(
    f"{GRAFANA_URL}/api/dashboards/db",
    headers={"Authorization": f"Bearer {GRAFANA_TOKEN}",
             "Content-Type": "application/json"},
    json=dashboard
)
print(resp.json())
```

---

## Runbook Template

```markdown
## Runbook: HighErrorRate

**Alert:** HTTP error rate > 1% for service `{{ service }}`

### Immediate Actions (< 2 min)
1. Check recent deployments: `kubectl rollout history deploy/{{ service }} -n production`
2. Look at logs: Loki query → `{namespace="production", app="{{ service }}"} |= "ERROR" | last 100`
3. Check downstream dependencies in Tempo traces

### Diagnosis
```bash
# Pod health
kubectl get pods -l app={{ service }} -n production
# Recent events
kubectl get events -n production --sort-by='.lastTimestamp' | grep {{ service }}
# CPU/Memory pressure
kubectl top pods -l app={{ service }} -n production
```

### Resolution
- If caused by a bad deploy: `kubectl rollout undo deploy/{{ service }} -n production`
- If downstream DB issue: check RDS CloudWatch metrics
- If traffic spike: `kubectl scale deploy/{{ service }} --replicas=10 -n production`

### Escalation
- After 15 min unresolved → page team lead
- After 30 min → declare incident, start war room
```

---

## Interview Questions

**Q: What is the difference between metrics, logs, and traces?**
> Metrics are aggregated numbers over time (error rate = 2.3%). They're cheap to store and great for alerting and dashboards. Logs are raw text events with full context — expensive but necessary for debugging. Traces show the journey of a single request through multiple services — they identify where latency is introduced. You need all three: metrics tell you something is wrong, logs tell you what happened, traces tell you where and why.

**Q: What is an error budget and how do you use it?**
> An error budget is how much failure your SLO allows. With 99.9% SLO, you have 0.1% errors allowed per month (43.2 minutes). When the error budget drops below 10%, you stop feature deployments and focus on reliability work. This creates a shared vocabulary between product (wants features) and engineering (wants stability): once the budget is spent, everyone agrees reliability takes priority.

**Q: How do you debug a slow request using observability tools?**
> 1. Prometheus: is the p99 latency elevated? Since when? 2. Grafana: correlate with deployment or traffic spike. 3. Tempo: find a trace for a slow request — which service took the most time? 4. Loki: pull logs from that service at that timestamp — look for slow queries, timeouts. This workflow takes 5-10 minutes vs hours of guessing.

---

[← AlertManager](./03-alertmanager.md) | [Back to Section](./README.md)
