# Production-Grade Kubernetes

> A Kubernetes cluster in development vs production are very different.
> Production requires: HA control plane, network policies, pod security,
> resource quotas, disruption budgets, cluster autoscaling, and proper RBAC.
> This section takes your cluster from "it works" to "it works at 3am on Black Friday."

---

## Production Readiness Checklist

```
Before calling a cluster "production-ready":

RELIABILITY
  ✓ Control plane: Multi-AZ (3 nodes or managed EKS/GKE/AKS)
  ✓ Worker nodes: Min 3 nodes across 2+ AZs
  ✓ Pod disruption budgets: max 1 pod down during maintenance
  ✓ Horizontal pod autoscaler: scale on CPU/memory
  ✓ Cluster autoscaler: scale nodes when pods can't fit
  ✓ Resource requests/limits: on ALL containers
  ✓ Liveness and readiness probes: on ALL containers
  ✓ Anti-affinity rules: spread pods across nodes

SECURITY
  ✓ RBAC: least privilege for all service accounts
  ✓ Network policies: deny all by default, allow explicitly
  ✓ Pod security: no root containers, read-only rootfs
  ✓ Secrets: external (AWS Secrets Manager, Vault), not etcd
  ✓ Image scanning: in CI (Trivy)
  ✓ Admission control: OPA Gatekeeper

OBSERVABILITY
  ✓ Metrics: Prometheus scraping all pods
  ✓ Logs: Loki/Alloy collecting all pod logs
  ✓ Traces: distributed tracing (Jaeger/Tempo)
  ✓ Alerts: firing before customers notice

OPERATIONS
  ✓ Runbooks: what to do when each alert fires
  ✓ Backup: etcd backup, PV backup (Velero)
  ✓ Upgrade strategy: tested upgrade procedure
  ✓ DR: can recreate cluster from IaC in < 1 hour
```

---

## Resource Management — Requests, Limits, and Quotas

```yaml
# kubernetes/production-deployment.yml
# Complete production deployment with ALL required fields

apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: production
  labels:
    app: payment-api
    version: v2.1.0
    team: payments
spec:
  replicas: 3
  
  # Rolling update strategy (zero-downtime deployments)
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # Can have 1 extra pod during update
      maxUnavailable: 0  # Never reduce below desired count
  
  selector:
    matchLabels:
      app: payment-api
  
  template:
    metadata:
      labels:
        app: payment-api
        version: v2.1.0
    spec:
      # Security: don't mount service account token unless needed
      automountServiceAccountToken: false
      
      # Spread pods across nodes (anti-affinity)
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - key: app
                    operator: In
                    values: [payment-api]
              topologyKey: kubernetes.io/hostname
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: app
                      operator: In
                      values: [payment-api]
                topologyKey: topology.kubernetes.io/zone
      
      # Spread across AZs
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: payment-api
      
      containers:
        - name: payment-api
          image: 123456789.dkr.ecr.us-east-1.amazonaws.com/payment-api:sha-abc123
          ports:
            - containerPort: 8080
              name: http
          
          # REQUIRED: Resource requests and limits
          resources:
            requests:
              memory: "256Mi"  # Pod is scheduled on a node with this available
              cpu: "250m"      # 0.25 CPU core
            limits:
              memory: "512Mi"  # OOMKilled if exceeds this
              cpu: "500m"      # Throttled if exceeds this
          
          # REQUIRED: Probes
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 3
            # Pod won't receive traffic until this passes
          
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
            # Pod is restarted if this fails 3 times
          
          startupProbe:
            httpGet:
              path: /health
              port: 8080
            failureThreshold: 30
            periodSeconds: 10
            # Gives app 5 minutes to start (30 * 10s)
            # Prevents liveness from killing slow-starting pods
          
          # Security context
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          
          # Environment variables from secrets (not hardcoded)
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: payment-api-secrets
                  key: db-password
            - name: API_KEY
              valueFrom:
                secretKeyRef:
                  name: payment-api-secrets
                  key: api-key
          
          # Non-sensitive config from ConfigMap
          envFrom:
            - configMapRef:
                name: payment-api-config
          
          # Writable directory (since rootfs is read-only)
          volumeMounts:
            - name: tmp-dir
              mountPath: /tmp
            - name: cache-dir
              mountPath: /app/cache
      
      volumes:
        - name: tmp-dir
          emptyDir: {}
        - name: cache-dir
          emptyDir: {}
      
      # Graceful shutdown
      terminationGracePeriodSeconds: 60
```

---

## Pod Disruption Budget (PDB)

```yaml
# kubernetes/pdb.yml
# PodDisruptionBudget: prevent too many pods from going down at once
# Required for: maintenance, node upgrades, cluster autoscaler actions

apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payment-api-pdb
  namespace: production
spec:
  # Keep at least 2 pods running at all times
  minAvailable: 2
  selector:
    matchLabels:
      app: payment-api

---
# Alternative: maxUnavailable approach
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: frontend-pdb
  namespace: production
spec:
  # Allow max 1 pod to be unavailable at any time
  maxUnavailable: 1
  selector:
    matchLabels:
      app: frontend
```

---

## Horizontal Pod Autoscaler (HPA)

```yaml
# kubernetes/hpa.yml
# Scale pods automatically based on CPU, memory, or custom metrics

apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-api-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-api
  
  minReplicas: 3
  maxReplicas: 50
  
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60  # Scale when CPU > 60%
    
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 70  # Scale when memory > 70%
    
    # Custom metric from Prometheus (requests per second per pod)
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "100"  # Scale when > 100 rps per pod
  
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60   # Wait 1 min before scaling up
      policies:
        - type: Pods
          value: 5          # Add at most 5 pods per minute
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5 min before scaling down
      policies:
        - type: Pods
          value: 2          # Remove at most 2 pods per minute
          periodSeconds: 60
```

---

## Resource Quotas and Limit Ranges

```yaml
# kubernetes/namespace-quotas.yml
# Prevent any team from using all cluster resources

apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    # Compute limits
    requests.cpu: "20"         # Total CPU requests in namespace
    requests.memory: 40Gi      # Total memory requests
    limits.cpu: "40"           # Total CPU limits
    limits.memory: 80Gi        # Total memory limits
    
    # Object counts
    pods: "100"                # Max 100 pods
    services: "20"             # Max 20 services
    persistentvolumeclaims: "20"
    secrets: "50"
    configmaps: "50"

---
# LimitRange: default values for containers without requests/limits
apiVersion: v1
kind: LimitRange
metadata:
  name: production-limits
  namespace: production
spec:
  limits:
    - type: Container
      default:             # Applied if no limits specified
        cpu: "500m"
        memory: "512Mi"
      defaultRequest:      # Applied if no requests specified
        cpu: "100m"
        memory: "128Mi"
      max:                 # Container cannot exceed
        cpu: "4"
        memory: "8Gi"
      min:                 # Container must have at least
        cpu: "50m"
        memory: "64Mi"
```

---

## Network Policies (Zero-Trust Networking)

```yaml
# kubernetes/network-policies.yml
# Default: deny all traffic. Explicitly allow only what's needed.

# STEP 1: Deny all ingress and egress in the namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}  # Applies to ALL pods
  policyTypes:
    - Ingress
    - Egress

---
# STEP 2: Allow payment-api to receive from ALB/ingress controller
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-to-payment-api
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: payment-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx  # Only from ingress controller namespace
      ports:
        - port: 8080

---
# STEP 3: Allow payment-api to talk to database
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-payment-api-to-db
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: payment-api
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - port: 5432
    
    # Allow DNS (required for hostname resolution)
    - ports:
        - port: 53
          protocol: UDP

---
# STEP 4: Allow payment-api to talk to external payment gateway
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-payment-api-external
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: payment-api
  policyTypes:
    - Egress
  egress:
    # Allow HTTPS outbound to payment gateway IPs
    - to:
        - ipBlock:
            cidr: "0.0.0.0/0"
            except:
              - "10.0.0.0/8"    # No internal traffic through this rule
              - "172.16.0.0/12"
              - "192.168.0.0/16"
      ports:
        - port: 443
```

---

## RBAC — Role-Based Access Control

```yaml
# kubernetes/rbac.yml
# Least privilege: each team gets only what they need

# ── Developer (read-only in production) ──────────────────────────
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: developer-readonly
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "services", "configmaps", "events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
  # Explicitly NO: secrets, create, delete, patch, update

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: developers-readonly
  namespace: production
subjects:
  - kind: Group
    name: developers       # Comes from OIDC/SSO group claim
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: developer-readonly
  apiGroup: rbac.authorization.k8s.io

---
# ── DevOps Engineer (can deploy, cannot manage cluster) ──────────
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: devops-deployer
  namespace: production
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "update", "patch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "delete"]  # Can delete stuck pods
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "create", "update", "patch"]

---
# ── Service Account (for application pods) ───────────────────────
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-api
  namespace: production
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789:role/payment-api-role
    # IRSA: pod gets AWS credentials via this role (no keys needed)

---
# Service account can only do what payment-api needs
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: payment-api-role
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["payment-api-secrets"]  # Only THIS secret
    verbs: ["get"]
```

---

## OPA Gatekeeper — Policy Enforcement

```yaml
# gatekeeper/constraint-template-required-labels.yml
# Enforce that all deployments have required labels (for compliance)

apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: requirelabels
spec:
  crd:
    spec:
      names:
        kind: RequireLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package requirelabels
        
        violation[{"msg": msg}] {
          provided := {label | input.review.object.metadata.labels[label]}
          required := {label | label := input.parameters.labels[_]}
          missing := required - provided
          count(missing) > 0
          msg := sprintf("Missing required labels: %v", [missing])
        }

---
# Apply the constraint: all deployments must have team and version labels
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: RequireLabels
metadata:
  name: deployment-required-labels
spec:
  match:
    kinds:
      - apiGroups: ["apps"]
        kinds: ["Deployment"]
    namespaces: ["production", "staging"]
  parameters:
    labels: ["team", "version", "app"]
```

```yaml
# gatekeeper/no-latest-tag.yml
# Block :latest image tags in production

apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: nolatesttag
spec:
  crd:
    spec:
      names:
        kind: NoLatestTag
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package nolatesttag
        
        violation[{"msg": msg}] {
          container := input.review.object.spec.template.spec.containers[_]
          endswith(container.image, ":latest")
          msg := sprintf("Container '%v' uses ':latest' tag — use specific version", [container.name])
        }
        
        violation[{"msg": msg}] {
          container := input.review.object.spec.template.spec.containers[_]
          not contains(container.image, ":")
          msg := sprintf("Container '%v' has no tag — use specific version", [container.name])
        }

---
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: NoLatestTag
metadata:
  name: no-latest-in-production
spec:
  match:
    kinds:
      - apiGroups: ["apps"]
        kinds: ["Deployment", "StatefulSet", "DaemonSet"]
    namespaces: ["production"]
```

---

## Cluster Autoscaler (EKS)

```yaml
# kubernetes/cluster-autoscaler.yml
# Automatically add/remove nodes when pods can't be scheduled

apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cluster-autoscaler
  template:
    spec:
      serviceAccountName: cluster-autoscaler
      containers:
        - name: cluster-autoscaler
          image: registry.k8s.io/autoscaling/cluster-autoscaler:v1.29.0
          command:
            - ./cluster-autoscaler
            - --v=4
            - --stderrthreshold=info
            - --cloud-provider=aws
            - --skip-nodes-with-local-storage=false
            - --expander=least-waste    # Choose node group with least wasted resources
            - --node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled=true,k8s.io/cluster-autoscaler/production-cluster=true
            - --balance-similar-node-groups  # Keep node groups balanced
            - --skip-nodes-with-system-pods=false
            - --scale-down-delay-after-add=5m  # Wait 5 min after adding before removing
            - --scale-down-unneeded-time=5m    # Node must be unneeded for 5 min
          env:
            - name: AWS_REGION
              value: us-east-1
          resources:
            limits:
              cpu: 100m
              memory: 600Mi
            requests:
              cpu: 100m
              memory: 600Mi
```

---

## Production Kubernetes — Operational Scripts

```bash
#!/bin/bash
# k8s-production-health-check.sh
# Run this to verify cluster health before major deployments

echo "=== Production Kubernetes Health Check ==="
echo "Time: $(date)"
echo ""

NAMESPACE=${1:-production}
CLUSTER_OK=true

# 1. Check node health
echo "--- Node Health ---"
kubectl get nodes -o wide
NODE_NOT_READY=$(kubectl get nodes | grep -c "NotReady" || true)
if [ "$NODE_NOT_READY" -gt 0 ]; then
  echo "❌ $NODE_NOT_READY nodes are NotReady"
  CLUSTER_OK=false
else
  echo "✅ All nodes Ready"
fi

# 2. Check pod health
echo ""
echo "--- Pod Health ($NAMESPACE) ---"
PODS_NOT_RUNNING=$(kubectl get pods -n $NAMESPACE | grep -v "Running\|Completed" | grep -v "NAME" | wc -l)
if [ "$PODS_NOT_RUNNING" -gt 0 ]; then
  echo "❌ Pods not running:"
  kubectl get pods -n $NAMESPACE | grep -v "Running\|Completed" | grep -v "NAME"
  CLUSTER_OK=false
else
  echo "✅ All pods Running"
fi

# 3. Check HPA status
echo ""
echo "--- HPA Status ---"
kubectl get hpa -n $NAMESPACE
HPA_UNKNOWN=$(kubectl get hpa -n $NAMESPACE | grep "unknown" | wc -l)
if [ "$HPA_UNKNOWN" -gt 0 ]; then
  echo "⚠️  $HPA_UNKNOWN HPAs have unknown metrics (check metrics server)"
fi

# 4. Check PDB compliance
echo ""
echo "--- PodDisruptionBudgets ---"
kubectl get pdb -n $NAMESPACE

# 5. Check resource usage
echo ""
echo "--- Resource Usage ---"
kubectl top nodes 2>/dev/null || echo "⚠️  metrics-server not available"
echo ""
kubectl top pods -n $NAMESPACE --sort-by=memory 2>/dev/null | head -20

# 6. Check recent events (warnings)
echo ""
echo "--- Recent Warning Events (last 1 hour) ---"
kubectl get events -n $NAMESPACE \
  --sort-by='.lastTimestamp' \
  --field-selector type=Warning | tail -20

# 7. Check certificate expiry
echo ""
echo "--- TLS Certificate Expiry ---"
kubectl get certificates -n $NAMESPACE 2>/dev/null || \
  echo "cert-manager not installed"

if [ "$CLUSTER_OK" = true ]; then
  echo ""
  echo "✅ CLUSTER HEALTH: OK — Safe to deploy"
  exit 0
else
  echo ""
  echo "❌ CLUSTER HEALTH: ISSUES FOUND — Investigate before deploying"
  exit 1
fi
```

```bash
#!/bin/bash
# k8s-rollback.sh
# Quick rollback for production incidents
# Goal: < 5 minutes from "problem detected" to "rolled back"

DEPLOYMENT=${1:-payment-api}
NAMESPACE=${2:-production}

echo "=== PRODUCTION ROLLBACK ==="
echo "Deployment: $DEPLOYMENT"
echo "Namespace: $NAMESPACE"
echo "Time: $(date)"
echo ""

# Show rollout history
echo "Rollout history:"
kubectl rollout history deployment/$DEPLOYMENT -n $NAMESPACE

echo ""
read -p "Rollback to previous version? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Rollback cancelled."
  exit 0
fi

START_TIME=$(date +%s)

# Perform rollback
echo "Rolling back..."
kubectl rollout undo deployment/$DEPLOYMENT -n $NAMESPACE

# Wait for rollback to complete
kubectl rollout status deployment/$DEPLOYMENT -n $NAMESPACE --timeout=5m

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "✅ Rollback complete in ${ELAPSED}s"
echo "Current pods:"
kubectl get pods -n $NAMESPACE -l app=$DEPLOYMENT

# Check health after rollback
sleep 10
HEALTH=$(curl -sf http://$DEPLOYMENT.$NAMESPACE.svc.cluster.local:8080/health \
  2>/dev/null | jq -r '.status' 2>/dev/null || echo "unknown")
echo "Service health: $HEALTH"
```

---

## Interview Questions — Production Kubernetes

**Q: What is the difference between liveness and readiness probes?**
```
READINESS PROBE:
  "Is this pod READY to receive traffic?"
  → Kubernetes only sends traffic when readinessProbe passes
  → If it fails: pod stays running but gets removed from Service endpoints
  → Use case: app needs time to load cache/connections before serving traffic
  → Effect: pod is Running but not receiving requests

LIVENESS PROBE:
  "Is this pod still ALIVE (not stuck)?"
  → If it fails 3 times: Kubernetes RESTARTS the pod
  → Use case: detect stuck processes (deadlock, infinite loop)
  → Effect: pod is killed and restarted

STARTUP PROBE (newer):
  "Has the app STARTED YET?"
  → During startup, liveness/readiness don't run — only startup probe
  → Prevents liveness from killing slow-starting apps
  → Once startup probe passes, normal probes take over

Example: Spring Boot app that takes 60 seconds to start:
  startupProbe: checks every 10s, fails after 30 attempts (5 min window)
  livenessProbe: checks every 10s, kills after 3 failures (30s)
  readinessProbe: checks every 5s, removes from service after 3 failures (15s)
```

**Q: What is a Pod Disruption Budget and why does it matter?**
```
PDB = A policy that limits how many pods can be unavailable at once

Why it matters:
  Without PDB: Kubernetes can drain all pods from a node at once
  → Your service goes down during node maintenance/upgrades
  
  With PDB (minAvailable: 2):
  → Kubernetes can only drain 1 pod at a time
  → You always have at least 2 pods serving traffic
  → Node upgrades become zero-downtime events

Example: Payment API with 3 replicas, PDB minAvailable: 2
  → Kubernetes drains node 1: moves pod from node 1 to node 3
  → Waits until pod is Running on node 3
  → Then drains next pod
  → Service never goes below 2 replicas
  
Key interactions:
  PDB + HPA: HPA might conflict with PDB if minReplicas < minAvailable
  PDB + Cluster Autoscaler: Autoscaler respects PDB when removing nodes
  PDB + kubectl drain: drain respects PDB (may block if PDB would be violated)
```

---

[← Hybrid Setup](./03-hybrid-setup.md) | [Next: Complete CI/CD Platform →](./05-complete-cicd-platform.md)
