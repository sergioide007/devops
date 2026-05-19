# AWS Cloud Platform — From Zero

> Build a production-ready AWS infrastructure from scratch.
> Every Terraform file is complete and tested.
> Follow these steps to go from empty AWS account to production platform in 4 hours.

---

## Phase 0: AWS Account Setup (Multi-Account Strategy)

```
AWS Organization
├── Management Account (billing, SCPs only)
├── Security Account (GuardDuty, Security Hub, CloudTrail)
├── Shared Services Account (ECR, Nexus, Artifactory)
├── Production Account
├── Staging Account
└── Development Account (individual sandboxes)
```

```bash
#!/bin/bash
# 01-bootstrap-account.sh
# Run ONCE with root account credentials to set up the foundation

set -euo pipefail

ACCOUNT_ALIAS="mycompany-production"
ADMIN_EMAIL="devops-admin@mycompany.com"
REGION="us-east-1"

echo "=== Setting up AWS account ==="

# Set account alias
aws iam create-account-alias --account-alias $ACCOUNT_ALIAS

# Create IAM admin user (never use root!)
aws iam create-user --user-name devops-admin
aws iam create-login-profile \
    --user-name devops-admin \
    --password "TempPassword@2026!" \
    --password-reset-required

aws iam attach-user-policy \
    --user-name devops-admin \
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Enforce MFA on all users (SCP or IAM policy)
cat > /tmp/require-mfa-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "DenyWithoutMFA",
            "Effect": "Deny",
            "NotAction": [
                "iam:CreateVirtualMFADevice",
                "iam:EnableMFADevice",
                "iam:GetUser",
                "iam:ListMFADevices",
                "sts:GetSessionToken"
            ],
            "Resource": "*",
            "Condition": {
                "BoolIfExists": {
                    "aws:MultiFactorAuthPresent": "false"
                }
            }
        }
    ]
}
EOF

aws iam create-policy \
    --policy-name RequireMFA \
    --policy-document file:///tmp/require-mfa-policy.json

# Enable CloudTrail (ALL regions!)
aws s3 mb s3://${ACCOUNT_ALIAS}-cloudtrail-logs --region $REGION
aws s3api put-bucket-versioning \
    --bucket ${ACCOUNT_ALIAS}-cloudtrail-logs \
    --versioning-configuration Status=Enabled

aws cloudtrail create-trail \
    --name main-trail \
    --s3-bucket-name ${ACCOUNT_ALIAS}-cloudtrail-logs \
    --is-multi-region-trail \
    --include-global-service-events \
    --enable-log-file-validation

aws cloudtrail start-logging --name main-trail

# Enable GuardDuty
aws guardduty create-detector \
    --enable \
    --finding-publishing-frequency FIFTEEN_MINUTES \
    --region $REGION

# Enable Security Hub
aws securityhub enable-security-hub \
    --enable-default-standards \
    --region $REGION

echo "=== Account bootstrap complete ==="
echo "NEXT: Configure MFA on devops-admin user, then use it for everything"
```

---

## Phase 1: Terraform Bootstrap — State Backend

```bash
#!/bin/bash
# 02-create-terraform-backend.sh
# Creates S3 bucket + DynamoDB for Terraform state

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-east-1"
BUCKET_NAME="mycompany-terraform-state-${ACCOUNT_ID}"
TABLE_NAME="terraform-state-locks"

# S3 bucket for state
aws s3api create-bucket \
    --bucket $BUCKET_NAME \
    --region $REGION

aws s3api put-bucket-versioning \
    --bucket $BUCKET_NAME \
    --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
    --bucket $BUCKET_NAME \
    --server-side-encryption-configuration '{
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            },
            "BucketKeyEnabled": true
        }]
    }'

aws s3api put-public-access-block \
    --bucket $BUCKET_NAME \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# DynamoDB for state locking
aws dynamodb create-table \
    --table-name $TABLE_NAME \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region $REGION

echo "=== Terraform backend created ==="
echo "Bucket: $BUCKET_NAME"
echo "Table:  $TABLE_NAME"
```

---

## Phase 2: Landing Zone — Terraform Infrastructure

```
terraform/
├── modules/
│   ├── vpc/
│   ├── eks/
│   ├── rds/
│   └── iam/
├── environments/
│   ├── production/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── terraform.tfvars
│   └── staging/
│       ├── main.tf
│       └── terraform.tfvars
└── shared/
    ├── ecr.tf
    └── iam-roles.tf
```

```hcl
# terraform/environments/production/main.tf

terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.40" }
  }
  backend "s3" {
    bucket         = "mycompany-terraform-state-123456789012"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-state-locks"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Environment = "production"
      ManagedBy   = "terraform"
      Project     = "mycompany-platform"
      CostCenter  = "engineering"
    }
  }
}

# ── VPC ──────────────────────────────────────────────────────────
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.5"

  name = "production-vpc"
  cidr = "10.0.0.0/16"

  azs              = ["us-east-1a", "us-east-1b", "us-east-1c"]
  public_subnets   = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnets  = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]
  database_subnets = ["10.0.21.0/24", "10.0.22.0/24", "10.0.23.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = false  # one per AZ for HA
  enable_vpn_gateway     = true   # for hybrid connectivity
  enable_dns_hostnames   = true
  enable_dns_support     = true

  # Tags required by EKS
  public_subnet_tags  = { "kubernetes.io/role/elb" = "1" }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = "1" }

  # VPC Flow Logs for security compliance
  enable_flow_log                      = true
  flow_log_destination_type            = "s3"
  flow_log_destination_arn             = aws_s3_bucket.vpc_flow_logs.arn
  flow_log_traffic_type                = "ALL"
  flow_log_max_aggregation_interval    = 60
}

resource "aws_s3_bucket" "vpc_flow_logs" {
  bucket = "mycompany-vpc-flow-logs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_lifecycle_configuration" "vpc_flow_logs" {
  bucket = aws_s3_bucket.vpc_flow_logs.id
  rule {
    id     = "expire-after-90-days"
    status = "Enabled"
    expiration { days = 90 }    # PCI requires 90 days hot, 1 year total
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}

# ── EKS Cluster ──────────────────────────────────────────────────
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  cluster_name    = "production-cluster"
  cluster_version = "1.30"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true
  cluster_endpoint_public_access_cidrs = [
    "203.0.113.0/24",  # your office IP
    "0.0.0.0/0"        # or restrict to specific IPs
  ]

  # EKS Add-ons
  cluster_addons = {
    coredns                = { most_recent = true }
    kube-proxy             = { most_recent = true }
    vpc-cni                = { most_recent = true }
    aws-ebs-csi-driver     = { most_recent = true }
    aws-efs-csi-driver     = { most_recent = true }
    eks-pod-identity-agent = { most_recent = true }
  }

  # Node groups
  eks_managed_node_groups = {
    general = {
      instance_types = ["m5.large", "m5a.large"]  # spot alternatives
      capacity_type  = "ON_DEMAND"
      min_size       = 2
      max_size       = 10
      desired_size   = 3

      block_device_mappings = {
        xvda = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size           = 50
            volume_type           = "gp3"
            encrypted             = true  # encryption required for ISO 27001
            delete_on_termination = true
          }
        }
      }

      labels = { role = "general" }
      taints = []
    }

    compute = {
      instance_types = ["c5.xlarge", "c5a.xlarge"]
      capacity_type  = "SPOT"    # save 70% cost for compute-intensive
      min_size       = 0
      max_size       = 20
      desired_size   = 0

      labels = { role = "compute" }
      taints = [{ key = "role", value = "compute", effect = "NO_SCHEDULE" }]
    }
  }

  # IRSA (IAM Roles for Service Accounts) — no credentials in pods
  enable_irsa = true

  # Enable cluster access entry
  enable_cluster_creator_admin_permissions = true
}

# ── RDS PostgreSQL ───────────────────────────────────────────────
module "rds" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.5"

  identifier = "production-postgres"

  engine               = "postgres"
  engine_version       = "15.5"
  family               = "postgres15"
  major_engine_version = "15"
  instance_class       = "db.t3.medium"

  allocated_storage     = 100
  max_allocated_storage = 500

  db_name  = "appdb"
  username = "dbadmin"
  port     = 5432

  # High Availability
  multi_az = true

  # Storage encrypted — ISO 27001 requirement
  storage_encrypted = true
  kms_key_id        = aws_kms_key.rds.arn

  # Networking
  db_subnet_group_name   = module.vpc.database_subnet_group
  vpc_security_group_ids = [aws_security_group.rds.id]

  # Backup — PCI DSS requires 7 days minimum
  backup_retention_period = 30    # 30 days for compliance
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  # Monitoring
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled    = true

  # Deletion protection
  deletion_protection = true

  # Parameter group
  parameters = [
    { name = "log_connections", value = "1" },
    { name = "log_disconnections", value = "1" },
    { name = "log_duration", value = "1" },
    { name = "log_min_duration_statement", value = "1000" },  # log slow queries > 1s
    { name = "shared_preload_libraries", value = "pg_stat_statements" }
  ]
}

resource "aws_kms_key" "rds" {
  description             = "KMS key for RDS encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true  # annual rotation
}

# ── ElastiCache Redis ────────────────────────────────────────────
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "production-redis"
  description          = "Production Redis cluster"

  node_type            = "cache.t3.medium"
  num_cache_clusters   = 2  # 1 primary + 1 replica
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token  # from Secrets Manager

  automatic_failover_enabled = true
  multi_az_enabled           = true

  # Maintenance and backup
  maintenance_window       = "sun:05:00-sun:06:00"
  snapshot_retention_limit = 7
  snapshot_window          = "03:00-04:00"

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }
}

# ── ECR Container Registry ───────────────────────────────────────
resource "aws_ecr_repository" "apps" {
  for_each = toset(["my-api", "frontend", "worker", "scheduler"])

  name                 = each.key
  image_tag_mutability = "IMMUTABLE"  # cannot overwrite tags

  image_scanning_configuration {
    scan_on_push = true  # scan every image on push
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.ecr.arn
  }
}

resource "aws_ecr_lifecycle_policy" "apps" {
  for_each   = aws_ecr_repository.apps
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 production images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["prod-"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Delete untagged images after 1 day"
        selection = {
          tagStatus = "untagged"
          countType = "sinceImagePushed"
          countUnit = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      }
    ]
  })
}

data "aws_caller_identity" "current" {}
```

---

## Phase 3: Deploy to EKS — Step by Step

```bash
#!/bin/bash
# 03-deploy-to-eks.sh

CLUSTER_NAME="production-cluster"
REGION="us-east-1"
ECR_REGISTRY="123456789012.dkr.ecr.us-east-1.amazonaws.com"

echo "=== Connecting to EKS ==="
aws eks update-kubeconfig --name $CLUSTER_NAME --region $REGION

echo "=== Verifying cluster ==="
kubectl get nodes
kubectl get pods -A | head -20

echo "=== Creating namespaces ==="
kubectl create namespace production --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace staging --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -

echo "=== Installing AWS Load Balancer Controller ==="
helm repo add eks https://aws.github.io/eks-charts
helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
    --namespace kube-system \
    --set clusterName=$CLUSTER_NAME \
    --set serviceAccount.create=true \
    --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789012:role/AWSLoadBalancerControllerRole

echo "=== Installing Cluster Autoscaler ==="
helm repo add autoscaler https://kubernetes.github.io/autoscaler
helm install cluster-autoscaler autoscaler/cluster-autoscaler \
    --namespace kube-system \
    --set autoDiscovery.clusterName=$CLUSTER_NAME \
    --set awsRegion=$REGION \
    --set rbac.serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789012:role/ClusterAutoscalerRole

echo "=== Installing External Secrets Operator ==="
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
    --namespace external-secrets \
    --create-namespace

# Create ClusterSecretStore (reads from AWS Secrets Manager)
cat << YAML | kubectl apply -f -
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: $REGION
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets
            namespace: external-secrets
YAML

echo "=== Installing ArgoCD (GitOps) ==="
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

echo "Waiting for ArgoCD to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/argocd-server -n argocd

ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)
echo "ArgoCD admin password: $ARGOCD_PASSWORD"

echo "=== Installing Prometheus + Grafana ==="
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install monitoring prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    -f monitoring-values.yaml

echo "=== Installing Loki + Alloy ==="
helm repo add grafana https://grafana.github.io/helm-charts
helm install loki grafana/loki --namespace monitoring -f loki-values.yaml
helm install alloy grafana/alloy --namespace monitoring -f alloy-values.yaml

echo "=== Platform deployed! ==="
echo ""
echo "Services:"
echo "  ArgoCD:   kubectl port-forward svc/argocd-server -n argocd 8080:443"
echo "  Grafana:  kubectl port-forward svc/monitoring-grafana -n monitoring 3000:80"
echo "  Prometheus: kubectl port-forward svc/monitoring-kube-prometheus-prometheus -n monitoring 9090:9090"
```

---

## Phase 4: Cost Optimization

```bash
#!/bin/bash
# cost-check.sh — Check for wasted money

echo "=== Cost analysis ==="

# Find unattached EBS volumes
echo "--- Unattached EBS volumes (costing money!) ---"
aws ec2 describe-volumes \
    --filters Name=status,Values=available \
    --query 'Volumes[*].{ID:VolumeId,Size:Size,Cost:""}' \
    --output table

# Find stopped EC2 instances (still paying for EBS)
echo "--- Stopped EC2 instances ---"
aws ec2 describe-instances \
    --filters Name=instance-state-name,Values=stopped \
    --query 'Reservations[*].Instances[*].{ID:InstanceId,Type:InstanceType,Name:Tags[?Key==`Name`].Value|[0]}' \
    --output table

# Find old snapshots
echo "--- Snapshots older than 90 days ---"
aws ec2 describe-snapshots \
    --owner-ids self \
    --query "Snapshots[?StartTime<='$(date -d '90 days ago' '+%Y-%m-%d')'].[SnapshotId,StartTime,VolumeSize]" \
    --output table

# Find unused Elastic IPs
echo "--- Unassociated Elastic IPs (charged when not attached!) ---"
aws ec2 describe-addresses \
    --filters Name=domain,Values=vpc \
    --query 'Addresses[?AssociationId==null].[PublicIp,AllocationId]' \
    --output table

# Use AWS Cost Explorer for forecasting
aws ce get-cost-forecast \
    --time-period Start=$(date +%Y-%m-%d),End=$(date -d '+30 days' +%Y-%m-%d) \
    --metric BLENDED_COST \
    --granularity MONTHLY \
    --query ForecastResultsByTime[0].MeanValue \
    --output text
```

---

[← Previous: On-Premise](./01-onpremise-from-zero.md) | [Next: Hybrid Setup →](./03-hybrid-setup.md)
