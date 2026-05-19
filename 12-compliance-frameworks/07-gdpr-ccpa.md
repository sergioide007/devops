# GDPR / CCPA — Data Privacy Regulations

> GDPR = European Union data privacy law (affects everyone who has EU customers)
> CCPA = California Consumer Privacy Act (affects businesses with CA customers)
> Both say: "Handle personal data responsibly. Give people control over their data."
> As a DevOps engineer, you build systems that delete, anonymize, and protect personal data.

---

## What Is Personal Data?

```
GDPR definition: Any information about an identified or identifiable person

Examples:
  ✓ Name + email = personal data
  ✓ IP address = personal data (can identify a person)
  ✓ Cookie ID = personal data (tracks a person online)
  ✓ Name + birthdate + zip code = personal data (can identify someone)
  ✓ GPS coordinates (home/work) = personal data
  ✗ Aggregated statistics ("25% of users in EU") = NOT personal data
  ✗ Truly anonymized data = NOT personal data (if anonymization is irreversible)

SPECIAL CATEGORIES (extra protection required):
  - Health/medical data
  - Racial or ethnic origin
  - Political opinions
  - Religious beliefs
  - Biometric data (fingerprints, face recognition)
  - Sexual orientation
```

---

## GDPR Key Rights → Technical Implementation

### Right of Access (Article 15) — Export user data

```python
# gdpr_export.py
# GDPR Art. 15: User has right to receive copy of all their data
# Must respond within 30 days

import boto3
import json
from datetime import datetime
from typing import Dict, Any

class GDPRDataExporter:
    """
    Collect all personal data for a user from all systems.
    Returns a complete data package (JSON) for the user.
    """
    
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb')
        self.s3 = boto3.client('s3')
    
    def export_user_data(self, user_id: str, email: str) -> Dict[str, Any]:
        """
        GDPR Article 15 — Subject Access Request (SAR)
        Collect ALL data about a user from ALL systems.
        """
        
        export = {
            "gdpr_export": True,
            "request_date": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "data_controller": "Company Name Ltd",
            "systems_queried": []
        }
        
        # 1. User profile data (main database)
        profile = self._get_profile_data(user_id)
        if profile:
            export["profile"] = profile
            export["systems_queried"].append("user-profile-service")
        
        # 2. Order history
        orders = self._get_order_history(user_id)
        export["orders"] = orders
        export["systems_queried"].append("order-service")
        
        # 3. Activity logs (what they did in the app)
        activity = self._get_activity_logs(user_id, email)
        export["activity_logs"] = activity
        export["systems_queried"].append("analytics-service")
        
        # 4. Communication history (emails sent)
        communications = self._get_communications(email)
        export["communications"] = communications
        export["systems_queried"].append("email-service")
        
        # 5. Consent records
        consents = self._get_consents(user_id)
        export["consents"] = consents
        export["systems_queried"].append("consent-service")
        
        # 6. Third-party sharing records
        export["third_party_sharing"] = [
            {
                "recipient": "Google Analytics",
                "data_shared": "anonymous usage data",
                "legal_basis": "Legitimate interests"
            },
            {
                "recipient": "Stripe",
                "data_shared": "payment data",
                "legal_basis": "Contract performance"
            }
        ]
        
        # Store export in S3 for download link
        export_key = f"gdpr-exports/{user_id}/{datetime.utcnow().strftime('%Y%m%d')}.json"
        self.s3.put_object(
            Bucket="gdpr-exports-bucket",
            Key=export_key,
            Body=json.dumps(export, default=str, indent=2),
            ServerSideEncryption="aws:kms",
            KMSKeyId="arn:aws:kms:...:key/gdpr-key"
        )
        
        # Generate pre-signed URL (valid 7 days for user to download)
        download_url = self.s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': 'gdpr-exports-bucket', 'Key': export_key},
            ExpiresIn=604800  # 7 days
        )
        
        export["download_url"] = download_url
        return export
    
    def _get_profile_data(self, user_id: str) -> dict:
        table = self.dynamodb.Table('users')
        response = table.get_item(Key={"user_id": user_id})
        return response.get("Item", {})
    
    def _get_order_history(self, user_id: str) -> list:
        table = self.dynamodb.Table('orders')
        response = table.query(
            IndexName="user_id-index",
            KeyConditionExpression="user_id = :uid",
            ExpressionAttributeValues={":uid": user_id}
        )
        return response.get("Items", [])
    
    def _get_activity_logs(self, user_id: str, email: str) -> list:
        # CloudWatch Logs Insights query
        logs = boto3.client('logs')
        response = logs.start_query(
            logGroupName="/app/user-activity",
            startTime=int((datetime.utcnow().timestamp() - 365*86400)),  # 1 year
            endTime=int(datetime.utcnow().timestamp()),
            queryString=f"fields @timestamp, action, resource | filter user_id = '{user_id}' | sort @timestamp desc | limit 1000"
        )
        # ... wait for query, return results
        return []
    
    def _get_communications(self, email: str) -> list:
        # Query email service for all emails sent to this address
        return []  # implementation depends on email provider
    
    def _get_consents(self, user_id: str) -> list:
        table = self.dynamodb.Table('consents')
        response = table.query(
            KeyConditionExpression="user_id = :uid",
            ExpressionAttributeValues={":uid": user_id}
        )
        return response.get("Items", [])
```

---

### Right to Erasure (Article 17) — "Right to be Forgotten"

```python
# gdpr_erasure.py
# GDPR Art. 17: User can request deletion of their personal data
# Must respond within 30 days
# EXCEPTIONS: legal obligation, public interest, legal claims

class GDPRErasureService:
    """
    Handle GDPR "right to be forgotten" requests.
    IMPORTANT: Some data CANNOT be deleted (legal/tax/fraud records).
    """
    
    RETENTION_OVERRIDES = {
        # Data we MUST keep despite erasure request (legal obligation)
        "financial_transactions": {
            "retention_years": 7,
            "legal_basis": "Tax law / AML regulations",
            "action": "anonymize"  # anonymize instead of delete
        },
        "fraud_records": {
            "retention_years": 5,
            "legal_basis": "Fraud prevention (legitimate interest)",
            "action": "retain"
        }
    }
    
    def process_erasure_request(self, user_id: str, email: str) -> dict:
        """
        GDPR Art. 17 — Right to Erasure
        
        Strategy:
          REGULAR data → delete completely
          FINANCIAL data → anonymize (keep for tax/legal)
          FRAUD data → keep (legal obligation)
        """
        
        results = {
            "user_id": user_id,
            "erasure_date": datetime.utcnow().isoformat(),
            "actions": []
        }
        
        # 1. Delete user profile (immediate)
        self._delete_user_profile(user_id)
        results["actions"].append({"system": "user-profile", "action": "DELETED"})
        
        # 2. Delete sessions
        self._delete_sessions(user_id)
        results["actions"].append({"system": "sessions", "action": "DELETED"})
        
        # 3. Delete marketing data
        self._unsubscribe_all(email)
        self._delete_from_marketing_lists(email)
        results["actions"].append({"system": "marketing", "action": "DELETED"})
        
        # 4. Delete analytics tracking
        self._delete_analytics(user_id)
        results["actions"].append({"system": "analytics", "action": "DELETED"})
        
        # 5. ANONYMIZE financial records (cannot delete — tax law)
        self._anonymize_transactions(user_id)
        results["actions"].append({
            "system": "transactions",
            "action": "ANONYMIZED",
            "retention": "7 years",
            "legal_basis": "Tax law obligation"
        })
        
        # 6. Notify data processors (third parties)
        self._notify_processors(user_id, email, action="erase")
        results["actions"].append({"system": "third-parties", "action": "NOTIFIED"})
        
        # 7. Mark in suppression list (prevent re-subscribe if user contacts again)
        self._add_to_suppression_list(email)
        
        return results
    
    def _anonymize_transactions(self, user_id: str):
        """
        Replace PII with anonymized values, keep transaction record.
        
        Before: {user_id: "U123", name: "John Doe", email: "john@example.com", amount: 99.99}
        After:  {user_id: "DELETED", name: "ANONYMIZED", email: "ANONYMIZED", amount: 99.99}
        """
        table = self.dynamodb.Table('transactions')
        transactions = table.query(
            IndexName="user_id-index",
            KeyConditionExpression="user_id = :uid",
            ExpressionAttributeValues={":uid": user_id}
        )
        
        for txn in transactions.get("Items", []):
            table.update_item(
                Key={"transaction_id": txn["transaction_id"]},
                UpdateExpression="SET user_id = :anon, customer_name = :anon, customer_email = :anon",
                ExpressionAttributeValues={":anon": "GDPR-ANONYMIZED"}
            )
    
    def _delete_user_profile(self, user_id: str):
        self.dynamodb.Table('users').delete_item(Key={"user_id": user_id})
    
    def _delete_sessions(self, user_id: str):
        # Redis: delete all session keys for this user
        import redis
        r = redis.Redis.from_url(os.environ['REDIS_URL'])
        pattern = f"session:*:{user_id}"
        keys = r.keys(pattern)
        if keys:
            r.delete(*keys)
    
    def _notify_processors(self, user_id: str, email: str, action: str):
        # Notify all data processors (third parties) via API/webhook
        processors = [
            "https://api.mailchimp.com/3.0/...",  # Marketing
            "https://api.intercom.io/...",         # Support
            "https://api.segment.com/..."          # Analytics
        ]
        # ... notify each processor
```

---

### Data Minimization — Don't Collect What You Don't Need

```yaml
# GDPR Art. 5(1)(c): Data minimization
# Collect only what is necessary for the stated purpose

# BAD: Collecting too much data
user_registration_form:
  fields:
    - email (required)    # ✓ needed for account
    - password (required) # ✓ needed for auth
    - first_name (required) # ✓ needed for personalization
    - last_name (required)  # ✓ needed for personalization
    - date_of_birth (required) # ❌ WHY? Not needed for this service
    - phone_number (required)  # ❌ unless 2FA — make it optional
    - gender (required)        # ❌ Not needed at registration
    - nationality (required)   # ❌ Not needed at all
    - address (required)       # ❌ Only needed if shipping physical goods

# GOOD: Collect only what's necessary
user_registration_form:
  fields:
    - email (required)         # ✓ account identifier + communication
    - password (required)      # ✓ authentication
    - display_name (optional)  # ✓ optional personalization

# Collect additional data later, only when needed:
  - phone_number: collected when user enables 2FA
  - address: collected at first purchase (if physical goods)
  - date_of_birth: collected only if age verification required by law
```

---

### Consent Management

```python
# consent_manager.py
# GDPR requires explicit, informed, revocable consent

class ConsentManager:
    """
    GDPR Art. 7: Conditions for consent
    - Must be freely given, specific, informed, and unambiguous
    - As easy to withdraw as to give
    - Granular (separate consent for each purpose)
    - Recorded with timestamp and version
    """
    
    CONSENT_PURPOSES = {
        "necessary": {
            "description": "Essential for the service to function",
            "required": True,  # Cannot be declined
            "examples": ["login session", "shopping cart"]
        },
        "analytics": {
            "description": "Understand how you use our service (anonymized)",
            "required": False,
            "examples": ["page views", "feature usage"]
        },
        "marketing": {
            "description": "Send you product updates and offers",
            "required": False,
            "examples": ["email newsletters", "personalized offers"]
        },
        "third_party": {
            "description": "Share data with partners for their services",
            "required": False,
            "examples": ["advertising networks", "analytics providers"]
        }
    }
    
    def record_consent(
        self,
        user_id: str,
        purpose: str,
        granted: bool,
        consent_version: str,
        ip_address: str
    ) -> str:
        """Record consent decision with full audit trail."""
        
        if purpose not in self.CONSENT_PURPOSES:
            raise ValueError(f"Unknown consent purpose: {purpose}")
        
        record = {
            "consent_id": f"CON-{uuid.uuid4().hex}",
            "user_id": user_id,
            "purpose": purpose,
            "granted": granted,
            "consent_version": consent_version,  # Version of privacy policy
            "timestamp": datetime.utcnow().isoformat(),
            "ip_address": ip_address,
            "method": "explicit_checkbox"  # How consent was collected
        }
        
        # Store consent record (immutable — never delete consent history)
        self.dynamodb.Table('gdpr_consents').put_item(Item=record)
        
        # Update active consent state
        self.dynamodb.Table('user_consents').update_item(
            Key={"user_id": user_id, "purpose": purpose},
            UpdateExpression="SET granted = :g, updated_at = :t",
            ExpressionAttributeValues={":g": granted, ":t": datetime.utcnow().isoformat()}
        )
        
        return record["consent_id"]
    
    def check_consent(self, user_id: str, purpose: str) -> bool:
        """Check if user has given consent for a specific purpose."""
        
        # Necessary processing never requires consent check
        if self.CONSENT_PURPOSES.get(purpose, {}).get("required"):
            return True
        
        response = self.dynamodb.Table('user_consents').get_item(
            Key={"user_id": user_id, "purpose": purpose}
        )
        
        item = response.get("Item", {})
        return item.get("granted", False)
```

---

## Data Classification and Labeling

```hcl
# terraform/data-classification.tf
# Label all data stores with sensitivity levels
# Required by GDPR for data mapping

resource "aws_s3_bucket" "user_documents" {
  bucket = "company-user-documents"
}

resource "aws_s3_bucket_tagging" "user_documents" {
  bucket = aws_s3_bucket.user_documents.id

  tags = {
    DataClassification  = "Personal"        # ISO 27001 classification
    GDPRCategory        = "General"         # General personal data
    GDPRLegalBasis      = "Contract"        # Why we process this
    DataRetention       = "3-years"         # How long we keep it
    DataController      = "Company-Name"    # Who is responsible
    PIIScan             = "required"        # Must be scanned for PII
    EncryptionRequired  = "true"
  }
}

resource "aws_dynamodb_table" "health_records" {
  name = "user-health-records"
  
  tags = {
    DataClassification  = "Highly-Sensitive"
    GDPRCategory        = "SpecialCategory-Health"  # Extra protection!
    GDPRLegalBasis      = "Explicit-Consent"
    DataRetention       = "10-years"
    HIPAA               = "true"
    AccessRestriction   = "health-team-only"
  }
}
```

---

## PII Detection in CI/CD Pipeline

```yaml
# .github/workflows/pii-scan.yml
# GDPR requires you know where personal data lives
# Scan code to prevent PII from leaking into logs, configs, tests

name: PII Detection Scan

on:
  pull_request:
    branches: [main]

jobs:
  pii-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Scan for PII in code
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          extra_args: --only-verified

      - name: Gitleaks — scan for secrets and PII patterns
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          config-path: .gitleaks-pii.toml

      - name: Check for hardcoded test PAN numbers
        run: |
          # Common test card numbers that should NOT be in prod code
          PATTERNS=(
            "4111111111111111"  # Visa test card
            "5500005555555559"  # Mastercard test
            "371449635398431"   # Amex test
            "ssn\s*[:=]\s*[0-9]{3}-[0-9]{2}-[0-9]{4}"  # SSN pattern
          )
          
          FOUND=0
          for pattern in "${PATTERNS[@]}"; do
            if grep -r "$pattern" --include="*.py" --include="*.js" --include="*.ts" .; then
              echo "❌ PII PATTERN FOUND: $pattern"
              FOUND=1
            fi
          done
          
          if [ $FOUND -eq 1 ]; then
            echo "PII detected in code. GDPR violation risk."
            exit 1
          fi
          echo "✅ No PII patterns detected in source code"
```

---

## GDPR vs CCPA Comparison

```
                    GDPR (EU)                    CCPA (California)
────────────────────────────────────────────────────────────────────
Scope:              Any company with EU customers  CA businesses >$25M revenue
                                                   OR sell 100K+ CA records

Legal basis:        Required for ALL processing    Opt-out for selling data only

Rights:             Access, Deletion, Portability  Access, Deletion, Opt-out
                    Rectification, Restriction     Know what data is collected
                    Object to processing

Consent:            Often required (granular)      Required for selling data

Fines:              Up to 4% of global revenue     $2,500–$7,500 per violation
                    (€20M max)

Data breach:        Notify in 72 hours             Notify "in the most expedient
notification:                                      time possible"

DPO required:       Yes (in some cases)            No DPO required

Technical           Privacy by design              Similar but less prescriptive
requirements:       Data minimization
                    Purpose limitation
```

---

## Privacy by Design (GDPR Art. 25)

```
Privacy by Design = Build privacy INTO the system from the start
                    (not added as an afterthought)

7 Principles:

1. PROACTIVE, NOT REACTIVE
   → Threat model for privacy risks BEFORE building
   → Privacy impact assessment for new features

2. PRIVACY AS DEFAULT
   → Maximum privacy settings by default (user must opt IN to share)
   → Don't collect data just because you can

3. PRIVACY EMBEDDED INTO DESIGN
   → Data flows documented in architecture
   → Privacy requirements in user stories

4. FULL FUNCTIONALITY (NOT ZERO-SUM)
   → Privacy AND security AND functionality (not tradeoffs)

5. END-TO-END SECURITY
   → Encryption everywhere
   → Data secure for its entire lifecycle

6. VISIBILITY AND TRANSPARENCY
   → Users can see what data you have (export)
   → Privacy policy in plain language

7. RESPECT FOR USER PRIVACY
   → User-centric controls
   → Strong defaults that protect privacy
```

---

## Interview Questions — GDPR/CCPA

**Q: What technical steps do you take to achieve GDPR compliance?**
```
1. Data minimization
   → Don't store what you don't need
   → Review forms and APIs for unnecessary PII collection

2. Encryption
   → Encrypt PII at rest (KMS) and in transit (TLS 1.2+)
   → Separate encryption keys per data category

3. Right to erasure implementation
   → API endpoint to export/delete user data
   → Anonymize records with legal hold (can't fully delete)
   → Cascade deletion across all services and caches

4. Consent management
   → Record consent with timestamp and version
   → Check consent before processing for each purpose

5. Access control
   → Only authorized teams can access PII databases
   → Audit log for all PII access (who, when, what)

6. Data retention policies
   → Automated deletion after retention period
   → Different retention per data type (7 years financial, 30 days logs)

7. Incident response
   → 72-hour breach notification process
   → Breach detection monitoring (unusual access patterns)
```

**Q: What is the difference between anonymization and pseudonymization?**
```
ANONYMIZATION:
  → PII is removed/transformed irreversibly
  → Result: cannot be linked back to a person
  → GDPR no longer applies to anonymized data
  → Example: aggregate statistics ("25% of users in EU")
  
PSEUDONYMIZATION:
  → Replace PII with a pseudonym/token
  → Original data still exists (in a key/vault)
  → Can still be linked back to a person (with the key)
  → GDPR STILL APPLIES (it's still personal data)
  → Example: user_id "U12345" instead of "john@example.com"
  → Lower risk but NOT exempt from GDPR
  
For erasure requests:
  → Anonymize financial records (keep for tax, but no PII)
  → Delete profile records (not needed for legal basis)
```

---

[← PCI-DSS](./06-pci-dss.md) | [Next: Banking Sector →](./08-sector-banking.md)
