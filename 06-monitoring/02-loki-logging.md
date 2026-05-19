# Loki — Centralized Log Aggregation

> Loki is "like Prometheus but for logs."
> It stores logs efficiently, uses the same labels as Prometheus,
> and integrates natively with Grafana.

---

## Loki vs ELK Stack

| Aspect | Loki + Grafana | ELK (Elasticsearch + Kibana) |
|--------|---------------|------------------------------|
| **Storage cost** | Very cheap (stores only labels + text) | Expensive (full-text index) |
| **Query language** | LogQL (simple) | Lucene (complex) |
| **Setup** | Easy | Complex |
| **Full-text search** | Basic | Excellent |
| **Best for** | DevOps logs, Kubernetes | Complex analytics, security |

---

## Install Loki + Alloy (Grafana Agent)

```bash
# Install with Helm (alongside kube-prometheus-stack)
helm repo add grafana https://grafana.github.io/helm-charts

# Install Loki
helm install loki grafana/loki \
    --namespace monitoring \
    -f loki-values.yaml

# Install Alloy (collects logs and sends to Loki)
helm install alloy grafana/alloy \
    --namespace monitoring \
    -f alloy-values.yaml
```

```yaml
# loki-values.yaml
loki:
  commonConfig:
    replication_factor: 1  # set 3 for production HA
  storage:
    type: s3
    s3:
      bucketNames:
        chunks: my-loki-chunks
        ruler: my-loki-ruler
      region: us-east-1
  schemaConfig:
    configs:
      - from: "2024-01-01"
        store: tsdb
        object_store: s3
        schema: v13
        index:
          prefix: loki_index_
          period: 24h
  limits_config:
    retention_period: 720h    # 30 days
    max_query_series_limit: 5000
```

```yaml
# alloy-values.yaml — collect all pod logs in Kubernetes
alloy:
  configMap:
    create: true
    content: |
      // Discover Kubernetes pods
      discovery.kubernetes "pods" {
        role = "pod"
      }

      // Filter and relabel
      discovery.relabel "pods" {
        targets = discovery.kubernetes.pods.targets

        // Add Kubernetes labels as Loki labels
        rule {
          source_labels = ["__meta_kubernetes_pod_label_app"]
          target_label  = "app"
        }
        rule {
          source_labels = ["__meta_kubernetes_namespace"]
          target_label  = "namespace"
        }
        rule {
          source_labels = ["__meta_kubernetes_pod_name"]
          target_label  = "pod"
        }
        rule {
          source_labels = ["__meta_kubernetes_container_name"]
          target_label  = "container"
        }
      }

      // Collect logs
      loki.source.kubernetes "pods" {
        targets    = discovery.relabel.pods.output
        forward_to = [loki.write.default.receiver]
      }

      // Send to Loki
      loki.write "default" {
        endpoint {
          url = "http://loki:3100/loki/api/v1/push"
        }
      }
```

---

## LogQL — Query Language for Logs

```logql
# Basic query — show logs from a pod
{app="my-api"}

# Filter by namespace
{namespace="production", app="my-api"}

# Filter log content (pipe operator)
{app="my-api"} |= "ERROR"
{app="my-api"} != "health check"    # exclude health checks
{app="my-api"} |~ "payment.*failed" # regex

# Parse JSON logs
{app="my-api"} | json | level="error"
{app="my-api"} | json | status_code >= 500

# Count errors per minute
sum by (pod) (
    rate({namespace="production", app="my-api"} |= "ERROR" [1m])
)

# Error rate as percentage
sum(rate({app="my-api"} |= "ERROR" [5m]))
/
sum(rate({app="my-api"} [5m]))
* 100

# Top slowest requests (from structured JSON logs)
{app="my-api"} 
    | json 
    | duration > 1000 
    | line_format "{{.method}} {{.path}} {{.duration}}ms"
```

---

## Structured Logging — Best Practice

```python
# Python — structured logging for Loki
import logging
import json
import sys
from datetime import datetime

class StructuredLogger:
    def __init__(self, service_name):
        self.service = service_name
        logging.basicConfig(
            stream=sys.stdout,
            level=logging.INFO,
            format='%(message)s'  # just the JSON, nothing else
        )
        self.logger = logging.getLogger(service_name)

    def _log(self, level, message, **kwargs):
        entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": level,
            "service": self.service,
            "message": message,
            **kwargs
        }
        self.logger.info(json.dumps(entry))

    def info(self, message, **kwargs):
        self._log("INFO", message, **kwargs)

    def error(self, message, **kwargs):
        self._log("ERROR", message, **kwargs)

    def warning(self, message, **kwargs):
        self._log("WARNING", message, **kwargs)

logger = StructuredLogger("payment-api")

# Usage
logger.info("Payment processed",
    payment_id="pay_123",
    amount=99.99,
    currency="USD",
    merchant_id="merchant_456",
    duration_ms=145
)

logger.error("Payment failed",
    payment_id="pay_789",
    error_code="CARD_DECLINED",
    amount=50.00,
    user_id="user_321"
)
```

```javascript
// Node.js — Pino logger (fast, structured)
const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: {
        service: 'payment-api',
        env: process.env.APP_ENV
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => ({ level: label })
    }
});

// Usage
logger.info({ payment_id: 'pay_123', amount: 99.99 }, 'Payment processed');
logger.error({ payment_id: 'pay_789', error: 'CARD_DECLINED' }, 'Payment failed');
```

---

## Grafana — Correlate Metrics and Logs

```
In Grafana, you can link from a metric spike to the logs:

1. See spike in Prometheus error rate graph
2. Click "Explore" on the data point
3. Grafana opens Loki with the same time range
4. Automatically shows logs from that time period

This is called "correlated observability" — seeing metrics and logs together.
```

```bash
# Add Loki as a data source in Grafana
# Grafana → Configuration → Data Sources → Add Loki
# URL: http://loki:3100

# Create a panel with logs
# Dashboard → Add panel → Change panel type to "Logs"
# Query: {namespace="production", app="my-api"} |= "ERROR"
```

---

## CloudWatch Logs — AWS Native

```bash
# Send application logs to CloudWatch
# (from EC2, Lambda, ECS, EKS)

# Lambda logs automatically go to /aws/lambda/function-name

# EKS — send pod logs to CloudWatch
# Install FluentBit as DaemonSet
kubectl apply -f https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/fluent-bit/fluent-bit.yaml

# Query CloudWatch Logs Insights
aws logs start-query \
    --log-group-name "/aws/eks/production/application" \
    --start-time $(date -d "1 hour ago" +%s) \
    --end-time $(date +%s) \
    --query-string '
        fields @timestamp, kubernetes.pod_name, log
        | filter log like /ERROR/
        | sort @timestamp desc
        | limit 50
    '
```

---

## Interview Questions — Loki and Logging

**Q: How do you centralize logs from 50+ microservices?**
> "I use Grafana Alloy as a DaemonSet on every Kubernetes node — it automatically
> discovers all pods and forwards their logs to Loki. Applications log to stdout in
> JSON format — structured logs make querying much easier. In Grafana, I can query
> logs from all services in one place using LogQL, filter by service, error level,
> or request ID. I correlate metrics and logs in the same Grafana dashboard — a
> metric spike shows a button to jump to the logs for that exact time window."

**Q: What is the importance of structured logging?**
> "Structured logging (JSON format) makes logs machine-readable. Instead of parsing
> free text, I can query `| json | status_code >= 500` in LogQL. I can aggregate
> error counts by service, user, or merchant. I can trace a request through 10
> microservices using a single request_id field. Without structured logging, an
> incident investigation is manual regex. With it, I can build dashboards that
> automatically surface problems."

---

[← Back to Section](./README.md) | [Next: Alerting →](./03-alerting.md)
