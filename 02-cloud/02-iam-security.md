# IAM — Identity and Access Management

> IAM is the most important security service in AWS.
> Everything in AWS goes through IAM.
> In PCI-DSS environments (banking, fintech), IAM is critical.

---

## Core IAM Concepts

```
Users    → real people (one user per human)
Groups   → collection of users (Developers, DevOps, ReadOnly)
Roles    → identity for services and applications
Policies → JSON documents that define permissions
```

**Rule:** Never give more permissions than needed. This is **Least Privilege**.

---

## IAM Users and Groups

```bash
# Create a user
aws iam create-user --user-name john-devops

# Create access keys for CLI access
aws iam create-access-key --user-name john-devops

# Create a group
aws iam create-group --group-name DevOpsEngineers

# Add user to group
aws iam add-user-to-group \
    --user-name john-devops \
    --group-name DevOpsEngineers

# List users
aws iam list-users

# List groups
aws iam list-groups

# Delete access key (rotate credentials)
aws iam delete-access-key \
    --user-name john-devops \
    --access-key-id AKIAIOSFODNN7EXAMPLE
```

---

## IAM Policies

Policies define what actions are allowed or denied.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3ReadOnly",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-app-bucket",
        "arn:aws:s3:::my-app-bucket/*"
      ]
    },
    {
      "Sid": "DenyDeleteS3",
      "Effect": "Deny",
      "Action": "s3:DeleteObject",
      "Resource": "arn:aws:s3:::my-app-bucket/*"
    }
  ]
}
```

**Policy types:**
- **AWS Managed**: pre-built by Amazon (e.g., `AmazonS3ReadOnlyAccess`)
- **Customer Managed**: you create and control
- **Inline**: attached directly to a user/group/role (avoid these)

```bash
# Create a policy
aws iam create-policy \
    --policy-name DevOpsS3Policy \
    --policy-document file://s3-policy.json

# Attach policy to a group
aws iam attach-group-policy \
    --group-name DevOpsEngineers \
    --policy-arn arn:aws:iam::123456789012:policy/DevOpsS3Policy

# Attach AWS managed policy
aws iam attach-group-policy \
    --group-name DevOpsEngineers \
    --policy-arn arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess

# List policies attached to a group
aws iam list-attached-group-policies --group-name DevOpsEngineers

# Test what a user can do (policy simulator)
aws iam simulate-principal-policy \
    --policy-source-arn arn:aws:iam::123456789012:user/john-devops \
    --action-names s3:DeleteObject \
    --resource-arns arn:aws:s3:::my-bucket/file.txt
```

---

## IAM Roles — The Most Important Concept

Roles are for services and apps, not humans.

**Example use cases:**
- EC2 instance reads from S3 → attach a role to EC2
- Lambda writes to DynamoDB → attach a role to Lambda
- GitHub Actions deploys to EKS → use a role with OIDC

```bash
# Create a role for EC2 to access S3
# Step 1: Create trust policy (who can assume this role)
cat ec2-trust-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}

# Step 2: Create the role
aws iam create-role \
    --role-name EC2-S3-ReadRole \
    --assume-role-policy-document file://ec2-trust-policy.json

# Step 3: Attach permissions
aws iam attach-role-policy \
    --role-name EC2-S3-ReadRole \
    --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess

# Step 4: Create instance profile and attach role
aws iam create-instance-profile \
    --instance-profile-name EC2-S3-ReadProfile

aws iam add-role-to-instance-profile \
    --instance-profile-name EC2-S3-ReadProfile \
    --role-name EC2-S3-ReadRole

# Step 5: Attach to EC2 instance
aws ec2 associate-iam-instance-profile \
    --instance-id i-1234567890abcdef0 \
    --iam-instance-profile Name=EC2-S3-ReadProfile
```

---

## Role for Lambda

```python
# Lambda uses its execution role automatically
# No need to pass credentials in code!

import boto3

def lambda_handler(event, context):
    # boto3 automatically uses the Lambda execution role
    s3 = boto3.client('s3')
    response = s3.get_object(Bucket='my-bucket', Key='config.json')
    return response['Body'].read().decode('utf-8')
```

```bash
# Create Lambda execution role
aws iam create-role \
    --role-name LambdaExecutionRole \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "lambda.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }'

aws iam attach-role-policy \
    --role-name LambdaExecutionRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy \
    --role-name LambdaExecutionRole \
    --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
```

---

## GitHub Actions OIDC — No Long-Lived Credentials

```yaml
# .github/workflows/deploy.yml
permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          aws-region: us-east-1

      # Now all AWS commands use the assumed role
      - name: Deploy to EKS
        run: |
          aws eks update-kubeconfig --name my-cluster
          kubectl apply -f deployment.yaml
```

```bash
# Create the OIDC provider in AWS
aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1"

# Create role with trust policy for GitHub
cat github-trust-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:my-org/my-repo:*"
        }
      }
    }
  ]
}
```

---

## KMS — Key Management Service

Used for encrypting data. Critical in PCI-DSS environments.

```bash
# Create a KMS key
aws kms create-key \
    --description "Encryption key for payment data" \
    --key-usage ENCRYPT_DECRYPT

# Create an alias (human-readable name)
aws kms create-alias \
    --alias-name alias/payment-encryption \
    --target-key-id 1234abcd-12ab-34cd-56ef-1234567890ab

# Encrypt data
aws kms encrypt \
    --key-id alias/payment-encryption \
    --plaintext fileb://secret.txt \
    --output text \
    --query CiphertextBlob | base64 --decode > secret.encrypted

# Decrypt data
aws kms decrypt \
    --ciphertext-blob fileb://secret.encrypted \
    --output text \
    --query Plaintext | base64 --decode

# Encrypt S3 bucket with KMS (in Terraform)
resource "aws_s3_bucket_server_side_encryption_configuration" "example" {
  bucket = aws_s3_bucket.payments.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.payment_key.arn
      sse_algorithm     = "aws:kms"
    }
  }
}
```

---

## Secrets Manager — Never Hardcode Passwords

```bash
# Store a secret
aws secretsmanager create-secret \
    --name prod/myapp/database \
    --description "Production database credentials" \
    --secret-string '{
        "host": "postgres.internal",
        "port": 5432,
        "username": "app_user",
        "password": "myStrongPassword123!"
    }'

# Get a secret
aws secretsmanager get-secret-value \
    --secret-id prod/myapp/database \
    --query SecretString \
    --output text | jq .

# Rotate a secret (automatic rotation)
aws secretsmanager rotate-secret \
    --secret-id prod/myapp/database \
    --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789:function:rotate-db-secret
```

```python
# Access secrets in Python (Lambda, ECS, EC2)
import boto3
import json

def get_secret(secret_name):
    client = boto3.client('secretsmanager', region_name='us-east-1')
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response['SecretString'])

# Use in your app
db_creds = get_secret('prod/myapp/database')
connection = connect_db(
    host=db_creds['host'],
    user=db_creds['username'],
    password=db_creds['password']
)
```

---

## IAM Best Practices

```
1. Never use root account for daily work
   → Create an IAM admin user instead

2. Enable MFA on root and all human users
   → aws iam enable-mfa-device

3. Rotate access keys regularly (every 90 days)
   → aws iam list-access-keys --user-name ...

4. Use roles for EC2, Lambda, ECS (never hardcode keys)
   → Instance profiles, execution roles

5. Use AWS Organizations with Service Control Policies
   → Prevent certain actions at org level

6. Enable CloudTrail (audit log of all API calls)
   → Who did what, when, from where

7. Use Permission Boundaries for delegated admins
   → Limit what delegated admins can grant

8. Delete unused users, keys, and roles
   → Regular IAM access review
```

```bash
# Enable CloudTrail
aws cloudtrail create-trail \
    --name my-org-trail \
    --s3-bucket-name my-cloudtrail-logs \
    --is-multi-region-trail

aws cloudtrail start-logging --name my-org-trail

# Find who deleted an S3 bucket
aws cloudtrail lookup-events \
    --lookup-attributes AttributeKey=EventName,AttributeValue=DeleteBucket \
    --start-time 2026-05-01T00:00:00Z
```

---

## Interview Questions — IAM

**Q: How do you give an EC2 instance access to S3 without using access keys?**
> "I create an IAM Role with the necessary S3 permissions and attach it to the EC2
> instance as an Instance Profile. The instance gets temporary credentials automatically
> via the instance metadata service (IMDS). No hardcoded keys, no credential rotation
> needed. The SDK automatically picks up these credentials."

**Q: What is the difference between a Role and a Policy?**
> "A Policy is a document that defines permissions — it says what actions are allowed
> or denied on which resources. A Role is an identity that can be assumed by a service
> or application. You attach policies to roles. The role is who can act; the policy
> defines what they can do."

**Q: How do you enforce PCI-DSS compliance with IAM?**
> "Least privilege — every service only gets the minimum permissions needed. Use KMS
> for all data encryption. Enable CloudTrail for audit logging. Rotate all credentials
> every 90 days or use Secrets Manager with automatic rotation. Use separate AWS accounts
> for production (cardholder data environment) and non-production. Enable GuardDuty for
> threat detection. No direct access to production — all changes go through CI/CD."

---

[← Back to Section](./README.md) | [Next: VPC & Networking →](./05-vpc-networking.md)
