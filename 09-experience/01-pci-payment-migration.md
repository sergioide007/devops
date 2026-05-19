# Case Study: PCI-DSS Payment System on AWS

> **Industry:** Fintech — Payment Gateway
> **Environment:** AWS (Lambda, EKS, API Gateway, KMS, SQS)
> **Challenge:** Migrate payment processor to PCI-compliant cloud environment

---

## The Problem

A payment processing system was running on legacy on-premise servers:
- No encryption at rest
- Manual server patching (compliance risk)
- No auto-scaling (traffic spikes caused outages)
- Cold starts in Lambda functions causing 3-4 second delays
- No structured logging (impossible to audit)

PCI-DSS Level 1 compliance was required (processes > 6 million card transactions/year).

---

## The Solution Architecture

```
Card Data Flow (PCI scope):

Card Network
    ↓
API Gateway (TLS 1.3 only, WAF enabled)
    ↓
Lambda: fn-tokenizer (in private VPC subnet)
    ↓
KMS (encrypt card token)
    ↓
Redis ElastiCache (token cache, 15min TTL)
    ↓
Lambda: fn-charge
    ↓
SQS Queue (for async processing)
    ↓
Lambda: fn-job-card-refund
    ↓
DynamoDB (transaction records, encrypted with KMS)
    ↓
EKS (reporting APIs, outside PCI scope)
```

---

## What Was Implemented

### 1. Lambda Cold Start Fix

```python
# BEFORE: cold start 3-4 seconds
# AFTER: cold start ~200ms

# Key changes:
# 1. Move heavy initialization OUTSIDE the handler
import boto3
import json

# These run ONCE when Lambda container starts (warm)
# Not on every invocation
dynamodb = boto3.resource('dynamodb')
redis_client = redis.Redis(
    host=os.environ['REDIS_HOST'],
    port=6379,
    ssl=True,
    socket_connect_timeout=1
)
table = dynamodb.Table(os.environ['TABLE_NAME'])

def lambda_handler(event, context):
    # Handler is called on every invocation
    # DB client is already initialized
    token = redis_client.get(event['card_hash'])
    if token:
        return {'token': token.decode()}

    # Process...
```

```bash
# 2. Provisioned concurrency for critical functions
aws lambda put-provisioned-concurrency-config \
    --function-name fn-tokenizer \
    --qualifier production \
    --provisioned-concurrent-executions 10

# 3. Reduce package size
# Before: 28MB zip (included test files, dev deps)
# After: 3.2MB zip

# .dockerignore equivalent for Lambda
# Use only production dependencies:
pip install -r requirements.txt --target package/ --only-binary :all:
# Remove test files:
find package/ -name "test*" -delete
find package/ -name "*.pyc" -delete
```

### 2. KMS Encryption for Card Data

```python
# fn-tokenizer — encrypt card data
import boto3
import base64
import json

kms = boto3.client('kms')
KMS_KEY_ID = os.environ['KMS_KEY_ARN']

def tokenize_card(card_number, expiry, cvv):
    """Encrypt card data with KMS. CVV is never stored."""

    sensitive_data = {
        'pan': card_number,     # Primary Account Number
        'expiry': expiry
        # Note: CVV is intentionally NOT stored (PCI requirement)
    }

    encrypted = kms.encrypt(
        KeyId=KMS_KEY_ID,
        Plaintext=json.dumps(sensitive_data).encode('utf-8'),
        EncryptionContext={
            'purpose': 'card-tokenization',
            'service': 'payment-gateway'
        }
    )

    token = base64.urlsafe_b64encode(
        encrypted['CiphertextBlob']
    ).decode('utf-8')

    return f"tok_{token[:32]}"    # opaque token

def decrypt_token(token):
    """Decrypt for charge processing. Only accessible in PCI scope."""
    ciphertext = base64.urlsafe_b64decode(token[4:])    # remove "tok_"

    decrypted = kms.decrypt(
        CiphertextBlob=ciphertext,
        EncryptionContext={
            'purpose': 'card-tokenization',
            'service': 'payment-gateway'
        }
    )

    return json.loads(decrypted['Plaintext'].decode('utf-8'))
```

### 3. VPC and Security Groups for Lambda

```hcl
# terraform/pci-vpc.tf
# Lambda functions in private subnets — no direct internet access

resource "aws_vpc" "pci" {
  cidr_block = "10.10.0.0/16"

  tags = {
    Name        = "pci-vpc"
    PCIScope    = "true"
    Environment = "production"
  }
}

# Lambda functions CANNOT be in public subnets
resource "aws_subnet" "lambda_private" {
  count             = 2
  vpc_id            = aws_vpc.pci.id
  cidr_block        = "10.10.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name     = "lambda-private-${count.index + 1}"
    PCIScope = "true"
  }
}

# Lambda security group — only outbound to specific services
resource "aws_security_group" "lambda_pci" {
  name   = "lambda-pci-sg"
  vpc_id = aws_vpc.pci.id

  egress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.kms_endpoint.id]
    description     = "Allow HTTPS to KMS VPC endpoint"
  }

  egress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.redis.id]
    description     = "Allow Redis"
  }
}
```

### 4. Structured Logging (Audit Trail)

```python
# PCI requires detailed audit logs for all card data access
import json
import logging
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def log_pci_event(event_type, request_id, masked_pan, result, user_context):
    """
    Structured log entry for PCI audit trail.
    Goes to CloudWatch → CloudWatch Insights → Audit reports.
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "event_type": event_type,            # TOKENIZE, CHARGE, REFUND
        "request_id": request_id,
        "pan_masked": f"****{masked_pan[-4:]}",  # NEVER log full PAN
        "result": result,                     # SUCCESS, FAILURE
        "ip_address": user_context.get('ip'),
        "merchant_id": user_context.get('merchant'),
        "pci_scope": True,
        "retention": "7_years"               # PCI requires 7-year retention
    }

    # JSON format for CloudWatch Insights queries
    logger.info(json.dumps(log_entry))

# Query PCI events in CloudWatch Insights:
# fields @timestamp, event_type, pan_masked, result, merchant_id
# | filter pci_scope = true and event_type = "CHARGE"
# | filter result = "FAILURE"
# | sort @timestamp desc
# | limit 100
```

---

## EKS Deployment for Reporting APIs

```yaml
# reporting-deployment.yaml
# Reports live outside PCI scope — no card data
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reporting-api
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: reporting-api
  template:
    spec:
      serviceAccountName: reporting-api-sa   # IRSA — pod gets AWS role
      containers:
        - name: reporting-api
          image: registry/reporting-api:v1.5.0
          env:
            - name: APP_ENV
              value: production
            - name: DB_URL
              valueFrom:
                secretKeyRef:
                  name: reporting-db-credentials
                  key: url
          resources:
            requests:
              memory: "256Mi"
              cpu: "200m"
            limits:
              memory: "512Mi"
              cpu: "1000m"
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
```

---

## Results

| Metric | Before | After |
|--------|--------|-------|
| Cold start latency | 3-4 seconds | ~200ms |
| Deployment time | 2 hours (manual) | 8 minutes (CI/CD) |
| PCI compliance issues | 12 findings | 0 findings |
| Mean time to detect incident | 45 minutes | 3 minutes |
| Payment success rate | 94.2% | 99.7% |
| Monthly infrastructure cost | $12,000 | $4,200 (Lambda pay-per-use) |

---

## How to Talk About This in an Interview

**Q: Tell me about a challenging project.**

> "I led the migration of a payment processor to a PCI-DSS compliant AWS environment.
> The main challenges were: keeping cold start latency under 200ms on Lambda, ensuring
> no card data was ever stored in plaintext, and maintaining 99.9% uptime during migration.
>
> For cold starts, I moved initialization outside the handler and used Provisioned
> Concurrency for the critical tokenization function. For encryption, all card data
> is encrypted with KMS — the encryption context ensures that even if someone gets the
> ciphertext, they can't decrypt it without the correct context.
>
> The result was a 98% reduction in PCI audit findings and a 60% reduction in
> infrastructure cost by moving from always-on EC2 to Lambda pay-per-invocation."

---

[← Back to Section](./README.md)
