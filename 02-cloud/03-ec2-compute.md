# EC2 — Virtual Machines in AWS

> **Level:** Intermediate
> **Prerequisites:** AWS Overview, IAM & Security
> **You will learn:** Instance types, AMIs, key pairs, security groups, auto-scaling, launch templates, Terraform

---

## What is EC2?

EC2 (Elastic Compute Cloud) is AWS's virtual machine service. Every EC2 instance runs on physical hardware in an AWS data center — you choose the OS, CPU, memory, and storage.

```
Your laptop → SSH → EC2 Instance (Linux/Windows VM)
                        ↓
              EBS Volume (persistent disk)
              Security Group (firewall)
              VPC Subnet (network placement)
```

---

## Instance Types

```
Family  Use case                   Example
──────────────────────────────────────────────
t3      General / dev / low cost   t3.micro (1 vCPU, 1GB)
m6i     General production         m6i.xlarge (4 vCPU, 16GB)
c6i     CPU-intensive (compute)    c6i.2xlarge (8 vCPU, 16GB)
r6i     Memory-intensive (DBs)     r6i.4xlarge (16 vCPU, 128GB)
g4dn    GPU (ML inference)         g4dn.xlarge (4 vCPU, 1 GPU)
i3      High I/O (NVMe SSD)        i3.large (2 vCPU, 15.25GB)
```

**Naming convention:** `[family][generation][attributes].[size]`
- `t3.micro` → t-family, gen 3, micro size
- `m6i.xlarge` → m-family, gen 6, Intel, xlarge

---

## Launch Your First EC2 Instance

### Via AWS CLI

```bash
# 1. Find the latest Amazon Linux 2023 AMI
aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*" \
             "Name=architecture,Values=x86_64" \
             "Name=state,Values=available" \
  --query "sort_by(Images, &CreationDate)[-1].ImageId" \
  --output text
# Output: ami-0abcdef1234567890

# 2. Create a key pair (save the .pem file!)
aws ec2 create-key-pair \
  --key-name my-devops-key \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/my-devops-key.pem
chmod 400 ~/.ssh/my-devops-key.pem

# 3. Get your default VPC and subnet
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=is-default,Values=true" \
  --query "Vpcs[0].VpcId" --output text)

SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[0].SubnetId" --output text)

# 4. Create a security group
SG_ID=$(aws ec2 create-security-group \
  --group-name web-sg \
  --description "Web server security group" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text)

# Allow SSH and HTTP
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp --port 22 --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp --port 80 --cidr 0.0.0.0/0

# 5. Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id ami-0abcdef1234567890 \
  --instance-type t3.micro \
  --key-name my-devops-key \
  --security-group-ids $SG_ID \
  --subnet-id $SUBNET_ID \
  --associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=web-server}]' \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "Instance ID: $INSTANCE_ID"

# 6. Wait until running
aws ec2 wait instance-running --instance-ids $INSTANCE_ID

# 7. Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

ssh -i ~/.ssh/my-devops-key.pem ec2-user@$PUBLIC_IP
```

---

## User Data — Bootstrap Script

```bash
# Run commands on first boot (passed as user data)

aws ec2 run-instances \
  --image-id ami-0abcdef1234567890 \
  --instance-type t3.small \
  --key-name my-devops-key \
  --security-group-ids $SG_ID \
  --subnet-id $SUBNET_ID \
  --user-data file://bootstrap.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=web-app}]'
```

```bash
# bootstrap.sh — runs as root on first boot
#!/bin/bash
set -ex

# Update system
dnf update -y

# Install and start Nginx
dnf install -y nginx
systemctl enable nginx
systemctl start nginx

# Install Docker
dnf install -y docker
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

echo "Bootstrap complete at $(date)" >> /var/log/bootstrap.log
```

---

## EBS Volumes (Persistent Storage)

```bash
# Add a 50GB gp3 volume to a running instance

# 1. Create the volume (same AZ as your instance!)
VOLUME_ID=$(aws ec2 create-volume \
  --availability-zone us-east-1a \
  --volume-type gp3 \
  --size 50 \
  --iops 3000 \
  --throughput 125 \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=app-data}]' \
  --query 'VolumeId' --output text)

# 2. Attach to instance
aws ec2 attach-volume \
  --volume-id $VOLUME_ID \
  --instance-id $INSTANCE_ID \
  --device /dev/sdf

# 3. On the instance: format and mount
ssh -i ~/.ssh/my-devops-key.pem ec2-user@$PUBLIC_IP << 'EOF'
  # Wait for device
  lsblk
  # Format (first time only)
  sudo mkfs -t xfs /dev/nvme1n1
  # Mount
  sudo mkdir /data
  sudo mount /dev/nvme1n1 /data
  # Persist across reboots
  echo '/dev/nvme1n1 /data xfs defaults,nofail 0 2' | sudo tee -a /etc/fstab
EOF
```

---

## Auto Scaling Group (ASG)

```bash
# Create launch template → ASG → scales based on CPU

# 1. Launch Template
aws ec2 create-launch-template \
  --launch-template-name web-lt \
  --launch-template-data '{
    "ImageId": "ami-0abcdef1234567890",
    "InstanceType": "t3.small",
    "KeyName": "my-devops-key",
    "SecurityGroupIds": ["'$SG_ID'"],
    "UserData": "'$(base64 -w0 bootstrap.sh)'",
    "TagSpecifications": [{
      "ResourceType": "instance",
      "Tags": [{"Key": "Name", "Value": "asg-web"}]
    }]
  }'

# 2. Auto Scaling Group
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name web-asg \
  --launch-template LaunchTemplateName=web-lt,Version='$Latest' \
  --min-size 2 \
  --max-size 10 \
  --desired-capacity 2 \
  --vpc-zone-identifier "$SUBNET_ID" \
  --health-check-type ELB \
  --health-check-grace-period 300

# 3. Target tracking policy — scale when CPU > 60%
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name web-asg \
  --policy-name cpu-scale-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ASGAverageCPUUtilization"
    },
    "TargetValue": 60.0,
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

---

## Terraform: Complete EC2 Setup

```hcl
# terraform/ec2.tf

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023*"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "aws_instance" "web" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t3.small"
  key_name               = aws_key_pair.devops.key_name
  vpc_security_group_ids = [aws_security_group.web.id]
  subnet_id              = aws_subnet.public.id
  associate_public_ip_address = true

  user_data = base64encode(file("bootstrap.sh"))

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    delete_on_termination = true
    encrypted             = true
  }

  metadata_options {
    http_tokens = "required"   # IMDSv2 — disable legacy metadata endpoint
  }

  tags = {
    Name        = "web-server"
    Environment = var.env
  }
}

resource "aws_key_pair" "devops" {
  key_name   = "devops-key"
  public_key = file("~/.ssh/id_rsa.pub")
}

resource "aws_security_group" "web" {
  name   = "web-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]   # Only your IP, not 0.0.0.0/0
  }
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

# Launch Template + ASG
resource "aws_launch_template" "web" {
  name_prefix   = "web-lt-"
  image_id      = data.aws_ami.amazon_linux.id
  instance_type = "t3.small"
  key_name      = aws_key_pair.devops.key_name

  vpc_security_group_ids = [aws_security_group.web.id]
  user_data              = base64encode(file("bootstrap.sh"))

  metadata_options {
    http_tokens = "required"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "web" {
  name                = "web-asg"
  min_size            = 2
  max_size            = 10
  desired_capacity    = 2
  vpc_zone_identifier = aws_subnet.public[*].id

  launch_template {
    id      = aws_launch_template.web.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "web-asg-instance"
    propagate_at_launch = true
  }
}

resource "aws_autoscaling_policy" "cpu" {
  name                   = "cpu-scale"
  autoscaling_group_name = aws_autoscaling_group.web.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 60.0
  }
}
```

---

## Useful EC2 Commands

```bash
# List all running instances
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].[InstanceId,InstanceType,PublicIpAddress,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# Stop / start / terminate
aws ec2 stop-instances --instance-ids i-0abc123
aws ec2 start-instances --instance-ids i-0abc123
aws ec2 terminate-instances --instance-ids i-0abc123

# Get instance console output (useful when SSH fails)
aws ec2 get-console-output --instance-id i-0abc123

# Create AMI (snapshot of running instance)
aws ec2 create-image \
  --instance-id i-0abc123 \
  --name "web-server-$(date +%Y%m%d)" \
  --no-reboot

# Check instance metadata from inside the instance (IMDSv2)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/instance-id
```

---

## Interview Questions

**Q: What's the difference between stopping and terminating an EC2 instance?**
> Stop: instance is shut down but EBS root volume is preserved. Data survives. You can restart it. Stop/start changes the public IP (unless Elastic IP).
> Terminate: instance and its root EBS volume are permanently deleted (unless `delete_on_termination=false`). No recovery.

**Q: How do you make EC2 instances more secure?**
> 1. Use IMDSv2 (block legacy v1 metadata endpoint).
> 2. No SSH from 0.0.0.0/0 — use a bastion or SSM Session Manager.
> 3. Enable EBS encryption at rest.
> 4. Use IAM instance profiles instead of hardcoded credentials.
> 5. Store secrets in Secrets Manager, not user data or env vars.

**Q: When would you choose EC2 over Lambda?**
> EC2 for: long-running processes (>15min), stateful apps, custom OS/runtime, GPU workloads, high-memory needs, steady baseline traffic (Reserved Instances save ~60%).
> Lambda for: event-driven, unpredictable traffic, short tasks (<15min), cost savings on sporadic workloads.

---

[← Back to Section](./README.md) | [Next: S3 Storage →](./04-s3-storage.md)
