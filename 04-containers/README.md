# Section 04 — Containers: Docker and Kubernetes

> Containers changed how we deploy software.
> Docker packages your app with everything it needs.
> Kubernetes runs containers at scale in production.

---

## Topics in This Section

| File | Topic | Level |
|------|-------|-------|
| [Docker basics](javascript:dvGo('docker-basics')) | Docker fundamentals | Beginner |
| [Docker advanced](javascript:dvGo('docker-advanced')) | Multi-stage builds, Compose, security | Intermediate |
| [Kubernetes basics](javascript:dvGo('kubernetes-basics')) | Kubernetes concepts and kubectl | Intermediate |
| [Kubernetes production](javascript:dvGo('kubernetes-production')) | Production: HPA, PDB, resource limits | Advanced |
| [Helm.md](javascript:dvGo('helm')) | Helm — Package manager for Kubernetes | Intermediate |

---

## Docker vs Kubernetes — What Is the Difference?

| Docker | Kubernetes |
|--------|-----------|
| Runs containers on one machine | Runs containers across many machines |
| Manual restart if container crashes | Automatically restarts crashed containers |
| Manual scaling | Automatic scaling (HPA) |
| No load balancing | Built-in service discovery and load balancing |
| Good for development | Good for production |

**In practice:** Use Docker to build images, use Kubernetes to run them at scale.

---

## The Container Journey

```
Developer writes code
        ↓
Dockerfile defines how to build the image
        ↓
docker build creates a Docker image
        ↓
Image is pushed to a registry (ECR, GHCR, Docker Hub)
        ↓
Kubernetes pulls the image and runs it as a Pod
        ↓
Service exposes the Pod to other Pods or the internet
        ↓
Deployment manages rolling updates and rollbacks
```

---

[← Back to Main](../README.md) | [Next: IaC →](../05-iac/README.md)
