# AlertManager — Alerts and Notifications

> **Level:** Advanced
> **Prerequisites:** Prometheus & Grafana, Monitoring & Observability
> **You will learn:** AlertManager architecture, routing tree, receivers (Slack, PagerDuty, email), inhibition, silences, Helm install

---

## What is AlertManager?

AlertManager handles alerts fired by Prometheus. It deduplicates, groups, and routes them to the correct receivers (Slack, PagerDuty, email, webhook).

```
Alert flow:

Prometheus (evaluates rules every 15s)
    │
    │  AlertManager receives all firing alerts
    ▼
AlertManager
    ├── Deduplication (same alert fires from 3 replicas → 1 notification)
    ├── Grouping (100 alerts for 1 broken service → 1 message)
    ├── Routing (route by labels → correct receiver)
    ├── Inhibition (high-severity alert suppresses low-severity ones)
    └── Silencing (maintenance window — suppress for N hours)
         │
         ▼
   Receivers:
     Slack #ops-critical
     PagerDuty (on-call rotation)
     Email ops-team@company.com
     Webhook (custom integration)
```

---

## Install via Helm

```bash
# AlertManager is included in kube-prometheus-stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install with custom alertmanager config
helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  -f alertmanager-values.yaml
```

---

## AlertManager Configuration

```yaml
# alertmanager-values.yaml (Helm values for kube-prometheus-stack)
alertmanager:
  config:
    global:
      resolve_timeout: 5m
      slack_api_url: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
      pagerduty_url:  "https://events.pagerduty.com/v2/enqueue"

    # ── ROUTING TREE ──────────────────────────────────────────────
    route:
      group_by: ['alertname', 'cluster', 'namespace']
      group_wait:      30s    # wait 30s to group alerts before sending
      group_interval:  5m     # send updates every 5 min for ongoing incidents
      repeat_interval: 4h     # re-notify if still firing after 4 hours
      receiver: slack-default

      routes:
        # Critical alerts → PagerDuty (wake people up)
        - matchers:
            - severity="critical"
          receiver: pagerduty-critical
          continue: true   # also send to Slack

        # Critical alerts also go to Slack #ops-critical
        - matchers:
            - severity="critical"
          receiver: slack-critical

        # Warning alerts → Slack #ops-warnings only
        - matchers:
            - severity="warning"
          receiver: slack-warnings

        # Database alerts → dedicated DBA channel
        - matchers:
            - team="database"
          receiver: slack-dba
          group_wait: 10s

        # Silence noisy canary alerts during business hours
        - matchers:
            - job="canary"
          receiver: "null"   # discard canary alerts
          active_time_intervals:
            - business-hours

    # ── RECEIVERS ─────────────────────────────────────────────────
    receivers:
      - name: "null"   # discard receiver

      - name: slack-default
        slack_configs:
          - channel: "#ops-general"
            title: '[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}'
            text: >-
              {{ range .Alerts }}
              *Alert:* {{ .Annotations.summary }}
              *Description:* {{ .Annotations.description }}
              *Severity:* {{ .Labels.severity }}
              *Namespace:* {{ .Labels.namespace }}
              {{ end }}
            send_resolved: true

      - name: slack-critical
        slack_configs:
          - channel: "#ops-critical"
            color: '{{ if eq .Status "firing" }}danger{{ else }}good{{ end }}'
            title: '🔥 CRITICAL: {{ .CommonLabels.alertname }}'
            text: >-
              {{ range .Alerts }}
              *Summary:* {{ .Annotations.summary }}
              *Impact:* {{ .Annotations.impact | default "Unknown" }}
              *Runbook:* {{ .Annotations.runbook_url | default "N/A" }}
              {{ end }}
            send_resolved: true
            actions:
              - type: button
                text: "View in Grafana"
                url: "{{ (index .Alerts 0).GeneratorURL }}"

      - name: slack-warnings
        slack_configs:
          - channel: "#ops-warnings"
            color: "warning"
            title: '⚠️ {{ .CommonLabels.alertname }}'
            text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
            send_resolved: true

      - name: slack-dba
        slack_configs:
          - channel: "#team-dba"
            title: 'DB Alert: {{ .CommonLabels.alertname }}'
            text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

      - name: pagerduty-critical
        pagerduty_configs:
          - routing_key: "{{ .ExternalURL }}"
            service_key: YOUR_PAGERDUTY_SERVICE_KEY
            description: '{{ .CommonLabels.alertname }}: {{ .CommonAnnotations.summary }}'
            severity: critical
            details:
              namespace: '{{ .CommonLabels.namespace }}'
              cluster:   '{{ .CommonLabels.cluster }}'

    # ── INHIBITION RULES ──────────────────────────────────────────
    inhibit_rules:
      # If a node is down, suppress all pod alerts on that node
      - source_matchers:
          - alertname="NodeDown"
        target_matchers:
          - alertname=~"Pod.*"
        equal: ['node']

      # If cluster is down, suppress everything else
      - source_matchers:
          - alertname="KubernetesClusterUnreachable"
        target_matchers:
          - severity=~"warning|critical"

    # ── TIME INTERVALS ────────────────────────────────────────────
    time_intervals:
      - name: business-hours
        time_intervals:
          - times:
              - start_time: "09:00"
                end_time:   "18:00"
            weekdays: ['monday:friday']
            location: "America/New_York"
```

---

## Prometheus Alert Rules

```yaml
# k8s/prometheus-rules.yaml

apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: production-alerts
  namespace: monitoring
  labels:
    prometheus: kube-prometheus
    role: alert-rules
spec:
  groups:
    - name: kubernetes.availability
      interval: 30s
      rules:
        - alert: PodCrashLooping
          expr: |
            rate(kube_pod_container_status_restarts_total[15m]) * 60 > 0
          for: 5m
          labels:
            severity: critical
            team: platform
          annotations:
            summary: "Pod {{ $labels.pod }} is crash-looping"
            description: "{{ $labels.namespace }}/{{ $labels.pod }} has restarted {{ $value | humanize }} times/min"
            runbook_url: "https://wiki.company.com/runbooks/pod-crash-looping"

        - alert: DeploymentReplicasMismatch
          expr: |
            kube_deployment_spec_replicas != kube_deployment_status_available_replicas
          for: 10m
          labels:
            severity: warning
            team: platform
          annotations:
            summary: "Deployment {{ $labels.deployment }} has {{ $value }} unavailable replicas"
            description: "Expected replicas: {{ $labels.deployment }} replicas are not all available"

    - name: application.sla
      rules:
        - alert: HighErrorRate
          expr: |
            (
              sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
              /
              sum(rate(http_requests_total[5m])) by (service)
            ) * 100 > 1
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "{{ $labels.service }} error rate is {{ $value | humanizePercentage }}"
            impact: "Users are experiencing errors on {{ $labels.service }}"

        - alert: HighLatencyP99
          expr: |
            histogram_quantile(0.99,
              sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)
            ) > 2
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "{{ $labels.service }} p99 latency is {{ $value | humanizeDuration }}"

    - name: infrastructure.capacity
      rules:
        - alert: NodeDiskSpaceHigh
          expr: |
            (node_filesystem_size_bytes - node_filesystem_free_bytes)
            / node_filesystem_size_bytes * 100 > 85
          for: 15m
          labels:
            severity: warning
            team: platform
          annotations:
            summary: "Node {{ $labels.instance }} disk is {{ $value | humanizePercentage }} full"

        - alert: NodeDiskSpaceCritical
          expr: |
            (node_filesystem_size_bytes - node_filesystem_free_bytes)
            / node_filesystem_size_bytes * 100 > 95
          for: 5m
          labels:
            severity: critical
            team: platform
          annotations:
            summary: "Node {{ $labels.instance }} disk is critically full ({{ $value | humanizePercentage }})"

        - alert: PersistentVolumeAlmostFull
          expr: |
            kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100 > 90
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "PVC {{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full"
```

---

## Silence (Maintenance Window)

```bash
# Create a 4-hour silence for a planned maintenance window via API

curl -X POST http://alertmanager:9093/api/v2/silences \
  -H "Content-Type: application/json" \
  -d '{
    "matchers": [
      {"name": "namespace", "value": "production", "isRegex": false},
      {"name": "severity",  "value": "warning",    "isRegex": false}
    ],
    "startsAt":  "2026-05-20T22:00:00Z",
    "endsAt":    "2026-05-21T02:00:00Z",
    "createdBy": "ops-team",
    "comment":   "Planned maintenance: database upgrade 22:00-02:00 UTC"
  }'

# List active silences
curl http://alertmanager:9093/api/v2/silences

# Delete a silence
curl -X DELETE http://alertmanager:9093/api/v2/silences/{silenceID}
```

---

## Testing Alerts

```bash
# Send a test alert to AlertManager (verify routing works before production)

curl -X POST http://alertmanager:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity":  "warning",
      "namespace": "test",
      "job":       "test"
    },
    "annotations": {
      "summary":     "This is a test alert",
      "description": "Verifying AlertManager routing is working correctly"
    },
    "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }]'

# Check AlertManager status
curl http://alertmanager:9093/api/v2/status | jq .

# List currently firing alerts
curl http://alertmanager:9093/api/v2/alerts | jq '.[] | {alertname: .labels.alertname, status: .status.state}'
```

---

## Interview Questions

**Q: An alert is firing but your team is getting flooded with duplicate notifications. How do you fix it?**
> AlertManager deduplication and grouping solve this. Set `group_by: ['alertname', 'cluster']` so 100 pods restarting in one cluster becomes 1 notification. Set `group_wait: 30s` to accumulate alerts before sending. Use `inhibit_rules` to suppress downstream alerts when a root cause alert fires (e.g., node down suppresses all pod alerts on that node).

**Q: What's the difference between silence and inhibition?**
> Silence: manual, time-bounded suppression — created by a human for maintenance windows. Inhibition: automatic, rule-based suppression — if alert A is firing, suppress alert B with the same labels. Silences expire; inhibitions are permanent rules in the config.

**Q: How do you design alert routing for a multi-team organization?**
> Use label-based routing. Each alert has a `team` label (set in Prometheus rule definitions). AlertManager routes `team=database` to the DBA Slack channel, `team=platform` to platform Slack, `severity=critical` goes to PagerDuty regardless of team. This way each team owns their alerts without modifying the central routing config.

---

[← Loki Logging](./02-loki-logging.md) | [Back to Section](./README.md) | [Next: Observability Stack →](./04-observability-stack.md)
