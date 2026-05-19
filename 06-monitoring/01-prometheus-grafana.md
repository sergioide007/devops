# Prometheus and Grafana

> Prometheus collects metrics from your applications and infrastructure.
> Grafana displays those metrics in beautiful dashboards.
> Together, they are the standard for Kubernetes monitoring.

---

## How Prometheus Works

```
Application (exposes /metrics)
        ↑
Prometheus (pulls metrics every 15s)
        ↓
PromQL queries
        ↓
Grafana (visualizes)
        ↓
AlertManager (sends alerts)
```

**Prometheus pulls metrics.** Your app must expose a `/metrics` endpoint.

---

## Deploy Prometheus + Grafana on Kubernetes

```bash
# Install with Helm (recommended)
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install kube-prometheus-stack (includes Prometheus, Grafana, AlertManager)
helm install monitoring prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --create-namespace \
    -f monitoring-values.yaml

kubectl get pods -n monitoring
# NAME                                       READY   STATUS    RESTARTS
# alertmanager-monitoring-kube-prometheus-alertmanager-0   2/2     Running
# monitoring-grafana-5d9b4c77-xk2rp          3/3     Running
# monitoring-kube-prometheus-operator-xxx    1/1     Running
# prometheus-monitoring-kube-prometheus-prometheus-0        2/2     Running
```

```yaml
# monitoring-values.yaml
prometheus:
  prometheusSpec:
    retention: 30d           # keep metrics for 30 days
    storageSpec:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 50Gi

grafana:
  adminPassword: "my-secure-password"
  persistence:
    enabled: true
    size: 10Gi
  ingress:
    enabled: true
    hosts:
      - grafana.mycompany.com

alertmanager:
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 10Gi
```

---

## Instrument Your Application — Expose Metrics

```python
# Python + Flask with Prometheus metrics
from flask import Flask
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
import time

app = Flask(__name__)

# Define metrics
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status_code']
)

REQUEST_DURATION = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration',
    ['method', 'endpoint'],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
)

@app.before_request
def start_timer():
    from flask import g
    g.start_time = time.time()

@app.after_request
def record_metrics(response):
    from flask import g, request
    duration = time.time() - g.start_time

    REQUEST_COUNT.labels(
        method=request.method,
        endpoint=request.path,
        status_code=response.status_code
    ).inc()

    REQUEST_DURATION.labels(
        method=request.method,
        endpoint=request.path
    ).observe(duration)

    return response

@app.route('/metrics')
def metrics():
    return generate_latest(), 200, {'Content-Type': CONTENT_TYPE_LATEST}

@app.route('/health')
def health():
    return {'status': 'ok'}
```

```javascript
// Node.js with prom-client
const express = require('express');
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
});

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
    registers: [register]
});

const app = express();

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        httpRequestsTotal.labels(req.method, req.route?.path || req.path, res.statusCode).inc();
        httpRequestDuration.labels(req.method, req.route?.path || req.path).observe(duration);
    });
    next();
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});
```

---

## Tell Prometheus to Scrape Your App

```yaml
# ServiceMonitor (kube-prometheus-stack picks this up automatically)
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: my-api-monitor
  namespace: production
  labels:
    release: monitoring     # must match Prometheus selector
spec:
  selector:
    matchLabels:
      app: my-api
  endpoints:
    - port: http
      path: /metrics
      interval: 15s         # scrape every 15 seconds
      scrapeTimeout: 10s
```

---

## PromQL — Query Language for Metrics

```promql
# HTTP requests per second
rate(http_requests_total[5m])

# Error rate (%)
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
* 100

# 95th percentile response time
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# CPU usage per pod
sum(rate(container_cpu_usage_seconds_total{namespace="production"}[5m])) by (pod)

# Memory usage per pod
sum(container_memory_usage_bytes{namespace="production"}) by (pod)
  / 1024 / 1024     # convert to MB

# Pods not running
kube_pod_status_phase{phase!~"Running|Succeeded"} == 1

# Number of restarts in last 15 minutes
increase(kube_pod_container_status_restarts_total[15m]) > 0

# Disk usage (node)
(node_filesystem_size_bytes - node_filesystem_free_bytes) 
/ node_filesystem_size_bytes * 100
```

---

## Grafana Dashboards

```bash
# Access Grafana
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
# Open: http://localhost:3000
# User: admin
# Pass: (from values.yaml or secret)

# Import pre-built dashboards from grafana.com:
# Dashboard 6417 → Kubernetes Cluster Overview
# Dashboard 1860 → Node Exporter Full
# Dashboard 315  → Kubernetes Pod Resources
# Dashboard 7249 → PostgreSQL
# Dashboard 763  → Redis
```

```json
// Example: Create dashboard programmatically (Grafana API)
{
  "dashboard": {
    "title": "My API Dashboard",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{app=\"my-api\"}[5m]))",
            "legendFormat": "Requests/sec"
          }
        ]
      },
      {
        "title": "Error Rate %",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{app=\"my-api\",status_code=~\"5..\"}[5m])) / sum(rate(http_requests_total{app=\"my-api\"}[5m])) * 100"
          }
        ],
        "thresholds": {
          "steps": [
            {"value": null, "color": "green"},
            {"value": 1, "color": "yellow"},
            {"value": 5, "color": "red"}
          ]
        }
      }
    ]
  }
}
```

---

## CloudWatch — AWS Monitoring

```bash
# Create CloudWatch dashboard
aws cloudwatch put-dashboard \
    --dashboard-name "production-api" \
    --dashboard-body file://dashboard.json

# Create CloudWatch alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "api-error-rate-high" \
    --alarm-description "Alert when error rate exceeds 5%" \
    --metric-name 5xxErrorRate \
    --namespace AWS/ApplicationELB \
    --dimensions Name=LoadBalancer,Value=app/my-alb/xxxx \
    --statistic Average \
    --period 60 \
    --evaluation-periods 3 \
    --threshold 5 \
    --comparison-operator GreaterThanThreshold \
    --alarm-actions arn:aws:sns:us-east-1:123456789:alerts-topic \
    --ok-actions arn:aws:sns:us-east-1:123456789:alerts-topic

# Query logs with CloudWatch Insights
aws logs start-query \
    --log-group-name "/aws/eks/production/application" \
    --start-time $(date -d "1 hour ago" +%s) \
    --end-time $(date +%s) \
    --query-string 'fields @timestamp, @message
        | filter level = "ERROR"
        | stats count() as errorCount by bin(5m)
        | sort errorCount desc'
```

---

## SLOs and SLAs — Key Concepts

```
SLA (Service Level Agreement)   → contract with customer (e.g., 99.9% uptime)
SLO (Service Level Objective)   → internal target (e.g., 99.95% to stay under SLA)
SLI (Service Level Indicator)   → the actual measurement (e.g., current uptime %)
Error Budget = 100% - SLO target
```

```promql
# SLO: 99.9% of requests under 200ms in the last 30 days
# SLI: actual percentage

# Calculate error rate (bad requests / total requests)
1 - (
    sum(rate(http_request_duration_seconds_bucket{le="0.2"}[30d]))
    /
    sum(rate(http_request_duration_seconds_count[30d]))
)

# Error budget remaining
(1 - 0.999) - (current_error_rate)
```

---

## Grafana K6 — Load Testing

```javascript
// k6-test.js — load test your API
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
    stages: [
        { duration: '1m', target: 50 },    // ramp up to 50 users
        { duration: '5m', target: 50 },    // stay at 50 users
        { duration: '2m', target: 200 },   // spike to 200 users
        { duration: '5m', target: 200 },   // stay at 200
        { duration: '2m', target: 0 },     // ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
        errors: ['rate<0.01'],             // error rate under 1%
    },
};

export default function () {
    const response = http.get('https://api.mycompany.com/users');

    const success = check(response, {
        'status is 200': (r) => r.status === 200,
        'response time < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(!success);
    sleep(1);
}
```

```bash
# Run load test
k6 run k6-test.js

# Run and send results to Prometheus
k6 run --out prometheus=http://prometheus:9090/api/v1/write k6-test.js

# Run and send results to Grafana Cloud k6
k6 run --out cloud k6-test.js
```

---

## Interview Questions — Monitoring

**Q: What is the difference between monitoring and observability?**
> "Monitoring is watching pre-defined metrics — you know what to watch because you
> defined the alerts in advance. Observability means you can ask arbitrary questions
> about your system's behavior and find answers. With observability, when something
> unexpected happens, I can explore metrics, logs, and traces together in Grafana to
> understand the root cause, even if I never anticipated that specific failure mode."

**Q: What are your key SLOs and how do you track them?**
> "For a payment API, I track: availability (99.9%), P95 response time under 200ms,
> and error rate under 0.1%. I track these with Prometheus and display them in Grafana
> with error budget burn rate dashboards. When the error budget burn rate is too high,
> we stop shipping new features until reliability is restored."

**Q: How do you handle an incident — walk me through your process.**
> "Triggered by an alert. I open the Grafana dashboard to see which metrics are
> abnormal. I check logs in Loki for error messages. I look at recent deployments in
> Jenkins — did we ship anything recently? I check AWS CloudWatch if it's infrastructure.
> I communicate in Slack — 'investigating X, ETA Y'. I fix, verify metrics recover,
> write a post-mortem within 24 hours with root cause and prevention actions."

---

[← Back to Section](./README.md) | [Next: Loki Logging →](./02-loki-logging.md)
