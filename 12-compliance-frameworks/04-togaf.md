# TOGAF — The Open Group Architecture Framework

> TOGAF is the language enterprise architects speak.
> When you join a large bank, insurance company, or government agency,
> TOGAF is how they design and govern their IT systems.
> As a DevOps engineer, you work WITHIN the architecture that TOGAF defines.

---

## What Is TOGAF?

```
TOGAF = Framework for designing and managing enterprise IT architecture

It answers: "How does the whole company's technology fit together?"

TOGAF has four architecture domains (BDAT):
  B = Business Architecture   → HOW the business works (processes, org)
  D = Data Architecture       → WHAT data exists and where
  A = Application Architecture → WHICH systems exist and how they connect
  T = Technology Architecture  → HOW the infrastructure supports everything
                                 ← THIS IS WHERE DEVOPS LIVES
```

---

## The ADM — Architecture Development Method

```
TOGAF's ADM is a cycle of phases:

          ┌─────────────────────────────────┐
          │         Preliminary             │
          │   (Set up the framework)        │
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    A — Architecture Vision      │
          │    (What are we trying to do?)  │
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    B — Business Architecture    │
          │    (Business processes/goals)   │
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    C — Information Systems      │
          │    (Data + Applications)        │
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    D — Technology Architecture  │  ← DEVOPS TERRITORY
          │    (Infrastructure, Cloud, K8s) │
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    E — Opportunities/Solutions  │
          │    (What to build/buy/migrate)  │
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    F — Migration Planning       │
          │    (Roadmap to implement)       │
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    G — Implementation           │
          │    (Build + Deploy + Monitor)   │  ← DEVOPS EXECUTES HERE
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    H — Architecture Change      │
          │    (Monitor + update the arch)  │
          └──────────────┬──────────────────┘
                         ↓
          ┌─────────────────────────────────┐
          │    Requirements Management      │
          │    (Center of the cycle)        │
          └─────────────────────────────────┘
```

---

## Phase D — Technology Architecture (DevOps Deliverables)

```
Phase D produces:
  1. Technology Architecture Document
     → Shows all infrastructure components and how they connect
  
  2. Technology Baseline (AS-IS)
     → What exists today
  
  3. Technology Target (TO-BE)  
     → What we want to build
  
  4. Gap Analysis
     → What's missing (what DevOps must build)
  
  5. Technology Architecture Principles
     → Rules that all teams must follow
```

### Example: Technology Architecture Principles

```yaml
# technology-architecture-principles.yml
# These principles come from TOGAF Phase D
# DevOps teams must follow these when designing infrastructure

principles:
  
  TP-001:
    name: "Everything as Code"
    statement: |
      All infrastructure, configuration, and deployment processes
      MUST be defined as code and stored in version control.
    rationale: |
      Manual configurations create drift, cannot be audited,
      and cannot be reproduced consistently.
    implications:
      - Terraform for all cloud resources
      - Ansible for all server configuration
      - Helm charts for all Kubernetes deployments
      - No manual clicks in AWS console for production
    iso27001_control: "A.8.9 Configuration Management"

  TP-002:
    name: "Defence in Depth"
    statement: |
      Multiple layers of security controls MUST exist.
      No single control can be the only protection.
    rationale: |
      When one control fails, others prevent breach.
    implications:
      - WAF → ALB → Security Group → K8s NetworkPolicy → Pod Security
      - Secrets in AWS Secrets Manager, never in environment variables
      - Encryption in transit AND at rest
    iso27001_control: "A.8.20 Network Security"

  TP-003:
    name: "Zero Trust Networking"
    statement: |
      No implicit trust based on network location.
      All access MUST be authenticated and authorized explicitly.
    rationale: |
      Perimeter-based security fails when attackers are inside.
    implications:
      - Service mesh (Istio/Linkerd) for mTLS between services
      - IRSA (not EC2 instance profiles) for AWS access
      - RBAC on all Kubernetes resources
      - No "allow all" security groups
    
  TP-004:
    name: "Immutable Infrastructure"
    statement: |
      Running systems are never modified in place.
      Changes are made by replacing the system.
    rationale: |
      Immutable systems are predictable, reproducible, and auditable.
    implications:
      - No SSH into running containers or pods
      - Container images tagged by git SHA (never :latest in production)
      - Server changes via new AMI (not apt upgrade on running server)
      - Kubernetes rolling deployments (never kubectl exec + modify)
    
  TP-005:
    name: "High Availability by Default"
    statement: |
      All production services MUST be able to tolerate failure
      of any single component.
    implications:
      - Minimum 2 replicas for all deployments (preferably 3)
      - Multi-AZ for all databases
      - PodDisruptionBudget on all deployments
      - ALB health checks on all services
```

---

## Architecture Repository — TOGAF Documentation in Git

```
# TOGAF Architecture Repository structure
# Stored in Git — architecture as code

enterprise-architecture/
├── README.md                      # Architecture overview
│
├── principles/                    # Architecture Principles
│   ├── technology-principles.yml  # TP-001, TP-002... (above)
│   ├── data-principles.yml
│   └── application-principles.yml
│
├── baseline/                      # AS-IS architecture
│   ├── technology-baseline.md     # Current state
│   ├── network-diagrams/          # Current network diagrams
│   └── inventory/                 # Current systems inventory
│
├── target/                        # TO-BE architecture
│   ├── technology-target.md       # Future state
│   ├── target-diagrams/           # Target architecture diagrams
│   └── migration-roadmap.md       # How to get from AS-IS to TO-BE
│
├── adrs/                          # Architecture Decision Records
│   ├── 001-use-kubernetes.md      # Why we chose Kubernetes
│   ├── 002-use-terraform.md       # Why Terraform over CloudFormation
│   ├── 003-multi-az-databases.md  # Why Multi-AZ for databases
│   └── template.md                # ADR template
│
├── standards/                     # Technology Standards
│   ├── approved-technologies.md   # What technologies are approved
│   ├── container-standards.md     # Container image standards
│   └── api-standards.md           # API design standards
│
└── compliance/                    # Compliance Mapping
    ├── iso27001-mapping.md        # Controls to technical controls
    ├── pci-dss-mapping.md
    └── gdpr-mapping.md
```

### Architecture Decision Record (ADR) Template

```markdown
# ADR-003: Multi-AZ Databases for All Production Workloads

Date: 2024-01-15
Status: Accepted
Authors: Platform Architecture Team

## Context
Single-AZ databases create a single point of failure.
AWS reports that AZ failures occur ~2-3 times per year per region.
Banking regulations require 99.9% uptime for core services.

## Decision
All production databases MUST be deployed Multi-AZ.

## Options Considered
| Option | Cost/month | RTO | RPO | Decision |
|--------|-----------|-----|-----|---------|
| Single-AZ RDS | $200 | Hours | Hours | Rejected |
| Multi-AZ RDS | $400 | 1-2 min | ~1 min | Accepted |
| Aurora Multi-AZ | $600 | <30 sec | <5 sec | For critical only |

## Consequences
- Cost increase: ~$200/month per database
- Zero manual intervention on AZ failure
- Satisfies ISO 22301 RTO requirements
- Satisfies banking regulatory uptime requirements

## Implementation
Terraform module: `modules/rds-multi-az`
Required for: all environments labeled `production=true`

## Review Date
2025-01-15 (annual review)
```

---

## TOGAF + DevOps: Phase G — Implementation Governance

```
Phase G = Architecture governance during implementation
DevOps engineers are the implementors — they must follow architecture guidelines

Architecture Compliance Review (ACR):
  BEFORE a new service goes to production:
  1. Does it follow TP-001? (Is infrastructure as code?)
  2. Does it follow TP-002? (Does it have multiple security layers?)
  3. Does it follow TP-003? (Does it use zero-trust networking?)
  4. Does it follow TP-004? (Is it using immutable images?)
  5. Does it follow TP-005? (Does it have 2+ replicas, Multi-AZ?)
```

```yaml
# Architecture compliance checklist (add to PR template)
# Used in TOGAF Phase G — Implementation Governance

## Architecture Compliance Review

### Technology Principles Compliance

- [ ] TP-001 Everything as Code
  - [ ] Terraform/Helm used (no manual console changes)
  - [ ] Configuration in Git
  
- [ ] TP-002 Defence in Depth
  - [ ] WAF rules reviewed
  - [ ] Security Groups least privilege
  - [ ] Secrets in AWS Secrets Manager
  - [ ] Encryption at rest and in transit
  
- [ ] TP-003 Zero Trust
  - [ ] mTLS between services (if service mesh in use)
  - [ ] IRSA/OIDC for AWS access (no hard-coded credentials)
  - [ ] RBAC configured
  
- [ ] TP-004 Immutable Infrastructure
  - [ ] Docker image tagged with git SHA
  - [ ] No :latest tag in production
  - [ ] No SSH access to running containers
  
- [ ] TP-005 High Availability
  - [ ] replicas >= 2
  - [ ] PodDisruptionBudget configured
  - [ ] Database is Multi-AZ
  - [ ] ALB health check configured

**Architecture Review Result:**
- [ ] APPROVED — all principles satisfied
- [ ] APPROVED WITH CONDITIONS — conditions: ___
- [ ] REJECTED — fails: ___

Reviewed by: [Architecture Team]
Date: ___
```

---

## TOGAF Architecture Views

```
TOGAF uses "views" — different perspectives of the same architecture

For a bank's payment system:

BUSINESS VIEW (for business stakeholders):
  "Customer initiates payment → Bank validates → Settles with central bank"
  (No technical details — just business process)

APPLICATION VIEW (for application architects):
  "Payment API → Fraud Detection → Core Banking → SWIFT Gateway"
  (Which applications, which integrations)

DATA VIEW (for data architects):
  "Transaction data → PostgreSQL → DW → Reporting"
  (What data, where it lives, how it flows)

TECHNOLOGY VIEW (for DevOps — YOUR view):
  EKS Cluster → ALB → Payment Service (3 pods)
              → Fraud Service (2 pods) → SageMaker
              → Core Banking API (on-premise via VPN)
              → SWIFT Gateway (on-premise, DMZ)
  RDS Aurora Multi-AZ → Primary (us-east-1a), Replica (us-east-1b)
  Redis ElastiCache (session cache)
  CloudFront → S3 (static frontend)
```

---

## Interview Questions — TOGAF

**Q: What is TOGAF and why does it matter for DevOps?**
```
TOGAF is an enterprise architecture framework that defines HOW an 
organization designs and manages its IT systems.

For DevOps:
- Phase D (Technology Architecture) is our domain
- Architecture principles are the rules we must follow
- ADRs (Architecture Decision Records) document WHY we chose K8s, Terraform, etc.
- Phase G means architects review our implementations for compliance

In a TOGAF enterprise:
  Architects DESIGN the target architecture
  DevOps BUILDS and OPERATES what architects design
  We are the bridge between design and reality
```

**Q: What is an ADR and why is it useful?**
```
ADR = Architecture Decision Record
A short document that captures:
  - WHAT decision was made
  - WHY it was made (context, constraints)
  - WHAT alternatives were considered
  - WHAT the consequences are

Example: "ADR-003: We use Terraform instead of AWS CloudFormation"

Why useful:
  - Future team members understand WHY (not just WHAT)
  - Prevents re-litigating past decisions without new information
  - Creates an audit trail for architecture governance
  - Required by TOGAF for Architecture Repository maintenance
```

---

[← ISO 9001](./03-iso9001.md) | [Next: BIAN →](./05-bian.md)
