# BIAN — Banking Industry Architecture Network

> BIAN is the standard for how banks design their services and APIs.
> If you work in banking or fintech, BIAN tells you WHAT services exist
> and HOW they should communicate.
> DevOps engineers use BIAN to design microservices that match the bank's architecture.

---

## What Is BIAN?

```
BIAN = A reference model for banking services and their interfaces

Created by: Major banks (Deutsche Bank, Standard Chartered, etc.)
            + Technology companies (IBM, SAP, Finastra)

Purpose: Standardize banking terminology and service design
         so that different systems can talk to each other

Key concept: SERVICE DOMAINS
  BIAN defines ~350 standard banking service domains
  Each domain = one area of banking functionality
  Each domain has standard API operations
```

---

## BIAN Service Domains — Core Banking

```
BIAN divides banking into functional areas:

CUSTOMER MANAGEMENT
  ├── Customer Relationship Management
  ├── Customer Agreement
  ├── Customer Profile
  └── Customer Case Management

PRODUCT AND SERVICE MANAGEMENT
  ├── Current Account
  ├── Savings Account
  ├── Credit Card
  ├── Loan Administration
  └── Mortgage Administration

PAYMENTS
  ├── Payment Order (SEPA, SWIFT, etc.)
  ├── Payment Execution
  ├── Direct Debit
  ├── Payment Initiation
  └── Correspondent Bank Relationship

FRAUD AND RISK
  ├── Fraud Detection
  ├── Fraud Resolution
  ├── Credit Risk Management
  └── Compliance Controls

OPERATIONS
  ├── Financial Accounting
  ├── Regulatory Reporting
  ├── Audit Trail
  └── Business Development
```

---

## BIAN Service Domain Operations

```
Each BIAN service domain has standard operations:

INITIATE   → Start a new instance (create a new payment)
UPDATE     → Modify an existing instance
EXECUTE    → Process/perform an action
REQUEST    → Request information or an action
RETRIEVE   → Get information about an instance
CONTROL    → Change the state (suspend, terminate)
EXCHANGE   → Two-way communication
NOTIFY     → Event notification
EVALUATE   → Assessment/analysis
GRANT      → Provide permission

Example — Payment Order service domain:
  POST   /payment-orders                → INITIATE (create payment)
  PUT    /payment-orders/{id}           → UPDATE (modify payment)
  POST   /payment-orders/{id}/execute   → EXECUTE (send the payment)
  GET    /payment-orders/{id}           → RETRIEVE (get payment details)
  PUT    /payment-orders/{id}/control   → CONTROL (suspend/cancel)
```

---

## BIAN API Design in Kubernetes (Microservices)

```yaml
# kubernetes/bian-payment-services.yml
# Banking microservices following BIAN service domain model

# Each service = one BIAN service domain
# Services are loosely coupled (communicate via API/events)

---
# 1. Payment Order Service (BIAN: Payment Order SD)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-order-service
  namespace: banking-core
  labels:
    bian.domain: "payment-order"
    bian.version: "v12"
    team: payments
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-order-service
  template:
    metadata:
      labels:
        app: payment-order-service
        bian.domain: "payment-order"
    spec:
      containers:
        - name: payment-order
          image: registry.company.com/payment-order:v2.1.0
          ports:
            - containerPort: 8080
          env:
            - name: BIAN_SERVICE_DOMAIN
              value: "payment-order"
            - name: BIAN_VERSION
              value: "v12"

---
# 2. Payment Execution Service (BIAN: Payment Execution SD)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-execution-service
  namespace: banking-core
  labels:
    bian.domain: "payment-execution"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-execution-service
  template:
    metadata:
      labels:
        app: payment-execution-service
    spec:
      containers:
        - name: payment-execution
          image: registry.company.com/payment-execution:v1.5.0
          ports:
            - containerPort: 8080

---
# 3. Fraud Detection Service (BIAN: Fraud Detection SD)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fraud-detection-service
  namespace: banking-core
  labels:
    bian.domain: "fraud-detection"
spec:
  replicas: 5  # More replicas — high volume, latency-sensitive
  selector:
    matchLabels:
      app: fraud-detection-service
  template:
    spec:
      containers:
        - name: fraud-detection
          image: registry.company.com/fraud-detection:v3.0.0
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2000m"  # More CPU for ML model inference
```

---

## BIAN-Compliant API Design

```python
# bian_payment_order_api.py
# RESTful API following BIAN service domain conventions

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid

app = FastAPI(
    title="Payment Order Service",
    description="BIAN Service Domain: Payment Order",
    version="12.0.0"
)


# BIAN Data Models
class PaymentOrderInitiation(BaseModel):
    """BIAN: Payment Order - Initiate Request"""
    payment_transaction_type: str = Field(
        ..., 
        description="SEPA_CREDIT | SWIFT | DOMESTIC",
        example="SEPA_CREDIT"
    )
    payment_amount: float = Field(..., gt=0)
    payment_currency: str = Field(..., min_length=3, max_length=3, example="EUR")
    payer_account_number: str
    payee_account_number: str
    payee_name: str
    payment_purpose_code: str = Field(default="OTHR")
    scheduled_date: Optional[datetime] = None


class PaymentOrderRecord(BaseModel):
    """BIAN: Payment Order - Full Record"""
    payment_order_reference: str
    payment_transaction_type: str
    payment_amount: float
    payment_currency: str
    payer_account_number: str
    payee_account_number: str
    payee_name: str
    payment_status: str  # PENDING | EXECUTING | COMPLETED | FAILED | CANCELLED
    creation_timestamp: datetime
    execution_timestamp: Optional[datetime] = None


# BIAN Operations
@app.post("/payment-orders", status_code=201)
async def initiate_payment_order(
    request: PaymentOrderInitiation
) -> PaymentOrderRecord:
    """
    BIAN Operation: INITIATE
    Creates a new Payment Order instance.
    """
    payment_ref = f"PAY-{uuid.uuid4().hex[:12].upper()}"
    
    # Store in database
    # ... database logic here
    
    return PaymentOrderRecord(
        payment_order_reference=payment_ref,
        payment_transaction_type=request.payment_transaction_type,
        payment_amount=request.payment_amount,
        payment_currency=request.payment_currency,
        payer_account_number=request.payer_account_number,
        payee_account_number=request.payee_account_number,
        payee_name=request.payee_name,
        payment_status="PENDING",
        creation_timestamp=datetime.utcnow()
    )


@app.get("/payment-orders/{payment_order_reference}")
async def retrieve_payment_order(
    payment_order_reference: str
) -> PaymentOrderRecord:
    """
    BIAN Operation: RETRIEVE
    Get details of a specific Payment Order.
    """
    # Fetch from database
    order = await get_payment_from_db(payment_order_reference)
    if not order:
        raise HTTPException(status_code=404, detail="Payment Order not found")
    return order


@app.post("/payment-orders/{payment_order_reference}/execute")
async def execute_payment_order(
    payment_order_reference: str
) -> dict:
    """
    BIAN Operation: EXECUTE
    Process the payment (call payment execution service).
    """
    order = await get_payment_from_db(payment_order_reference)
    if not order:
        raise HTTPException(status_code=404, detail="Payment Order not found")
    
    if order.payment_status != "PENDING":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot execute payment in status: {order.payment_status}"
        )
    
    # Call BIAN Payment Execution service
    execution_result = await payment_execution_client.execute(
        payment_order_reference=payment_order_reference,
        payment_type=order.payment_transaction_type,
        amount=order.payment_amount,
        currency=order.payment_currency
    )
    
    return {
        "payment_order_reference": payment_order_reference,
        "execution_status": execution_result.status,
        "execution_reference": execution_result.reference,
        "timestamp": datetime.utcnow().isoformat()
    }


@app.put("/payment-orders/{payment_order_reference}/control")
async def control_payment_order(
    payment_order_reference: str,
    control_action: str  # "SUSPEND" | "CANCEL" | "RESUME"
) -> dict:
    """
    BIAN Operation: CONTROL
    Change the state of a Payment Order.
    """
    valid_actions = ["SUSPEND", "CANCEL", "RESUME"]
    if control_action not in valid_actions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid control action. Must be one of: {valid_actions}"
        )
    
    # Apply state change
    # ...
    
    return {
        "payment_order_reference": payment_order_reference,
        "control_action": control_action,
        "result": "APPLIED",
        "timestamp": datetime.utcnow().isoformat()
    }
```

---

## BIAN Event-Driven Communication (Kafka)

```python
# bian_event_publisher.py
# BIAN recommends event-driven communication between service domains
# When a payment is executed, publish event so other domains can react

from kafka import KafkaProducer
import json
from datetime import datetime

class BIANEventPublisher:
    """
    Publishes BIAN-compliant events to Kafka topics.
    Topic naming convention: bian.{service-domain}.{operation}
    """
    
    def __init__(self, kafka_brokers: list):
        self.producer = KafkaProducer(
            bootstrap_servers=kafka_brokers,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None
        )
    
    def publish_payment_order_executed(
        self,
        payment_order_reference: str,
        amount: float,
        currency: str,
        payer_account: str,
        payee_account: str
    ):
        """
        BIAN Event: PaymentOrderExecuted
        Topic: bian.payment-order.executed
        
        Consumers:
          - Financial Accounting (update account balances)
          - Customer Notifications (notify payer/payee)
          - Compliance Monitoring (AML checks)
          - Audit Trail (log the transaction)
        """
        event = {
            "event_id": f"EVT-{uuid.uuid4().hex}",
            "event_type": "PaymentOrderExecuted",
            "bian_service_domain": "PaymentOrder",
            "bian_operation": "Execute",
            "timestamp": datetime.utcnow().isoformat(),
            "payload": {
                "payment_order_reference": payment_order_reference,
                "amount": amount,
                "currency": currency,
                "payer_account": payer_account,
                "payee_account": payee_account
            }
        }
        
        self.producer.send(
            topic="bian.payment-order.executed",
            key=payment_order_reference,
            value=event
        )
        self.producer.flush()
```

```yaml
# Kafka topics for BIAN events
# topics.yml

topics:
  # Payment Order events
  - name: bian.payment-order.initiated
    partitions: 12
    replication_factor: 3
    
  - name: bian.payment-order.executed
    partitions: 12
    replication_factor: 3
    retention_ms: 2592000000  # 30 days
    
  - name: bian.payment-order.failed
    partitions: 12
    replication_factor: 3

  # Fraud Detection events
  - name: bian.fraud-detection.alert
    partitions: 6
    replication_factor: 3
    retention_ms: 7776000000  # 90 days (compliance)
    
  # Customer events
  - name: bian.customer-profile.updated
    partitions: 6
    replication_factor: 3

  # Account events  
  - name: bian.current-account.balance-updated
    partitions: 24  # High volume — more partitions
    replication_factor: 3
```

---

## BIAN Service Domain Map for a Modern Bank

```
                    ┌─────────────────────────────────────────┐
                    │           DIGITAL CHANNELS              │
                    │   Mobile App │ Web Portal │ ATM │ API   │
                    └──────────────────┬──────────────────────┘
                                       │ API Gateway
                    ┌──────────────────▼──────────────────────┐
                    │            API LAYER                    │
                    │  Authentication │ Authorization │ Rate  │
                    └──────────────────┬──────────────────────┘
                                       │
        ┌──────────────────────────────▼───────────────────────────┐
        │                   CORE BANKING SERVICES                  │
        │                                                          │
        │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │
        │  │   Customer    │  │   Payment     │  │   Account   │ │
        │  │ Relationship  │  │    Order      │  │  Management │ │
        │  │  Management   │  │    Service    │  │   Service   │ │
        │  └───────┬───────┘  └───────┬───────┘  └──────┬──────┘ │
        │          │                  │                  │        │
        │  ┌───────▼───────┐  ┌───────▼───────┐  ┌──────▼──────┐ │
        │  │   Customer    │  │   Payment     │  │   Current   │ │
        │  │    Profile    │  │   Execution   │  │   Account   │ │
        │  │   Service     │  │    Service    │  │   Service   │ │
        │  └───────────────┘  └───────┬───────┘  └─────────────┘ │
        └─────────────────────────────┼────────────────────────────┘
                                      │ Events (Kafka)
        ┌─────────────────────────────▼────────────────────────────┐
        │                   RISK & COMPLIANCE                      │
        │                                                          │
        │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │
        │  │    Fraud      │  │   Compliance  │  │   Audit     │ │
        │  │   Detection   │  │   Controls    │  │   Trail     │ │
        │  │   Service     │  │    Service    │  │   Service   │ │
        │  └───────────────┘  └───────────────┘  └─────────────┘ │
        └──────────────────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────▼────────────────────────────┐
        │               EXTERNAL CONNECTIONS                       │
        │                                                          │
        │  SWIFT Network │ SEPA │ Open Banking │ Credit Bureaus   │
        └──────────────────────────────────────────────────────────┘
```

---

## Terraform: BIAN-aligned Infrastructure Labels

```hcl
# terraform/bian-labels.tf
# Tag all infrastructure with BIAN service domain labels
# Makes it easy to find what belongs to which banking function

locals {
  # BIAN service domain tags — apply to all resources in this service
  bian_tags = {
    "bian.domain"   = "payment-order"
    "bian.version"  = "v12"
    "bian.criticality" = "high"   # critical | high | medium | low
  }
}

# All resources for the Payment Order service get BIAN tags
resource "aws_eks_service_account" "payment_order" {
  name      = "payment-order-service"
  namespace = "banking-core"

  labels = merge(local.bian_tags, {
    "app" = "payment-order-service"
  })

  annotations = {
    "eks.amazonaws.com/role-arn" = aws_iam_role.payment_order.arn
    "bian.domain"                = "payment-order"
  }
}

# Cost allocation by BIAN domain
resource "aws_cost_allocation_tag" "bian_domain" {
  tag_key = "bian.domain"
  status  = "Active"
}
```

---

## Interview Questions — BIAN

**Q: What is BIAN and why is it important in banking?**
```
BIAN (Banking Industry Architecture Network) is an industry standard
that defines the services a bank needs and how they should be designed.

Why it matters for DevOps:
1. Service boundaries: BIAN tells you which microservices to create
   (Payment Order, Fraud Detection, Customer Profile — not arbitrary)
   
2. API design: BIAN defines standard operations (INITIATE, EXECUTE, RETRIEVE)
   so APIs are consistent across the bank
   
3. Event-driven: BIAN promotes event-based communication between domains
   → Kafka topics named after BIAN operations
   
4. Regulatory compliance: Banking regulators expect banks to have
   clear separation of concerns — BIAN provides that structure
```

**Q: How does BIAN relate to microservices?**
```
BIAN service domains = natural microservice boundaries

Instead of teams inventing their own service boundaries:
  ❌ "payment-backend" (too vague — what does it do exactly?)
  ✓ "payment-order-service" (BIAN SD: Payment Order)
  ✓ "payment-execution-service" (BIAN SD: Payment Execution)
  ✓ "fraud-detection-service" (BIAN SD: Fraud Detection)

Benefits:
  - New team members understand the service immediately (BIAN is documented)
  - Integrations with vendors are easier (they also know BIAN)
  - Architecture reviews use common language
  - Regulatory auditors recognize BIAN terms
```

---

[← TOGAF](./04-togaf.md) | [Next: PCI-DSS →](./06-pci-dss.md)
