# AWS Overview — Fundamentals

> AWS (Amazon Web Services) is the world's largest cloud platform.
> 200+ services. Available in 30+ regions worldwide.

---

## AWS Global Infrastructure

```
Region              → a geographic area (e.g., us-east-1, eu-west-1, sa-east-1)
  ├── Availability Zone (AZ) → one or more data centers
  │     (e.g., us-east-1a, us-east-1b, us-east-1c)
  ├── Local Zone          → closer to cities (for low latency)
  └── Edge Location       → CloudFront CDN point (100+ worldwide)
```

```bash
# List all regions
aws ec2 describe-regions --output table

# List AZs in a region
aws ec2 describe-availability-zones \
    --region us-east-1 \
    --output table
```

**Best practice:** Always deploy across **at least 2 Availability Zones**.
If one AZ fails, your app is still running.

---

## AWS Services Map — What Does What

### Compute (run your code)
| Service | What It Does | When to Use |
|---------|-------------|-------------|
| **EC2** | Virtual machine | Long-running apps, databases |
| **Lambda** | Run code without servers | Short tasks, event-driven |
| **ECS** | Run Docker containers | Containerized apps (simpler) |
| **EKS** | Kubernetes on AWS | Large-scale container orchestration |
| **Fargate** | Serverless containers | No server management for containers |
| **Auto Scaling** | Add/remove EC2 automatically | Handle traffic spikes |

### Storage
| Service | What It Does | When to Use |
|---------|-------------|-------------|
| **S3** | Object storage (files, images, backups) | Static files, backups, data lake |
| **EBS** | Block storage (hard drive for EC2) | EC2 operating system, databases |
| **EFS** | Shared file system | Multiple EC2 instances share files |
| **Glacier** | Cold archive storage | Long-term backups (cheap, slow) |

### Database
| Service | What It Does | When to Use |
|---------|-------------|-------------|
| **RDS** | Managed relational DB (MySQL, PostgreSQL) | SQL databases |
| **Aurora** | High-performance RDS | High-traffic MySQL/PostgreSQL |
| **DynamoDB** | Managed NoSQL | High-scale key-value, gaming, IoT |
| **ElastiCache** | Managed Redis/Memcached | Caching, sessions |
| **DocumentDB** | Managed MongoDB compatible | Document storage |

### Networking
| Service | What It Does | When to Use |
|---------|-------------|-------------|
| **VPC** | Private network in AWS | Isolate your resources |
| **ELB/ALB** | Load balancer | Distribute traffic |
| **Route 53** | DNS service | Domain names, health checks |
| **CloudFront** | CDN (Content Delivery Network) | Faster content globally |
| **API Gateway** | HTTP API front door | REST/GraphQL APIs |
| **Direct Connect** | Private link to AWS | On-premise to AWS (no internet) |

### Security
| Service | What It Does | When to Use |
|---------|-------------|-------------|
| **IAM** | Users, roles, permissions | Control who can do what |
| **KMS** | Encryption key management | Encrypt data |
| **Secrets Manager** | Store secrets (passwords, API keys) | Never hardcode secrets |
| **WAF** | Web Application Firewall | Block SQL injection, XSS |
| **GuardDuty** | Threat detection | Monitor for attacks |

---

## AWS Account Structure — Best Practices

```
AWS Organization
├── Management Account (billing only)
├── Production Account
│   ├── VPC (production)
│   ├── EKS cluster
│   └── RDS databases
├── Staging Account
│   └── Mirror of production
└── Development Account
    └── Individual developer sandboxes
```

```bash
# List accounts in organization
aws organizations list-accounts

# Assume role in another account (cross-account access)
aws sts assume-role \
    --role-arn "arn:aws:iam::123456789012:role/DevOpsRole" \
    --role-session-name "my-session"
```

---

## AWS Pricing — What You Pay For

| Service | Pricing Model |
|---------|--------------|
| EC2 | Per hour/second (type + size) |
| Lambda | Per invocation + per GB-second |
| S3 | Per GB stored + per request |
| Data transfer IN | Free |
| Data transfer OUT | Per GB (this adds up!) |

```bash
# Use AWS Cost Explorer to see spending
aws ce get-cost-and-usage \
    --time-period Start=2026-05-01,End=2026-05-31 \
    --granularity MONTHLY \
    --metrics "BlendedCost"

# Set a billing alert (very important!)
aws cloudwatch put-metric-alarm \
    --alarm-name billing-alarm \
    --alarm-description "Alert when monthly bill exceeds $100" \
    --metric-name EstimatedCharges \
    --namespace AWS/Billing \
    --statistic Maximum \
    --period 86400 \
    --evaluation-periods 1 \
    --threshold 100 \
    --comparison-operator GreaterThanThreshold \
    --alarm-actions arn:aws:sns:us-east-1:123456789:billing-alerts
```

---

## AWS Free Tier

Use this to practice for FREE:

```
EC2:          750 hours/month of t2.micro (12 months)
S3:           5GB storage (12 months)
Lambda:       1 million requests/month (always free)
DynamoDB:     25GB storage (always free)
RDS:          750 hours/month db.t2.micro (12 months)
CloudWatch:   10 custom metrics (always free)
```

---

## Amazon Q — AI Assistant for AWS

Amazon Q helps you understand and work with AWS.

```bash
# In AWS Console: click the Q icon (top right)
# Ask: "How do I set up a VPC with public and private subnets?"
# Ask: "Why is my Lambda function timing out?"
# Ask: "Show me the CloudWatch logs for my EKS cluster"

# Amazon Q in the CLI
aws q chat
# > How do I create an S3 bucket with versioning?
```

---

## Interview Questions — AWS Overview

**Q: How is AWS structured globally?**
> "AWS has Regions around the world — us-east-1 in Virginia, eu-west-1 in Ireland,
> ap-southeast-1 in Singapore, and more. Each Region has multiple Availability Zones —
> which are separate data centers with independent power and networking. I always deploy
> across at least 2 AZs for high availability. CloudFront Edge Locations are in 100+
> cities for CDN caching."

**Q: How would you design for high availability on AWS?**
> "Deploy across multiple AZs. Use Auto Scaling Groups for EC2. Use RDS Multi-AZ for
> databases. Use S3 which is 99.999999999% durable by default. Use ALB which distributes
> traffic across AZs. Use Route 53 health checks to failover DNS. Set up CloudWatch alarms
> for early warning."

---

[← Back to Section](./README.md) | [Next: IAM Security →](./02-iam-security.md)
