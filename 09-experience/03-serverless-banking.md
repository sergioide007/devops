# Case Study: Legacy Banking → Serverless Lambda

> **Industry:** Banking — Retail Banking
> **Environment:** AWS (Lambda, API Gateway, DynamoDB, SQS, EventBridge)
> **Challenge:** Migrate a monolithic on-premise core banking backend to serverless AWS Lambda with no service interruption

---

## The Problem

A retail bank was running a 12-year-old Java monolith on on-premise servers:
- Single point of failure — one deploy brought down all services
- Scaling required manual provisioning (2-3 days lead time)
- Peak hours (payroll days) caused 40% request failure rate
- Deploy cycle: 3 weeks freeze + 4-hour maintenance window
- Monthly on-premise infrastructure cost: $38,000

---

## The Solution Architecture

```
Strangler Fig Pattern — migrate service by service

Legacy Monolith (on-prem)
      ↓
  API Gateway (routing layer)
      ├── /accounts/*   → Lambda fn-accounts   (migrated)
      ├── /payments/*   → Lambda fn-payments   (migrated)
      ├── /transfers/*  → Lambda fn-transfers  (migrated)
      └── /loans/*      → Legacy monolith      (pending)

Event Bus: EventBridge
  Lambda events → downstream services → audit logs → analytics

Persistence:
  DynamoDB (accounts, sessions)
  RDS Aurora Serverless (transactions — relational)
  ElastiCache Redis (session cache)
```

---

## What Was Implemented

### 1. Lambda Function — Accounts Service

```python
# fn-accounts/handler.py
import boto3
import json
import os
from decimal import Decimal
from datetime import datetime

dynamodb  = boto3.resource('dynamodb')
events    = boto3.client('events')
table     = dynamodb.Table(os.environ['ACCOUNTS_TABLE'])

def lambda_handler(event, context):
    method = event['httpMethod']
    path   = event['path']

    if method == 'GET' and path.startswith('/accounts/'):
        account_id = path.split('/')[-1]
        return get_account(account_id)

    if method == 'POST' and path == '/accounts':
        body = json.loads(event['body'])
        return create_account(body)

    return {'statusCode': 404, 'body': json.dumps({'error': 'Not found'})}


def get_account(account_id: str) -> dict:
    resp = table.get_item(Key={'accountId': account_id})
    item = resp.get('Item')
    if not item:
        return {'statusCode': 404, 'body': json.dumps({'error': 'Account not found'})}
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps(item, default=decimal_serializer)
    }


def create_account(body: dict) -> dict:
    account = {
        'accountId':  body['customerId'] + '-' + datetime.utcnow().strftime('%Y%m%d%H%M%S'),
        'customerId': body['customerId'],
        'balance':    Decimal('0'),
        'currency':   body.get('currency', 'USD'),
        'status':     'ACTIVE',
        'createdAt':  datetime.utcnow().isoformat() + 'Z',
    }
    table.put_item(Item=account)

    # Emit event — downstream services (notifications, audit) react independently
    events.put_events(Entries=[{
        'Source':       'banking.accounts',
        'DetailType':   'AccountCreated',
        'Detail':       json.dumps({'accountId': account['accountId']}),
        'EventBusName': os.environ['EVENT_BUS_NAME'],
    }])

    return {'statusCode': 201, 'body': json.dumps({'accountId': account['accountId']})}


def decimal_serializer(obj):
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f'Not serializable: {type(obj)}')
```

### 2. Payments with SQS (Async Processing)

```python
# fn-payments/handler.py
# Payments are async — API returns 202 immediately, SQS processes in background

import boto3
import json
import uuid
import os
from datetime import datetime

sqs   = boto3.client('sqs')
table = boto3.resource('dynamodb').Table(os.environ['PAYMENTS_TABLE'])

def lambda_handler(event, context):
    body = json.loads(event['body'])

    # Validate amount
    if body.get('amount', 0) <= 0:
        return {'statusCode': 400, 'body': json.dumps({'error': 'Invalid amount'})}

    payment_id = str(uuid.uuid4())

    # Persist as PENDING immediately
    table.put_item(Item={
        'paymentId':   payment_id,
        'fromAccount': body['fromAccount'],
        'toAccount':   body['toAccount'],
        'amount':      str(body['amount']),
        'currency':    body.get('currency', 'USD'),
        'status':      'PENDING',
        'createdAt':   datetime.utcnow().isoformat() + 'Z',
    })

    # Enqueue for async processing
    sqs.send_message(
        QueueUrl=os.environ['PAYMENTS_QUEUE_URL'],
        MessageBody=json.dumps({
            'paymentId':   payment_id,
            'fromAccount': body['fromAccount'],
            'toAccount':   body['toAccount'],
            'amount':      body['amount'],
        }),
        MessageGroupId=body['fromAccount'],  # FIFO — same account processes in order
    )

    return {
        'statusCode': 202,
        'body': json.dumps({'paymentId': payment_id, 'status': 'PENDING'})
    }
```

### 3. Terraform Infrastructure

```hcl
# terraform/lambda-banking.tf

module "fn_accounts" {
  source        = "./modules/lambda-function"
  function_name = "fn-accounts"
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"
  memory_size   = 256
  timeout       = 10

  environment_variables = {
    ACCOUNTS_TABLE = aws_dynamodb_table.accounts.name
    EVENT_BUS_NAME = aws_cloudwatch_event_bus.banking.name
  }

  # Auto-scaling via provisioned concurrency
  provisioned_concurrency = 5
}

resource "aws_dynamodb_table" "accounts" {
  name         = "banking-accounts-${var.env}"
  billing_mode = "PAY_PER_REQUEST"   # no capacity planning needed
  hash_key     = "accountId"

  attribute {
    name = "accountId"
    type = "S"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.banking.arn
  }

  tags = {
    Environment = var.env
    Compliance  = "PCI"
  }
}

resource "aws_sqs_queue" "payments" {
  name                        = "banking-payments-${var.env}.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  visibility_timeout_seconds  = 60
  message_retention_seconds   = 86400   # 24h

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.payments_dlq.arn
    maxReceiveCount     = 3
  })
}
```

### 4. API Gateway Routing (Strangler Fig)

```hcl
# terraform/api-gateway.tf

resource "aws_api_gateway_rest_api" "banking" {
  name = "banking-api-${var.env}"
}

# Route /accounts → Lambda (migrated)
resource "aws_api_gateway_resource" "accounts" {
  rest_api_id = aws_api_gateway_rest_api.banking.id
  parent_id   = aws_api_gateway_rest_api.banking.root_resource_id
  path_part   = "accounts"
}

resource "aws_api_gateway_integration" "accounts_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.banking.id
  resource_id             = aws_api_gateway_resource.accounts.id
  http_method             = "ANY"
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = module.fn_accounts.invoke_arn
}

# Route /loans → Legacy monolith (not yet migrated)
resource "aws_api_gateway_integration" "loans_legacy" {
  rest_api_id = aws_api_gateway_rest_api.banking.id
  resource_id = aws_api_gateway_resource.loans.id
  http_method = "ANY"
  type        = "HTTP_PROXY"
  uri         = "https://${var.legacy_endpoint}/loans/{proxy}"
}
```

---

## Results

| Metric | Before (Monolith) | After (Serverless) |
|--------|-------------------|--------------------|
| Peak hour failure rate | 40% | 0.2% |
| Deploy cycle | 3 weeks + 4h window | 8 minutes, no window |
| Auto-scaling | Manual (2-3 days) | Instant (Lambda) |
| Cold start p99 | N/A | 210ms (provisioned) |
| Monthly infra cost | $38,000 | $4,800 |
| MTTR (mean time to recover) | 2.5 hours | 4 minutes |

---

## How to Talk About This in an Interview

**Q: How did you modernize a legacy system without big-bang rewrites?**

> "We used the Strangler Fig pattern: an API Gateway sat in front of both the
> legacy monolith and the new Lambda functions. We migrated one service at a time —
> accounts first, then payments — routing traffic progressively.
>
> The key decision was making payments async via SQS FIFO queues. The API returns
> 202 immediately and the payment processes in the background. This eliminated the
> timeout failures that happened during peak hours when the monolith was overloaded.
>
> After 6 months, 80% of traffic was on Lambda. The monolith handled only loans,
> which had complex legacy business rules that needed more time to untangle."

---

[← Back to Section](./README.md)
