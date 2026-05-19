# Lambda — Serverless Computing

> Lambda lets you run code without managing servers.
> AWS handles scaling, patching, and availability.
> You only pay when your code runs.

---

## How Lambda Works

```
Event → Lambda Function → Response
         (your code)
```

**Events can come from:**
- API Gateway (HTTP requests)
- S3 (file uploaded)
- SQS (message in queue)
- DynamoDB Streams (database change)
- CloudWatch Events (scheduled)
- SNS (notification)

---

## Your First Lambda Function

```python
# lambda_function.py
import json
import boto3
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    event   = the input data (from API Gateway, SQS, etc.)
    context = Lambda runtime info (function name, timeout, etc.)
    """
    logger.info(f"Event received: {json.dumps(event)}")

    # Your business logic here
    body = json.loads(event.get('body', '{}'))
    user_id = body.get('user_id')

    if not user_id:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'user_id is required'})
        }

    # Call another AWS service (uses execution role — no credentials needed)
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table('users')
    response = table.get_item(Key={'id': user_id})

    if 'Item' not in response:
        return {
            'statusCode': 404,
            'body': json.dumps({'error': 'User not found'})
        }

    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(response['Item'])
    }
```

---

## Deploy Lambda with AWS CLI

```bash
# Package the code
zip function.zip lambda_function.py

# If you have dependencies
pip install requests -t package/
cp lambda_function.py package/
cd package && zip -r ../function.zip . && cd ..

# Create function
aws lambda create-function \
    --function-name get-user \
    --runtime python3.12 \
    --role arn:aws:iam::123456789012:role/LambdaExecutionRole \
    --handler lambda_function.lambda_handler \
    --zip-file fileb://function.zip \
    --timeout 30 \
    --memory-size 256 \
    --environment Variables='{
        "APP_ENV":"production",
        "TABLE_NAME":"users"
    }'

# Update code
aws lambda update-function-code \
    --function-name get-user \
    --zip-file fileb://function.zip

# Update configuration
aws lambda update-function-configuration \
    --function-name get-user \
    --timeout 60 \
    --memory-size 512

# Invoke manually for testing
aws lambda invoke \
    --function-name get-user \
    --payload '{"body": "{\"user_id\": \"123\"}"}' \
    --cli-binary-format raw-in-base64-out \
    response.json

cat response.json

# View logs
aws logs tail /aws/lambda/get-user --follow
```

---

## Lambda with API Gateway

```bash
# Create REST API
aws apigateway create-rest-api --name "MyAPI"

# Get the root resource
ROOT_ID=$(aws apigateway get-resources \
    --rest-api-id abc123 \
    --query 'items[0].id' --output text)

# Create resource /users
aws apigateway create-resource \
    --rest-api-id abc123 \
    --parent-id $ROOT_ID \
    --path-part users

# Create GET method
aws apigateway put-method \
    --rest-api-id abc123 \
    --resource-id res123 \
    --http-method GET \
    --authorization-type NONE

# Connect to Lambda
aws apigateway put-integration \
    --rest-api-id abc123 \
    --resource-id res123 \
    --http-method GET \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:get-user/invocations"

# Deploy
aws apigateway create-deployment \
    --rest-api-id abc123 \
    --stage-name prod

# Your API is now at:
# https://abc123.execute-api.us-east-1.amazonaws.com/prod/users
```

---

## Lambda Performance Tuning

```bash
# Cold start problem: Lambda takes time to start when idle
# Solution 1: Provisioned Concurrency (keeps instances warm)
aws lambda put-provisioned-concurrency-config \
    --function-name get-user \
    --qualifier prod \
    --provisioned-concurrent-executions 5

# Solution 2: Keep function warm with scheduled ping
# CloudWatch Events rule: runs every 5 minutes
aws events put-rule \
    --name keep-lambda-warm \
    --schedule-expression "rate(5 minutes)"

# Solution 3: Optimize memory (more memory = faster CPU)
# Test different memory sizes — Lambda scales CPU with memory
# 128MB → baseline
# 256MB → usually 2x faster
# 512MB → 4x faster (for CPU-heavy tasks)

# Use Lambda Power Tuning tool
# https://github.com/alexcasalboni/aws-lambda-power-tuning

# Check function metrics
aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Duration \
    --dimensions Name=FunctionName,Value=get-user \
    --start-time 2026-05-19T00:00:00Z \
    --end-time 2026-05-19T23:59:59Z \
    --period 3600 \
    --statistics Average,Maximum
```

---

## Lambda with SQS — Payment Processing Pattern

```python
# Process payment events from SQS queue
import json
import boto3
import logging
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')

def lambda_handler(event, context):
    """Process SQS messages in batch."""
    table = dynamodb.Table('payments')
    failed_messages = []

    for record in event['Records']:
        message_id = record['messageId']

        try:
            payment = json.loads(record['body'])
            logger.info(f"Processing payment: {payment['payment_id']}")

            # Process the payment
            result = process_payment(payment)

            # Save result
            table.put_item(Item={
                'payment_id': payment['payment_id'],
                'status': 'completed',
                'amount': result['charged_amount'],
                'timestamp': result['timestamp']
            })

            logger.info(f"Payment {payment['payment_id']} completed")

        except Exception as e:
            logger.error(f"Failed to process message {message_id}: {str(e)}")
            # Report as failed (will be retried or sent to DLQ)
            failed_messages.append({
                'itemIdentifier': message_id
            })

    # Return failed messages for retry (SQS will retry these)
    return {
        'batchItemFailures': failed_messages
    }

def process_payment(payment):
    # Your payment processing logic here
    pass
```

```bash
# Create SQS queue with Dead Letter Queue
aws sqs create-queue \
    --queue-name payments-dlq \
    --attributes MessageRetentionPeriod=1209600  # 14 days

aws sqs create-queue \
    --queue-name payments \
    --attributes '{
        "VisibilityTimeout": "60",
        "MessageRetentionPeriod": "86400",
        "RedrivePolicy": "{
            \"deadLetterTargetArn\": \"arn:aws:sqs:us-east-1:123456789:payments-dlq\",
            \"maxReceiveCount\": \"3\"
        }"
    }'

# Connect SQS to Lambda
aws lambda create-event-source-mapping \
    --event-source-arn arn:aws:sqs:us-east-1:123456789:payments \
    --function-name process-payment \
    --batch-size 10 \
    --function-response-types ReportBatchItemFailures  # partial batch failures
```

---

## Serverless Framework — Deploy Lambda Faster

```yaml
# serverless.yml
service: payment-api
provider:
  name: aws
  runtime: python3.12
  region: us-east-1
  environment:
    TABLE_NAME: payments
    APP_ENV: production
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
          Resource: !GetAtt PaymentsTable.Arn
        - Effect: Allow
          Action:
            - sqs:ReceiveMessage
            - sqs:DeleteMessage
            - sqs:GetQueueAttributes
          Resource: !GetAtt PaymentsQueue.Arn

functions:
  getUser:
    handler: handlers/user.get_user
    events:
      - httpApi:
          path: /users/{id}
          method: GET
    timeout: 30
    memorySize: 256

  processPayment:
    handler: handlers/payment.process
    events:
      - sqs:
          arn: !GetAtt PaymentsQueue.Arn
          batchSize: 10
          functionResponseType: ReportBatchItemFailures
    timeout: 60
    memorySize: 512

resources:
  Resources:
    PaymentsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: payments
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: payment_id
            AttributeType: S
        KeySchema:
          - AttributeName: payment_id
            KeyType: HASH
```

```bash
# Deploy
serverless deploy --stage production

# Deploy only one function (faster)
serverless deploy function -f processPayment

# View logs
serverless logs -f processPayment --tail

# Remove all resources
serverless remove --stage production
```

---

## Interview Questions — Lambda

**Q: What is a cold start and how do you mitigate it?**
> "A cold start happens when Lambda creates a new execution environment — it downloads
> your code and initializes the runtime. It can add 100ms to several seconds of latency.
> I mitigate it by: (1) using Provisioned Concurrency for latency-sensitive functions;
> (2) minimizing package size — only include what you need; (3) initializing clients
> outside the handler so they are reused across invocations; (4) using smaller runtimes
> like Node.js or Python instead of Java for simple functions."

**Q: How do you handle failures in Lambda processing SQS messages?**
> "I use batch item failures — the function returns failed message IDs, and SQS retries
> only those. I set a Dead Letter Queue (DLQ) with a maxReceiveCount of 3 — after 3
> failures, the message goes to DLQ for investigation. I also set VisibilityTimeout to
> at least 6 times the Lambda timeout to prevent duplicate processing. I log all failures
> with structured logging and alert on DLQ queue depth via CloudWatch."

---

[← Back to Section](./README.md)
