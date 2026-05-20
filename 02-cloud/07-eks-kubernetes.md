# EKS — Kubernetes on AWS

> **Level:** Advanced
> **Prerequisites:** AWS Overview, IAM, VPC, Containers & Kubernetes
> **You will learn:** EKS cluster setup, node groups, IRSA, kubectl config, Helm, Ingress, HPA, Terraform

---

## What is EKS?

EKS (Elastic Kubernetes Service) is AWS-managed Kubernetes. AWS runs the control plane (API server, etcd, scheduler) — you only manage the worker nodes.

```
EKS Architecture:

AWS-managed Control Plane:
  API Server ─── etcd (HA, 3 AZs)
       │
       ▼
Your Worker Nodes (EC2 or Fargate):
  Node Group A (us-east-1a):  [Pod] [Pod] [Pod]
  Node Group B (us-east-1b):  [Pod] [Pod] [Pod]
  Node Group C (us-east-1c):  [Pod] [Pod] [Pod]
       │
       ▼
  Load Balancer (ALB Ingress / NLB)
       │
       ▼
    Internet
```

---

## Create an EKS Cluster

### Via eksctl (quickest)

```bash
# Install eksctl
curl --silent --location \
  "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" \
  | tar xz -C /usr/local/bin

# Create cluster (production-ready: multi-AZ, managed node group)
eksctl create cluster \
  --name production-cluster \
  --region us-east-1 \
  --nodegroup-name standard-workers \
  --node-type m6i.large \
  --nodes 3 \
  --nodes-min 2 \
  --nodes-max 10 \
  --managed \
  --asg-access \
  --with-oidc   # Required for IRSA

# Configure kubectl
aws eks update-kubeconfig \
  --name production-cluster \
  --region us-east-1

# Verify
kubectl get nodes
kubectl get pods -A
```

---

## Terraform: Production EKS

```hcl
# terraform/eks.tf

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "production-cluster"
  cluster_version = "1.30"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Enable OIDC provider for IRSA
  enable_irsa = true

  # Cluster access
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  eks_managed_node_groups = {
    general = {
      name           = "general-workers"
      instance_types = ["m6i.large"]

      min_size     = 2
      max_size     = 10
      desired_size = 3

      labels = {
        role = "general"
      }

      taints = []

      update_config = {
        max_unavailable_percentage = 33   # rolling update
      }
    }

    spot = {
      name           = "spot-workers"
      instance_types = ["m6i.large", "m5.large", "m5a.large"]
      capacity_type  = "SPOT"

      min_size     = 0
      max_size     = 20
      desired_size = 2

      labels = {
        role     = "spot"
        workload = "non-critical"
      }

      taints = [{
        key    = "spot"
        value  = "true"
        effect = "NO_SCHEDULE"
      }]
    }
  }

  tags = {
    Environment = "production"
    Terraform   = "true"
  }
}
```

---

## IRSA — IAM Roles for Service Accounts

IRSA lets a Kubernetes pod assume an AWS IAM role without storing credentials anywhere. The pod gets temporary tokens via the EKS OIDC provider.

```hcl
# terraform/irsa.tf — give the payments pod access to DynamoDB

data "aws_iam_policy_document" "payments_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:production:payments-sa"]
    }
  }
}

resource "aws_iam_role" "payments" {
  name               = "eks-payments-role"
  assume_role_policy = data.aws_iam_policy_document.payments_assume.json
}

resource "aws_iam_role_policy" "payments_dynamodb" {
  name = "payments-dynamodb"
  role = aws_iam_role.payments.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
      Resource = aws_dynamodb_table.payments.arn
    }]
  })
}
```

```yaml
# k8s/payments-sa.yaml
# The ServiceAccount annotation connects to the IAM role

apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-sa
  namespace: production
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/eks-payments-role
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-service
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payments
  template:
    spec:
      serviceAccountName: payments-sa   # link to the annotated SA
      containers:
        - name: payments
          image: registry/payments:v2.0.0
          # No AWS credentials needed — IRSA injects temporary tokens
          env:
            - name: PAYMENTS_TABLE
              value: "payments-production"
            - name: AWS_DEFAULT_REGION
              value: "us-east-1"
```

---

## ALB Ingress Controller

```bash
# Install AWS Load Balancer Controller (manages ALB/NLB from Kubernetes)

# 1. Create IAM policy
aws iam create-policy \
  --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json

# 2. Create service account with IRSA
eksctl create iamserviceaccount \
  --cluster=production-cluster \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --attach-policy-arn=arn:aws:iam::123456789012:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# 3. Install via Helm
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --namespace kube-system \
  --set clusterName=production-cluster \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

```yaml
# k8s/ingress.yaml — creates an ALB automatically

apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: production
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-1:123456789012:certificate/abc
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
spec:
  rules:
    - host: api.myapp.com
      http:
        paths:
          - path: /payments
            pathType: Prefix
            backend:
              service:
                name: payments-service
                port:
                  number: 8080
          - path: /accounts
            pathType: Prefix
            backend:
              service:
                name: accounts-service
                port:
                  number: 8080
```

---

## HPA — Horizontal Pod Autoscaler

```yaml
# k8s/hpa.yaml

apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payments-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payments-service
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 4
          periodSeconds: 60   # add max 4 pods per minute
    scaleDown:
      stabilizationWindowSeconds: 300   # wait 5 min before scaling down
```

---

## Cluster Autoscaler (Node Scaling)

```bash
# Install Cluster Autoscaler — scales EC2 node groups when pods are pending

helm repo add autoscaler https://kubernetes.github.io/autoscaler

helm install cluster-autoscaler autoscaler/cluster-autoscaler \
  --namespace kube-system \
  --set autoDiscovery.clusterName=production-cluster \
  --set awsRegion=us-east-1 \
  --set rbac.serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=\
        arn:aws:iam::123456789012:role/cluster-autoscaler-role
```

---

## Useful kubectl Commands for EKS

```bash
# Switch between clusters
kubectl config get-contexts
kubectl config use-context arn:aws:eks:us-east-1:123456789012:cluster/production-cluster

# Node info
kubectl get nodes -o wide
kubectl describe node ip-10-0-1-100.ec2.internal
kubectl top nodes

# Pod troubleshooting
kubectl get pods -n production -o wide
kubectl describe pod payments-service-abc123 -n production
kubectl logs payments-service-abc123 -n production --previous
kubectl exec -it payments-service-abc123 -n production -- /bin/sh

# Check IRSA token
kubectl exec -it payments-service-abc123 -n production -- \
  cat /var/run/secrets/eks.amazonaws.com/serviceaccount/token | \
  cut -d. -f2 | base64 -d | python3 -m json.tool

# Events (useful for debugging pending pods)
kubectl get events -n production --sort-by='.lastTimestamp'

# Force node restart for rolling updates
kubectl drain ip-10-0-1-100.ec2.internal --ignore-daemonsets --delete-emptydir-data
kubectl uncordon ip-10-0-1-100.ec2.internal
```

---

## Interview Questions

**Q: What is IRSA and why is it better than storing AWS credentials?**
> IRSA (IAM Roles for Service Accounts) lets pods get temporary AWS credentials through the EKS OIDC provider. Compared to stored credentials: tokens expire automatically (no rotation needed), access is scoped to the specific pod's service account, and credentials never appear in environment variables or config files. If a pod is compromised, the attacker only has access until the token expires (typically 1 hour).

**Q: A pod is stuck in Pending. How do you debug it?**
> `kubectl describe pod <name>` → check Events section. Common causes: (1) Insufficient CPU/memory — nodes don't have capacity (cluster autoscaler might be slow to provision). (2) Taints: pod doesn't have the right tolerations. (3) Node affinity/anti-affinity rules. (4) PVC not bound. For (1), check `kubectl get nodes` and `kubectl top nodes`.

**Q: How do you do a zero-downtime deployment on EKS?**
> Use RollingUpdate strategy with `maxUnavailable: 0` and `maxSurge: 1`. Also: add readiness probes so traffic only goes to healthy pods, use PodDisruptionBudgets to prevent too many pods going down simultaneously, and set `terminationGracePeriodSeconds` to handle in-flight requests.

---

[← Lambda](./06-lambda-serverless.md) | [Back to Section](./README.md) | [Next: CloudWatch →](./08-cloudwatch-monitoring.md)
