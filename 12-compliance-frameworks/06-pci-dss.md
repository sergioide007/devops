# PCI-DSS — Payment Card Industry Data Security Standard

> PCI-DSS protects card data (Visa, Mastercard, Amex) from theft.
> If your system touches payment card data, PCI-DSS is not optional.
> Fines for non-compliance: $5,000–$100,000 per month.
> As a DevOps engineer, you build the technical controls that satisfy PCI-DSS.

---

## PCI-DSS Overview

```
PCI-DSS v4.0 (current) — 12 Requirements organized in 6 goals:

GOAL 1 — Build and Maintain a Secure Network
  Req 1: Install and maintain network security controls (firewalls)
  Req 2: Apply secure configurations to all system components

GOAL 2 — Protect Account Data
  Req 3: Protect stored account data (encryption, tokenization)
  Req 4: Protect cardholder data in transit (TLS)

GOAL 3 — Maintain a Vulnerability Management Program
  Req 5: Protect all systems against malware
  Req 6: Develop and maintain secure systems and software

GOAL 4 — Implement Strong Access Control
  Req 7: Restrict access to system components
  Req 8: Identify users and authenticate access to system components
  Req 9: Restrict physical access to cardholder data

GOAL 5 — Regularly Monitor and Test Networks
  Req 10: Log and monitor all access to system components and cardholder data
  Req 11: Test security of systems and networks regularly

GOAL 6 — Maintain an Information Security Policy
  Req 12: Support information security with organizational policies and programs
```

---

## The Cardholder Data Environment (CDE)

```
CDE = The systems that store, process, or transmit cardholder data

MINIMIZE YOUR CDE — fewer systems in scope = easier/cheaper compliance

CARDHOLDER DATA (CHD) — what PCI-DSS protects:
  - PAN (Primary Account Number) = the 16-digit card number ← MOST SENSITIVE
  - Cardholder Name
  - Expiry Date
  - Service Code

SENSITIVE AUTHENTICATION DATA (SAD) — NEVER store after authorization:
  - Full magnetic stripe data
  - CAV2/CVC2/CVV2/CID (the 3-4 digit code)
  - PIN / PIN block

REDUCE CDE WITH TOKENIZATION:
  Instead of storing PAN → store a TOKEN
  Token has no value to attackers
  Only PCI-compliant vault can map token ↔ PAN
```

---

## Requirement 1 — Network Security Controls

```hcl
# terraform/pci-dss-network.tf
# PCI-DSS Requirement 1: Secure network controls

# RULE: Cardholder data must be isolated in a dedicated network segment
# RULE: Direct connection between internet and CDE is PROHIBITED

resource "aws_vpc" "pci_vpc" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name        = "pci-compliant-vpc"
    Compliance  = "PCI-DSS-R1"
    Environment = "production"
  }
}

# Public subnet — internet-facing (no cardholder data here)
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.pci_vpc.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name       = "public-${count.index}"
    PCIScope   = "out-of-scope"  # Not in CDE
  }
}

# Private application subnet (in CDE — but no direct card storage)
resource "aws_subnet" "private_app" {
  count             = 2
  vpc_id            = aws_vpc.pci_vpc.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name     = "private-app-${count.index}"
    PCIScope = "in-scope"  # Part of CDE
  }
}

# Database subnet — most restricted (stores tokenized data)
resource "aws_subnet" "database" {
  count             = 2
  vpc_id            = aws_vpc.pci_vpc.id
  cidr_block        = "10.0.${count.index + 20}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name     = "database-${count.index}"
    PCIScope = "in-scope"
  }
}

# WAF — required by PCI-DSS for web-facing apps
resource "aws_wafv2_web_acl" "pci_waf" {
  name  = "pci-dss-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # SQL Injection protection (PCI-DSS Req 6.4)
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SQLiRule"
      sampled_requests_enabled   = true
    }
  }

  # Common attacks protection
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRule"
      sampled_requests_enabled   = true
    }
  }

  # Rate limiting — prevent brute force (PCI-DSS Req 8.3.4)
  rule {
    name     = "RateLimitRule"
    priority = 3

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000  # max 2000 requests per 5 minutes per IP
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "PCIWebACL"
    sampled_requests_enabled   = true
  }

  tags = {
    Compliance = "PCI-DSS-R6.4"
  }
}

# Security Groups — explicit allow, deny all else
resource "aws_security_group" "payment_api" {
  name        = "payment-api-sg"
  description = "PCI-DSS compliant security group for payment API"
  vpc_id      = aws_vpc.pci_vpc.id

  # Allow HTTPS from ALB only
  ingress {
    from_port       = 8443
    to_port         = 8443
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "HTTPS from ALB only"
  }

  # NO SSH in production (PCI-DSS Req 2.2)
  # Use SSM Session Manager instead

  # Allow HTTPS out (for external API calls)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS outbound"
  }

  # Allow DB connection to database subnet only
  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.database.id]
    description     = "PostgreSQL to DB"
  }

  tags = {
    Name       = "payment-api-sg"
    Compliance = "PCI-DSS-R1"
  }
}
```

---

## Requirement 3 — Protect Stored Cardholder Data (Tokenization)

```python
# pci_tokenization.py
# PCI-DSS Requirement 3: Never store PANs in plain text
# Use tokenization: replace PAN with a non-sensitive token

import boto3
import hashlib
import hmac
import secrets
from typing import Optional

class PCITokenizationService:
    """
    PCI-DSS compliant card tokenization.
    Stores token ↔ PAN mapping in AWS DynamoDB (encrypted at rest with KMS).
    Only this service can map tokens back to PANs.
    """
    
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb')
        self.kms = boto3.client('kms')
        self.kms_key_id = "arn:aws:kms:us-east-1:123456789:key/pci-card-vault-key"
        self.table = self.dynamodb.Table('pci-token-vault')
    
    def tokenize(self, pan: str) -> str:
        """
        Replace PAN with a secure token.
        Token is safe to store in non-PCI systems.
        """
        # Validate PAN format (Luhn check)
        if not self._validate_luhn(pan):
            raise ValueError("Invalid PAN")
        
        # Check if PAN already has a token (idempotent)
        pan_hash = self._hash_pan(pan)
        existing = self.table.get_item(
            Key={"pan_hash": pan_hash}
        ).get("Item")
        
        if existing:
            return existing["token"]
        
        # Encrypt PAN with KMS
        encrypted_pan = self.kms.encrypt(
            KeyId=self.kms_key_id,
            Plaintext=pan.encode(),
            EncryptionContext={"purpose": "pci-card-vault"}
        )["CiphertextBlob"]
        
        # Generate secure token
        # Format: TOK-{random} — clearly not a real PAN
        token = f"TOK-{secrets.token_hex(16).upper()}"
        
        # Store encrypted PAN with token in vault
        self.table.put_item(Item={
            "pan_hash": pan_hash,
            "token": token,
            "encrypted_pan": encrypted_pan,
            "created_at": datetime.utcnow().isoformat(),
            "last_4": pan[-4:],  # Safe to store for display
            "card_type": self._detect_card_type(pan)
        })
        
        return token
    
    def detokenize(self, token: str, requester_id: str) -> str:
        """
        Convert token back to PAN.
        Only authorized services can detokenize.
        Logs every access for PCI audit trail.
        """
        # Audit log (PCI-DSS Req 10)
        self._audit_log("DETOKENIZE", token, requester_id)
        
        item = self.table.get_item(Key={"token": token}).get("Item")
        if not item:
            raise ValueError("Token not found")
        
        # Decrypt PAN
        pan = self.kms.decrypt(
            CiphertextBlob=item["encrypted_pan"].value,
            EncryptionContext={"purpose": "pci-card-vault"}
        )["Plaintext"].decode()
        
        return pan
    
    def _validate_luhn(self, pan: str) -> bool:
        """Luhn algorithm — validates credit card number"""
        digits = [int(d) for d in pan if d.isdigit()]
        checksum = 0
        for i, digit in enumerate(reversed(digits)):
            if i % 2 == 1:
                digit *= 2
                if digit > 9:
                    digit -= 9
            checksum += digit
        return checksum % 10 == 0
    
    def _hash_pan(self, pan: str) -> str:
        """One-way hash of PAN for deduplication (not reversible)"""
        # Use HMAC-SHA256 with a secret key (not just SHA256)
        secret = self._get_hash_secret()
        return hmac.new(secret, pan.encode(), hashlib.sha256).hexdigest()
    
    def _detect_card_type(self, pan: str) -> str:
        if pan.startswith('4'):
            return "VISA"
        elif pan[:2] in ['51','52','53','54','55']:
            return "MASTERCARD"
        elif pan[:2] in ['34','37']:
            return "AMEX"
        return "OTHER"
    
    def _audit_log(self, operation: str, token: str, requester: str):
        """PCI-DSS Req 10 — Log all access to cardholder data"""
        import logging
        logger = logging.getLogger("pci.audit")
        logger.info({
            "pci_event": True,
            "operation": operation,
            "token_masked": token[:8] + "****",
            "requester": requester,
            "timestamp": datetime.utcnow().isoformat()
        })
```

---

## Requirement 4 — Encryption in Transit

```yaml
# PCI-DSS Req 4: All cardholder data transmission MUST use TLS 1.2+
# Never use: HTTP, FTP, Telnet, SSL, TLS 1.0, TLS 1.1

# nginx/tls-config.conf — PCI-compliant TLS configuration
server {
    listen 443 ssl;
    server_name api.payments.company.com;

    # PCI-DSS: Only TLS 1.2 and 1.3
    ssl_protocols TLSv1.2 TLSv1.3;
    
    # PCI-DSS: Strong cipher suites only
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305';
    ssl_prefer_server_ciphers on;
    
    # HSTS — force HTTPS for 1 year (PCI requirement)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    
    # Certificate (use ACM or Let's Encrypt)
    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    
    # OCSP stapling (certificate validity)
    ssl_stapling on;
    ssl_stapling_verify on;
    
    location / {
        proxy_pass http://payment-api:8080;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Remove sensitive headers
        proxy_hide_header X-Powered-By;
        proxy_hide_header Server;
    }
}

# REDIRECT HTTP → HTTPS (no plain text allowed)
server {
    listen 80;
    server_name api.payments.company.com;
    return 301 https://$host$request_uri;
}
```

---

## Requirement 8 — Multi-Factor Authentication

```bash
#!/bin/bash
# pci-access-audit.sh
# PCI-DSS Req 8: Identify users and authenticate access
# Req 8.4: MFA required for ALL access to CDE

echo "=== PCI-DSS Access Control Audit ==="
echo "Requirement 8 — User Identification and Authentication"
echo ""

# Check 1: No shared accounts in CDE
echo "Checking for shared/generic accounts..."
aws iam list-users \
  --query 'Users[?contains(UserName, `shared`) || contains(UserName, `admin`) || contains(UserName, `generic`)].[UserName]' \
  --output text

# Check 2: MFA enabled for all users
echo ""
echo "Checking MFA status (ALL users must have MFA for CDE access)..."
aws iam generate-credential-report
sleep 5
aws iam get-credential-report --query 'Content' --output text | base64 -d | \
  awk -F',' 'NR>1 {
    if ($8 == "false") {
      print "❌ MFA NOT ENABLED: " $1
    } else {
      print "✅ MFA enabled: " $1
    }
  }'

# Check 3: Password policy meets PCI requirements
echo ""
echo "Checking password policy..."
aws iam get-account-password-policy --query 'PasswordPolicy' --output table

# PCI-DSS Req 8.3.6: Min 12 characters
# PCI-DSS Req 8.3.7: Numeric + alpha + special
# PCI-DSS Req 8.3.8: Expire in 90 days max

# Check 4: Access key age (no keys older than 90 days)
echo ""
echo "Checking access key age (PCI-DSS: rotate every 90 days)..."
aws iam list-users --query 'Users[*].UserName' --output text | \
  tr '\t' '\n' | while read user; do
    aws iam list-access-keys --user-name "$user" \
      --query "AccessKeyMetadata[?Status=='Active'].[UserName,CreateDate]" \
      --output text | while read key_info; do
        KEY_DATE=$(echo "$key_info" | awk '{print $2}')
        KEY_AGE=$(( ($(date +%s) - $(date -d "$KEY_DATE" +%s)) / 86400 ))
        if [ $KEY_AGE -gt 90 ]; then
          echo "❌ OLD KEY (${KEY_AGE} days): $key_info"
        fi
      done
  done

echo ""
echo "Audit complete. Review findings above for PCI-DSS compliance."
```

---

## Requirement 10 — Audit Logging

```yaml
# cloudwatch-pci-logging.tf
# PCI-DSS Req 10: Log and monitor ALL access to cardholder data
# Log retention: minimum 12 months (3 months immediately accessible)

resource "aws_cloudwatch_log_group" "pci_audit" {
  name              = "/pci-dss/cardholder-data-access"
  retention_in_days = 365  # 12 months

  kms_key_id = aws_kms_key.pci_logs.arn

  tags = {
    Compliance = "PCI-DSS-R10"
    DataClass  = "Highly-Sensitive"
  }
}

# Metric filter: Alert on any access to cardholder data vault
resource "aws_cloudwatch_metric_filter" "vault_access" {
  name           = "CardVaultAccess"
  pattern        = "{ $.pci_event = true }"
  log_group_name = aws_cloudwatch_log_group.pci_audit.name

  metric_transformation {
    name      = "CardVaultAccessCount"
    namespace = "PCI/Security"
    value     = "1"
  }
}

# Alert on unusual vault access volume
resource "aws_cloudwatch_metric_alarm" "vault_access_spike" {
  alarm_name          = "PCI-CardVaultAccessSpike"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "CardVaultAccessCount"
  namespace           = "PCI/Security"
  period              = 300  # 5 minutes
  statistic           = "Sum"
  threshold           = 100  # Alert if >100 vault accesses in 5 min
  alarm_description   = "PCI-DSS R10: Unusual cardholder data access volume"

  alarm_actions = [aws_sns_topic.security_team.arn]

  tags = {
    Compliance = "PCI-DSS-R10"
  }
}
```

---

## PCI-DSS Compliance Checklist for DevOps

```markdown
## PCI-DSS v4.0 — DevOps Compliance Checklist

### Requirement 1 — Network Controls
- [ ] CDE isolated in private subnets (no direct internet access)
- [ ] WAF deployed for web-facing payment pages
- [ ] Security Groups: deny all by default, allow only required ports
- [ ] VPC Flow Logs enabled (all traffic logged)
- [ ] Network diagrams updated (show CDE boundary clearly)

### Requirement 2 — Secure Configurations
- [ ] No default passwords anywhere (Jenkins, databases, admin panels)
- [ ] SSH disabled on production systems (use SSM Session Manager)
- [ ] OS hardening applied (CIS benchmark)
- [ ] Unnecessary services disabled
- [ ] Docker containers run as non-root

### Requirement 3 — Protect Stored Data
- [ ] PAN never stored in plain text (tokenization in place)
- [ ] CVV/CVC NEVER stored (not even encrypted)
- [ ] Database encryption: RDS encryption enabled (KMS)
- [ ] S3 buckets in CDE: server-side encryption (SSE-KMS)
- [ ] EBS volumes: encrypted

### Requirement 4 — Encryption in Transit
- [ ] TLS 1.2+ on ALL connections (no HTTP in CDE)
- [ ] No SSL or TLS 1.0/1.1
- [ ] Strong cipher suites only
- [ ] HSTS headers present

### Requirement 5 — Malware Protection
- [ ] Container images scanned (Trivy in CI/CD)
- [ ] ECR image scanning enabled
- [ ] Dependencies scanned (OWASP Dependency Check)

### Requirement 6 — Secure Development
- [ ] SAST in CI pipeline (SonarQube)
- [ ] OWASP Top 10 training completed
- [ ] Code review required for all changes
- [ ] No test PANs in production code (Gitleaks)

### Requirement 7 — Restrict Access
- [ ] Least privilege IAM policies
- [ ] RBAC on Kubernetes (no admin ClusterRole for developers)
- [ ] Access reviewed quarterly

### Requirement 8 — Authentication
- [ ] MFA for ALL CDE access
- [ ] No shared accounts
- [ ] Password policy: 12+ chars, 90-day expiry
- [ ] Access keys rotated every 90 days
- [ ] IAM role-based (no long-lived keys in apps)

### Requirement 10 — Logging
- [ ] All CDE access logged (who, what, when, result)
- [ ] Logs protected from modification
- [ ] Logs retained 12 months (3 months accessible)
- [ ] Alerts on suspicious access patterns
- [ ] Log review process documented

### Requirement 11 — Security Testing
- [ ] Quarterly external vulnerability scan (by ASV)
- [ ] Annual penetration test
- [ ] Internal vulnerability scan monthly
- [ ] File integrity monitoring on CDE systems
```

---

## Interview Questions — PCI-DSS

**Q: What is the CDE and why do you try to minimize it?**
```
CDE = Cardholder Data Environment
= all systems that store, process, or transmit cardholder data

Why minimize it:
  - Every system in CDE requires ALL 12 PCI-DSS requirements
  - Smaller CDE = fewer systems to secure = lower cost = less risk
  
Ways to minimize CDE:
  1. Tokenization: replace PAN with a token before it reaches your systems
     → Your payment page sends to Stripe/Braintree → they tokenize
     → Your database stores token (not PAN) → you're out of CDE

  2. iFrame/redirect: Payment form is hosted by PCI-compliant provider
     → Their form captures card → your system never sees the PAN
     → You're completely out of CDE for card capture
     
  3. Segmentation: physical and logical separation
     → CDE systems in dedicated subnet
     → Strict controls at boundary
```

**Q: How do you prevent CVV from being stored?**
```
CVV (Card Verification Value) MUST NEVER be stored — ever.

PCI-DSS says: "Do not store sensitive authentication data after authorization"

Technical controls:
  1. Application code: never write CVV to database
     - Code review ensures no CVV field in database schema
     - SonarQube rule: flag any variable named cvv/cvc in DB operations
  
  2. Input handling: CVV field never goes to backend in plain text
     - Tokenization provider receives CVV (they use it, don't store it)
     - Your backend never receives the raw CVV
  
  3. Testing: Gitleaks secret scanning
     - Catch if CVV accidentally ends up in logs or config files
  
  4. Monitoring: Alert on any 3-digit pattern in payment logs
```

---

[← BIAN](./05-bian.md) | [Next: GDPR/CCPA →](./07-gdpr-ccpa.md)
