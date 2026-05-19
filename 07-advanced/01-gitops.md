# GitOps — Git as the Single Source of Truth

> In GitOps, the desired state of your infrastructure and applications
> is stored in Git. A GitOps operator continuously ensures the actual
> state matches the desired state in Git.

---

## GitOps Principles

```
1. Declarative  → describe WHAT you want, not HOW to do it
2. Versioned    → all changes tracked in Git with history
3. Automatic    → the system applies changes automatically
4. Reconciled   → system continuously checks and fixes drift
```

---

## Traditional CD vs GitOps

```
Traditional (push-based):
Developer → CI pipeline → kubectl apply → cluster

GitOps (pull-based):
Developer → git push → ArgoCD/FluxCD reads Git → cluster
                       ArgoCD WATCHES Git and PULLS changes
```

**Why GitOps is better:**
- No credentials in CI pipeline (ArgoCD inside cluster)
- Complete audit trail (every change is a Git commit)
- Easy rollback (just revert the Git commit)
- Drift detection (alerts if cluster differs from Git)

---

## ArgoCD — GitOps for Kubernetes

```bash
# Install ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for ArgoCD to be ready
kubectl wait --for=condition=available --timeout=300s \
    deployment/argocd-server -n argocd

# Get admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
    -o jsonpath="{.data.password}" | base64 -d

# Access UI
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Open: https://localhost:8080
# User: admin, Pass: (from above)

# Install ArgoCD CLI
curl -sSL -o argocd-linux-amd64 https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x argocd-linux-amd64
sudo mv argocd-linux-amd64 /usr/local/bin/argocd

# Login
argocd login localhost:8080
```

---

## ArgoCD Application — Deploy from Git

```yaml
# argocd-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-api-production
  namespace: argocd
spec:
  project: default

  # Source: your Git repository
  source:
    repoURL: https://github.com/mycompany/infrastructure
    targetRevision: main         # branch or tag
    path: kubernetes/production  # directory with K8s manifests

  # Destination: where to deploy
  destination:
    server: https://kubernetes.default.svc  # in-cluster
    namespace: production

  # Sync policy
  syncPolicy:
    automated:
      prune: true       # delete resources removed from Git
      selfHeal: true    # fix drift automatically
      allowEmpty: false # don't delete everything if directory is empty

    syncOptions:
      - CreateNamespace=true
      - PruneLast=true           # delete old resources last (safe)
      - RespectIgnoreDifferences=true

    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

```bash
# Apply the application
kubectl apply -f argocd-app.yaml

# Check status
argocd app get my-api-production
argocd app list

# Sync manually (force)
argocd app sync my-api-production

# Rollback to previous version
argocd app history my-api-production
argocd app rollback my-api-production <revision-number>
```

---

## GitOps Repository Structure

```
infrastructure/
├── kubernetes/
│   ├── base/                    # common resources
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── hpa.yaml
│   ├── overlays/
│   │   ├── staging/             # staging-specific overrides
│   │   │   ├── kustomization.yaml
│   │   │   └── patches/
│   │   │       └── replicas.yaml
│   │   └── production/          # production-specific overrides
│   │       ├── kustomization.yaml
│   │       └── patches/
│   │           └── replicas.yaml
├── apps/
│   ├── my-api/
│   │   ├── Chart.yaml
│   │   ├── values.yaml          # common values
│   │   ├── values.staging.yaml  # staging values
│   │   └── values.production.yaml  # production values
└── argocd/
    ├── projects/
    └── applications/
```

---

## Kustomize — Manage Kubernetes Overlays

```yaml
# base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml
  - hpa.yaml

commonLabels:
  app: my-api
  managed-by: argocd

commonAnnotations:
  app.kubernetes.io/version: "1.5.0"
```

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

bases:
  - ../../base

patchesStrategicMerge:
  - patches/replicas.yaml
  - patches/resources.yaml

images:
  - name: registry.mycompany.com/my-api
    newTag: v1.5.0    # update image tag here!

namespace: production
```

```yaml
# overlays/production/patches/replicas.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-api
spec:
  replicas: 5    # production has 5 replicas, staging has 2
```

---

## Complete GitOps Workflow

```
1. Developer pushes code to GitHub
   ↓
2. GitHub Actions CI runs:
   - Tests
   - Build Docker image: my-api:abc123f
   - Push image to registry
   - Update image tag in Git:
     sed -i "s|newTag:.*|newTag: abc123f|" overlays/production/kustomization.yaml
     git commit -m "ci: update my-api to abc123f"
     git push
   ↓
3. ArgoCD detects Git change (every 3 minutes or webhook)
   ↓
4. ArgoCD compares Git state vs cluster state
   ↓
5. ArgoCD applies changes (kubectl apply)
   ↓
6. Kubernetes rolling update
   ↓
7. ArgoCD reports: Synced, Healthy ✅
```

---

## Update Image Tag from CI

```bash
# In CI pipeline (GitHub Actions or Jenkins)
# After building and pushing the Docker image:

NEW_TAG="${GITHUB_SHA:0:8}"
IMAGE="registry.mycompany.com/my-api:${NEW_TAG}"

# Clone the infrastructure repo
git clone git@github.com:mycompany/infrastructure.git
cd infrastructure

# Update the image tag
sed -i "s|newTag:.*|newTag: ${NEW_TAG}|" \
    kubernetes/overlays/production/kustomization.yaml

# Commit and push
git config user.email "ci@mycompany.com"
git config user.name "CI Pipeline"
git add .
git commit -m "ci: deploy my-api ${NEW_TAG} to production"
git push origin main

# ArgoCD will pick this up automatically!
```

---

## ArgoCD ApplicationSet — Multiple Apps at Once

```yaml
# applicationset.yaml — deploy to multiple clusters
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: all-apps
  namespace: argocd
spec:
  generators:
    - matrix:
        generators:
          - git:
              repoURL: https://github.com/mycompany/infrastructure
              revision: main
              directories:
                - path: apps/*
          - clusters:
              selector:
                matchLabels:
                  environment: production

  template:
    metadata:
      name: '{{path.basename}}-{{name}}'
    spec:
      project: production
      source:
        repoURL: https://github.com/mycompany/infrastructure
        targetRevision: main
        path: '{{path}}'
      destination:
        server: '{{server}}'
        namespace: '{{path.basename}}'
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

---

## Interview Questions — GitOps

**Q: What is GitOps and why is it better than traditional CI/CD?**
> "GitOps uses Git as the single source of truth for infrastructure and application
> state. Instead of a CI pipeline pushing changes with kubectl, an operator like ArgoCD
> runs inside the cluster and continuously pulls the desired state from Git. The benefits
> are: no pipeline credentials needed inside the cluster, complete audit trail in Git,
> easy rollback (just revert), and automatic drift correction. If someone manually changes
> something in the cluster, ArgoCD reverts it to match Git."

**Q: How do you handle secrets in GitOps? You can't commit secrets to Git.**
> "I use Sealed Secrets or External Secrets Operator. With External Secrets, secrets are
> stored in AWS Secrets Manager and the operator syncs them into Kubernetes Secrets
> automatically. The Git repository only has the ExternalSecret CR — which references the
> AWS secret by name, not the actual value. Secrets rotate in AWS Secrets Manager, and
> the operator picks up the new value without any Git change."

---

[← Back to Section](./README.md) | [Next: Microservices →](./02-microservices-devops.md)
