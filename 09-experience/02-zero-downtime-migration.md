# Case Study: Zero-Downtime NoSQL → SQL Migration

> **Industry:** Fintech — Digital Banking
> **Environment:** Azure (AKS, Cosmos DB, Azure SQL, Azure DevOps)
> **Challenge:** Migrate production NoSQL (Cosmos DB) to relational SQL (Azure SQL) with zero downtime and no data loss

---

## The Problem

A digital banking platform was running on Azure Cosmos DB:
- Inconsistent data models across 14 microservices
- No joins — complex reporting required in-memory aggregation
- Regulatory audit required relational referential integrity
- 24/7 availability requirement — no maintenance windows allowed
- 8M+ records across 3 Cosmos DB collections

---

## The Solution Architecture

```
Migration Strategy: Dual-Write + Cutover

Phase 1 — Shadow Write:
  App → writes → Cosmos DB (primary)
                  ↓ sync worker
                 Azure SQL (shadow)

Phase 2 — Validation:
  Read comparison: Cosmos vs SQL → diff report

Phase 3 — Read Cutover:
  App → reads → Azure SQL (new primary)
              → writes → both (safety net)

Phase 4 — Write Cutover:
  App → writes → Azure SQL only
  Cosmos DB → read-only → decommission in 30 days
```

---

## What Was Implemented

### 1. Dual-Write Proxy Pattern (Kubernetes Sidecar)

```python
# migration/dual_write_proxy.py
# Kubernetes sidecar intercepts writes and replicates to SQL

import asyncio
import json
from azure.cosmos.aio import CosmosClient
import pyodbc

class DualWriteProxy:
    def __init__(self, cosmos_conn: str, sql_conn: str):
        self.cosmos = CosmosClient.from_connection_string(cosmos_conn)
        self.sql_conn = sql_conn

    async def write_account(self, account: dict) -> dict:
        # Write to Cosmos (primary — never fail)
        cosmos_result = await self._write_cosmos(account)

        # Write to SQL (shadow — log failures, don't block)
        try:
            await self._write_sql_account(account)
        except Exception as e:
            # Shadow failures → DLQ for manual replay
            await self._send_to_dlq(account, str(e))

        return cosmos_result

    async def _write_sql_account(self, account: dict):
        conn = pyodbc.connect(self.sql_conn)
        cursor = conn.cursor()
        cursor.execute("""
            MERGE INTO accounts AS target
            USING (VALUES (?, ?, ?, ?, ?)) AS source
                  (id, customer_id, balance, currency, updated_at)
            ON target.id = source.id
            WHEN MATCHED THEN UPDATE SET
                balance    = source.balance,
                updated_at = source.updated_at
            WHEN NOT MATCHED THEN INSERT
                (id, customer_id, balance, currency, updated_at)
            VALUES (source.id, source.customer_id, source.balance,
                    source.currency, source.updated_at);
        """, account['id'], account['customerId'],
             account['balance'], account['currency'],
             account['updatedAt'])
        conn.commit()
        conn.close()
```

### 2. Kubernetes Deployment with Sidecar

```yaml
# k8s/account-service-migration.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: account-service
  namespace: banking
spec:
  replicas: 3
  selector:
    matchLabels:
      app: account-service
  template:
    metadata:
      labels:
        app: account-service
        migration-phase: "dual-write"
    spec:
      containers:
        - name: account-service
          image: registry.azurecr.io/account-service:v2.4.0
          env:
            - name: MIGRATION_PHASE
              valueFrom:
                configMapKeyRef:
                  name: migration-config
                  key: phase   # "cosmos-primary" | "sql-primary" | "sql-only"
            - name: COSMOS_CONN
              valueFrom:
                secretKeyRef:
                  name: cosmos-credentials
                  key: connection-string
            - name: SQL_CONN
              valueFrom:
                secretKeyRef:
                  name: sql-credentials
                  key: connection-string

        - name: migration-sidecar
          image: registry.azurecr.io/dual-write-proxy:v1.2.0
          ports:
            - containerPort: 9090   # intercept writes
          env:
            - name: DLQ_ENDPOINT
              value: "https://banking-sb.servicebus.windows.net/migration-dlq"
```

### 3. Data Validation Script

```python
# migration/validate.py
# Compare Cosmos vs SQL record by record — run nightly during Phase 2

import asyncio
from dataclasses import dataclass
from typing import List

@dataclass
class ValidationResult:
    total: int
    matching: int
    mismatches: List[dict]

async def validate_accounts(cosmos_client, sql_conn) -> ValidationResult:
    cosmos_accounts = await fetch_all_cosmos_accounts(cosmos_client)
    sql_accounts = await fetch_all_sql_accounts(sql_conn)

    cosmos_map = {a['id']: a for a in cosmos_accounts}
    sql_map    = {a['id']: a for a in sql_accounts}

    mismatches = []
    for acc_id, cosmos_acc in cosmos_map.items():
        sql_acc = sql_map.get(acc_id)
        if not sql_acc:
            mismatches.append({'id': acc_id, 'issue': 'missing_in_sql'})
            continue
        if cosmos_acc['balance'] != sql_acc['balance']:
            mismatches.append({
                'id':          acc_id,
                'issue':       'balance_mismatch',
                'cosmos':      cosmos_acc['balance'],
                'sql':         sql_acc['balance'],
            })

    return ValidationResult(
        total=len(cosmos_map),
        matching=len(cosmos_map) - len(mismatches),
        mismatches=mismatches
    )

# Acceptance threshold: < 0.001% mismatches before cutover
```

### 4. Feature Flag Cutover via ConfigMap

```bash
# Zero-downtime cutover: update ConfigMap → rolling restart
# No code deployment needed — phase change via config only

# Phase 2 → 3: switch reads to SQL
kubectl patch configmap migration-config -n banking \
  --patch '{"data":{"phase":"sql-primary"}}'

# Rolling restart picks up new phase
kubectl rollout restart deployment/account-service -n banking

# Monitor rollout
kubectl rollout status deployment/account-service -n banking

# Validate — check error rates in Prometheus
kubectl port-forward svc/prometheus 9090:9090 -n monitoring &
# Query: rate(http_requests_total{status=~"5.."}[5m])
```

---

## Azure DevOps Pipeline for Migration Phases

```yaml
# azure-pipelines-migration.yml
trigger: none   # manual trigger only — migration is controlled

stages:
  - stage: Validate
    jobs:
      - job: RunValidation
        steps:
          - script: python migration/validate.py
            displayName: 'Compare Cosmos vs SQL'
          - script: |
              MISMATCHES=$(cat validation-report.json | jq '.mismatches | length')
              TOTAL=$(cat validation-report.json | jq '.total')
              RATE=$(echo "scale=5; $MISMATCHES / $TOTAL" | bc)
              echo "Mismatch rate: $RATE"
              if (( $(echo "$RATE > 0.00001" | bc -l) )); then
                echo "##[error]Mismatch rate exceeds threshold"
                exit 1
              fi
            displayName: 'Check mismatch threshold'

  - stage: Cutover
    dependsOn: Validate
    condition: succeeded()
    jobs:
      - deployment: SwitchReads
        environment: production
        strategy:
          runOnce:
            deploy:
              steps:
                - script: |
                    kubectl patch configmap migration-config -n banking \
                      --patch '{"data":{"phase":"sql-primary"}}'
                    kubectl rollout restart deployment/account-service -n banking
                    kubectl rollout status deployment/account-service -n banking --timeout=5m
                  displayName: 'Cutover reads to SQL'
```

---

## Results

| Metric | Before | After |
|--------|--------|-------|
| Downtime during migration | N/A | 0 seconds |
| Report query time | 4.2s (in-memory join) | 180ms (SQL JOIN) |
| Data integrity violations | 0 allowed | 0 found |
| Migration duration | N/A | 18 days (phases) |
| Cosmos DB monthly cost | $2,800 | $0 (decommissioned) |
| Azure SQL monthly cost | $0 | $1,100 |

---

## How to Talk About This in an Interview

**Q: Describe a technically complex migration you led.**

> "We needed to migrate 8 million records from Cosmos DB to Azure SQL on a
> 24/7 banking platform — zero maintenance windows allowed.
>
> The strategy was dual-write: for two weeks, every write went to both databases
> simultaneously. A nightly validation script compared every record and we tracked
> mismatch rate. When it dropped below 0.001%, we cut over reads to SQL via a
> ConfigMap change — no code deployment, no downtime.
>
> The most critical decision was making shadow write failures non-blocking:
> failures went to a DLQ for replay rather than breaking the user request.
> That kept risk entirely on the shadow side."

---

[← Back to Section](./README.md)
