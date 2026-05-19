# VPC — Virtual Private Cloud

> VPC is your own private network in AWS.
> Everything runs inside a VPC — EC2, RDS, EKS, Lambda (VPC-connected).
> Designing a good VPC is critical for security and performance.

---

## VPC Core Concepts

```
VPC (10.0.0.0/16)
├── Public Subnet (10.0.1.0/24)  — has internet access
│   ├── Load Balancer
│   ├── NAT Gateway
│   └── Bastion Host (jump server)
├── Private Subnet (10.0.2.0/24) — no direct internet access
│   ├── EC2 instances (app servers)
│   ├── EKS nodes
│   └── Lambda functions
└── Database Subnet (10.0.3.0/24) — most restricted
    └── RDS, ElastiCache
```

**Rules:**
- Public subnet = has a route to Internet Gateway
- Private subnet = only has route to NAT Gateway (for outbound)
- Database subnet = no outbound to internet

---

## Create VPC with Terraform

```hcl
# vpc.tf — Production VPC with 2 AZs

# VPC
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "production-vpc"
    Environment = "production"
  }
}

# Internet Gateway (allows public subnets to reach internet)
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "production-igw"
  }
}

# Public Subnets (one per AZ)
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "public-subnet-${count.index + 1}"
    Type = "public"
    "kubernetes.io/role/elb" = "1"  # needed for EKS load balancers
  }
}

# Private Subnets (one per AZ)
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "private-subnet-${count.index + 1}"
    Type = "private"
    "kubernetes.io/role/internal-elb" = "1"  # needed for EKS internal LBs
  }
}

# Database Subnets
resource "aws_subnet" "database" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 20}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "database-subnet-${count.index + 1}"
    Type = "database"
  }
}

# NAT Gateway (allows private subnets to reach internet for updates/patches)
resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id  # NAT goes in PUBLIC subnet

  tags = {
    Name = "production-nat"
  }
}

# Route Tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id  # public goes to IGW
  }

  tags = {
    Name = "public-rt"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id  # private goes to NAT
  }

  tags = {
    Name = "private-rt"
  }
}

# Route Table Associations
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

data "aws_availability_zones" "available" {
  state = "available"
}
```

---

## Security Groups

Security Groups are stateful firewalls attached to resources.

```hcl
# security_groups.tf

# ALB Security Group — accepts traffic from internet
resource "aws_security_group" "alb" {
  name        = "alb-sg"
  description = "Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# App Security Group — only accepts traffic from ALB
resource "aws_security_group" "app" {
  name        = "app-sg"
  description = "Application servers"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]  # only from ALB
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# RDS Security Group — only accepts from app servers
resource "aws_security_group" "rds" {
  name        = "rds-sg"
  description = "RDS database"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]  # only from app
  }
  # No egress needed for RDS
}
```

---

## Network ACLs — Extra Layer

```bash
# NACLs are stateless (you must allow both directions)
# Applied at subnet level (not instance level)

# Create NACL for database subnet
aws ec2 create-network-acl --vpc-id vpc-12345678

# Allow PostgreSQL from private subnet only
aws ec2 create-network-acl-entry \
    --network-acl-id acl-12345678 \
    --rule-number 100 \
    --protocol tcp \
    --rule-action allow \
    --ingress \
    --cidr-block 10.0.10.0/24 \
    --port-range From=5432,To=5432

# Allow return traffic (ephemeral ports — stateless!)
aws ec2 create-network-acl-entry \
    --network-acl-id acl-12345678 \
    --rule-number 200 \
    --protocol tcp \
    --rule-action allow \
    --egress \
    --cidr-block 10.0.10.0/24 \
    --port-range From=1024,To=65535

# Deny everything else
aws ec2 create-network-acl-entry \
    --network-acl-id acl-12345678 \
    --rule-number 32766 \
    --protocol -1 \
    --rule-action deny \
    --ingress \
    --cidr-block 0.0.0.0/0
```

---

## VPC Peering and Transit Gateway

```bash
# VPC Peering — connect two VPCs directly
# Use case: connect production VPC to logging VPC

aws ec2 create-vpc-peering-connection \
    --vpc-id vpc-111111 \           # requester
    --peer-vpc-id vpc-222222        # accepter

aws ec2 accept-vpc-peering-connection \
    --vpc-peering-connection-id pcx-12345678

# Add route in each VPC's route table
aws ec2 create-route \
    --route-table-id rtb-111111 \
    --destination-cidr-block 10.1.0.0/16 \
    --vpc-peering-connection-id pcx-12345678

# Transit Gateway — hub for multiple VPCs (better than peering for many VPCs)
# One TGW connects all your VPCs
# Much simpler at scale (10+ VPCs)
aws ec2 create-transit-gateway \
    --description "Main TGW for all VPCs"

aws ec2 create-transit-gateway-vpc-attachment \
    --transit-gateway-id tgw-12345678 \
    --vpc-id vpc-111111 \
    --subnet-ids subnet-aaa111 subnet-bbb222
```

---

## Load Balancer Setup

```bash
# Application Load Balancer (ALB) — HTTP/HTTPS routing

# Create ALB
aws elbv2 create-load-balancer \
    --name production-alb \
    --type application \
    --subnets subnet-public1 subnet-public2 \
    --security-groups sg-alb \
    --scheme internet-facing

# Create target group (the backend servers)
aws elbv2 create-target-group \
    --name api-servers \
    --protocol HTTP \
    --port 8080 \
    --vpc-id vpc-12345 \
    --health-check-path /health \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3

# Register targets (EC2 instances)
aws elbv2 register-targets \
    --target-group-arn arn:aws:elasticloadbalancing:... \
    --targets Id=i-1234567890 Id=i-0987654321

# Create HTTPS listener
aws elbv2 create-listener \
    --load-balancer-arn arn:aws:elasticloadbalancing:... \
    --protocol HTTPS \
    --port 443 \
    --certificates CertificateArn=arn:aws:acm:... \
    --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:...
```

---

## Interview Questions — VPC

**Q: Explain the difference between public and private subnets.**
> "A public subnet has a route to an Internet Gateway — resources in it can receive
> traffic from the internet and initiate outbound connections. A private subnet only
> has a route to a NAT Gateway — resources can reach the internet for updates but
> cannot be reached from the internet directly. I put load balancers and NAT gateways
> in public subnets, application servers and databases in private/database subnets."

**Q: What is a NAT Gateway?**
> "NAT Gateway allows private subnet resources to initiate outbound connections to
> the internet (for software updates, API calls) while remaining unreachable from
> the internet. It is managed by AWS — no patching needed. The NAT Gateway itself
> lives in a public subnet and has an Elastic IP. Private subnets route 0.0.0.0/0
> to the NAT Gateway."

**Q: How do you control traffic between a load balancer and application servers?**
> "I use Security Groups with source restrictions. The ALB security group allows
> 80/443 from 0.0.0.0/0. The app security group allows 8080 only from the ALB
> security group (by ID, not by CIDR). The RDS security group allows 5432 only
> from the app security group. This creates a chain where traffic can only flow
> in the intended direction."

---

[← Back to Section](./README.md)
