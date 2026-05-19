# Retail Sector — SOC 2, PCI-DSS, CCPA, High-Traffic Deployments

> Retail has unique challenges: Black Friday traffic spikes (10x normal),
> card payments everywhere, customer data in every system, and
> the need to deploy features FAST for competitive advantage.
> DevOps in retail balances speed, scale, and compliance.

---

## Retail Regulatory Landscape

```
RETAIL COMPLIANCE REQUIREMENTS:

PCI-DSS (Payment Card Industry)
  → Mandatory if you accept cards (and you do)
  → See Section 06 for full details
  → Retail-specific: customer checkout, payment terminals (POS)

SOC 2 Type II (Service Organization Controls)
  → Required by enterprise B2B customers (they demand it before signing)
  → Proves your security controls work over time (12-month audit period)
  → 5 Trust Service Criteria: Security, Availability, Confidentiality,
    Processing Integrity, Privacy

CCPA (California Consumer Privacy Act)
  → Required if you have California customers and >$25M revenue
  → See Section 07 for full details
  → Retail-specific: purchase history, loyalty programs, browsing data

GDPR (if EU customers)
  → See Section 07

ADA / WCAG (Accessibility)
  → Not directly DevOps but affects frontend deployments
  → Automated accessibility testing in CI pipeline
```

---

## SOC 2 Type II for Retail DevOps

```
SOC 2 audits are performed by certified auditors (CPAs)
They check: "Do your security controls actually work?"
Type I = Controls EXIST (point in time)
Type II = Controls WORK CONSISTENTLY (over 12 months audit period)

5 Trust Service Criteria:

SECURITY (mandatory)
  CC6.1 — Logical and physical access controls
  CC6.2 — Authentication
  CC6.3 — Authorization
  CC7.1 — Threat detection monitoring
  CC7.2 — Incident response
  CC8.1 — Change management (your CI/CD pipeline!)

AVAILABILITY (common for e-commerce)
  A1.1 — Capacity planning
  A1.2 — Environmental protections
  A1.3 — Backup and recovery

PROCESSING INTEGRITY (for payment processors)
  PI1.1 — Complete, valid, accurate, timely processing

CONFIDENTIALITY
  C1.1 — Confidential information identified and protected
  C1.2 — Confidential information disposed of properly

PRIVACY
  P1.1 — Privacy policy
  P3.1 — Consent for personal information collection
```

### SOC 2 CC8.1 — Change Management Evidence

```yaml
# SOC 2 auditors look at your change management process
# CC8.1: Changes to infrastructure are authorized and tested

# GitHub branch protection (enforces SOC 2 CC8.1)
# terraform/github-branch-protection.tf

resource "github_branch_protection" "main" {
  repository_id = github_repository.ecommerce.node_id
  pattern       = "main"

  # SOC 2: Changes must be reviewed (not self-approved)
  required_pull_request_reviews {
    required_approving_review_count = 2
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = true
    restrict_dismissals             = true
  }

  # SOC 2: All checks must pass before merge
  required_status_checks {
    strict   = true
    contexts = [
      "ci/unit-tests",
      "ci/integration-tests",
      "ci/security-scan",
      "ci/performance-test"
    ]
  }

  # SOC 2: No force pushes (preserve audit trail)
  allows_force_pushes = false
  allows_deletions    = false
  
  # SOC 2: Signed commits (verify author identity)
  require_signed_commits = true
}
```

---

## Black Friday — High-Traffic Deployment Strategy

```
Black Friday challenge:
  Normal traffic:     10,000 requests/minute
  Black Friday peak: 100,000 requests/minute (10x)
  Duration:           24-48 hours of sustained high traffic

DevOps strategy:
  1. Load test BEFORE Black Friday (not during)
  2. Pre-scale infrastructure before the event
  3. Feature flags to disable expensive features under load
  4. Automatic scaling with safety limits
  5. Rollback plan ready (< 5 minutes to rollback)
  6. War room: on-call engineers monitoring dashboards
```

### Load Testing with Grafana K6

```javascript
// k6/black-friday-load-test.js
// Run this 2 weeks before Black Friday to find breaking points

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const checkoutErrorRate = new Rate('checkout_errors');
const checkoutDuration = new Trend('checkout_duration');

export const options = {
  stages: [
    // Ramp up gradually
    { duration: '5m', target: 1000 },    // Normal traffic
    { duration: '10m', target: 5000 },   // Growing load
    { duration: '15m', target: 10000 },  // Peak Black Friday
    { duration: '10m', target: 10000 },  // Sustain peak
    { duration: '5m', target: 0 },       // Scale down
  ],
  
  thresholds: {
    // Business requirements for Black Friday
    'http_req_duration': ['p95<2000'],   // 95% of requests < 2 seconds
    'http_req_failed': ['rate<0.01'],    // Error rate < 1%
    'checkout_errors': ['rate<0.005'],   // Checkout errors < 0.5%
    'checkout_duration': ['p95<3000'],   // Checkout < 3 seconds (95th percentile)
  }
};

const BASE_URL = 'https://shop.company.com';

// Simulate realistic user journey
export default function () {
  
  // 1. Browse product catalog
  const catalogRes = http.get(`${BASE_URL}/api/products?category=electronics`);
  check(catalogRes, {
    'catalog loaded': r => r.status === 200,
    'catalog has products': r => JSON.parse(r.body).products.length > 0,
  });
  
  sleep(2);  // User browses
  
  // 2. View product detail
  const productRes = http.get(`${BASE_URL}/api/products/SKU-001`);
  check(productRes, {
    'product page loaded': r => r.status === 200,
  });
  
  sleep(1);
  
  // 3. Add to cart
  const cartRes = http.post(
    `${BASE_URL}/api/cart`,
    JSON.stringify({ sku: 'SKU-001', quantity: 1 }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(cartRes, {
    'added to cart': r => r.status === 200,
  });
  
  sleep(1);
  
  // 4. Checkout (most critical flow)
  const startTime = Date.now();
  const checkoutRes = http.post(
    `${BASE_URL}/api/checkout`,
    JSON.stringify({
      cart_id: JSON.parse(cartRes.body).cart_id,
      payment_token: 'tok_visa_test',  // Stripe test token
      shipping_address: {
        line1: '123 Test St',
        city: 'San Francisco',
        state: 'CA',
        zip: '94105'
      }
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  
  const checkoutTime = Date.now() - startTime;
  checkoutDuration.add(checkoutTime);
  
  const checkoutSuccess = check(checkoutRes, {
    'checkout succeeded': r => r.status === 200,
    'order confirmed': r => JSON.parse(r.body).order_id !== undefined,
  });
  
  checkoutErrorRate.add(!checkoutSuccess);
}
```

---

### Auto-Scaling for Black Friday

```hcl
# terraform/black-friday-scaling.tf
# Pre-configured scaling for high-traffic events

# EKS Cluster Autoscaler with Black Friday settings
resource "aws_autoscaling_group" "ecommerce_nodes" {
  name                = "ecommerce-eks-nodes"
  min_size            = 3
  max_size            = 100  # Allow scale to 100 nodes for Black Friday
  desired_capacity    = 5

  # Mixed instances (some On-Demand + Spot for cost efficiency)
  mixed_instances_policy {
    instances_distribution {
      on_demand_percentage_above_base_capacity = 30  # 30% on-demand always
      spot_allocation_strategy                 = "capacity-optimized"
    }

    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.eks_node.id
        version            = "$Latest"
      }

      override {
        instance_type = "m6i.xlarge"  # Primary instance type
      }
      override {
        instance_type = "m5.xlarge"   # Fallback if m6i not available
      }
      override {
        instance_type = "m6a.xlarge"  # AMD alternative (cheaper)
      }
    }
  }

  tag {
    key                 = "k8s.io/cluster-autoscaler/enabled"
    value               = "true"
    propagate_at_launch = true
  }
}

# HPA: Scale application pods under load
resource "kubernetes_horizontal_pod_autoscaler_v2" "ecommerce_api" {
  metadata {
    name      = "ecommerce-api-hpa"
    namespace = "production"
  }

  spec {
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = "ecommerce-api"
    }

    min_replicas = 5
    max_replicas = 200  # Can scale to 200 pods for Black Friday

    metric {
      type = "Resource"
      resource {
        name = "cpu"
        target {
          type               = "Utilization"
          average_utilization = 60  # Scale at 60% CPU (before it gets too slow)
        }
      }
    }

    metric {
      type = "Resource"
      resource {
        name = "memory"
        target {
          type               = "Utilization"
          average_utilization = 70
        }
      }
    }

    # Custom metric: requests per second
    metric {
      type = "External"
      external {
        metric {
          name = "nginx_requests_per_second"
          selector {
            match_labels = {
              app = "ecommerce-api"
            }
          }
        }
        target {
          type  = "AverageValue"
          value = "100"  # Scale when > 100 rps per pod
        }
      }
    }

    behavior {
      scale_up {
        stabilization_window_seconds = 60  # React fast during Black Friday
        policy {
          type           = "Pods"
          value          = 10  # Add 10 pods at a time
          period_seconds = 60
        }
      }
      scale_down {
        stabilization_window_seconds = 300  # Scale down slowly (avoid thrashing)
        policy {
          type           = "Pods"
          value          = 2
          period_seconds = 60
        }
      }
    }
  }
}
```

---

### Feature Flags for Black Friday (Graceful Degradation)

```python
# feature_flags.py
# During peak load, disable expensive features to keep core working
# This is "graceful degradation" — prioritize checkout over recommendations

import boto3
import json
from functools import lru_cache

class FeatureFlags:
    """
    Feature flags backed by AWS AppConfig.
    Can be changed instantly without deployment.
    Critical for Black Friday load management.
    """
    
    def __init__(self):
        self.appconfig = boto3.client('appconfigdata')
        self._session_token = None
        self._config = {}
    
    def is_enabled(self, feature: str) -> bool:
        """Check if a feature is enabled."""
        config = self._get_config()
        return config.get(feature, True)  # Default: enabled
    
    def _get_config(self) -> dict:
        # Refresh every 30 seconds (not every request)
        return self._config or self._refresh_config()
    
    def _refresh_config(self) -> dict:
        """Fetch current feature flags from AppConfig."""
        response = self.appconfig.get_latest_configuration(
            ClientConfigurationVersion="",
            ClientId="ecommerce-api"
        )
        self._config = json.loads(response['Configuration'].read())
        return self._config


flags = FeatureFlags()

# In your application:
def get_product_recommendations(user_id: str, product_id: str) -> list:
    """Product recommendations — expensive ML call."""
    
    # Disable during peak load (Black Friday flag)
    if not flags.is_enabled("product_recommendations"):
        # Return empty (frontend shows nothing instead of waiting)
        return []
    
    # Normal flow — call recommendation service
    return recommendation_service.get(user_id, product_id)


def process_checkout(cart_id: str, payment_token: str) -> dict:
    """Checkout — this ALWAYS runs (never disabled)."""
    
    # Core checkout logic never behind a feature flag
    # This is the revenue-generating function
    return checkout_service.process(cart_id, payment_token)


# AppConfig JSON for Black Friday (change without deployment):
BLACK_FRIDAY_CONFIG = {
    "product_recommendations": False,    # Disabled — too expensive
    "personalized_homepage": False,      # Disabled — just show bestsellers
    "real_time_inventory": True,         # Keep — customers need stock info
    "review_sorting_ml": False,          # Disabled — show by date instead
    "loyalty_points_display": True,      # Keep — drives purchases
    "cross_sell_popup": False,           # Disabled — slows page load
    "checkout": True,                    # NEVER disable this
    "payment_processing": True           # NEVER disable this
}
```

---

## SOC 2 Availability — Uptime Monitoring

```python
# soc2_availability_monitor.py
# SOC 2 A1.1: Monitor and report on system availability
# Must prove 99.9% uptime (or whatever you committed to customers)

import boto3
from datetime import datetime, timedelta

def calculate_availability_soc2_report(
    service_name: str,
    period_days: int = 90
) -> dict:
    """
    Calculate availability for SOC 2 audit evidence.
    SOC 2 auditors want: uptime %, incidents list, RTO achieved.
    """
    
    cloudwatch = boto3.client('cloudwatch')
    
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(days=period_days)
    
    # Get health check data
    response = cloudwatch.get_metric_statistics(
        Namespace='AWS/Route53',
        MetricName='HealthCheckStatus',
        Dimensions=[
            {'Name': 'HealthCheckId', 'Value': f'{service_name}-health-check'}
        ],
        StartTime=start_time,
        EndTime=end_time,
        Period=60,  # 1-minute granularity
        Statistics=['Average']
    )
    
    datapoints = response['Datapoints']
    total_minutes = period_days * 24 * 60
    
    # Calculate uptime
    downtime_minutes = sum(
        1 for dp in datapoints
        if dp['Average'] < 1  # 0 = down, 1 = up
    )
    
    uptime_minutes = total_minutes - downtime_minutes
    uptime_percentage = (uptime_minutes / total_minutes) * 100
    
    # SOC 2 availability tier mapping
    if uptime_percentage >= 99.99:
        tier = "Four Nines (99.99%)"
    elif uptime_percentage >= 99.9:
        tier = "Three Nines (99.9%)"
    elif uptime_percentage >= 99.0:
        tier = "Two Nines (99%)"
    else:
        tier = f"Below 99%"
    
    report = {
        "soc2_criteria": "A1.1 - Availability",
        "service": service_name,
        "period": f"{start_time.date()} to {end_time.date()}",
        "sla_commitment": "99.9%",
        "actual_availability": f"{uptime_percentage:.3f}%",
        "tier": tier,
        "sla_met": uptime_percentage >= 99.9,
        "total_downtime_minutes": downtime_minutes,
        "incidents": [],  # Pull from PagerDuty
    }
    
    return report
```

---

## Retail CI/CD — Fast and Safe Deployments

```yaml
# .github/workflows/retail-deploy.yml
# Retail needs: fast deployments + zero downtime + easy rollback
# Black Friday rule: FREEZE deployments 48 hours before event

name: Retail Production Deploy

on:
  push:
    branches: [main]

env:
  # Black Friday freeze check (set in GitHub Environment secrets)
  DEPLOYMENT_FREEZE: ${{ vars.DEPLOYMENT_FREEZE }}

jobs:
  pre-deploy-checks:
    runs-on: ubuntu-latest
    steps:
      - name: Check deployment freeze (Black Friday)
        run: |
          if [ "${{ env.DEPLOYMENT_FREEZE }}" = "true" ]; then
            echo "❌ DEPLOYMENT FREEZE ACTIVE"
            echo "Black Friday event in progress or imminent."
            echo "To override: set DEPLOYMENT_FREEZE=false in GitHub Variables"
            echo "Override requires: VP Engineering approval"
            exit 1
          fi
          echo "✅ No deployment freeze active"

      - uses: actions/checkout@v4

      - name: Run full test suite
        run: |
          npm ci
          npm run test
          npm run test:integration
          npm run test:e2e

      - name: Performance regression check
        run: |
          k6 run --out json=results.json k6/smoke-test.js
          # Fail if p95 > 2s (SOC 2 + user experience)
          P95=$(cat results.json | jq '.metrics.http_req_duration.values["p(95)"]')
          if (( $(echo "$P95 > 2000" | bc -l) )); then
            echo "❌ Performance regression: p95=${P95}ms (limit: 2000ms)"
            exit 1
          fi

  deploy-canary:
    needs: pre-deploy-checks
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to 5% of traffic (canary)
        run: |
          # Deploy new version to 5% of pods
          kubectl set image deployment/ecommerce-api \
            ecommerce-api=${{ env.IMAGE }}:${{ github.sha }}
          
          # Scale: 5% canary (1 of 20 pods gets new version)
          kubectl patch deployment ecommerce-api-canary \
            -p '{"spec":{"replicas":1}}'
          
          echo "Canary deployed. Monitoring for 10 minutes..."

      - name: Monitor canary (10 minutes)
        run: |
          sleep 300  # Wait 5 minutes
          
          # Check error rate for canary
          ERROR_RATE=$(kubectl exec -n monitoring prometheus-0 -- \
            promtool query instant \
            'rate(http_requests_total{job="ecommerce-api-canary",status=~"5.."}[5m]) / rate(http_requests_total{job="ecommerce-api-canary"}[5m]) * 100')
          
          echo "Canary error rate: $ERROR_RATE%"
          
          if (( $(echo "$ERROR_RATE > 1" | bc -l) )); then
            echo "❌ Canary error rate too high: $ERROR_RATE%"
            echo "Rolling back canary..."
            kubectl rollout undo deployment/ecommerce-api-canary
            exit 1
          fi
          
          echo "✅ Canary healthy. Proceeding to full rollout."

  deploy-production:
    needs: deploy-canary
    runs-on: ubuntu-latest
    steps:
      - name: Full production rollout
        run: |
          kubectl set image deployment/ecommerce-api \
            ecommerce-api=${{ env.IMAGE }}:${{ github.sha }}
          
          kubectl rollout status deployment/ecommerce-api --timeout=10m

      - name: Smoke test post-deploy
        run: |
          curl -sf https://shop.company.com/api/health | \
            jq '.status == "ok"' | grep true
          
          # Test critical checkout flow
          RESPONSE=$(curl -sf -X POST https://shop.company.com/api/checkout/test)
          echo "Checkout test: $RESPONSE"

      - name: Notify team
        if: always()
        run: |
          STATUS=${{ job.status }}
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -d "{\"text\": \"Retail deploy $STATUS: ${GITHUB_SHA:0:8} by $GITHUB_ACTOR\"}"
```

---

## SOC 2 Evidence Collection

```bash
#!/bin/bash
# soc2-evidence-collector.sh
# Collect evidence for SOC 2 Type II audit
# Run monthly — auditors review 12 months of evidence

PERIOD=$(date +%Y-%m)
EVIDENCE_DIR="soc2-evidence/$PERIOD"
mkdir -p "$EVIDENCE_DIR"

echo "Collecting SOC 2 Type II evidence for $PERIOD..."

# CC6.1 — Access control
echo "Collecting access control evidence..."
# IAM users, groups, policies
aws iam get-account-authorization-details \
  --output json > "$EVIDENCE_DIR/cc6.1-iam-access-control.json"

# Active sessions and access reviews
aws iam generate-credential-report
sleep 10
aws iam get-credential-report \
  --query 'Content' --output text | base64 -d > \
  "$EVIDENCE_DIR/cc6.1-credential-report.csv"

# CC6.2 — Authentication
echo "Collecting authentication evidence..."
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=ConsoleLogin \
  --start-time $(date -d 'first day of last month' +%Y-%m-%dT00:00:00) \
  --end-time $(date -d 'last day of last month' +%Y-%m-%dT23:59:59) \
  --output json > "$EVIDENCE_DIR/cc6.2-login-audit.json"

# CC7.1 — Threat detection
echo "Collecting threat detection evidence..."
aws guardduty list-findings \
  --detector-id $(aws guardduty list-detectors --query 'DetectorIds[0]' --output text) \
  --finding-criteria '{"Criterion":{"service.archived":{"Eq":["false"]}}}' \
  --output json > "$EVIDENCE_DIR/cc7.1-guardduty-findings.json"

aws securityhub get-findings \
  --filters '{"WorkflowStatus":[{"Value":"NEW","Comparison":"EQUALS"}]}' \
  --max-results 100 \
  --output json > "$EVIDENCE_DIR/cc7.1-security-hub-findings.json"

# CC8.1 — Change management
echo "Collecting change management evidence..."
# All deployments in the period
aws codedeploy list-deployments \
  --create-time-range \
    start=$(date -d 'first day of last month' +%Y-%m-%dT00:00:00),\
end=$(date -d 'last day of last month' +%Y-%m-%dT23:59:59) \
  --output json > "$EVIDENCE_DIR/cc8.1-deployments.json"

# A1.1 — Availability
echo "Collecting availability evidence..."
# Uptime from Route53 health checks (30 days)
aws route53 get-health-check-status \
  --health-check-id $(aws route53 list-health-checks \
    --query 'HealthChecks[0].Id' --output text) \
  --output json > "$EVIDENCE_DIR/a1.1-health-check-status.json"

# Create summary index
cat > "$EVIDENCE_DIR/INDEX.md" << EOF
# SOC 2 Evidence Package — $PERIOD

## Files
| File | SOC 2 Criteria | Description |
|------|----------------|-------------|
| cc6.1-iam-access-control.json | CC6.1 | IAM access controls |
| cc6.1-credential-report.csv | CC6.1 | MFA and key status for all users |
| cc6.2-login-audit.json | CC6.2 | Authentication events |
| cc7.1-guardduty-findings.json | CC7.1 | Threat detection findings |
| cc7.1-security-hub-findings.json | CC7.1 | Security posture |
| cc8.1-deployments.json | CC8.1 | All production deployments (change management) |
| a1.1-health-check-status.json | A1.1 | System availability |

## Collection Method
Automated via soc2-evidence-collector.sh
Evidence collected: $(date)
Next collection: $(date -d '+1 month' +%Y-%m-01)
EOF

echo ""
echo "SOC 2 evidence package: $EVIDENCE_DIR/"
ls -la "$EVIDENCE_DIR/"
```

---

## Interview Questions — Retail Sector

**Q: How do you prepare infrastructure for Black Friday?**
```
1. Load test (6 weeks before)
   → Run K6 load test at 2x expected peak
   → Find breaking points before customers do
   → Fix bottlenecks (usually DB queries or slow APIs)

2. Pre-scale (2 days before)
   → Scale EKS nodes to 60% of peak capacity (saves cold start time)
   → Warm up caches (Redis) with popular products
   → Pre-provision RDS read replicas

3. Feature flags
   → Disable expensive features: recommendations, ML personalization
   → Keep essential: checkout, search, inventory check
   → Emergency kill switches for non-critical features

4. Deployment freeze (48 hours before)
   → No new deployments during high-risk period
   → Exception process: VP approval required

5. War room
   → On-call engineers on alert
   → Grafana dashboards on screens
   → Runbooks ready (what to do if X breaks)
   → Rollback practiced (< 5 minutes)

6. Post-event review
   → What happened? What did we learn?
   → Update runbooks and capacity plans
```

**Q: What is the difference between SOC 2 Type I and Type II?**
```
SOC 2 Type I:
  "Your controls EXIST at a point in time"
  → Auditor visits once, reviews your controls
  → Takes ~3 months to prepare
  → Good for initial sales conversations
  
SOC 2 Type II:
  "Your controls WORKED CONSISTENTLY over 12 months"
  → Auditor reviews evidence from 12-month period
  → MUCH more valuable to enterprise customers
  → Requires: continuous evidence collection (logs, audit trails)
  → DevOps provides: CloudTrail, access logs, deployment history
  
For retail selling to enterprises:
  → SOC 2 Type II is often required (not Type I)
  → B2B enterprise deals: "show us your SOC 2 report"
  → Your CI/CD pipeline and CloudTrail logs ARE the evidence
```

---

[← Banking Sector](./08-sector-banking.md) | [Next: Compliance Pipeline →](./10-compliance-pipeline.md)
