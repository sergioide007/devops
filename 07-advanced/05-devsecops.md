# DevSecOps — Security in Every Step

> DevSecOps means security is everyone's responsibility, not just a final audit.
> Security checks run automatically in the CI/CD pipeline.
> You catch issues when they are cheap to fix, not after deployment.

---

## Shift Left — Move Security Earlier

```
Traditional:     Code → Test → Build → Security Audit → Deploy
                                                  ↑
                                         LATE! Expensive to fix here.

DevSecOps:       Code → SAST → Test → SCA → Build → DAST → Deploy
                       ↑             ↑             ↑
                   In IDE      In CI Pipeline   Pre-production
```

---

## Security Tools in the Pipeline

| Tool | Type | What It Finds |
|------|------|--------------|
| **Snyk** | SAST + SCA | Code vulns, dependency CVEs |
| **SonarQube** | SAST | Code quality + security hotspots |
| **Trivy** | Container scan | OS and app CVEs in Docker images |
| **OWASP Dependency Check** | SCA | Known CVEs in libraries |
| **Checkov** | IaC scan | Terraform, K8s misconfigurations |
| **Gitleaks** | Secret detection | Hardcoded secrets in Git |
| **AWS GuardDuty** | Runtime | Threats in AWS environment |

---

## Container Security — Trivy

```bash
# Scan Docker image
trivy image nginx:latest
trivy image --severity HIGH,CRITICAL nginx:latest
trivy image --exit-code 1 --severity CRITICAL my-api:latest

# Scan Kubernetes manifests
trivy config ./kubernetes/

# Scan Terraform files
trivy config ./terraform/

# Scan filesystem
trivy fs ./src/

# In CI pipeline (GitHub Actions)
- name: Scan image with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: my-api:${{ github.sha }}
    severity: CRITICAL,HIGH
    exit-code: 1
    ignore-unfixed: true
    format: sarif
    output: trivy-results.sarif

# Upload to GitHub Security tab
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy-results.sarif
```

---

## Infrastructure Security — Checkov

```bash
# Install
pip install checkov

# Scan Terraform
checkov -d terraform/

# Scan Kubernetes YAML
checkov -d kubernetes/ --framework kubernetes

# Scan Dockerfile
checkov -f Dockerfile --framework dockerfile

# Example findings:
# CKV_K8S_30: "Do not admit containers that wish to share the host process ID namespace"
# CKV_TF_AWS_18: "Ensure that S3 Bucket has access logging enabled"
# CKV_DOCKER_2: "Ensure that HEALTHCHECK instructions have been added to container images"

# In CI — fail if critical findings
checkov -d terraform/ \
    --check CKV_AWS_18,CKV_AWS_20 \
    --compact \
    --output cli \
    --output junitxml \
    --output-file results/checkov.xml
```

---

## Secret Detection — Gitleaks

```bash
# Install
wget https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_linux_x64.tar.gz
tar xvf gitleaks_linux_x64.tar.gz
sudo mv gitleaks /usr/local/bin/

# Scan current repo
gitleaks detect --source .

# Scan git history
gitleaks detect --source . --log-opts "HEAD~100..HEAD"

# Pre-commit hook (prevent accidental commits)
cat .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks

# GitHub Action
- name: Detect secrets with Gitleaks
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## OWASP Top 10 — What to Test

```bash
# OWASP Top 10 vulnerabilities every DevOps engineer should prevent:

# 1. Injection (SQL, Command injection)
# Never concatenate user input into commands or queries

# 2. Broken Authentication
# Use JWT with short expiry, MFA, secure session management

# 3. Sensitive Data Exposure
# Encrypt everything at rest and in transit
# Never log passwords, PINs, card numbers

# 4. XML External Entities (XXE)
# Disable DTD processing in XML parsers

# 5. Broken Access Control
# Test with Burp Suite, verify role-based access

# 6. Security Misconfiguration
# Run checkov on Terraform, disable default credentials

# 7. Cross-Site Scripting (XSS)
# CSP headers, input validation, output encoding

# 8. Insecure Deserialization
# Never deserialize untrusted data without validation

# 9. Using Components with Known Vulnerabilities
# Scan with Trivy, update dependencies regularly (Dependabot)

# 10. Insufficient Logging & Monitoring
# Log all authentication events, suspicious activity

# Test your API with OWASP ZAP
docker run -t owasp/zap2docker-stable zap-api-scan.py \
    -t https://staging.myapp.com/api/v1/openapi.json \
    -f openapi \
    -r zap-report.html
```

---

## Network Security Hardening

```bash
# Linux server hardening
# 1. Disable root SSH login
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# 2. Enable fail2ban (block IPs after failed logins)
sudo apt install fail2ban
sudo systemctl enable fail2ban

# 3. Automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure unattended-upgrades

# 4. Audit open ports regularly
ss -tlnp
nmap -sV localhost

# 5. CIS Benchmark compliance
# Install OpenSCAP and run CIS benchmark
sudo apt install openscap-scanner scap-security-guide
oscap oval eval --results scan-results.xml \
    /usr/share/xml/scap/ssg/content/ssg-ubuntu2204-oval.xml
```

---

## AWS Security Hardening

```bash
# GuardDuty — threat detection
aws guardduty create-detector --enable --finding-publishing-frequency FIFTEEN_MINUTES

# AWS Security Hub — aggregates findings
aws securityhub enable-security-hub \
    --enable-default-standards   # enables CIS AWS, PCI DSS, FSBP

# Config Rules — check compliance
aws configservice put-config-rule --config-rule '{
    "ConfigRuleName": "s3-bucket-server-side-encryption-enabled",
    "Source": {
        "Owner": "AWS",
        "SourceIdentifier": "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED"
    }
}'

# Access Analyzer — find overly permissive policies
aws accessanalyzer create-analyzer \
    --analyzer-name production-analyzer \
    --type ACCOUNT

# Inspector — vulnerability assessment for EC2 and Lambda
aws inspector2 enable --resource-types EC2 LAMBDA

# Review findings
aws inspector2 list-findings \
    --filter-criteria '{"severity":[{"comparison":"EQUALS","value":"CRITICAL"}]}' \
    --sort-criteria '{"field":"SEVERITY","sortOrder":"DESC"}'
```

---

## Compliance as Code — PCI-DSS Example

```hcl
# terraform/compliance.tf — enforce security standards

# S3 bucket must have versioning (PCI requirement)
resource "aws_s3_bucket_versioning" "all_buckets" {
  for_each = aws_s3_bucket.all
  bucket   = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

# All EBS volumes must be encrypted (PCI requirement)
resource "aws_ebs_encryption_by_default" "main" {
  enabled = true
}

# CloudTrail must be enabled (PCI requirement)
resource "aws_cloudtrail" "main" {
  name                          = "compliance-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    data_resource {
      type   = "AWS::S3::Object"
      values = ["arn:aws:s3:::*/*"]
    }
  }
}
```

---

## Interview Questions — DevSecOps

**Q: How do you integrate security into a CI/CD pipeline without slowing it down?**
> "I run security checks in parallel with other pipeline stages. SAST (SonarQube) runs
> at the same time as unit tests. Container scanning (Trivy) runs at the same time as
> integration tests. I set different severity thresholds: CRITICAL issues fail the build,
> HIGH issues create a ticket but don't fail, LOW issues are logged. This way, a new
> critical CVE in a base image stops the deployment automatically, but a low-severity
> finding doesn't block the team."

**Q: How do you handle a security finding in production?**
> "First, assess the risk: is it actually exploitable in our environment? Many CVEs are
> theoretical. If it's high risk, I patch immediately. If it's a base image CVE, I update
> the base image and redeploy. If it's a dependency CVE, I update the package and run
> full regression tests. I track all findings in our security backlog with severity and
> due dates — critical: 24 hours, high: 7 days, medium: 30 days."

---

[← Back to Section](./README.md)
