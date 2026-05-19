# Kubernetes Basics

> Kubernetes (K8s) is the industry standard for running containers in production.
> It handles scheduling, scaling, healing, and networking automatically.

---

## Core Concepts

```
Cluster       → one or more machines running Kubernetes
  ├── Control Plane (master)
  │   ├── API Server       → accepts kubectl commands
  │   ├── etcd             → database of cluster state
  │   ├── Scheduler        → decides which node runs a Pod
  │   └── Controller Manager → keeps desired state
  └── Nodes (workers)
      ├── kubelet          → runs on each node, manages Pods
      ├── kube-proxy       → manages networking
      └── Container Runtime → Docker / containerd
```

```
Pod         → smallest unit, runs 1+ containers
Deployment  → manages Pods, handles rolling updates
Service     → stable network endpoint for Pods
ConfigMap   → non-secret configuration
Secret      → sensitive data (passwords, tokens)
Namespace   → isolation between environments
Ingress     → HTTP/HTTPS routing into the cluster
```

---

## Install kubectl and Connect to Cluster

```bash
# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# Connect to AWS EKS cluster
aws eks update-kubeconfig --name my-cluster --region us-east-1

# Connect to local cluster (minikube or kind)
minikube start
kind create cluster

# Check connection
kubectl cluster-info
kubectl get nodes
kubectl get nodes -o wide   # more details
```

---

## Essential kubectl Commands

```bash
# ── Cluster info ──────────────────────────────────────────
kubectl cluster-info
kubectl get all -A                    # all resources in all namespaces

# ── Namespaces ────────────────────────────────────────────
kubectl get namespaces
kubectl create namespace staging
kubectl delete namespace old-staging

# Set default namespace (so you don't type -n every time)
kubectl config set-context --current --namespace=production

# ── Pods ──────────────────────────────────────────────────
kubectl get pods
kubectl get pods -n production
kubectl get pods -o wide              # shows node, IP
kubectl get pods -w                   # watch for changes

# Describe a pod (shows events, reason for failure)
kubectl describe pod my-api-abc123

# View logs
kubectl logs my-api-abc123
kubectl logs my-api-abc123 -f         # follow
kubectl logs my-api-abc123 --previous # last crashed container
kubectl logs -l app=my-api            # all pods with label

# Execute command in pod
kubectl exec -it my-api-abc123 -- bash
kubectl exec -it my-api-abc123 -- sh  # Alpine containers
kubectl exec my-api-abc123 -- env     # list env vars

# Port forward (access a pod locally without exposing it)
kubectl port-forward pod/my-api-abc123 8080:8080
kubectl port-forward svc/my-api 8080:80

# ── Deployments ───────────────────────────────────────────
kubectl get deployments
kubectl describe deployment my-api
kubectl rollout status deployment/my-api
kubectl rollout history deployment/my-api

# Scale
kubectl scale deployment my-api --replicas=5

# Update image
kubectl set image deployment/my-api my-api=registry/my-api:v1.5.0

# Rollback
kubectl rollout undo deployment/my-api
kubectl rollout undo deployment/my-api --to-revision=2

# ── Services ──────────────────────────────────────────────
kubectl get services
kubectl describe service my-api

# ── Apply / Delete ─────────────────────────────────────────
kubectl apply -f deployment.yaml
kubectl apply -f ./k8s/                  # apply all files in directory
kubectl delete -f deployment.yaml
kubectl delete pod my-api-abc123
```

---

## Core YAML Files

### Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-api
  namespace: production
  labels:
    app: my-api
    version: v1.5.0
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1           # one extra pod during update
      maxUnavailable: 0     # never take pods down before new ones are ready
  template:
    metadata:
      labels:
        app: my-api
        version: v1.5.0
    spec:
      containers:
        - name: my-api
          image: registry.mycompany.com/my-api:v1.5.0
          ports:
            - containerPort: 8080
          env:
            - name: APP_ENV
              value: production
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: url
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
      terminationGracePeriodSeconds: 60  # wait 60s for graceful shutdown
```

### Service

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: my-api
  namespace: production
spec:
  selector:
    app: my-api
  ports:
    - name: http
      protocol: TCP
      port: 80            # port on the Service
      targetPort: 8080    # port on the Pod
  type: ClusterIP         # internal only (most common)
  # type: LoadBalancer    # creates AWS ELB
  # type: NodePort        # accessible on each node's IP
```

### Ingress (HTTP routing)

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-api-ingress
  namespace: production
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
spec:
  tls:
    - hosts:
        - api.mycompany.com
      secretName: api-tls-cert
  rules:
    - host: api.mycompany.com
      http:
        paths:
          - path: /v1/users
            pathType: Prefix
            backend:
              service:
                name: user-service
                port:
                  number: 80
          - path: /v1/payments
            pathType: Prefix
            backend:
              service:
                name: payment-service
                port:
                  number: 80
```

### ConfigMap and Secret

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-api-config
  namespace: production
data:
  APP_ENV: "production"
  LOG_LEVEL: "info"
  MAX_CONNECTIONS: "100"
  nginx.conf: |
    server {
        listen 80;
        location / {
            proxy_pass http://localhost:8080;
        }
    }
---
# secret.yaml — values must be base64 encoded
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: production
type: Opaque
data:
  url: cG9zdGdyZXM6Ly91c2VyOnBhc3NAZGIuaW50ZXJuYWw=  # base64
  password: c3VwZXJzZWNyZXQ=

# Encode/decode
echo -n "postgres://user:pass@db.internal" | base64
echo "cG9zdGdyZXM6Ly91c2VyOnBhc3NAZGIuaW50ZXJuYWw=" | base64 -d

# Better: use External Secrets Operator (pulls from AWS Secrets Manager)
```

---

## Horizontal Pod Autoscaler (HPA)

```yaml
# hpa.yaml — scale based on CPU/memory
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-api-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70   # scale when CPU > 70%
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

```bash
# Apply HPA
kubectl apply -f hpa.yaml

# Watch HPA in action
kubectl get hpa -n production -w
kubectl describe hpa my-api-hpa -n production
```

---

## Namespaces and Resource Quotas

```yaml
# namespace-quota.yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    requests.cpu: "10"
    requests.memory: "20Gi"
    limits.cpu: "20"
    limits.memory: "40Gi"
    pods: "50"
    services: "20"
    secrets: "100"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: production
spec:
  limits:
    - default:          # default limit if not specified
        memory: "256Mi"
        cpu: "500m"
      defaultRequest:   # default request if not specified
        memory: "128Mi"
        cpu: "100m"
      type: Container
```

---

## Debugging in Kubernetes

```bash
# Pod is in Pending state
kubectl describe pod my-pod
# Look for: "Events:" section at the bottom
# Common reasons:
# - Insufficient resources → add nodes or reduce requests
# - Node selector not matching → check node labels
# - PVC not bound → check storage

# Pod is in CrashLoopBackOff
kubectl logs my-pod --previous    # logs from previous crash
kubectl describe pod my-pod       # check for OOMKilled, exit codes

# Service not reachable
# Step 1: check if pods are running
kubectl get pods -l app=my-api
# Step 2: check endpoints
kubectl get endpoints my-api
# Step 3: test from inside cluster
kubectl run debug --rm -it --image=alpine -- sh
# Inside: wget -qO- http://my-api.production.svc.cluster.local/health

# Image pull error
kubectl describe pod my-pod | grep "Failed to pull image"
# Check: image name, tag, registry credentials

# Secret for private registry
kubectl create secret docker-registry regcred \
    --docker-server=myregistry.com \
    --docker-username=user \
    --docker-password=password

# In Pod spec:
spec:
  imagePullSecrets:
    - name: regcred
```

---

## EKS — Kubernetes on AWS

```bash
# Create EKS cluster with eksctl
eksctl create cluster \
    --name production-cluster \
    --region us-east-1 \
    --nodegroup-name standard-workers \
    --node-type m5.xlarge \
    --nodes 3 \
    --nodes-min 2 \
    --nodes-max 10 \
    --managed

# Create cluster with Fargate (serverless nodes)
eksctl create cluster \
    --name serverless-cluster \
    --region us-east-1 \
    --fargate

# Add node group
eksctl create nodegroup \
    --cluster production-cluster \
    --name gpu-workers \
    --node-type p3.2xlarge \
    --nodes 2

# Update kubeconfig
aws eks update-kubeconfig --name production-cluster --region us-east-1

# EKS with Terraform (production recommended)
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "production-cluster"
  cluster_version = "1.30"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets

  eks_managed_node_groups = {
    general = {
      instance_types = ["m5.large"]
      min_size       = 2
      max_size       = 10
      desired_size   = 3
    }
  }

  enable_cluster_creator_admin_permissions = true
}
```

---

## Interview Questions — Kubernetes

**Q: What is the difference between a Pod and a Deployment?**
> "A Pod is a single running instance of a container (or multiple containers). It is
> ephemeral — if it crashes, it is gone. A Deployment is a controller that manages
> a set of Pods — it ensures the desired number of replicas is always running. If a
> Pod crashes, the Deployment automatically creates a new one. I always use Deployments
> (never bare Pods) in production."

**Q: How does rolling update work in Kubernetes?**
> "When you update a Deployment, Kubernetes uses the rolling update strategy. It creates
> new Pods with the new version while keeping old Pods running. With maxSurge=1 and
> maxUnavailable=0, it adds one new Pod, waits for it to be ready, then removes one old
> Pod. This continues until all Pods are updated. Traffic is never interrupted. If the
> rollout fails, I use `kubectl rollout undo` to go back instantly."

**Q: How do you handle configuration and secrets in Kubernetes?**
> "Configuration goes in ConfigMaps — non-sensitive values like feature flags, URLs,
> timeouts. Secrets hold sensitive data like passwords and API keys — they are base64
> encoded but not encrypted by default. In production, I use the External Secrets Operator
> to sync secrets from AWS Secrets Manager into Kubernetes Secrets — this way secrets are
> managed centrally, rotated automatically, and never stored in Git."

---

[← Back to Section](./README.md) | [Next: Kubernetes Production →](./04-kubernetes-production.md)
