# CloudWatch — Metrics and Alerts

> **Level:** Intermediate
> **Prerequisites:** AWS Overview, IAM, EC2
> **You will learn:** Metrics, alarms, dashboards, log groups, Insights queries, Lambda monitoring, SNS notifications

---

## What is CloudWatch?

CloudWatch is AWS's native observability service: metrics, logs, alarms, dashboards, and automated responses — all in one.

```
CloudWatch components:

Metrics      → numerical measurements (CPU, request count, latency)
Logs         → text output from services and applications
Alarms       → trigger actions when a metric crosses a threshold
Dashboards   → visualize metrics and logs in one view
Insights     → query language for log analysis
Contributor  → identify top N contributors to a metric
Events/Rules → react to AWS events (instance state change, etc.)
```

---

## Metrics

```bash
# List metrics for an EC2 instance
aws cloudwatch list-metrics \
  --namespace "AWS/EC2" \
  --dimensions Name=InstanceId,Value=i-0abc123456

# Get metric data: last 1 hour of CPU utilization
aws cloudwatch get-metric-data \
  --metric-data-queries '[
    {
      "Id": "cpu",
      "MetricStat": {
        "Metric": {
          "Namespace": "AWS/EC2",
          "MetricName": "CPUUtilization",
          "Dimensions": [{"Name": "InstanceId", "Value": "i-0abc123456"}]
        },
        "Period": 300,
        "Stat": "Average"
      }
    }
  ]' \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

### Custom Metrics (from application)

```python
# app/metrics.py — push custom business metrics to CloudWatch

import boto3
from datetime import datetime

cloudwatch = boto3.client('cloudwatch', region_name='us-east-1')

def record_payment_processed(amount: float, success: bool):
    cloudwatch.put_metric_data(
        Namespace='Banking/Payments',
        MetricData=[
            {
                'MetricName': 'PaymentsProcessed',
                'Dimensions': [
                    {'Name': 'Result', 'Value': 'Success' if success else 'Failure'},
                    {'Name': 'Environment', 'Value': 'production'},
                ],
                'Timestamp': datetime.utcnow(),
                'Value': 1,
                'Unit': 'Count',
            },
            {
                'MetricName': 'PaymentAmount',
                'Dimensions': [{'Name': 'Currency', 'Value': 'USD'}],
                'Timestamp': datetime.utcnow(),
                'Value': amount,
                'Unit': 'None',
            }
        ]
    )
```

---

## Alarms

```bash
# Alarm: alert when EC2 CPU > 80% for 2 consecutive 5-minute periods

aws cloudwatch put-metric-alarm \
  --alarm-name "ec2-high-cpu" \
  --alarm-description "EC2 CPU above 80% for 10 minutes" \
  --namespace "AWS/EC2" \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-0abc123456 \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:ops-alerts \
  --ok-actions arn:aws:sns:us-east-1:123456789012:ops-alerts \
  --treat-missing-data notBreaching

# Alarm: Lambda error rate > 1%
aws cloudwatch put-metric-alarm \
  --alarm-name "lambda-error-rate" \
  --namespace "AWS/Lambda" \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=fn-payments \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 3 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:ops-alerts
```

### SNS Topic for Notifications

```bash
# Create SNS topic
TOPIC_ARN=$(aws sns create-topic --name ops-alerts --query 'TopicArn' --output text)

# Subscribe email
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint ops-team@company.com

# Subscribe Slack via Lambda webhook (common pattern)
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol lambda \
  --notification-endpoint arn:aws:lambda:us-east-1:123456789012:function:slack-notifier
```

---

## Log Groups and Log Streams

```bash
# Create log group
aws logs create-log-group \
  --log-group-name /app/payments \
  --tags Environment=production

# Set retention (don't store logs forever)
aws logs put-retention-policy \
  --log-group-name /app/payments \
  --retention-in-days 30

# Stream logs (like tail -f)
aws logs tail /app/payments --follow

# Get log events from specific stream
aws logs get-log-events \
  --log-group-name /app/payments \
  --log-stream-name "i-0abc123456/application" \
  --start-from-head
```

### Send Application Logs to CloudWatch

```python
# Using CloudWatch agent (installed on EC2) or SDK directly

import boto3
import json
import time

logs = boto3.client('logs', region_name='us-east-1')

LOG_GROUP  = '/app/payments'
LOG_STREAM = 'production-instance-1'

def send_log(message: str, level: str = 'INFO'):
    log_entry = json.dumps({
        'timestamp': int(time.time() * 1000),
        'level':     level,
        'message':   message,
        'service':   'payments',
    })

    logs.put_log_events(
        logGroupName=LOG_GROUP,
        logStreamName=LOG_STREAM,
        logEvents=[{
            'timestamp': int(time.time() * 1000),
            'message':   log_entry,
        }]
    )
```

---

## CloudWatch Insights (Log Queries)

```
# CloudWatch Insights query syntax — run in AWS Console or CLI

# Error count by service in last 1 hour
fields @timestamp, level, message, service
| filter level = "ERROR"
| stats count() as errorCount by service
| sort errorCount desc
| limit 20

# P95 latency by endpoint
fields @timestamp, endpoint, duration_ms
| filter ispresent(duration_ms)
| stats pct(duration_ms, 95) as p95, avg(duration_ms) as avg_ms by endpoint
| sort p95 desc

# Find all payments over $10,000
fields @timestamp, message
| filter message like /PaymentAmount/
| parse message '"amount": *,' as amount
| filter amount > 10000
| sort @timestamp desc

# Lambda cold starts
fields @timestamp, @initDuration, @duration
| filter @initDuration > 0
| stats avg(@initDuration) as avg_cold_start, count() as cold_starts by bin(1h)
```

```bash
# Run Insights query via CLI
aws logs start-query \
  --log-group-names "/aws/lambda/fn-payments" \
  --start-time $(date -d '1 hour ago' +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @duration | filter @duration > 1000 | sort @duration desc | limit 100'

# Get results (queryId from above)
aws logs get-query-results --query-id abc-123-xyz
```

---

## CloudWatch Dashboard (Terraform)

```hcl
# terraform/cloudwatch-dashboard.tf

resource "aws_cloudwatch_dashboard" "production" {
  dashboard_name = "production-overview"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title  = "EC2 CPU Utilization"
          period = 300
          stat   = "Average"
          metrics = [
            ["AWS/EC2", "CPUUtilization", "InstanceId", "i-0abc123456"]
          ]
          view   = "timeSeries"
          yAxis  = { left = { min = 0, max = 100 } }
        }
      },
      {
        type = "metric"
        properties = {
          title  = "Lambda Errors vs Invocations"
          period = 60
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "fn-payments"],
            ["AWS/Lambda", "Errors",      "FunctionName", "fn-payments", { color = "#d62728" }]
          ]
          view = "timeSeries"
        }
      },
      {
        type = "log"
        properties = {
          title   = "Recent Errors"
          region  = "us-east-1"
          query   = "SOURCE '/app/payments' | fields @timestamp, message | filter level='ERROR' | limit 20"
          view    = "table"
        }
      }
    ]
  })
}

# Composite alarm: alert only if BOTH CPU and memory are high
resource "aws_cloudwatch_composite_alarm" "high_load" {
  alarm_name = "high-load-composite"
  alarm_rule = "ALARM(aws_cloudwatch_metric_alarm.cpu.alarm_name) AND ALARM(aws_cloudwatch_metric_alarm.memory.alarm_name)"

  alarm_actions = [aws_sns_topic.ops.arn]
}
```

---

## CloudWatch Agent on EC2

```json
// /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "cwagent"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/nginx/access.log",
            "log_group_name": "/ec2/nginx/access",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 30
          },
          {
            "file_path": "/var/log/app/application.log",
            "log_group_name": "/ec2/app",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 30
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "CWAgent",
    "metrics_collected": {
      "mem": {
        "measurement": ["mem_used_percent"],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": ["used_percent"],
        "resources": ["/"],
        "metrics_collection_interval": 60
      }
    }
  }
}
```

```bash
# Install and start CloudWatch agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s
```

---

## Interview Questions

**Q: What is the difference between CloudWatch Metrics and CloudWatch Logs?**
> Metrics are numerical time-series data sampled at a period (CPUUtilization = 72.3% at 14:05). Logs are text records (access logs, application output). Metrics are for alerting and dashboards; Logs are for debugging and auditing. Metrics Insights can query metrics with SQL-like syntax; CloudWatch Logs Insights queries log text.

**Q: How do you monitor a Lambda function in production?**
> CloudWatch automatically records: Invocations, Errors, Duration, Throttles, ConcurrentExecutions. Add custom metrics for business logic (payments processed, cart abandonment). Set alarms on Errors rate and Duration p99. Use Logs Insights to find cold start patterns (`filter @initDuration > 0`). Enable X-Ray for distributed tracing.

**Q: An alarm fires at 2 AM. How do you investigate?**
> 1. CloudWatch Alarm → check the metric that triggered it. 2. Go to Logs Insights → query the relevant log group around the alarm time. 3. Check related metrics (was there a spike in traffic? a deployment?). 4. Correlate with CloudTrail if it's an IAM/API issue. 5. Check EC2/ECS/Lambda service health dashboard.

---

[← EKS](./07-eks-kubernetes.md) | [Back to Section](./README.md) | [Next: Route 53 →](./09-route53-dns.md)
