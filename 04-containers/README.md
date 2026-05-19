# Section 04 — Containers: Docker and Kubernetes

> Containers changed how we deploy software.
> Docker packages your app with everything it needs.
> Kubernetes runs containers at scale in production.

---

## Topics in This Section

| File | Topic | Level |
|------|-------|-------|
| [01-docker-basics.md](./01-docker-basics.md) | Docker fundamentals | Beginner |
| [02-docker-advanced.md](./02-docker-advanced.md) | Multi-stage builds, Compose, security | Intermediate |
| [03-kubernetes-basics.md](./03-kubernetes-basics.md) | Kubernetes concepts and kubectl | Intermediate |
| [04-kubernetes-production.md](./04-kubernetes-production.md) | Production: HPA, PDB, resource limits | Advanced |
| [05-helm.md](./05-helm.md) | Helm — Package manager for Kubernetes | Intermediate |

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
