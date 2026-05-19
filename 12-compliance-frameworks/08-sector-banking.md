# Banking Sector — BCBS 239, Basel III, SWIFT CSP, Open Banking

> Banks are the most regulated industry in the world.
> Multiple regulators (central bank, financial regulator, tax authority) 
> all have requirements for your DevOps pipeline.
> This section maps banking regulations to concrete DevOps implementations.

---

## Banking Regulatory Landscape

```
GLOBAL BANKING REGULATORS AND STANDARDS:

BCBS (Basel Committee on Banking Supervision)
  → Basel III: capital requirements, liquidity rules
  → BCBS 239: risk data aggregation and risk reporting

SWIFT (Society for Worldwide Interbank Financial Telecommunication)
  → SWIFT CSP (Customer Security Programme): protect SWIFT infrastructure

OPEN BANKING / PSD2 (Payment Services Directive 2)
  → API access to bank accounts for third-party apps
  → Strong Customer Authentication (SCA)

LOCAL REGULATORS (vary by country):
  EU:  EBA (European Banking Authority) + ECB (European Central Bank)
  UK:  PRA (Prudential Regulation Authority) + FCA (Financial Conduct Authority)
  US:  OCC (Office of the Comptroller of the Currency) + Federal Reserve
  DE:  BaFin (Federal Financial Supervisory Authority)

ALSO APPLIES:
  → ISO 27001 (information security)
  → PCI-DSS (payment cards)
  → GDPR (personal data)
  → SOX (financial reporting, if listed company)
```

---

## BCBS 239 — Risk Data Aggregation

```
BCBS 239 principle: Banks must be able to aggregate risk data
                    accurately and quickly — especially in a crisis.

"If the CFO asks 'what is our total exposure to Bank X?'
 the answer must be available within HOURS, not DAYS."

BCBS 239 Requirements:
  - Data governance (who owns what data)
  - Data architecture (single source of truth)
  - Data quality (no wrong data in risk reports)
  - Reporting (timely, accurate, complete)

DevOps impact:
  → Data pipelines must be auditable (git history)
  → Data transformations must be documented and tested
  → Reporting infrastructure must be HA (cannot fail during crisis)
  → Data lineage: know WHERE each number came from
```

### Data Lineage Pipeline (BCBS 239 Compliance)

```python
# bcbs239_data_pipeline.py
# Risk data must be traceable from source to report
# BCBS 239: "data lineage" — know where every number came from

from datetime import datetime
import hashlib
import json

class BCBS239DataPipeline:
    """
    Risk data aggregation pipeline with full audit trail.
    Every data transformation is logged with source, transformation, and result.
    This satisfies BCBS 239 Principle 3: Accuracy and Integrity.
    """
    
    def __init__(self, pipeline_name: str, run_id: str):
        self.pipeline_name = pipeline_name
        self.run_id = run_id
        self.lineage = []
    
    def extract(self, source_system: str, query: str, data: list) -> list:
        """Extract data with lineage tracking."""
        
        data_hash = hashlib.sha256(json.dumps(data, default=str).encode()).hexdigest()
        
        self.lineage.append({
            "step": "EXTRACT",
            "timestamp": datetime.utcnow().isoformat(),
            "source_system": source_system,
            "query": query,
            "record_count": len(data),
            "data_hash": data_hash,  # Proves data wasn't tampered
            "run_id": self.run_id
        })
        
        return data
    
    def transform(self, operation: str, input_data: list, output_data: list, 
                  transformation_logic: str) -> list:
        """Transform data with lineage tracking."""
        
        self.lineage.append({
            "step": "TRANSFORM",
            "timestamp": datetime.utcnow().isoformat(),
            "operation": operation,
            "transformation_logic": transformation_logic,
            "input_records": len(input_data),
            "output_records": len(output_data),
            "input_hash": hashlib.sha256(json.dumps(input_data, default=str).encode()).hexdigest(),
            "output_hash": hashlib.sha256(json.dumps(output_data, default=str).encode()).hexdigest(),
        })
        
        return output_data
    
    def load(self, target_system: str, data: list) -> dict:
        """Load data with lineage tracking."""
        
        self.lineage.append({
            "step": "LOAD",
            "timestamp": datetime.utcnow().isoformat(),
            "target_system": target_system,
            "record_count": len(data),
            "data_hash": hashlib.sha256(json.dumps(data, default=str).encode()).hexdigest()
        })
        
        # Store lineage in audit trail
        self._store_lineage()
        
        return {
            "records_loaded": len(data),
            "lineage_id": self.run_id,
            "lineage_records": len(self.lineage)
        }
    
    def _store_lineage(self):
        """Store complete lineage in immutable audit store."""
        import boto3
        s3 = boto3.client('s3')
        
        lineage_document = {
            "pipeline": self.pipeline_name,
            "run_id": self.run_id,
            "bcbs239_compliance": True,
            "principle": "3-Accuracy-and-Integrity",
            "steps": self.lineage
        }
        
        s3.put_object(
            Bucket="bcbs239-audit-trail",
            Key=f"lineage/{self.pipeline_name}/{self.run_id}.json",
            Body=json.dumps(lineage_document, indent=2),
            ServerSideEncryption="aws:kms"
        )


# Example: Aggregate counterparty credit exposure (BCBS 239 use case)
def aggregate_counterparty_exposure(bank_entity_id: str) -> dict:
    """
    Aggregate ALL exposure to a single counterparty across ALL books.
    BCBS 239 Principle 6: Completeness
    Must include ALL legal entities, ALL asset classes, ALL geographies.
    """
    
    pipeline = BCBS239DataPipeline(
        pipeline_name="counterparty-exposure-aggregation",
        run_id=f"RUN-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
    )
    
    # Extract from all source systems
    trading_book = pipeline.extract(
        source_system="trading-system-core",
        query=f"SELECT * FROM positions WHERE counterparty_id = '{bank_entity_id}'",
        data=[]  # actual data from DB
    )
    
    banking_book = pipeline.extract(
        source_system="core-banking-loans",
        query=f"SELECT * FROM loans WHERE borrower_id = '{bank_entity_id}'",
        data=[]
    )
    
    derivatives = pipeline.extract(
        source_system="derivatives-platform",
        query=f"SELECT * FROM otc_trades WHERE counterparty = '{bank_entity_id}'",
        data=[]
    )
    
    # Transform: aggregate to single exposure number
    all_positions = trading_book + banking_book + derivatives
    
    aggregated = pipeline.transform(
        operation="SUM_BY_CURRENCY",
        input_data=all_positions,
        output_data=[],  # actual aggregated result
        transformation_logic="SUM(mark_to_market) GROUP BY currency, risk_type"
    )
    
    # Load to risk reporting system
    result = pipeline.load(
        target_system="risk-reporting-data-mart",
        data=aggregated
    )
    
    return result
```

---

## SWIFT Customer Security Programme (CSP)

```
SWIFT CSP = Security requirements for banks using the SWIFT network
            (SWIFT = the messaging system for international money transfers)

SWIFT CSP has mandatory controls (MUST) and advisory controls (SHOULD)

Key mandatory controls relevant to DevOps:
  1.1  SWIFT Environment Protection     → Isolate SWIFT systems in secure zone
  1.2  Privileged Account Control       → Restrict SWIFT admin access
  2.1  Internal Data Flow Security      → Encrypt SWIFT message flows
  2.2  Security Updates                 → Patch SWIFT systems within 3 months
  2.5  Internet Access Policies         → No direct internet from SWIFT zone
  5.1  Logical Access Control           → MFA for SWIFT operator accounts
  6.1  Operator Transaction Records     → Log all SWIFT operations
  6.2  Software Integrity               → Verify SWIFT software integrity
```

### SWIFT Infrastructure in Kubernetes

```yaml
# kubernetes/swift-zone.yml
# SWIFT systems must be in a dedicated, isolated zone
# No direct internet access. Access only via controlled network path.

# Dedicated namespace for SWIFT systems
apiVersion: v1
kind: Namespace
metadata:
  name: swift-zone
  labels:
    security-zone: "swift"
    swift-csp: "mandatory"
    environment: production

---
# Network Policy: SWIFT zone can ONLY communicate with approved systems
# SWIFT CSP Control 1.1: Environment Protection
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: swift-zone-isolation
  namespace: swift-zone
spec:
  podSelector: {}  # Apply to ALL pods in swift-zone namespace
  policyTypes:
    - Ingress
    - Egress
  
  ingress:
    # Only allow traffic from SWIFT gateway service
    - from:
        - namespaceSelector:
            matchLabels:
              app: swift-gateway
      ports:
        - port: 9000  # SWIFT MQ port
  
  egress:
    # Only allow SWIFT network (SWIFT BIC addresses)
    - to:
        - ipBlock:
            cidr: "10.0.50.0/24"  # Internal SWIFT gateway network
      ports:
        - port: 9000
    
    # Allow DNS only
    - ports:
        - port: 53
          protocol: UDP
    
    # NO internet access from SWIFT zone (SWIFT CSP 2.5)

---
# Pod Security — SWIFT operator workstation
# SWIFT CSP Control 1.2: Privileged Account Control
apiVersion: v1
kind: Pod
metadata:
  name: swift-operator-workstation
  namespace: swift-zone
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10000
    seccompProfile:
      type: RuntimeDefault
  
  containers:
    - name: swift-client
      image: registry.company.com/swift-client:6.0.1
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      
      env:
        # SWIFT credentials from Secrets Manager (not hardcoded)
        - name: SWIFT_OPERATOR_CERT
          valueFrom:
            secretKeyRef:
              name: swift-operator-cert
              key: certificate
```

---

## Basel III — Operational Risk and Capital Requirements

```
Basel III operational risk requirements for DevOps:

1. OPERATIONAL RESILIENCE
   → Systems must be resilient to failure
   → DevOps: HA architecture, DR, runbooks

2. CONCENTRATION RISK
   → Don't depend on a single vendor
   → DevOps: Multi-cloud strategy (or at least multi-region)
   → Don't put all eggs in one cloud (AWS Single Region = concentration risk)

3. INCIDENT REPORTING
   → Operational losses must be reported to regulators
   → DevOps: Incident tracking, financial impact assessment

4. OUTSOURCING RISK
   → Cloud = outsourcing. Regulators care.
   → Need exit strategy from cloud provider
   → Need to understand cloud provider's own resilience
```

```bash
#!/bin/bash
# operational-resilience-report.sh
# Basel III: demonstrate operational resilience

echo "=== Operational Resilience Report ==="
echo "Basel III — Operational Risk Reporting"
echo "Date: $(date)"
echo ""

# 1. Single points of failure check
echo "--- Single Points of Failure Analysis ---"

# Check: Any database without Multi-AZ?
echo "Databases without Multi-AZ (concentration risk):"
aws rds describe-db-instances \
  --query 'DBInstances[?MultiAZ==`false`].[DBInstanceIdentifier,DBInstanceClass]' \
  --output table

# Check: Any service with only 1 pod?
echo ""
echo "Kubernetes deployments with <2 replicas (SPOF):"
kubectl get deployments --all-namespaces \
  -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,REPLICAS:.spec.replicas' | \
  awk '$3 < 2 {print "⚠️  SPOF RISK: " $1 "/" $2 " has " $3 " replica(s)"}'

# 2. Recovery time check
echo ""
echo "--- Recovery Time Metrics (last 90 days) ---"
# From PagerDuty/incident system
echo "MTTR: 45 minutes (Basel III threshold: < 4 hours)"
echo "Incidents > 4 hours: 0"

# 3. Concentration risk — cloud dependency
echo ""
echo "--- Cloud Concentration Risk ---"
echo "Cloud provider: AWS"
echo "Regions active: us-east-1 (primary), us-west-2 (DR)"
echo "DR tested: Yes (last test: $(date -d '-30 days' +%Y-%m-%d))"
echo "Exit plan: Terraform modules portable to GCP/Azure"
```

---

## Open Banking / PSD2 — API Security

```
PSD2 (EU) / Open Banking (UK) = Banks must open APIs
so licensed third-party providers (TPPs) can:
  - Read account data (AIS: Account Information Services)
  - Initiate payments (PIS: Payment Initiation Services)

Security requirements:
  - Strong Customer Authentication (SCA): 2FA for payments
  - eIDAS certificates for TPP identification
  - TLS 1.2+ for all API communication
  - Rate limiting and monitoring for API abuse
```

```yaml
# kong-psd2-api.yml
# PSD2/Open Banking API Gateway configuration (Kong)

# API Gateway with PSD2 security controls
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: psd2-rate-limit
plugin: rate-limiting
config:
  # PSD2: Prevent API abuse
  minute: 100
  hour: 1000
  day: 10000
  limit_by: consumer
  policy: redis

---
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: psd2-jwt-verify
plugin: jwt
config:
  # PSD2: eIDAS certificate-based authentication for TPPs
  secret_is_base64: false
  claims_to_verify:
    - exp    # Token not expired
    - iss    # Issuer is registered TPP
  
---
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata:
  name: psd2-audit-log
plugin: file-log
config:
  path: /tmp/psd2-audit.log
  # Log all API access for PSD2 audit trail

---
# PSD2 Account Information endpoint
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: psd2-api
  annotations:
    konghq.com/plugins: "psd2-jwt-verify,psd2-rate-limit,psd2-audit-log"
    konghq.com/protocols: "https"  # TLS only (PSD2 requirement)
spec:
  ingressClassName: kong
  tls:
    - hosts:
        - api.bank.com
      secretName: bank-tls-cert
  rules:
    - host: api.bank.com
      http:
        paths:
          - path: /v1/accounts
            pathType: Prefix
            backend:
              service:
                name: account-information-service
                port:
                  number: 8080
          - path: /v1/payments
            pathType: Prefix
            backend:
              service:
                name: payment-initiation-service
                port:
                  number: 8080
```

---

## Banking DevOps Architecture Summary

```
REGULATORY LAYER
  ├── BCBS 239    → Data lineage, risk data quality, audit trails
  ├── Basel III   → HA, multi-region, no SPOF, operational resilience
  ├── SWIFT CSP   → Isolated SWIFT zone, MFA, integrity checks
  ├── PSD2        → API security, SCA, TPP authentication
  ├── ISO 27001   → Information security controls (see section 01)
  ├── PCI-DSS     → Card data protection (see section 06)
  ├── GDPR        → Customer data privacy (see section 07)
  └── BIAN        → Service domain model for APIs (see section 05)

INFRASTRUCTURE LAYER (implements regulations)
  ├── Core Banking Zone      → On-premise (data sovereignty)
  ├── SWIFT Zone             → Isolated K8s namespace, no internet
  ├── Digital Banking Zone   → AWS (customer-facing, scalable)
  ├── PCI Zone               → Isolated VPC for card processing
  └── Data Platform          → BCBS 239 pipelines, risk reporting

DEVOPS PIPELINE
  ├── Security gates at every stage (ISO 27001, PCI-DSS)
  ├── Change management process (CAB approval, Basel III)
  ├── Audit logs for all deployments (regulatory requirement)
  ├── DR testing quarterly (ISO 22301, Basel III)
  └── Vulnerability management (ISO 27001, PCI-DSS)
```

---

## Interview Questions — Banking Sector

**Q: What is the biggest challenge of DevOps in banking?**
```
Speed vs. Compliance tension:
  DevOps wants: deploy multiple times per day
  Banking regulators want: change approval boards, test periods

Solution: Automate compliance so speed doesn't sacrifice control

1. Automated compliance checks in pipeline (Checkov, Trivy)
   → Human approval only for business-level decisions
   → Technical compliance is automatic and instant

2. Risk-based deployment gates
   → Low-risk (config change): auto-approve after tests pass
   → High-risk (database migration): CAB approval required
   → Emergency (production incident): fast-track with post-hoc review

3. Immutable infrastructure
   → Rollback is instant (just deploy previous image)
   → No "can't deploy because we might break something"
   
Result: Deploy frequently but with a full audit trail, 
        automated security checks, and the ability to rollback instantly
```

**Q: How do you handle the SWIFT network in a Kubernetes environment?**
```
SWIFT is extremely sensitive — requires physical and logical isolation.

My approach:
1. Dedicated namespace: swift-zone (no other workloads)
2. NetworkPolicy: deny all, allow only specific paths
   - SWIFT client → Internal SWIFT gateway only
   - No direct internet access from SWIFT zone (SWIFT CSP 2.5)
3. Pod security: non-root, read-only filesystem, no privilege escalation
4. Secrets: SWIFT operator certificates in Kubernetes Secrets (from AWS Secrets Manager)
5. Monitoring: every SWIFT message logged, alerts on anomalies
6. MFA: SWIFT operator login requires hardware token (SWIFT CSP 5.1)
7. Software integrity: SWIFT software checksums verified before deployment
```

---

[← GDPR/CCPA](./07-gdpr-ccpa.md) | [Next: Retail Sector →](./09-sector-retail.md)
