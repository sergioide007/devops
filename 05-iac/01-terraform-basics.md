# Terraform Fundamentals

> Terraform lets you write infrastructure as code.
> Write HCL files, run terraform apply, and your infrastructure is created.

---

## Install Terraform

```bash
# Linux (Ubuntu)
wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform

# Mac
brew tap hashicorp/tap
brew install hashicorp/tap/terraform

# Verify
terraform version
```

---

## Terraform Workflow

```bash
# 1. Write code in .tf files
# 2. Initialize (download providers)
terraform init

# 3. See what will change
terraform plan

# 4. Apply changes
terraform apply

# 5. Destroy (tear down everything)
terraform destroy
```

---

## Basic Terraform Structure

```
project/
├── main.tf          # main resources
├── variables.tf     # input variables
├── outputs.tf       # output values
├── providers.tf     # provider configuration
└── terraform.tfvars # variable values (not in git if contains secrets)
```

---

## Your First Terraform Project — EC2 + S3

```hcl
# providers.tf
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote backend — store state in S3 (not locally!)
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"  # prevent concurrent applies
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "my-app"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
```

```hcl
# variables.tf
variable "aws_region" {
  description = "AWS region to deploy to"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access the server"
  type        = list(string)
  default     = ["10.0.0.0/8"]
}
```

```hcl
# main.tf
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# Security Group
resource "aws_security_group" "web" {
  name        = "${var.environment}-web-sg"
  description = "Web server security group"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.environment}-web-sg"
  }
}

# EC2 Instance
resource "aws_instance" "web" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.web.name

  user_data = base64encode(<<-EOF
    #!/bin/bash
    yum update -y
    yum install -y nginx
    systemctl enable nginx
    systemctl start nginx
  EOF
  )

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  tags = {
    Name = "${var.environment}-web-server"
  }
}

# S3 Bucket for static files
resource "aws_s3_bucket" "static" {
  bucket = "${var.environment}-my-app-static"
}

resource "aws_s3_bucket_versioning" "static" {
  bucket = aws_s3_bucket.static.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "static" {
  bucket = aws_s3_bucket.static.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "static" {
  bucket = aws_s3_bucket.static.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

```hcl
# outputs.tf
output "web_server_ip" {
  description = "Public IP of the web server"
  value       = aws_instance.web.public_ip
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.static.bucket
}

output "web_server_dns" {
  description = "Public DNS of the web server"
  value       = aws_instance.web.public_dns
}
```

---

## Terraform Commands Reference

```bash
# Initialize
terraform init
terraform init -upgrade        # upgrade providers

# Plan
terraform plan
terraform plan -out=tfplan     # save plan to file
terraform plan -target=aws_instance.web  # plan only one resource
terraform plan -var="environment=production"

# Apply
terraform apply
terraform apply tfplan          # apply saved plan (safer)
terraform apply -auto-approve   # skip confirmation (use in CI)
terraform apply -target=aws_instance.web  # apply one resource

# Destroy
terraform destroy
terraform destroy -target=aws_instance.web

# State management
terraform state list                        # list all resources
terraform state show aws_instance.web       # show resource details
terraform state rm aws_s3_bucket.old        # remove from state (don't destroy)
terraform import aws_s3_bucket.existing my-bucket-name  # import existing

# Format and validate
terraform fmt                   # format code
terraform fmt -check            # check formatting (CI)
terraform validate              # validate configuration

# Get outputs
terraform output
terraform output web_server_ip
terraform output -json

# Workspace (for multiple environments)
terraform workspace new staging
terraform workspace select production
terraform workspace list
```

---

## Terraform Modules — Reuse Code

```hcl
# modules/ec2-instance/main.tf
variable "name" { type = string }
variable "instance_type" { type = string }
variable "subnet_id" { type = string }
variable "security_group_ids" { type = list(string) }

resource "aws_instance" "this" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = var.security_group_ids

  tags = { Name = var.name }
}

output "instance_id" { value = aws_instance.this.id }
output "private_ip"  { value = aws_instance.this.private_ip }

# Use the module in main.tf
module "web_server" {
  source = "./modules/ec2-instance"

  name               = "production-web"
  instance_type      = "m5.large"
  subnet_id          = module.vpc.private_subnets[0]
  security_group_ids = [aws_security_group.web.id]
}

# Use module from Terraform Registry
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "production-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["us-east-1a", "us-east-1b"]
  public_subnets  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets = ["10.0.10.0/24", "10.0.11.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = false  # one per AZ for HA
}
```

---

## Terraform State Backend — S3 + DynamoDB

```bash
# Create state bucket (only once, manually or with Terraform)
aws s3 mb s3://mycompany-terraform-state --region us-east-1

# Enable versioning (to recover from accidents)
aws s3api put-bucket-versioning \
    --bucket mycompany-terraform-state \
    --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
    --bucket mycompany-terraform-state \
    --server-side-encryption-configuration '{
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            }
        }]
    }'

# Create DynamoDB table for state locking
aws dynamodb create-table \
    --table-name terraform-locks \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST
```

---

## Interview Questions — Terraform

**Q: What is the Terraform state file and why is it important?**
> "The state file records the current state of your infrastructure — it maps Terraform
> resources to real AWS resources. Without it, Terraform doesn't know what exists. I always
> use a remote backend (S3 + DynamoDB) — S3 stores the state file with versioning and
> encryption, DynamoDB provides locking so two people can't run terraform apply at the
> same time. Never commit the state file to Git — it can contain sensitive data."

**Q: What is the difference between terraform plan and terraform apply?**
> "`terraform plan` shows what changes will be made — which resources will be created,
> modified, or destroyed — without making any changes. It is like a dry run. `terraform apply`
> actually makes the changes. In CI/CD, I run plan on PRs so the team can review infrastructure
> changes before merging, then apply automatically on merge to main."

**Q: How do you manage multiple environments with Terraform?**
> "I use separate state files per environment using the S3 backend key. For example:
> `production/terraform.tfstate` and `staging/terraform.tfstate`. I pass environment-specific
> values through .tfvars files: `terraform apply -var-file=production.tfvars`. Some teams
> use Terraform workspaces, but I prefer separate state files because workspaces can get
> confusing with multiple accounts."

---

[← Back to Section](./README.md) | [Next: Ansible Basics →](./03-ansible-basics.md)
