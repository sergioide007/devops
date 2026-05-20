# Terraform for AWS — VPC, EKS, RDS

> **Level:** Advanced
> **Prerequisites:** Terraform Basics, AWS Overview, VPC, EKS
> **You will learn:** Production-grade AWS infrastructure with Terraform — modular VPC, EKS cluster, RDS, remote state, workspaces

---

## Project Structure

```
terraform/
├── environments/
│   ├── staging/
│   │   ├── main.tf
│   │   ├── terraform.tfvars
│   │   └── backend.tf
│   └── production/
│       ├── main.tf
│       ├── terraform.tfvars
│       └── backend.tf
└── modules/
    ├── vpc/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── eks/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── rds/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

---

## Remote State Backend

```hcl
# environments/production/backend.tf
# Shared state in S3 + DynamoDB lock — always set this up first

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "company-terraform-state-123456789012"
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
      Environment = var.environment
      ManagedBy   = "Terraform"
      Project     = "company-platform"
    }
  }
}
```

---

## VPC Module

```hcl
# modules/vpc/main.tf

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}

# VPC
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${var.name}-vpc" }
}

# Public subnets (Load Balancers, NAT Gateways)
resource "aws_subnet" "public" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone = local.azs[count.index]

  map_public_ip_on_launch = true

  tags = {
    Name                     = "${var.name}-public-${local.azs[count.index]}"
    "kubernetes.io/role/elb" = "1"   # Required for EKS ALB
  }
}

# Private subnets (EC2, EKS nodes, RDS)
resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 10)
  availability_zone = local.azs[count.index]

  tags = {
    Name                              = "${var.name}-private-${local.azs[count.index]}"
    "kubernetes.io/role/internal-elb" = "1"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name}-igw" }
}

# NAT Gateway (one per AZ for HA)
resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? length(local.azs) : 0
  domain = "vpc"
  tags   = { Name = "${var.name}-nat-eip-${count.index}" }
}

resource "aws_nat_gateway" "main" {
  count         = var.enable_nat_gateway ? length(local.azs) : 0
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${var.name}-nat-${count.index}" }
  depends_on    = [aws_internet_gateway.main]
}

# Route tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.name}-public-rt" }
}

resource "aws_route_table" "private" {
  count  = length(local.azs)
  vpc_id = aws_vpc.main.id

  dynamic "route" {
    for_each = var.enable_nat_gateway ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.main[count.index].id
    }
  }

  tags = { Name = "${var.name}-private-rt-${count.index}" }
}

resource "aws_route_table_association" "public" {
  count          = length(local.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(local.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}
```

```hcl
# modules/vpc/variables.tf
variable "name"               { type = string }
variable "vpc_cidr"           { type = string; default = "10.0.0.0/16" }
variable "enable_nat_gateway" { type = bool;   default = true }
```

```hcl
# modules/vpc/outputs.tf
output "vpc_id"          { value = aws_vpc.main.id }
output "public_subnets"  { value = aws_subnet.public[*].id }
output "private_subnets" { value = aws_subnet.private[*].id }
output "vpc_cidr"        { value = aws_vpc.main.cidr_block }
```

---

## EKS Module

```hcl
# modules/eks/main.tf

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnet_ids

  enable_irsa                    = true
  cluster_endpoint_public_access = var.public_access

  cluster_addons = {
    coredns    = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni    = { most_recent = true }
    aws-ebs-csi-driver = { most_recent = true }
  }

  eks_managed_node_groups = {
    system = {
      name           = "system-ng"
      instance_types = ["m6i.large"]
      min_size       = 2
      max_size       = 4
      desired_size   = 2

      labels = { role = "system" }

      taints = [{
        key    = "CriticalAddonsOnly"
        value  = "true"
        effect = "NO_SCHEDULE"
      }]
    }

    application = {
      name           = "app-ng"
      instance_types = [var.node_instance_type]
      min_size       = var.min_nodes
      max_size       = var.max_nodes
      desired_size   = var.desired_nodes

      disk_size = 50

      labels = { role = "application" }

      update_config = {
        max_unavailable_percentage = 25
      }
    }
  }
}

# Cluster Autoscaler IAM
module "cluster_autoscaler_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name                        = "${var.cluster_name}-cluster-autoscaler"
  attach_cluster_autoscaler_policy = true
  cluster_autoscaler_cluster_names = [module.eks.cluster_name]

  oidc_providers = {
    ex = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:cluster-autoscaler"]
    }
  }
}
```

---

## RDS Module

```hcl
# modules/rds/main.tf

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-db-subnet-group"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "rds" {
  name   = "${var.name}-rds-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.allowed_security_groups   # only EKS nodes
  }
}

resource "aws_db_parameter_group" "main" {
  family = "postgres16"
  name   = "${var.name}-pg16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"   # log queries > 1s
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }
}

resource "aws_db_instance" "main" {
  identifier = var.name

  engine         = "postgres"
  engine_version = "16.2"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn

  db_name  = var.database_name
  username = var.master_username
  password = var.master_password   # use Secrets Manager in production

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  parameter_group_name   = aws_db_parameter_group.main.name

  multi_az               = var.multi_az
  publicly_accessible    = false
  deletion_protection    = var.deletion_protection

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:05:00-sun:06:00"

  performance_insights_enabled = true

  skip_final_snapshot = false
  final_snapshot_identifier = "${var.name}-final-snapshot"

  tags = { Name = var.name }
}
```

---

## Environments: Staging vs Production

```hcl
# environments/production/main.tf

module "vpc" {
  source = "../../modules/vpc"

  name               = "company-production"
  vpc_cidr           = "10.0.0.0/16"
  enable_nat_gateway = true
}

module "eks" {
  source = "../../modules/eks"

  cluster_name        = "production-cluster"
  kubernetes_version  = "1.30"
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnets
  node_instance_type  = "m6i.large"
  min_nodes           = 3
  max_nodes           = 20
  desired_nodes       = 3
  public_access       = false   # private cluster in production
}

module "rds" {
  source = "../../modules/rds"

  name                    = "company-production-db"
  vpc_id                  = module.vpc.vpc_id
  private_subnet_ids      = module.vpc.private_subnets
  allowed_security_groups = [module.eks.node_security_group_id]
  instance_class          = "db.r6g.large"
  allocated_storage       = 100
  max_allocated_storage   = 500
  database_name           = "appdb"
  master_username         = "appuser"
  master_password         = var.db_password   # from terraform.tfvars or SSM
  multi_az                = true
  deletion_protection     = true
}
```

```hcl
# environments/staging/main.tf — same modules, smaller config

module "vpc" {
  source             = "../../modules/vpc"
  name               = "company-staging"
  vpc_cidr           = "10.1.0.0/16"
  enable_nat_gateway = true
}

module "eks" {
  source             = "../../modules/eks"
  cluster_name       = "staging-cluster"
  kubernetes_version = "1.30"
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnets
  node_instance_type = "t3.medium"
  min_nodes          = 1
  max_nodes          = 5
  desired_nodes      = 2
  public_access      = true   # staging: OK for devs to access directly
}

module "rds" {
  source                  = "../../modules/rds"
  name                    = "company-staging-db"
  vpc_id                  = module.vpc.vpc_id
  private_subnet_ids      = module.vpc.private_subnets
  allowed_security_groups = [module.eks.node_security_group_id]
  instance_class          = "db.t3.micro"
  allocated_storage       = 20
  max_allocated_storage   = 100
  database_name           = "appdb"
  master_username         = "appuser"
  master_password         = var.db_password
  multi_az                = false   # cost saving in staging
  deletion_protection     = false
}
```

---

## Deployment Workflow

```bash
# Initialize and plan for production

cd environments/production

# Set variables (never commit db_password to git)
export TF_VAR_db_password=$(aws secretsmanager get-secret-value \
  --secret-id company/production/db-password \
  --query SecretString --output text | jq -r .password)

# Init (downloads modules and providers)
terraform init

# Validate syntax
terraform validate

# Plan — review before applying
terraform plan -out=production.tfplan

# Review plan output carefully before apply
terraform apply production.tfplan

# After apply: configure kubectl
aws eks update-kubeconfig \
  --name production-cluster \
  --region us-east-1
```

---

## Interview Questions

**Q: How do you manage different environments (staging/production) with Terraform?**
> Two approaches: (1) Workspaces — same code, different state files. Simpler but can cause drift between environments. (2) Separate directories per environment (recommended for production) — each has its own `backend.tf`, `tfvars`, and calls the same modules with different variables. Safer because you review staging changes independently before production.

**Q: What happens if two people run `terraform apply` at the same time?**
> The DynamoDB state lock prevents concurrent applies. The second `apply` gets a "state is locked" error with the LockID. If a plan/apply crashes without releasing the lock, you can manually unlock with `terraform force-unlock <LockID>` — but confirm the previous run actually failed before doing this.

**Q: How do you import existing AWS resources into Terraform state?**
> `terraform import aws_instance.web i-0abc123456` — Terraform maps the existing resource to the state file. You still need to write the matching HCL configuration manually; `import` only updates the state, it doesn't generate code. (Terraform 1.5+ has `import` blocks that can generate config.)

---

[← Terraform Basics](./01-terraform-basics.md) | [Back to Section](./README.md) | [Next: Ansible Playbooks →](./04-ansible-playbooks.md)
