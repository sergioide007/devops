# Route 53 — DNS and Traffic Routing

> **Level:** Intermediate
> **Prerequisites:** AWS Overview, VPC, EC2
> **You will learn:** Hosted zones, record types, routing policies, health checks, failover, ACM certificates, Terraform

---

## What is Route 53?

Route 53 is AWS's DNS service and global traffic manager. It translates domain names into IP addresses and can route traffic intelligently based on health, geography, latency, and weights.

```
DNS resolution flow:
  Browser: "what is the IP for api.myapp.com?"
      ↓
  Recursive resolver (ISP/8.8.8.8)
      ↓
  Route 53 authoritative nameserver
      ↓
  Returns: 54.32.10.45  ← (EC2 / ALB / CloudFront IP)
      ↓
  Browser: HTTP request to 54.32.10.45
```

---

## Hosted Zones

```bash
# A hosted zone holds DNS records for a domain

# Create a public hosted zone
ZONE_ID=$(aws route53 create-hosted-zone \
  --name myapp.com \
  --caller-reference "$(date +%s)" \
  --query 'HostedZone.Id' \
  --output text | cut -d'/' -f3)

echo "Zone ID: $ZONE_ID"

# List all hosted zones
aws route53 list-hosted-zones

# List records in a zone
aws route53 list-resource-record-sets --hosted-zone-id $ZONE_ID
```

---

## Record Types

```bash
# A Record — domain to IPv4
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.myapp.com",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "54.32.10.45"}]
      }
    }]
  }'

# CNAME — domain to another domain (not for apex/root domains)
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "www.myapp.com",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "api.myapp.com"}]
      }
    }]
  }'

# ALIAS Record — like CNAME but for apex and AWS resources (no extra DNS lookup cost)
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "myapp.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z35SXDOTRQ7X7K",
          "DNSName": "my-alb-123456.us-east-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

**Common ALB Hosted Zone IDs:**
```
us-east-1:      Z35SXDOTRQ7X7K
us-west-2:      Z1H1FL5HABSF5
eu-west-1:      Z32O12XQLNTSW2
CloudFront:     Z2FDTNDATAQYW2
```

---

## Routing Policies

### Weighted Routing (Blue/Green Deployments)

```bash
# Send 10% of traffic to new version, 90% to old version

# Old version (weight 90)
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.myapp.com",
        "Type": "A",
        "SetIdentifier": "v1-production",
        "Weight": 90,
        "TTL": 60,
        "ResourceRecords": [{"Value": "10.0.1.100"}]
      }
    }]
  }'

# New version (weight 10)
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.myapp.com",
        "Type": "A",
        "SetIdentifier": "v2-canary",
        "Weight": 10,
        "TTL": 60,
        "ResourceRecords": [{"Value": "10.0.2.200"}]
      }
    }]
  }'
```

### Latency-Based Routing (Multi-Region)

```bash
# Route users to the nearest region based on measured latency

# US-EAST-1 endpoint
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.myapp.com",
        "Type": "A",
        "SetIdentifier": "us-east-1",
        "Region": "us-east-1",
        "TTL": 60,
        "ResourceRecords": [{"Value": "54.32.10.45"}]
      }
    }]
  }'

# EU-WEST-1 endpoint
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.myapp.com",
        "Type": "A",
        "SetIdentifier": "eu-west-1",
        "Region": "eu-west-1",
        "TTL": 60,
        "ResourceRecords": [{"Value": "52.18.20.30"}]
      }
    }]
  }'
```

### Failover Routing (Active-Passive DR)

```bash
# Primary: active region — Secondary: DR region (only used if primary fails)

# Health check for primary
HEALTH_CHECK_ID=$(aws route53 create-health-check \
  --caller-reference "$(date +%s)" \
  --health-check-config '{
    "IPAddress": "54.32.10.45",
    "Port": 443,
    "Type": "HTTPS",
    "ResourcePath": "/health",
    "FailureThreshold": 3,
    "RequestInterval": 30
  }' \
  --query 'HealthCheck.Id' --output text)

# Primary record (active)
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.myapp.com",
        "Type": "A",
        "SetIdentifier": "primary",
        "Failover": "PRIMARY",
        "HealthCheckId": "'$HEALTH_CHECK_ID'",
        "TTL": 60,
        "ResourceRecords": [{"Value": "54.32.10.45"}]
      }
    }]
  }'

# Secondary record (DR — used only when primary health check fails)
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.myapp.com",
        "Type": "A",
        "SetIdentifier": "secondary",
        "Failover": "SECONDARY",
        "TTL": 60,
        "ResourceRecords": [{"Value": "52.18.20.30"}]
      }
    }]
  }'
```

---

## ACM — SSL/TLS Certificates

```bash
# Request a certificate (DNS validation — works with Route 53 auto-validation)
CERT_ARN=$(aws acm request-certificate \
  --domain-name "myapp.com" \
  --subject-alternative-names "*.myapp.com" \
  --validation-method DNS \
  --query 'CertificateArn' \
  --output text)

# Get DNS validation record (Route 53 auto-adds this)
aws acm describe-certificate \
  --certificate-arn $CERT_ARN \
  --query 'Certificate.DomainValidationOptions'

# After Route 53 creates the CNAME validation record, certificate becomes ISSUED (~5 min)
aws acm wait certificate-validated --certificate-arn $CERT_ARN
echo "Certificate validated: $CERT_ARN"
```

---

## Terraform: Complete DNS Setup

```hcl
# terraform/route53.tf

# Hosted zone (assuming domain was registered externally)
data "aws_route53_zone" "main" {
  name         = "myapp.com"
  private_zone = false
}

# ACM Certificate
resource "aws_acm_certificate" "main" {
  domain_name               = "myapp.com"
  subject_alternative_names = ["*.myapp.com"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Auto-validate via Route 53 DNS record
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# A record pointing to ALB (ALIAS)
resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "api.myapp.com"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# Health check
resource "aws_route53_health_check" "api" {
  fqdn              = "api.myapp.com"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30

  tags = {
    Name = "api-health-check"
  }
}

# Failover: primary + secondary
resource "aws_route53_record" "api_primary" {
  zone_id        = data.aws_route53_zone.main.zone_id
  name           = "api.myapp.com"
  type           = "A"
  set_identifier = "primary"

  failover_routing_policy {
    type = "PRIMARY"
  }

  health_check_id = aws_route53_health_check.api.id

  alias {
    name                   = aws_lb.us_east.dns_name
    zone_id                = aws_lb.us_east.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "api_secondary" {
  zone_id        = data.aws_route53_zone.main.zone_id
  name           = "api.myapp.com"
  type           = "A"
  set_identifier = "secondary"

  failover_routing_policy {
    type = "SECONDARY"
  }

  alias {
    name                   = aws_lb.eu_west.dns_name
    zone_id                = aws_lb.eu_west.zone_id
    evaluate_target_health = true
  }
}
```

---

## Interview Questions

**Q: What's the difference between a CNAME and an ALIAS record?**
> CNAME maps one domain to another domain name. It cannot be used at the apex (root) domain (`myapp.com`) — only subdomains. ALIAS is an AWS-specific extension: it maps a domain to an AWS resource (ALB, CloudFront, S3 website) and works at the apex. ALIAS resolves the target's current IP internally, so it's faster and free (no extra DNS charge). Always use ALIAS for AWS resources.

**Q: How does Route 53 health-check-based failover work?**
> Route 53 sends periodic HTTP/HTTPS/TCP probes from multiple AWS regions to your primary endpoint. If the threshold of consecutive failures is reached (typically 3), the record is marked unhealthy and Route 53 stops returning it. Traffic then goes to the SECONDARY record. Failover happens in ~60 seconds (30s check interval × 2 failures + TTL expiry).

**Q: How do you migrate a domain's DNS to Route 53 with zero downtime?**
> 1. Create the hosted zone in Route 53 and import all existing DNS records. 2. Lower TTL on all records at the old registrar to 60 seconds (do this 48h before). 3. Wait for TTL to propagate. 4. Change the NS (nameserver) records at your domain registrar to Route 53 nameservers. 5. Monitor with `dig @8.8.8.8 myapp.com` — propagation takes minutes to hours.

---

[← CloudWatch](./08-cloudwatch-monitoring.md) | [Back to Section](./README.md)
