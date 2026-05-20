# Case Study: Security Module for Fintech Platform

> **Industry:** Fintech — Lending & Payments
> **Environment:** Kubernetes (EKS), API Gateway, AWS WAF, Secrets Manager, OPA
> **Challenge:** Design and implement a centralized security module across 22 microservices without refactoring each service

---

## The Problem

A fintech platform with 22 microservices had security applied inconsistently:
- 6 services had no JWT validation
- 3 services logged full request bodies (PII exposure risk)
- No centralized rate limiting — scraping attacks hit raw service endpoints
- Secrets stored in environment variables inside Docker images
- No mutual TLS between internal services
- Compliance audit found 31 critical findings

---

## The Solution Architecture

```
Security layers — enforced at infrastructure level (not per-service)

Internet
    ↓
AWS WAF (L7 — SQLi, XSS, rate limit by IP)
    ↓
API Gateway (JWT validation, request throttling)
    ↓
Istio Service Mesh (mTLS between all pods)
    ↓
OPA Gatekeeper (Kubernetes admission — policy as code)
    ↓
Pods (secrets via Secrets Manager CSI driver — no env vars)
    ↓
Audit: CloudTrail + CloudWatch → SIEM
```

---

## What Was Implemented

### 1. Istio mTLS — Zero-Trust Between Services

```bash
# Enable strict mTLS across the fintech namespace
# No service can receive plaintext traffic from another service

kubectl apply -f - <<EOF
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: fintech-mtls-strict
  namespace: fintech
spec:
  mtls:
    mode: STRICT   # reject all non-mTLS traffic
EOF

# Verify: attempt plaintext call from outside mesh — must fail
kubectl run test-pod --image=curlimages/curl --rm -it \
  -- curl http://payments-service.fintech.svc:8080/health
# Expected: connection refused (mTLS enforced)
```

### 2. JWT Validation at API Gateway (Not Per-Service)

```hcl
# terraform/api-gateway-jwt.tf
# Centralized JWT authorizer — all routes require valid token
# Services never see unauthenticated requests

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.fintech.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "fintech-jwt-authorizer"

  jwt_configuration {
    audience = [var.jwt_audience]
    issuer   = var.jwt_issuer   # e.g. https://auth.fintech.internal
  }
}

# Apply to ALL routes
resource "aws_apigatewayv2_route" "default" {
  api_id             = aws_apigatewayv2_api.fintech.id
  route_key          = "$default"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.vpc_link.id}"
}
```

### 3. OPA Gatekeeper — Policy as Code

```yaml
# opa/no-secrets-in-env.yaml
# Admission policy: reject any pod that sets secret values in env vars directly

apiVersion: templates.gatekeeper.sh/v1beta1
kind: ConstraintTemplate
metadata:
  name: nosecretsenv
spec:
  crd:
    spec:
      names:
        kind: NoSecretsEnv
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package nosecretsenv

        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          env       := container.env[_]
          # Flag env vars whose names suggest secret values
          re_match("(?i)(password|secret|token|key|credential)", env.name)
          # But value is set inline (not from secretKeyRef)
          not env.valueFrom.secretKeyRef
          msg := sprintf("Container '%v' sets sensitive env var '%v' directly. Use secretKeyRef.", [container.name, env.name])
        }
---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: NoSecretsEnv
metadata:
  name: deny-inline-secrets
spec:
  match:
    namespaces: ["fintech", "production"]
```

### 4. Secrets Manager CSI Driver (Replace ENV Vars)

```yaml
# k8s/payments-service-secrets.yaml
# Secrets injected as files from AWS Secrets Manager — not environment variables

apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: payments-secrets
  namespace: fintech
spec:
  provider: aws
  parameters:
    objects: |
      - objectName: "fintech/production/payments-db"
        objectType: "secretsmanager"
        jmesPath:
          - path: "host"
            objectAlias: "DB_HOST"
          - path: "password"
            objectAlias: "DB_PASSWORD"
      - objectName: "fintech/production/stripe-key"
        objectType: "secretsmanager"
        objectAlias: "STRIPE_KEY"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-service
  namespace: fintech
spec:
  template:
    spec:
      serviceAccountName: payments-sa   # IRSA — pod identity for Secrets Manager
      volumes:
        - name: secrets
          csi:
            driver: secrets-store.csi.k8s.io
            readOnly: true
            volumeAttributes:
              secretProviderClass: payments-secrets
      containers:
        - name: payments
          image: registry/payments:v3.1.0
          volumeMounts:
            - name: secrets
              mountPath: /mnt/secrets
              readOnly: true
          # App reads /mnt/secrets/DB_PASSWORD — never an env var
```

### 5. AWS WAF Rules

```hcl
# terraform/waf.tf

resource "aws_wafv2_web_acl" "fintech" {
  name  = "fintech-waf"
  scope = "REGIONAL"

  default_action { allow {} }

  # Block SQLi
  rule {
    name     = "SQLiProtection"
    priority = 1
    action { block {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SQLiBlocked"
      sampled_requests_enabled   = true
    }
  }

  # Rate limit: 500 req/5min per IP
  rule {
    name     = "RateLimitPerIP"
    priority = 2
    action { block {} }
    statement {
      rate_based_statement {
        limit              = 500
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitBlocked"
      sampled_requests_enabled   = true
    }
  }
}
```

---

## Results

| Metric | Before | After |
|--------|--------|-------|
| Compliance findings (critical) | 31 | 0 |
| Services with JWT validation | 16/22 | 22/22 (API Gateway) |
| Secrets in environment variables | 22 services | 0 |
| Scraping/abuse requests blocked | 0% | 94% (WAF) |
| mTLS coverage | 0% | 100% (Istio) |
| Time to add new service securely | 2 weeks | 0 (inherit mesh/gateway policies) |

---

## How to Talk About This in an Interview

**Q: How would you secure a microservices architecture?**

> "The key insight is that security shouldn't be the responsibility of each individual
> service — it should be enforced at the infrastructure layer so developers can't
> accidentally bypass it.
>
> We implemented four layers: WAF at the edge for L7 attack blocking, API Gateway
> for centralized JWT validation, Istio for mTLS between every internal service,
> and OPA Gatekeeper to reject any Kubernetes deployment that tries to put secrets
> in environment variables.
>
> The result was that a new microservice inherited all security policies automatically
> on deploy — no code changes, no security review checklist. The compliance audit
> dropped from 31 critical findings to zero."

---

[← Back to Section](./README.md)
