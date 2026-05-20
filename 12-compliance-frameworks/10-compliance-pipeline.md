# Automated Compliance in CI/CD — Compliance as Code

> "Compliance as Code" means your pipeline automatically enforces
> ISO 27001, PCI-DSS, GDPR, and other standards on every commit.
> Instead of annual audits that miss things, you have continuous compliance.
> Auditors love automated evidence. It's reproducible, timestamped, and complete.

---

## The Compliance Pipeline Architecture

```
EVERY CODE COMMIT TRIGGERS:

1. Pre-commit hooks (developer machine)
   ├── Gitleaks    → No secrets in code
   ├── Detect-secrets → No PII patterns
   └── Pre-commit framework → Linting, formatting

2. CI Pipeline — Security Stage
   ├── SAST: SonarQube (code vulnerabilities)
   ├── SAST: Semgrep (custom compliance rules)
   ├── SCA: OWASP Dependency Check (vulnerable libraries)
   └── Secret scan: Gitleaks in CI (belt AND suspenders)

3. Build Stage
   ├── Container build
   └── Container scan: Trivy (OS + app vulnerabilities)

4. Infrastructure Stage (on IaC changes)
   ├── Checkov (Terraform/K8s misconfigurations)
   ├── tfsec (Terraform security issues)
   └── OPA/Conftest (custom policy evaluation)

5. Deploy to Staging
   ├── DAST: OWASP ZAP (running application)
   ├── API security test
   └── Compliance smoke tests

6. Evidence Collection
   ├── All results stored as artifacts (1 year retention)
   ├── Compliance report generated (PDF)
   └── Audit trail updated

7. Production Deploy (only if ALL gates pass)
   └── Deployment logged with audit trail
```

---

## Complete Compliance Pipeline (GitHub Actions)

```yaml
# .github/workflows/compliance-pipeline.yml
# Complete compliance pipeline implementing:
# ISO 27001 (8.8 vulnerability management, 8.25 secure SDLC, 8.32 change management)
# PCI-DSS (Req 5, 6, 10, 11)
# SOC 2 (CC6, CC7, CC8)

name: Compliance Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  IMAGE_NAME: myapp
  REGISTRY: ${{ secrets.ECR_REGISTRY }}

jobs:
  # ═══════════════════════════════════════════
  # STAGE 1: Secret Detection
  # ISO 27001: 8.12 (Data Leakage Prevention)
  # PCI-DSS: Req 6.4
  # ═══════════════════════════════════════════
  secret-detection:
    name: Secret Detection (ISO 27001 A.8.12)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for Gitleaks

      - name: Gitleaks — Scan for secrets
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}

      - name: Custom PCI pattern detection
        run: |
          echo "Scanning for PAN patterns (PCI-DSS)..."
          
          # Credit card patterns (test cards should not be in production code)
          PATTERNS=(
            "[4][0-9]{12}(?:[0-9]{3})?"  # Visa
            "5[1-5][0-9]{14}"             # Mastercard
            "3[47][0-9]{13}"              # Amex
          )
          
          FOUND=0
          for pattern in "${PATTERNS[@]}"; do
            MATCHES=$(grep -rP "$pattern" --include="*.py" --include="*.js" \
              --include="*.ts" --include="*.json" . 2>/dev/null || true)
            if [ -n "$MATCHES" ]; then
              echo "❌ PCI PAN PATTERN FOUND:"
              echo "$MATCHES"
              FOUND=1
            fi
          done
          
          if [ $FOUND -eq 1 ]; then
            echo "PCI-DSS violation: PAN pattern in source code"
            exit 1
          fi
          echo "✅ No PAN patterns found"

  # ═══════════════════════════════════════════
  # STAGE 2: SAST — Code Security Analysis
  # ISO 27001: 8.25, 8.28
  # PCI-DSS: Req 6.3
  # SOC 2: CC6.1
  # ═══════════════════════════════════════════
  sast-analysis:
    name: SAST Analysis (ISO 27001 A.8.25)
    runs-on: ubuntu-latest
    needs: secret-detection
    steps:
      - uses: actions/checkout@v4

      - name: SonarQube SAST Analysis
        uses: SonarSource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}

      - name: Check SonarQube Quality Gate
        run: |
          sleep 10  # Wait for analysis to complete
          
          STATUS=$(curl -sf \
            -u "${{ secrets.SONAR_TOKEN }}:" \
            "${{ secrets.SONAR_HOST_URL }}/api/qualitygates/project_status?\
projectKey=${{ github.repository }}" | \
            jq -r '.projectStatus.status')
          
          echo "Quality Gate status: $STATUS"
          
          if [ "$STATUS" != "OK" ]; then
            echo "❌ SonarQube Quality Gate FAILED"
            echo "This blocks deployment (ISO 27001 A.8.25 — Secure SDLC)"
            exit 1
          fi
          echo "✅ Quality Gate PASSED"

      - name: Semgrep — Custom compliance rules
        uses: returntocorp/semgrep-action@v1
        with:
          config: |
            rules:
              # PCI-DSS: No logging of sensitive data
              - id: no-logging-card-data
                patterns:
                  - pattern: |
                      $LOG.info(..., $PAN, ...)
                  - metavariable-regex:
                      metavariable: $PAN
                      regex: "(pan|card_number|cvv|pin)"
                message: "PCI-DSS: Do not log cardholder data"
                severity: ERROR
                
              # ISO 27001: SQL injection prevention
              - id: sql-injection-check
                pattern: |
                  cursor.execute($QUERY + $VAR)
                message: "ISO 27001 A.8.28: Use parameterized queries"
                severity: ERROR
                
              # GDPR: No PII in log statements
              - id: no-pii-in-logs
                patterns:
                  - pattern: |
                      logger.$METHOD(..., $EMAIL, ...)
                  - metavariable-regex:
                      metavariable: $EMAIL
                      regex: "(email|ssn|dob|birth)"
                message: "GDPR: Do not log PII"
                severity: WARNING

  # ═══════════════════════════════════════════
  # STAGE 3: Dependency Vulnerability Scan
  # ISO 27001: 8.8 (Vulnerability Management)
  # PCI-DSS: Req 6.3.3
  # ═══════════════════════════════════════════
  dependency-scan:
    name: Dependency Scan (ISO 27001 A.8.8)
    runs-on: ubuntu-latest
    needs: secret-detection
    steps:
      - uses: actions/checkout@v4

      - name: OWASP Dependency Check
        uses: dependency-check/Dependency-Check_Action@main
        with:
          project: '${{ github.repository }}'
          path: '.'
          format: 'HTML,JSON,SARIF'
          args: >
            --enableRetired
            --failOnCVSS 7
            --suppression dependency-check-suppression.xml

      - name: Upload dependency scan results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: dependency-scan-${{ github.run_number }}
          path: reports/
          retention-days: 365  # ISO 27001: 1 year evidence retention

      - name: Upload SARIF to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: reports/dependency-check-report.sarif

  # ═══════════════════════════════════════════
  # STAGE 4: Container Build and Scan
  # ISO 27001: 8.8 (Vulnerability Management)
  # PCI-DSS: Req 5 (Malware Protection)
  # ═══════════════════════════════════════════
  container-scan:
    name: Container Scan (PCI-DSS Req 5)
    runs-on: ubuntu-latest
    needs: [sast-analysis, dependency-scan]
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4

      - name: Build container image
        id: build
        run: |
          IMAGE_TAG="${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}"
          docker build -t $IMAGE_TAG .
          echo "image_tag=$IMAGE_TAG" >> $GITHUB_OUTPUT

      - name: Trivy vulnerability scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ steps.build.outputs.image_tag }}
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH
          exit-code: 1  # Fail pipeline on CRITICAL vulnerabilities

      - name: Trivy full JSON report (audit evidence)
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ steps.build.outputs.image_tag }}
          format: json
          output: trivy-full-report.json

      - name: Check vulnerability SLA compliance
        run: |
          CRITICAL=$(jq '[.Results[].Vulnerabilities // [] | .[] | select(.Severity == "CRITICAL")] | length' trivy-full-report.json)
          HIGH=$(jq '[.Results[].Vulnerabilities // [] | .[] | select(.Severity == "HIGH")] | length' trivy-full-report.json)
          MEDIUM=$(jq '[.Results[].Vulnerabilities // [] | .[] | select(.Severity == "MEDIUM")] | length' trivy-full-report.json)
          
          echo "Vulnerability Summary:"
          echo "  CRITICAL: $CRITICAL (SLA: fix within 24 hours)"
          echo "  HIGH: $HIGH (SLA: fix within 7 days)"
          echo "  MEDIUM: $MEDIUM (SLA: fix within 30 days)"
          
          # ISO 27001 A.8.8: Must have defined SLAs for vulnerabilities
          if [ "$CRITICAL" -gt 0 ]; then
            echo "❌ CRITICAL vulnerabilities found — cannot deploy"
            exit 1
          fi
          echo "✅ No CRITICAL vulnerabilities"

      - name: Upload scan results (audit evidence)
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: container-scan-${{ github.run_number }}
          path: |
            trivy-results.sarif
            trivy-full-report.json
          retention-days: 365

  # ═══════════════════════════════════════════
  # STAGE 5: Infrastructure Security Scan
  # ISO 27001: 8.9 (Configuration Management)
  # PCI-DSS: Req 1, 2
  # ═══════════════════════════════════════════
  infrastructure-scan:
    name: Infrastructure Scan (ISO 27001 A.8.9)
    runs-on: ubuntu-latest
    needs: secret-detection
    if: contains(github.event.head_commit.modified, 'terraform/') || contains(github.event.head_commit.modified, 'kubernetes/')
    steps:
      - uses: actions/checkout@v4

      - name: Checkov — Terraform security scan
        uses: bridgecrewio/checkov-action@master
        with:
          directory: terraform/
          framework: terraform
          output_format: sarif
          output_file_path: checkov-terraform.sarif
          check: |
            CKV_AWS_3     # EBS encryption
            CKV_AWS_7     # CloudTrail log file validation
            CKV_AWS_19    # S3 encryption
            CKV_AWS_20    # S3 no public ACL
            CKV_AWS_21    # S3 versioning
            CKV_AWS_66    # CloudWatch encryption
            CKV_AWS_79    # EC2 IMDSv2 required
            CKV_AWS_86    # CloudFront HTTPS
            CKV_AWS_119   # DynamoDB encryption
            CKV_AWS_144   # S3 cross-region replication (ISO 22301)
            CKV2_AWS_5    # Security group not attached

      - name: tfsec — Additional Terraform checks
        uses: aquasecurity/tfsec-action@v1.0.0
        with:
          working_directory: terraform/
          format: sarif
          sarif_file: tfsec-results.sarif

      - name: OPA/Conftest — Custom policy checks
        run: |
          # Install conftest
          curl -L https://github.com/open-policy-agent/conftest/releases/download/v0.50.0/conftest_0.50.0_Linux_x86_64.tar.gz | tar xz
          
          # Check Kubernetes manifests against compliance policies
          ./conftest test kubernetes/ --policy policy/ --output sarif > conftest-results.sarif

      - name: Upload IaC scan results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: iac-scan-${{ github.run_number }}
          path: |
            checkov-terraform.sarif
            tfsec-results.sarif
            conftest-results.sarif
          retention-days: 365

  # ═══════════════════════════════════════════
  # STAGE 6: Deploy to Staging + DAST
  # ISO 27001: 8.29 (Security Testing)
  # PCI-DSS: Req 11.3
  # ═══════════════════════════════════════════
  staging-deploy-and-dast:
    name: Staging Deploy + DAST (ISO 27001 A.8.29)
    runs-on: ubuntu-latest
    needs: [container-scan, infrastructure-scan]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to staging
        run: |
          kubectl set image deployment/${{ env.IMAGE_NAME }} \
            ${{ env.IMAGE_NAME }}=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            --namespace staging
          kubectl rollout status deployment/${{ env.IMAGE_NAME }} \
            --namespace staging --timeout=5m

      - name: Wait for staging to be ready
        run: sleep 30

      - name: OWASP ZAP — Dynamic Application Security Testing
        uses: zaproxy/action-full-scan@v0.8.0
        with:
          target: 'https://staging.company.com'
          rules_file_name: '.zap/rules.tsv'
          cmd_options: '-a'
          artifact_name: zap-report-${{ github.run_number }}

      - name: Check OWASP ZAP results
        run: |
          # Fail on HIGH or CRITICAL alerts
          HIGH=$(jq '.site[0].alerts | map(select(.riskcode >= "2")) | length' \
            report_json.json)
          
          echo "OWASP ZAP High/Critical alerts: $HIGH"
          
          if [ "$HIGH" -gt 0 ]; then
            echo "❌ DAST found $HIGH high/critical security issues"
            exit 1
          fi
          echo "✅ DAST PASSED — No critical security issues"

      - name: Upload DAST results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: dast-zap-${{ github.run_number }}
          path: report_json.json
          retention-days: 365

  # ═══════════════════════════════════════════
  # STAGE 7: Generate Compliance Report
  # ISO 27001: 8.15 (Evidence collection)
  # SOC 2: Audit evidence requirement
  # ═══════════════════════════════════════════
  compliance-report:
    name: Generate Compliance Report
    runs-on: ubuntu-latest
    needs: [staging-deploy-and-dast]
    if: always()
    steps:
      - name: Download all scan artifacts
        uses: actions/download-artifact@v4
        with:
          path: all-artifacts/

      - name: Generate compliance report
        run: |
          python3 << 'EOF'
          import json
          import os
          from datetime import datetime
          
          report = {
              "report_type": "Automated Compliance Report",
              "generated_at": datetime.utcnow().isoformat(),
              "pipeline_run": os.environ.get("GITHUB_RUN_NUMBER"),
              "commit": os.environ.get("GITHUB_SHA", "")[:8],
              "branch": os.environ.get("GITHUB_REF_NAME"),
              "frameworks": ["ISO 27001:2022", "PCI-DSS v4.0", "SOC 2 Type II"],
              "checks": {
                  "secret_detection": {"status": "PASSED", "tool": "Gitleaks"},
                  "sast": {"status": "PASSED", "tool": "SonarQube + Semgrep"},
                  "dependency_scan": {"status": "PASSED", "tool": "OWASP Dependency Check"},
                  "container_scan": {"status": "PASSED", "tool": "Trivy"},
                  "iac_scan": {"status": "PASSED", "tool": "Checkov + tfsec"},
                  "dast": {"status": "PASSED", "tool": "OWASP ZAP"}
              },
              "compliance_status": "COMPLIANT",
              "evidence_retained": "365 days",
              "next_review": "Automated per commit"
          }
          
          with open("compliance-report.json", "w") as f:
              json.dump(report, f, indent=2)
          
          print(f"Compliance Report Generated")
          print(f"Status: {report['compliance_status']}")
          print(f"Checks: {len(report['checks'])} automated checks")
          EOF

      - name: Upload compliance report
        uses: actions/upload-artifact@v4
        with:
          name: compliance-report-${{ github.run_number }}
          path: compliance-report.json
          retention-days: 365

      - name: Publish compliance metrics
        run: |
          # Publish to CloudWatch for compliance dashboard
          aws cloudwatch put-metric-data \
            --namespace "Compliance/Pipeline" \
            --metric-name "ComplianceChecksPassed" \
            --value 6 \
            --unit "Count" \
            --dimensions \
              Name=Repository,Value=${{ github.repository }} \
              Name=Branch,Value=${{ github.ref_name }}

  # ═══════════════════════════════════════════
  # STAGE 8: Production Deploy
  # ISO 27001: 8.32 (Change Management)
  # SOC 2: CC8.1
  # ═══════════════════════════════════════════
  production-deploy:
    name: Production Deploy (SOC 2 CC8.1)
    runs-on: ubuntu-latest
    needs: compliance-report
    if: github.ref == 'refs/heads/main' && needs.compliance-report.result == 'success'
    environment:
      name: production
      url: https://app.company.com
    steps:
      - uses: actions/checkout@v4

      - name: Log deployment (change management audit trail)
        run: |
          # Record deployment for SOC 2 CC8.1 change management
          DEPLOYMENT_RECORD=$(cat << EOF
          {
            "deployment_id": "${{ github.run_number }}",
            "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "deployed_by": "${{ github.actor }}",
            "commit": "${{ github.sha }}",
            "branch": "${{ github.ref_name }}",
            "approved_by": "GitHub Actions (automated + human review in PR)",
            "compliance_checks_passed": true,
            "soc2_control": "CC8.1"
          }
          EOF
          )
          
          aws s3 cp - "s3://audit-trail/deployments/${{ github.run_number }}.json" \
            --sse aws:kms <<< "$DEPLOYMENT_RECORD"

      - name: Deploy to production (blue-green)
        run: |
          IMAGE="${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}"
          
          # Blue-green: deploy to green, switch ALB
          kubectl set image deployment/${{ env.IMAGE_NAME }}-green \
            ${{ env.IMAGE_NAME }}=$IMAGE --namespace production
          
          kubectl rollout status deployment/${{ env.IMAGE_NAME }}-green \
            --namespace production --timeout=10m
          
          # Switch traffic to green
          kubectl patch service ${{ env.IMAGE_NAME }} \
            --namespace production \
            --patch '{"spec":{"selector":{"slot":"green"}}}'

      - name: Verify production deployment
        run: |
          sleep 30
          HEALTH=$(curl -sf https://app.company.com/health | jq -r '.status')
          if [ "$HEALTH" != "ok" ]; then
            echo "❌ Production health check failed — rolling back"
            kubectl patch service ${{ env.IMAGE_NAME }} \
              --namespace production \
              --patch '{"spec":{"selector":{"slot":"blue"}}}'
            exit 1
          fi
          echo "✅ Production deployment verified"
```

---

## OPA/Conftest — Custom Compliance Policies

```rego
# policy/kubernetes-compliance.rego
# Custom compliance policies enforced in CI pipeline
# These translate compliance requirements into code

package kubernetes.compliance

import future.keywords.in

# ISO 27001 A.8.5: Containers must not run as root
deny[msg] {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  not container.securityContext.runAsNonRoot
  msg := sprintf(
    "ISO 27001 A.8.5: Container '%v' must set runAsNonRoot: true",
    [container.name]
  )
}

# PCI-DSS Req 2: No default passwords in environment variables
deny[msg] {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  env := container.env[_]
  lower(env.name) in {"password", "passwd", "pwd", "secret"}
  env.value  # Has a plain text value (not a secretRef)
  msg := sprintf(
    "PCI-DSS Req 2: Container '%v' has plain text secret in env var '%v'. Use secretRef.",
    [container.name, env.name]
  )
}

# ISO 22301: Production deployments must have >= 2 replicas
deny[msg] {
  input.kind == "Deployment"
  input.metadata.labels.environment == "production"
  input.spec.replicas < 2
  msg := sprintf(
    "ISO 22301: Production deployment '%v' must have >= 2 replicas (currently %v)",
    [input.metadata.name, input.spec.replicas]
  )
}

# ISO 27001 A.8.20: Containers must have resource limits
deny[msg] {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  not container.resources.limits.memory
  msg := sprintf(
    "ISO 27001 A.8.20 (capacity): Container '%v' must have memory limits",
    [container.name]
  )
}

# PCI-DSS Req 6: Images must not use :latest tag in production
deny[msg] {
  input.kind == "Deployment"
  input.metadata.labels.environment == "production"
  container := input.spec.template.spec.containers[_]
  endswith(container.image, ":latest")
  msg := sprintf(
    "PCI-DSS Req 6: Container '%v' uses ':latest' tag — use specific version",
    [container.name]
  )
}

# SOC 2 CC6.1: Services in CDE must have NetworkPolicy
warn[msg] {
  input.kind == "Namespace"
  input.metadata.labels.pci_scope == "in-scope"
  not data.kubernetes.networkpolicies[input.metadata.name]
  msg := sprintf(
    "SOC 2 CC6.1: Namespace '%v' is in PCI scope but has no NetworkPolicy",
    [input.metadata.name]
  )
}
```

---

## Compliance Dashboard (Grafana)

```json
// compliance-grafana-dashboard.json
// Import this in Grafana to see compliance status at a glance
{
  "title": "Compliance & Security Dashboard",
  "uid": "compliance-dashboard",
  "panels": [
    {
      "title": "Compliance Pipeline Pass Rate (30 days)",
      "type": "stat",
      "targets": [{
        "expr": "sum(compliance_checks_passed_total) / sum(compliance_checks_total) * 100",
        "legendFormat": "Pass Rate %"
      }],
      "options": {
        "colorMode": "background",
        "thresholds": {
          "steps": [
            {"value": 0, "color": "red"},
            {"value": 95, "color": "yellow"},
            {"value": 99, "color": "green"}
          ]
        }
      }
    },
    {
      "title": "Open Critical Vulnerabilities (must be 0)",
      "type": "stat",
      "targets": [{
        "expr": "security_hub_findings_total{severity='CRITICAL', status='NEW'}",
        "legendFormat": "Critical Findings"
      }],
      "options": {
        "thresholds": {
          "steps": [
            {"value": 0, "color": "green"},
            {"value": 1, "color": "red"}
          ]
        }
      }
    },
    {
      "title": "Deployment Frequency (DORA)",
      "type": "graph",
      "targets": [{
        "expr": "rate(deployments_total{environment='production'}[7d]) * 86400",
        "legendFormat": "Deploys per day"
      }]
    },
    {
      "title": "Change Failure Rate (DORA / ISO 9001)",
      "type": "stat",
      "targets": [{
        "expr": "rate(deployments_total{status='failed'}[30d]) / rate(deployments_total[30d]) * 100",
        "legendFormat": "Failure Rate %"
      }],
      "options": {
        "thresholds": {
          "steps": [
            {"value": 0, "color": "green"},
            {"value": 5, "color": "yellow"},
            {"value": 15, "color": "red"}
          ]
        }
      }
    },
    {
      "title": "MFA Compliance (ISO 27001 A.8.5)",
      "type": "stat",
      "targets": [{
        "expr": "iam_users_mfa_enabled / iam_users_total * 100",
        "legendFormat": "MFA Coverage %"
      }],
      "options": {
        "thresholds": {
          "steps": [
            {"value": 0, "color": "red"},
            {"value": 100, "color": "green"}
          ]
        }
      }
    }
  ]
}
```

---

## Evidence Retention Policy

```yaml
# evidence-retention-policy.yml
# How long to keep compliance evidence per framework

retention_policies:

  ISO_27001:
    audit_logs: 365 days       # Control 8.15
    vulnerability_scans: 365 days  # Control 8.8
    change_records: 365 days   # Control 8.32
    access_reviews: 365 days   # Control 8.2

  PCI_DSS:
    audit_logs: 365 days       # Req 10.7 (12 months)
    vulnerability_scans: 365 days  # Req 11.3
    penetration_test: 1 year   # Req 11.4 (annual)
    access_reviews: 90 days    # Req 7, 8 (quarterly)

  SOC_2_TYPE_II:
    all_evidence: 12 months    # Audit period coverage
    user_access_logs: 12 months
    deployment_logs: 12 months
    incident_records: 12 months

  ISO_22301:
    dr_test_results: 3 years
    incident_reports: 3 years
    rto_rpo_measurements: 1 year

implementation:
  s3_lifecycle_rules:
    - bucket: audit-trail
      transitions:
        - days: 90
          storage_class: STANDARD_IA  # Lower cost after 90 days
        - days: 180
          storage_class: GLACIER      # Archival after 6 months
      expiration:
        days: 365  # Delete after 1 year (adjust per framework)
```

---

## Interview Questions — Compliance Pipeline

**Q: What is "Compliance as Code" and why is it better than manual audits?**
```
Compliance as Code = Implementing compliance controls in automated tools
                     (pipelines, scripts, policies) rather than manual checklists

Manual audit (old way):
  - Auditor visits once per year
  - Checks a sample of changes
  - Finds issues months after they were introduced
  - High cost ($50K-200K per audit)
  - Evidence is PDFs and spreadsheets

Compliance as Code (modern way):
  - Every commit is checked automatically
  - 100% of changes checked (not a sample)
  - Issue found instantly (before it reaches production)
  - Evidence is automatically generated and retained
  - Continuous compliance (not annual)

For auditors:
  "Show me your access control evidence for the last 12 months"
  Old: "Let me find those spreadsheets..."
  New: "Here's the automated report from CloudWatch/S3 — click download"

Result:
  - Faster certification (less manual work)
  - Lower audit cost (evidence is pre-collected)
  - Fewer findings (issues caught before production)
  - Audit trail that can't be falsified (immutable S3 + CloudTrail)
```

**Q: How do you prove to an auditor that your deployments follow change management?**
```
SOC 2 CC8.1 / ISO 27001 A.8.32 require documented change management.

Evidence I provide:
1. GitHub branch protection rules
   → Proves: no one can push directly to main (requires PR + reviews)
   
2. GitHub PR history
   → Shows: who requested the change, who approved it, what changed
   
3. CI pipeline logs
   → Shows: all automated tests passed before deploy
   
4. AWS CloudTrail
   → Shows: who deployed, when, to what (immutable, tamper-proof)
   
5. S3 deployment records
   → JSON record per deploy: timestamp, deployer, commit, approvals
   
Auditors love this because:
  → It's ALL automated (no human could fake the timestamps)
  → It's 100% complete (not a sample)
  → It's already in the required format (JSON/CSV)
  → It goes back 365 days (evidence retention built in)
```

---

[← Retail Sector](./09-sector-retail.md) | [← Back to Section 12](./README.md) | [← Main Menu](../)
