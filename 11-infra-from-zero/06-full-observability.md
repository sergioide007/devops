# Full Observability Platform — Prometheus + Grafana + Loki + AlertManager

> Observability answers three questions:
>   METRICS: Is the system healthy? (numbers)
>   LOGS: What happened? (events)
>   TRACES: Why is it slow? (request path)
>
> This section wires everything together: collect, store, visualize, and alert.
> By the end, you have a dashboard that shows you problems BEFORE users call you.

---

## Observability Stack Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            YOUR APPLICATIONS            │
                    │  payment-api │ fraud-service │ frontend  │
                    └──────┬──────────────┬───────────────────┘
                           │              │
              metrics (/metrics)     logs (stdout)
                           │              │
                    ┌──────▼──────┐ ┌────▼──────────┐
                    │  PROMETHEUS  │ │  ALLOY / LOKI  │
                    │  (scrapes   │ │  (collects     │
                    │  metrics)   │ │   logs)        │
                    └──────┬──────┘ └────┬───────────┘
                           │              │
                    ┌──────▼──────────────▼──────────┐
                    │           GRAFANA               │
                    │  (dashboards + alerts + explore) │
                    └──────────────┬─────────────────┘
                                   │
                         ┌─────────▼──────────┐
                         │   ALERTMANAGER      │
                         │  (route alerts to   │
                         │  Slack/PagerDuty)   │
                         └────────────────────┘
```

---

## Step 1: Install the Complete Stack with Helm

```bash
#!/bin/bash
# install-observability-stack.sh
# Installs: Prometheus, Grafana, AlertManager, Loki, Alloy, node-exporter

MONITORING_NS="monitoring"

echo "=== Installing Full Observability Stack ==="

# Create monitoring namespace
kubectl create namespace $MONITORING_NS

# Add Helm repositories
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# ── STEP 1: Install kube-prometheus-stack ────────────────────────
# This installs: Prometheus, AlertManager, Grafana, kube-state-metrics,
#                node-exporter, and pre-built Kubernetes dashboards
echo ""
echo "Installing kube-prometheus-stack..."

helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  --namespace $MONITORING_NS \
  --values - << 'EOF'
# Prometheus settings
prometheus:
  prometheusSpec:
    retention: 30d                # Keep 30 days of metrics
    retentionSize: "50GB"
    
    # Scrape interval
    scrapeInterval: 15s
    evaluationInterval: 15s
    
    # Storage
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: standard
          resources:
            requests:
              storage: 50Gi
    
    # Resources
    resources:
      requests:
        memory: 2Gi
        cpu: "500m"
      limits:
        memory: 4Gi
        cpu: "2"
    
    # Additional scrape configs (for apps)
    additionalScrapeConfigs:
      - job_name: 'kubernetes-pods'
        kubernetes_sd_configs:
          - role: pod
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
            action: keep
            regex: true
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
            action: replace
            target_label: __metrics_path__
            regex: (.+)
          - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
            action: replace
            regex: ([^:]+)(?::\d+)?;(\d+)
            replacement: $1:$2
            target_label: __address__
          - action: labelmap
            regex: __meta_kubernetes_pod_label_(.+)
          - source_labels: [__meta_kubernetes_namespace]
            action: replace
            target_label: kubernetes_namespace
          - source_labels: [__meta_kubernetes_pod_name]
            action: replace
            target_label: kubernetes_pod_name

# Grafana settings
grafana:
  enabled: true
  adminPassword: "change-me-in-production"
  
  # Persistence
  persistence:
    enabled: true
    size: 10Gi
  
  # Pre-load dashboards
  dashboardProviders:
    dashboardproviders.yaml:
      apiVersion: 1
      providers:
        - name: 'default'
          orgId: 1
          folder: ''
          type: file
          disableDeletion: false
          editable: true
          options:
            path: /var/lib/grafana/dashboards/default
  
  # Import pre-built dashboards
  dashboards:
    default:
      kubernetes-cluster:
        gnetId: 7249    # Kubernetes cluster dashboard
        revision: 1
        datasource: Prometheus
      kubernetes-pods:
        gnetId: 6781    # Kubernetes pods dashboard
        revision: 1
        datasource: Prometheus
      node-exporter:
        gnetId: 1860    # Node exporter full
        revision: 1
        datasource: Prometheus

# AlertManager settings  
alertmanager:
  config:
    global:
      slack_api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
    
    route:
      group_by: ['alertname', 'namespace']
      group_wait: 30s
      group_interval: 5m
      repeat_interval: 1h
      receiver: 'slack-notifications'
      routes:
        - match:
            severity: critical
          receiver: 'pagerduty-critical'
          continue: true
        - match:
            severity: warning
          receiver: 'slack-notifications'
    
    receivers:
      - name: 'slack-notifications'
        slack_configs:
          - channel: '#monitoring'
            send_resolved: true
            title: '{{ template "slack.default.title" . }}'
            text: '{{ template "slack.default.text" . }}'
      
      - name: 'pagerduty-critical'
        pagerduty_configs:
          - service_key: 'YOUR_PAGERDUTY_KEY'
            description: '{{ template "pagerduty.default.description" . }}'

# Node exporter (metrics from each server/VM)
nodeExporter:
  enabled: true

# kube-state-metrics (metrics about K8s objects)
kubeStateMetrics:
  enabled: true
EOF

echo "✅ kube-prometheus-stack installed"

# ── STEP 2: Install Loki + Alloy (log collection) ───────────────
echo ""
echo "Installing Loki for log aggregation..."

helm upgrade --install loki \
  grafana/loki \
  --namespace $MONITORING_NS \
  --values - << 'EOF'
loki:
  commonConfig:
    replication_factor: 1  # Single node for lab (use 3 for production)
  
  storage:
    type: filesystem  # For lab; use S3 for production
    filesystem:
      chunks_directory: /tmp/loki/chunks
      rules_directory: /tmp/loki/rules
  
  # Log retention
  limits_config:
    retention_period: 30d
    ingestion_rate_mb: 10
    ingestion_burst_size_mb: 20

singleBinary:
  replicas: 1
  persistence:
    enabled: true
    size: 20Gi
EOF

echo ""
echo "Installing Grafana Alloy (log collector)..."

helm upgrade --install alloy \
  grafana/alloy \
  --namespace $MONITORING_NS \
  --values - << 'EOF'
alloy:
  configMap:
    content: |
      // Alloy configuration — collect logs from Kubernetes pods
      
      // Discovery: find all pods in the cluster
      discovery.kubernetes "pods" {
        role = "pod"
      }
      
      // Filter: only collect pods with annotation prometheus.io/scrape
      discovery.relabel "pods" {
        targets = discovery.kubernetes.pods.targets
        
        // Keep only pods that want their logs collected
        rule {
          source_labels = ["__meta_kubernetes_pod_annotation_collect_logs"]
          action        = "keep"
          regex         = "true"
        }
        
        // Add useful labels from pod metadata
        rule {
          source_labels = ["__meta_kubernetes_namespace"]
          target_label  = "namespace"
        }
        rule {
          source_labels = ["__meta_kubernetes_pod_name"]
          target_label  = "pod"
        }
        rule {
          source_labels = ["__meta_kubernetes_pod_container_name"]
          target_label  = "container"
        }
        rule {
          source_labels = ["__meta_kubernetes_pod_label_app"]
          target_label  = "app"
        }
      }
      
      // Collect logs from discovered pods
      loki.source.kubernetes "pods" {
        targets    = discovery.relabel.pods.output
        forward_to = [loki.write.default.receiver]
      }
      
      // Send logs to Loki
      loki.write "default" {
        endpoint {
          url = "http://loki:3100/loki/api/v1/push"
        }
      }
EOF

echo "✅ Loki and Alloy installed"

# ── STEP 3: Configure Grafana data sources ───────────────────────
echo ""
echo "Adding Loki datasource to Grafana..."

GRAFANA_URL="http://localhost:3000"
GRAFANA_USER="admin"
GRAFANA_PASS="change-me-in-production"

# Port-forward Grafana (temporary)
kubectl port-forward svc/kube-prometheus-stack-grafana 3000:80 \
  -n $MONITORING_NS &
PF_PID=$!
sleep 5

# Add Loki datasource
curl -sf -X POST \
  "$GRAFANA_URL/api/datasources" \
  -u "$GRAFANA_USER:$GRAFANA_PASS" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Loki",
    "type": "loki",
    "url": "http://loki:3100",
    "access": "proxy",
    "isDefault": false,
    "jsonData": {
      "derivedFields": [
        {
          "name": "TraceID",
          "matcherRegex": "trace_id=(\\w+)",
          "url": "http://tempo:3200/d/tempo/tempo?var-traceId=${__value.raw}"
        }
      ]
    }
  }'

kill $PF_PID
echo "✅ Loki datasource configured in Grafana"
```

---

## Step 2: Instrument Your Application

```python
# app_with_metrics.py
# Python application with Prometheus metrics and structured logging

from prometheus_client import (
    Counter, Histogram, Gauge, start_http_server
)
import logging
import json
import time
from datetime import datetime

# ── Prometheus Metrics ────────────────────────────────────────────
# Counters (go up, never down)
HTTP_REQUESTS = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'path', 'status']
)

# Histograms (measure distributions)
HTTP_DURATION = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration',
    ['method', 'path'],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
)

# Gauges (can go up or down)
ACTIVE_CONNECTIONS = Gauge(
    'active_connections',
    'Current number of active connections'
)

PAYMENT_QUEUE_SIZE = Gauge(
    'payment_queue_size',
    'Number of payments in processing queue'
)

# Business metrics
PAYMENTS_PROCESSED = Counter(
    'payments_processed_total',
    'Total payments processed',
    ['status', 'payment_type']
)

PAYMENT_AMOUNT = Histogram(
    'payment_amount_euros',
    'Payment amounts in euros',
    buckets=[1, 10, 50, 100, 500, 1000, 5000, 10000]
)


# ── Structured Logging ────────────────────────────────────────────
class StructuredLogger:
    """
    Outputs JSON logs for Loki to collect.
    JSON logs can be queried with LogQL (Loki's query language).
    """
    
    def __init__(self, service: str):
        self.service = service
        logging.basicConfig(
            level=logging.INFO,
            format='%(message)s'  # Just the JSON, no prefix
        )
        self.logger = logging.getLogger(service)
    
    def _log(self, level: str, message: str, **kwargs):
        record = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": level,
            "service": self.service,
            "message": message,
            **kwargs
        }
        getattr(self.logger, level.lower())(json.dumps(record))
    
    def info(self, message: str, **kwargs):
        self._log("INFO", message, **kwargs)
    
    def warning(self, message: str, **kwargs):
        self._log("WARNING", message, **kwargs)
    
    def error(self, message: str, **kwargs):
        self._log("ERROR", message, **kwargs)


log = StructuredLogger("payment-api")


# ── Request Handler with Instrumentation ─────────────────────────
def process_payment(request):
    """Example payment handler with full observability instrumentation."""
    
    ACTIVE_CONNECTIONS.inc()
    start_time = time.time()
    status_code = "200"
    
    try:
        log.info("Payment received",
                 payment_id=request.get("payment_id"),
                 amount=request.get("amount"),
                 currency=request.get("currency"),
                 payment_type=request.get("type"))
        
        # Simulate payment processing
        result = validate_and_process(request)
        
        # Business metrics
        PAYMENTS_PROCESSED.labels(
            status="success",
            payment_type=request.get("type", "unknown")
        ).inc()
        
        PAYMENT_AMOUNT.observe(request.get("amount", 0))
        
        log.info("Payment processed successfully",
                 payment_id=request.get("payment_id"),
                 duration_ms=round((time.time() - start_time) * 1000))
        
        return result
    
    except ValueError as e:
        status_code = "400"
        PAYMENTS_PROCESSED.labels(status="failed", payment_type="unknown").inc()
        log.error("Payment validation failed",
                  payment_id=request.get("payment_id"),
                  error=str(e))
        raise
    
    except Exception as e:
        status_code = "500"
        PAYMENTS_PROCESSED.labels(status="error", payment_type="unknown").inc()
        log.error("Payment processing error",
                  payment_id=request.get("payment_id"),
                  error=str(e),
                  error_type=type(e).__name__)
        raise
    
    finally:
        duration = time.time() - start_time
        HTTP_REQUESTS.labels(
            method="POST",
            path="/payments",
            status=status_code
        ).inc()
        HTTP_DURATION.labels(method="POST", path="/payments").observe(duration)
        ACTIVE_CONNECTIONS.dec()


# Start metrics server on port 9090
# Prometheus will scrape: http://your-pod:9090/metrics
if __name__ == "__main__":
    start_http_server(9090)
    print("Metrics server started on :9090")
```

---

## Step 3: ServiceMonitor (Tell Prometheus to Scrape Your App)

```yaml
# kubernetes/service-monitor.yml
# This tells Prometheus to scrape your application's metrics

apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: payment-api-metrics
  namespace: monitoring
  labels:
    release: kube-prometheus-stack  # Must match Prometheus label selector
spec:
  namespaceSelector:
    matchNames:
      - production
  selector:
    matchLabels:
      app: payment-api
  endpoints:
    - port: metrics          # Service port named "metrics"
      path: /metrics
      interval: 15s
      scrapeTimeout: 10s

---
# The Service must expose the metrics port
apiVersion: v1
kind: Service
metadata:
  name: payment-api
  namespace: production
  labels:
    app: payment-api
spec:
  ports:
    - name: http
      port: 8080
      targetPort: 8080
    - name: metrics         # This is what ServiceMonitor references
      port: 9090
      targetPort: 9090
  selector:
    app: payment-api
```

---

## Step 4: Alert Rules

```yaml
# kubernetes/alert-rules.yml
# PrometheusRule: define alerts that fire when something is wrong

apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: payment-api-alerts
  namespace: monitoring
  labels:
    release: kube-prometheus-stack
spec:
  groups:
    # ── Application Alerts ─────────────────────────
    - name: payment-api.rules
      interval: 30s
      rules:
        
        # Alert: High error rate
        - alert: HighErrorRate
          expr: |
            (
              rate(http_requests_total{namespace="production", status=~"5.."}[5m])
              /
              rate(http_requests_total{namespace="production"}[5m])
            ) > 0.05
          for: 2m
          labels:
            severity: critical
            team: payments
          annotations:
            summary: "High error rate in {{ $labels.app }}"
            description: |
              Error rate is {{ $value | humanizePercentage }} for {{ $labels.app }}.
              Threshold: 5%
            runbook_url: "https://wiki.company.com/runbooks/high-error-rate"
        
        # Alert: Slow response time
        - alert: SlowResponseTime
          expr: |
            histogram_quantile(0.95,
              rate(http_request_duration_seconds_bucket{namespace="production"}[5m])
            ) > 2.0
          for: 5m
          labels:
            severity: warning
            team: payments
          annotations:
            summary: "Slow response time in {{ $labels.app }}"
            description: |
              P95 latency is {{ $value | humanizeDuration }} (threshold: 2s)
        
        # Alert: No traffic (service down?)
        - alert: NoTraffic
          expr: |
            rate(http_requests_total{namespace="production", app="payment-api"}[5m]) == 0
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Payment API receiving no traffic"
            description: "Zero requests in the last 5 minutes — service may be down"
        
        # Business Alert: Payment failure rate too high
        - alert: HighPaymentFailureRate
          expr: |
            (
              rate(payments_processed_total{status="failed"}[10m])
              /
              rate(payments_processed_total[10m])
            ) > 0.02
          for: 5m
          labels:
            severity: critical
            team: payments
          annotations:
            summary: "High payment failure rate"
            description: |
              {{ $value | humanizePercentage }} of payments failing (threshold: 2%)
              This is a business-critical alert.
    
    # ── Kubernetes Alerts ──────────────────────────
    - name: kubernetes.rules
      rules:
        
        # Alert: Pod crash looping
        - alert: PodCrashLooping
          expr: |
            kube_pod_container_status_restarts_total{namespace="production"} > 5
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.pod }} is crash looping"
            description: "Container {{ $labels.container }} restarted {{ $value }} times"
        
        # Alert: Node disk full
        - alert: NodeDiskFull
          expr: |
            (1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)) > 0.85
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Node disk is {{ $value | humanizePercentage }} full"
            description: "Disk on {{ $labels.instance }} is almost full"
        
        # Alert: High memory usage
        - alert: HighMemoryUsage
          expr: |
            (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) > 0.90
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High memory usage on {{ $labels.instance }}"
            description: "Memory usage is {{ $value | humanizePercentage }}"
```

---

## Step 5: Essential PromQL Queries

```promql
# ── Useful PromQL queries for Grafana dashboards ──────────────────

# REQUEST RATE (requests per second, per service)
rate(http_requests_total{namespace="production"}[5m])

# ERROR RATE (percentage of 5xx errors)
(
  rate(http_requests_total{status=~"5.."}[5m])
  /
  rate(http_requests_total[5m])
) * 100

# P95 LATENCY (95th percentile response time)
histogram_quantile(0.95,
  rate(http_request_duration_seconds_bucket[5m])
)

# CPU USAGE PER POD
sum(rate(container_cpu_usage_seconds_total{namespace="production"}[5m]))
by (pod)

# MEMORY USAGE PER POD (in MB)
sum(container_memory_working_set_bytes{namespace="production"})
by (pod) / 1024 / 1024

# POD RESTART COUNT (last 1 hour)
increase(kube_pod_container_status_restarts_total{namespace="production"}[1h])

# CLUSTER CPU CAPACITY vs REQUESTS
sum(kube_node_status_allocatable{resource="cpu"})
vs
sum(kube_pod_container_resource_requests{resource="cpu"})

# SLO: Availability (% of successful requests in last 30 days)
(
  1 - (
    increase(http_requests_total{status=~"5.."}[30d])
    /
    increase(http_requests_total[30d])
  )
) * 100

# HPA SCALING ACTIVITY
kube_horizontalpodautoscaler_status_current_replicas
kube_horizontalpodautoscaler_status_desired_replicas
```

---

## Step 6: Essential LogQL Queries (Loki)

```logql
# ── Useful LogQL queries for Grafana Explore ──────────────────────

# All errors from payment-api in last 1 hour
{namespace="production", app="payment-api"} |= "ERROR"

# Parse JSON logs and filter by level
{namespace="production"} | json | level = "ERROR"

# Count errors per minute (for rate chart)
rate({namespace="production"} |= "ERROR" [1m])

# Parse JSON and extract payment_id from structured logs
{namespace="production", app="payment-api"}
  | json
  | payment_id != ""
  | line_format "PaymentID={{ .payment_id }} Error={{ .error }}"

# Find slow operations (>1000ms) in JSON logs
{namespace="production"}
  | json
  | duration_ms > 1000
  | line_format "{{ .service }}: {{ .message }} ({{ .duration_ms }}ms)"

# Error rate per service (last 5 minutes)
sum by (service) (
  count_over_time(
    {namespace="production"} | json | level = "ERROR" [5m]
  )
)

# Find all logs for a specific request (correlation)
{namespace="production"} | json | request_id = "req-abc123"

# Count payment failures by error type
sum by (error_type) (
  count_over_time(
    {namespace="production", app="payment-api"}
    | json
    | status = "failed"
    [5m]
  )
)
```

---

## Step 7: Grafana Dashboard — Application Overview

```json
// application-overview-dashboard.json
// Import this in Grafana (Dashboards → Import → Paste JSON)
{
  "title": "Payment API — Production Overview",
  "uid": "payment-api-overview",
  "tags": ["production", "payment-api"],
  "time": {"from": "now-6h", "to": "now"},
  "refresh": "30s",
  "panels": [
    {
      "title": "Request Rate (req/s)",
      "type": "timeseries",
      "gridPos": {"h": 8, "w": 8, "x": 0, "y": 0},
      "targets": [{
        "expr": "sum(rate(http_requests_total{namespace='production',app='payment-api'}[5m])) by (status)",
        "legendFormat": "HTTP {{status}}"
      }],
      "fieldConfig": {
        "defaults": {
          "unit": "reqps",
          "thresholds": {
            "steps": [
              {"value": 0, "color": "green"},
              {"value": 1000, "color": "yellow"},
              {"value": 5000, "color": "red"}
            ]
          }
        }
      }
    },
    {
      "title": "Error Rate (%)",
      "type": "stat",
      "gridPos": {"h": 4, "w": 4, "x": 8, "y": 0},
      "targets": [{
        "expr": "sum(rate(http_requests_total{namespace='production',app='payment-api',status=~'5..'}[5m])) / sum(rate(http_requests_total{namespace='production',app='payment-api'}[5m])) * 100",
        "legendFormat": "Error Rate"
      }],
      "options": {
        "colorMode": "background",
        "thresholds": {
          "steps": [
            {"value": 0, "color": "green"},
            {"value": 1, "color": "yellow"},
            {"value": 5, "color": "red"}
          ]
        }
      }
    },
    {
      "title": "P95 Latency (ms)",
      "type": "stat",
      "gridPos": {"h": 4, "w": 4, "x": 12, "y": 0},
      "targets": [{
        "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace='production',app='payment-api'}[5m])) by (le)) * 1000",
        "legendFormat": "P95"
      }],
      "options": {
        "unit": "ms",
        "thresholds": {
          "steps": [
            {"value": 0, "color": "green"},
            {"value": 500, "color": "yellow"},
            {"value": 2000, "color": "red"}
          ]
        }
      }
    },
    {
      "title": "Pod Count",
      "type": "stat",
      "gridPos": {"h": 4, "w": 4, "x": 16, "y": 0},
      "targets": [{
        "expr": "count(kube_pod_status_ready{namespace='production',pod=~'payment-api.*',condition='true'})",
        "legendFormat": "Ready Pods"
      }]
    },
    {
      "title": "Recent Errors (Logs)",
      "type": "logs",
      "gridPos": {"h": 8, "w": 24, "x": 0, "y": 16},
      "targets": [{
        "expr": "{namespace='production',app='payment-api'} | json | level = 'ERROR'",
        "legendFormat": ""
      }],
      "datasource": "Loki"
    }
  ]
}
```

---

## Runbook — Responding to Alerts

```markdown
## Runbook: HighErrorRate

**Alert:** Error rate > 5% for payment-api in production
**Severity:** Critical

### Step 1: Confirm the alert (2 minutes)
```bash
# Check current error rate
kubectl exec -n monitoring prometheus-0 -- \
  promtool query instant \
  'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100'

# Check recent pods
kubectl get pods -n production -l app=payment-api
```

### Step 2: Check logs (3 minutes)
```bash
# Get recent error logs
kubectl logs -n production -l app=payment-api --since=5m | grep ERROR | tail -50

# Or in Grafana Explore (Loki):
# {namespace="production",app="payment-api"} | json | level = "ERROR"
```

### Step 3: Check recent deployments (1 minute)
```bash
# Was there a recent deployment?
kubectl rollout history deployment/payment-api -n production
```

### Step 4: Decision
- If recent deployment caused it → ROLLBACK immediately
  ```bash
  kubectl rollout undo deployment/payment-api -n production
  ```
- If no recent deployment → escalate to on-call developer
- If database issue → check RDS metrics in CloudWatch

### Step 5: Communicate
Post in #incidents Slack channel:
```
@here INCIDENT: Payment API high error rate
Status: Investigating
ETA: 30 minutes
Lead: @your-name
```

### Step 6: Post-incident
- Write postmortem within 24 hours
- Add to ISO 9001 incident register
- Check if alert threshold needs tuning
```

---

## Interview Questions — Observability

**Q: What is the difference between metrics, logs, and traces?**
```
METRICS (Prometheus):
  → Numbers over time (count, gauge, histogram)
  → "How many requests per second?" "What is P95 latency?"
  → Low cardinality (limited label values)
  → Stored efficiently (not every request, just aggregates)
  → USE FOR: Dashboards, alerting, capacity planning

LOGS (Loki/ELK):
  → Text events (what happened, when)
  → "What errors occurred at 3:14pm?"
  → High cardinality (one record per event)
  → Contains context (user_id, payment_id, stack trace)
  → USE FOR: Debugging, root cause analysis

TRACES (Jaeger/Tempo):
  → Request flow across multiple services
  → "Why is this request slow? Which service is the bottleneck?"
  → Shows parent-child relationships between service calls
  → USE FOR: Performance optimization, finding bottlenecks

Together: "Something is wrong" → metrics alert fires
          "What is wrong?" → logs show the errors
          "Why is it wrong?" → traces show where in the call chain
```

**Q: What is an SLO and how do you implement it?**
```
SLO = Service Level Objective = a measurable quality target

Example:
  SLO: 99.9% of payment requests succeed in < 2 seconds over 30 days

How to implement:
  1. Define the SLI (Service Level Indicator)
     SLI = rate(success_requests[30d]) / rate(total_requests[30d]) * 100
     
  2. Set the SLO threshold (99.9%)
  
  3. Calculate the error budget:
     Error budget = 1 - 0.999 = 0.001 = 0.1%
     In a 30-day month = 43.2 minutes of allowed downtime
     
  4. Alert on error budget burn rate (not just current error rate):
     If you're burning 2x the budget rate → warn (will run out in 15 days)
     If burning 5x → page on-call immediately (run out in 6 days)
  
  5. When error budget is exhausted:
     Stop new feature work → focus on reliability
     
PromQL for SLO burn rate:
  (
    rate(http_requests_total{status=~"5.."}[1h])
    / rate(http_requests_total[1h])
  ) / (1 - 0.999)
  > 2  # Burning 2x the budget rate
```

---

[← Complete CI/CD Platform](./05-complete-cicd-platform.md) | [← Section 11 Overview](./README.md) | [← Main Menu](../README.md)
