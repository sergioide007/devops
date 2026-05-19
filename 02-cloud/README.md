# Section 02 — Cloud Platforms

> Cloud is the backbone of modern DevOps.
> AWS is the most used. Azure and GCP are close behind.
> Most American companies use AWS or are multi-cloud.

---

## Topics in This Section

| File | Topic | Level |
|------|-------|-------|
| [01-aws-overview.md](./01-aws-overview.md) | AWS fundamentals and global infrastructure | Beginner |
| [02-iam-security.md](./02-iam-security.md) | IAM — Identity and Access Management | Beginner–Intermediate |
| [03-ec2-compute.md](./03-ec2-compute.md) | EC2 — Virtual Machines in AWS | Intermediate |
| [04-s3-storage.md](./04-s3-storage.md) | S3 — Object Storage | Beginner |
| [05-vpc-networking.md](./05-vpc-networking.md) | VPC — Virtual Private Cloud | Intermediate |
| [06-lambda-serverless.md](./06-lambda-serverless.md) | Lambda — Serverless Computing | Intermediate |
| [07-eks-kubernetes.md](./07-eks-kubernetes.md) | EKS — Kubernetes on AWS | Advanced |
| [08-cloudwatch-monitoring.md](./08-cloudwatch-monitoring.md) | CloudWatch — Metrics and Alerts | Intermediate |
| [09-route53-dns.md](./09-route53-dns.md) | Route 53 — DNS and Traffic Routing | Intermediate |
| [10-hybrid-onpremise.md](./10-hybrid-onpremise.md) | Hybrid and On-Premise Strategies | Advanced |

---

## Why AWS First?

- AWS has 32% market share (largest cloud provider)
- Most DevOps job descriptions require AWS knowledge
- AWS certifications are valued in American companies
- Services like Lambda, EKS, and RDS are industry standard

---

## Core AWS Services — Quick Reference

```
Compute:        EC2, Lambda, ECS, EKS, Fargate
Storage:        S3, EBS, EFS, Glacier
Database:       RDS, DynamoDB, ElastiCache, Aurora
Networking:     VPC, Route 53, CloudFront, ELB, API Gateway
Security:       IAM, KMS, Secrets Manager, WAF, GuardDuty
Monitoring:     CloudWatch, X-Ray, CloudTrail
CI/CD:          CodeCommit, CodeBuild, CodePipeline, CodeDeploy
IaC:            CloudFormation, CDK
```

---

## AWS CLI — Essential Setup

```bash
# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Configure
aws configure
# AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
# AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
# Default region name: us-east-1
# Default output format: json

# Use named profiles (for multiple accounts)
aws configure --profile production
aws configure --profile staging

# Use profile in commands
aws s3 ls --profile production
export AWS_PROFILE=production    # set for current session

# Check who you are
aws sts get-caller-identity
```

---

[← Back to Main](../README.md) | [Next: CI/CD →](../03-cicd/README.md)
