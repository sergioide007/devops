# S3 — Object Storage

> **Level:** Beginner–Intermediate
> **Prerequisites:** AWS Overview, IAM & Security
> **You will learn:** Buckets, policies, versioning, lifecycle rules, encryption, static hosting, CLI operations, Terraform

---

## What is S3?

S3 (Simple Storage Service) stores objects (files) in buckets. Unlike EBS (block storage attached to one EC2), S3 is:
- **Globally accessible** via HTTP/HTTPS
- **Infinitely scalable** — no capacity planning
- **Highly durable** — 99.999999999% (11 nines)
- **Pay-per-use** — no upfront capacity

```
Object storage model:
  Bucket: my-company-assets
    └── images/logo.png        (key = "images/logo.png")
    └── docs/report-2026.pdf   (key = "docs/report-2026.pdf")
    └── backups/db-2026-01.tar (key = "backups/db-2026-01.tar")

URL: https://my-company-assets.s3.amazonaws.com/images/logo.png
```

---

## Create and Use a Bucket

```bash
# Create bucket (bucket names are globally unique)
aws s3 mb s3://my-devops-demo-bucket-2026 --region us-east-1

# Upload a file
aws s3 cp ./report.pdf s3://my-devops-demo-bucket-2026/docs/report.pdf

# Upload entire folder
aws s3 sync ./dist/ s3://my-devops-demo-bucket-2026/website/

# List contents
aws s3 ls s3://my-devops-demo-bucket-2026/ --recursive

# Download
aws s3 cp s3://my-devops-demo-bucket-2026/docs/report.pdf ./local-report.pdf

# Delete object
aws s3 rm s3://my-devops-demo-bucket-2026/docs/report.pdf

# Delete bucket (must be empty first)
aws s3 rm s3://my-devops-demo-bucket-2026 --recursive
aws s3 rb s3://my-devops-demo-bucket-2026
```

---

## Bucket Policies

```json
// s3-policy.json
// Allow public read for a static website
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-website-bucket/*"
    }
  ]
}
```

```bash
# Apply policy
aws s3api put-bucket-policy \
  --bucket my-website-bucket \
  --policy file://s3-policy.json
```

```json
// Restrict access to a specific IAM role only
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::my-private-bucket",
        "arn:aws:s3:::my-private-bucket/*"
      ],
      "Condition": {
        "StringNotEquals": {
          "aws:PrincipalArn": "arn:aws:iam::123456789012:role/app-role"
        }
      }
    }
  ]
}
```

---

## Versioning

```bash
# Enable versioning (cannot be fully disabled — only suspended)
aws s3api put-bucket-versioning \
  --bucket my-devops-demo-bucket-2026 \
  --versioning-configuration Status=Enabled

# List all versions of a file
aws s3api list-object-versions \
  --bucket my-devops-demo-bucket-2026 \
  --prefix docs/report.pdf

# Restore a previous version (copy it back to current)
aws s3api copy-object \
  --bucket my-devops-demo-bucket-2026 \
  --copy-source "my-devops-demo-bucket-2026/docs/report.pdf?versionId=abc123" \
  --key docs/report.pdf

# Delete a specific version permanently
aws s3api delete-object \
  --bucket my-devops-demo-bucket-2026 \
  --key docs/report.pdf \
  --version-id abc123
```

---

## Lifecycle Rules (Auto-archive and delete)

```bash
# lifecycle.json — move to cheaper storage after 30 days, delete after 365

aws s3api put-bucket-lifecycle-configuration \
  --bucket my-devops-demo-bucket-2026 \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "archive-logs",
        "Status": "Enabled",
        "Filter": {"Prefix": "logs/"},
        "Transitions": [
          {
            "Days": 30,
            "StorageClass": "STANDARD_IA"
          },
          {
            "Days": 90,
            "StorageClass": "GLACIER"
          }
        ],
        "Expiration": {
          "Days": 365
        },
        "NoncurrentVersionExpiration": {
          "NoncurrentDays": 30
        }
      }
    ]
  }'
```

**Storage classes (cost vs. access speed):**
```
STANDARD          — frequent access, milliseconds      $0.023/GB/month
STANDARD_IA       — infrequent, milliseconds           $0.0125/GB/month
GLACIER_IR        — infrequent, minutes                $0.004/GB/month
GLACIER           — archive, 3-5 hours                 $0.0036/GB/month
DEEP_ARCHIVE      — long-term, 12 hours                $0.00099/GB/month
```

---

## Encryption

```bash
# Enable default encryption (SSE-S3 = AWS-managed keys)
aws s3api put-bucket-encryption \
  --bucket my-devops-demo-bucket-2026 \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "arn:aws:kms:us-east-1:123456789012:key/abc-123"
      },
      "BucketKeyEnabled": true
    }]
  }'

# Deny unencrypted uploads (bucket policy)
{
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::my-devops-demo-bucket-2026/*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption": "aws:kms"
    }
  }
}

# Block all public access (important for private buckets)
aws s3api put-public-access-block \
  --bucket my-devops-demo-bucket-2026 \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

---

## Static Website Hosting

```bash
# 1. Create bucket with website name
aws s3 mb s3://www.mysite.com

# 2. Enable static website hosting
aws s3 website s3://www.mysite.com \
  --index-document index.html \
  --error-document 404.html

# 3. Apply public-read policy
aws s3api put-bucket-policy \
  --bucket www.mysite.com \
  --policy '{"Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::www.mysite.com/*"}]}'

# 4. Upload site
aws s3 sync ./dist/ s3://www.mysite.com/ \
  --cache-control "max-age=86400"

# Website URL: http://www.mysite.com.s3-website-us-east-1.amazonaws.com
```

---

## Pre-signed URLs (Temporary Access)

```python
# Generate a URL that allows anyone to download a private object for 1 hour

import boto3
from botocore.config import Config

s3 = boto3.client(
    's3',
    config=Config(signature_version='s3v4')
)

url = s3.generate_presigned_url(
    'get_object',
    Params={
        'Bucket': 'my-private-bucket',
        'Key':    'reports/confidential-2026.pdf'
    },
    ExpiresIn=3600   # 1 hour
)

print(url)
# https://my-private-bucket.s3.amazonaws.com/reports/confidential-2026.pdf?X-Amz-...
```

```python
# Pre-signed URL for uploads (client-side direct upload)
url = s3.generate_presigned_url(
    'put_object',
    Params={
        'Bucket':      'my-private-bucket',
        'Key':         'uploads/user-photo.jpg',
        'ContentType': 'image/jpeg'
    },
    ExpiresIn=300   # 5 minutes
)
# Frontend uploads directly to S3 — server never handles the file
```

---

## Terraform: Production S3 Setup

```hcl
# terraform/s3.tf

resource "aws_s3_bucket" "app_assets" {
  bucket = "company-app-assets-${var.env}"

  tags = {
    Environment = var.env
    Purpose     = "application-assets"
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "app_assets" {
  bucket = aws_s3_bucket.app_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning
resource "aws_s3_bucket_versioning" "app_assets" {
  bucket = aws_s3_bucket.app_assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Encryption with KMS
resource "aws_s3_bucket_server_side_encryption_configuration" "app_assets" {
  bucket = aws_s3_bucket.app_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true   # reduces KMS call costs by 99%
  }
}

# Lifecycle rules
resource "aws_s3_bucket_lifecycle_configuration" "app_assets" {
  bucket = aws_s3_bucket.app_assets.id

  rule {
    id     = "logs-lifecycle"
    status = "Enabled"

    filter { prefix = "logs/" }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    expiration {
      days = 365
    }
  }
}

# S3 bucket for Terraform state (separate from above)
resource "aws_s3_bucket" "terraform_state" {
  bucket = "company-terraform-state-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration { status = "Enabled" }
}

# DynamoDB for state locking
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "terraform-state-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

---

## S3 Event Notifications

```hcl
# Trigger Lambda when a file is uploaded to S3

resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.app_assets.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.process_upload.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/"
    filter_suffix       = ".jpg"
  }
}

resource "aws_lambda_permission" "s3_invoke" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.process_upload.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.app_assets.arn
}
```

---

## Interview Questions

**Q: How do you prevent S3 data from being accidentally deleted?**
> Enable versioning + MFA delete + Object Lock (WORM). Also: deny `s3:DeleteObject` in the bucket policy for non-admin roles. Lifecycle rules can handle cleanup safely.

**Q: What's the difference between S3 bucket policy and IAM policy?**
> Bucket policy (resource-based): attached to the bucket, controls who can access it — including cross-account access and public access. IAM policy (identity-based): attached to users/roles, controls what AWS services they can access. Both must allow for access to succeed.

**Q: How do you serve S3 files through CloudFront without making the bucket public?**
> Use Origin Access Control (OAC). CloudFront gets a dedicated identity, you grant that identity `s3:GetObject` via a bucket policy. The bucket stays private — only CloudFront can read it.

---

[← EC2 Compute](./03-ec2-compute.md) | [Back to Section](./README.md) | [Next: VPC →](./05-vpc-networking.md)
