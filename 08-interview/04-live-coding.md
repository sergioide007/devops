# Live Coding — Scenarios and Solutions

> **Level:** Professional
> **Prerequisites:** Technical Questions, Behavioral Questions
> **You will learn:** 6 real interview scenarios with complete solutions — Bash, Python, Kubernetes, Terraform, CI/CD

---

## How Live Coding Works in DevOps Interviews

```
Format options:
  1. Shared screen (CoderPad, HackerRank, Google Docs)
  2. Whiteboard (diagram + pseudo-code)
  3. Take-home assignment (24-48 hours)

Time per problem: 20-45 minutes
What they observe:
  - Do you talk through your thinking? (most important)
  - Do you ask clarifying questions before writing?
  - Can you write working code, not just describe it?
  - How do you handle being stuck?

Opening move (always):
  "Before I start, let me clarify: is X the expected behavior?
   I'm going to approach this by Y, does that make sense?"
```

---

## Scenario 1 — Bash: Disk Space Monitor

**Prompt:** *"Write a Bash script that checks disk usage on all mounted filesystems and sends an alert if any exceeds 80%. It should run without dependencies."*

```bash
#!/bin/bash
# disk-monitor.sh — checks disk usage and alerts via Slack webhook or email

set -euo pipefail

THRESHOLD=80
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"   # optional: set via env var
HOSTNAME=$(hostname)

alert() {
    local mount="$1"
    local usage="$2"
    local message="⚠️ DISK ALERT on ${HOSTNAME}: ${mount} is at ${usage}% (threshold: ${THRESHOLD}%)"

    echo "$message"

    # Slack notification (if webhook configured)
    if [[ -n "$SLACK_WEBHOOK" ]]; then
        curl -s -X POST "$SLACK_WEBHOOK" \
            -H "Content-Type: application/json" \
            --data "{\"text\": \"${message}\"}" \
            > /dev/null
    fi
}

main() {
    local has_alert=0

    # df output: Filesystem Size Used Avail Use% Mounted
    while IFS= read -r line; do
        # Extract Use% and Mount point
        usage=$(echo "$line" | awk '{print $5}' | tr -d '%')
        mount=$(echo "$line" | awk '{print $6}')

        # Skip header line and tmpfs/pseudo-filesystems
        [[ "$usage" == "Use%" ]] && continue
        [[ "$mount" == /proc* || "$mount" == /sys* || "$mount" == /dev* ]] && continue

        if (( usage >= THRESHOLD )); then
            alert "$mount" "$usage"
            has_alert=1
        fi
    done < <(df -h | tail -n +2)

    if (( has_alert == 0 )); then
        echo "✓ All filesystems below ${THRESHOLD}% threshold"
    fi

    return $has_alert
}

main "$@"
```

**Walk through with interviewer:**
> "I'll start with `set -euo pipefail` so the script fails on any error. I'm parsing `df -h` output with `awk` — column 5 is usage percent, column 6 is the mount point. I skip pseudo-filesystems since `/proc` and `/sys` don't represent real disk space. The threshold is a variable so it's configurable. The Slack webhook is optional — if not set, it only prints."

---

## Scenario 2 — Python: Kubernetes Pod Health Check

**Prompt:** *"Write a Python script that checks if all pods in a namespace are running. Exit with code 1 if any pods are not Ready."*

```python
#!/usr/bin/env python3
# pod-health.py — check all pods in a namespace are Ready

import sys
import subprocess
import json

def get_pods(namespace: str) -> list[dict]:
    result = subprocess.run(
        ["kubectl", "get", "pods", "-n", namespace, "-o", "json"],
        capture_output=True,
        text=True,
        check=True
    )
    data = json.loads(result.stdout)
    return data.get("items", [])


def is_pod_ready(pod: dict) -> bool:
    conditions = pod.get("status", {}).get("conditions", [])
    for condition in conditions:
        if condition["type"] == "Ready":
            return condition["status"] == "True"
    return False


def check_namespace(namespace: str) -> int:
    try:
        pods = get_pods(namespace)
    except subprocess.CalledProcessError as e:
        print(f"ERROR: kubectl failed: {e.stderr}", file=sys.stderr)
        return 1

    if not pods:
        print(f"WARNING: No pods found in namespace '{namespace}'")
        return 0

    failed = []
    for pod in pods:
        name  = pod["metadata"]["name"]
        phase = pod.get("status", {}).get("phase", "Unknown")

        if not is_pod_ready(pod):
            failed.append((name, phase))

    if failed:
        print(f"FAIL: {len(failed)}/{len(pods)} pods not Ready in namespace '{namespace}':")
        for name, phase in failed:
            print(f"  - {name}  [{phase}]")
        return 1

    print(f"OK: All {len(pods)} pods Ready in namespace '{namespace}'")
    return 0


if __name__ == "__main__":
    namespace = sys.argv[1] if len(sys.argv) > 1 else "default"
    sys.exit(check_namespace(namespace))
```

```bash
# Usage
python3 pod-health.py production
# OK: All 12 pods Ready in namespace 'production'

python3 pod-health.py production
# FAIL: 2/12 pods not Ready in namespace 'production':
#   - payments-service-abc123  [Pending]
#   - accounts-service-xyz789  [CrashLoopBackOff]
echo $?   # 1
```

**Walk through:** *"I'm using `kubectl get pods -o json` and parsing the `conditions` array. Ready status is a condition type with status True/False — not the same as the Phase field, which is just a lifecycle stage. The exit code matters here because this is designed to run in CI/CD pipelines."*

---

## Scenario 3 — CI/CD Pipeline Design

**Prompt:** *"Design a GitHub Actions pipeline for a Node.js API: lint, test, build Docker image, push to ECR, deploy to EKS. Only deploy from `main` branch."*

```yaml
# .github/workflows/deploy.yml

name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  AWS_REGION:     us-east-1
  ECR_REPOSITORY: company/api
  EKS_CLUSTER:    production-cluster
  NAMESPACE:      production

jobs:
  # ── 1. QUALITY GATES ────────────────────────────────────────────
  quality:
    name: Lint & Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Unit Tests
        run: npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v4

  # ── 2. SECURITY SCAN ────────────────────────────────────────────
  security:
    name: Security Scan
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v4

      - name: Trivy vulnerability scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'   # fail pipeline if critical/high CVEs found

  # ── 3. BUILD & PUSH ─────────────────────────────────────────────
  build:
    name: Build & Push Image
    runs-on: ubuntu-latest
    needs: [quality, security]
    outputs:
      image-tag: ${{ steps.meta.outputs.version }}
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id:     ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region:            ${{ env.AWS_REGION }}

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}
          tags: |
            type=sha,prefix=,format=short
            type=ref,event=branch
            type=semver,pattern={{version}}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags:    ${{ steps.meta.outputs.tags }}
          labels:  ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to:   type=gha,mode=max

  # ── 4. DEPLOY ───────────────────────────────────────────────────
  deploy:
    name: Deploy to EKS
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'   # only deploy from main
    environment:
      name: production
      url: https://api.myapp.com

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id:     ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region:            ${{ env.AWS_REGION }}

      - name: Configure kubectl
        run: |
          aws eks update-kubeconfig \
            --name ${{ env.EKS_CLUSTER }} \
            --region ${{ env.AWS_REGION }}

      - name: Deploy via Helm
        run: |
          helm upgrade --install api ./helm/api \
            --namespace ${{ env.NAMESPACE }} \
            --set image.tag=${{ needs.build.outputs.image-tag }} \
            --set replicaCount=3 \
            --atomic \
            --timeout 5m

      - name: Verify rollout
        run: |
          kubectl rollout status deployment/api \
            -n ${{ env.NAMESPACE }} \
            --timeout=5m
```

**Walk through:** *"I split jobs into 4 stages with explicit needs dependencies. The `if: github.ref == 'refs/heads/main'` gate on deploy ensures PRs never trigger a deployment. I use `--atomic` on Helm which rolls back automatically if the deploy fails. The `environment: production` in GitHub adds a manual approval gate if configured."*

---

## Scenario 4 — Terraform: Minimal Module

**Prompt:** *"Write a reusable Terraform module for an S3 bucket that: enables versioning, blocks public access, enables KMS encryption, and accepts a lifecycle rule for the prefix `logs/`."*

```hcl
# modules/s3-private/main.tf

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  count  = var.logs_lifecycle_days > 0 ? 1 : 0
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "logs-expire"
    status = "Enabled"
    filter { prefix = "logs/" }
    expiration {
      days = var.logs_lifecycle_days
    }
  }
}
```

```hcl
# modules/s3-private/variables.tf

variable "bucket_name"          { type = string }
variable "kms_key_arn"          { type = string }
variable "logs_lifecycle_days"  { type = number; default = 90 }
variable "tags"                 { type = map(string); default = {} }
```

```hcl
# modules/s3-private/outputs.tf

output "bucket_id"   { value = aws_s3_bucket.this.id }
output "bucket_arn"  { value = aws_s3_bucket.this.arn }
```

```hcl
# Usage
module "app_bucket" {
  source = "./modules/s3-private"

  bucket_name         = "company-app-data-prod"
  kms_key_arn         = aws_kms_key.main.arn
  logs_lifecycle_days = 30
  tags = { Environment = "production" }
}
```

---

## Scenario 5 — Debug: Pod Not Starting

**Prompt:** *"A pod is stuck in Pending state. Walk me through how you would debug it."*

```bash
# Step 1: describe the pod — Events section has the answer 90% of the time
kubectl describe pod payments-service-abc123 -n production

# Common causes from Events:
# ───────────────────────────────────────────────────────────────────
# "0/3 nodes are available: 3 Insufficient cpu"
#   → Not enough CPU on nodes
#   → Fix: kubectl get nodes -o wide; check requests/limits in deployment
#   → Immediate: add more nodes or lower resource requests

# "0/3 nodes are available: 3 node(s) had taints that the pod didn't tolerate"
#   → Pod needs tolerations for node taints
#   → Fix: check node taints: kubectl get nodes -o yaml | grep -A3 taints
#   → Add toleration to pod spec

# "Unschedulable: pod has unbound immediate PersistentVolumeClaims"
#   → PVC not bound to a PV
#   → Fix: kubectl get pvc -n production; check StorageClass

# Step 2: check node capacity
kubectl get nodes
kubectl describe node <nodename> | grep -A10 "Allocated resources"

# Step 3: check if image is pullable
kubectl describe pod <pod> | grep -A5 "Events"
# "Failed to pull image ... unauthorized"
# → Fix: check imagePullSecrets in deployment

# Step 4: check resource quotas
kubectl get resourcequota -n production
kubectl describe resourcequota -n production

# Step 5: check node selector / affinity
kubectl get pod <pod> -n production -o yaml | grep -A10 "affinity"
kubectl get nodes --show-labels
```

**Walk through:** *"Pending means the scheduler can't place the pod. I always start with `kubectl describe pod` — the Events section at the bottom will tell me exactly why. The three most common causes are: resource constraints (not enough CPU/memory), taints (node rejects the pod), or image pull failure. I walk through each systematically."*

---

## Scenario 6 — Architecture: High-Availability API

**Prompt:** *"Design a high-availability API on AWS that can handle 10,000 requests per second with < 100ms p99 latency. No single point of failure."*

```
Architecture answer (whiteboard/diagram):

Internet
    ↓
Route 53 (latency-based routing, health checks → failover)
    ↓
CloudFront (TLS termination, 400+ PoPs, cache static responses)
    ↓
ALB (cross-zone load balancing, health checks)
    ↓
EKS (3 AZs, HPA: 10-200 pods based on CPU/requests)
  ├── Pod (AZ-1)
  ├── Pod (AZ-2)
  └── Pod (AZ-3)
    ↓
  RDS Aurora Multi-AZ (read replicas, automatic failover)
  ElastiCache Redis (session/cache, cluster mode)

Supporting:
  - SQS for async work (don't block request thread on slow tasks)
  - CloudWatch for metrics, Loki for logs, Tempo for traces
  - PodDisruptionBudget: minAvailable=2 (prevent all pods draining at once)
```

**Key points to mention:**

```
Scale calculation:
  10,000 RPS × 50ms avg response = 500 concurrent requests
  Each pod handles ~100 concurrent → 5-10 pods minimum
  With HPA headroom: start at 10, scale to 50 under load

No single points of failure:
  ✓ Multi-AZ deployment (3 AZs)
  ✓ ALB is inherently multi-AZ
  ✓ RDS Aurora Multi-AZ with automatic failover
  ✓ Redis cluster mode (3 shards × 2 replicas)
  ✓ PodDisruptionBudget prevents full drainage during node maintenance

< 100ms p99:
  ✓ CloudFront caches at edge (static responses: 1-2ms)
  ✓ ElastiCache for hot data (< 1ms)
  ✓ DB read replicas for read-heavy queries
  ✓ HPA ensures pods never saturate (CPU target 60%)
  ✓ Connection pooling (PgBouncer for RDS)
```

---

## Live Coding Tips

```
1. Talk WHILE you code — silence is a red flag
   "I'm going to start with the function signature..."
   "Here I'm handling the edge case where..."

2. Ask clarifying questions FIRST
   "Should this handle errors gracefully or fail fast?"
   "Are there performance requirements I should know about?"

3. When stuck, think out loud
   "I know I need to parse the output — let me check if awk gives me column 5..."
   "I'm not 100% sure of the exact kubectl flag, but conceptually I'd do..."

4. Write a working simple version first, then optimize
   "Let me get the basic logic working, then I'll add error handling"

5. Test with an example before claiming it's done
   "Let me trace through: if disk is 85%, 85 >= 80 is true, so it calls alert()..."
```

---

[← Behavioral Questions](./03-behavioral-questions.md) | [Back to Section](./README.md)
