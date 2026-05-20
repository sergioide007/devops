# Section 04 — Containers: Docker and Kubernetes

> Containers changed how we deploy software.
> Docker packages your app with everything it needs.
> Kubernetes runs containers at scale in production.

---

## Topics in This Section

| Guide | Content | Level |
|-------|---------|-------|
| [Docker Basics](javascript:dvGo('docker-basics')) | Images, Dockerfile, volumes, networking, multi-stage builds | Beginner |
| [Kubernetes Basics](javascript:dvGo('kubernetes-basics')) | Components, objects, kubectl, YAML, HPA, debugging, interview Q&A | Intermediate |

---

## What You Learn in Kubernetes Basics

The Kubernetes guide covers everything interviewers actually ask:

- **Cluster components** — Control Plane (apiserver, etcd, scheduler, controller-manager) and Worker Node (kubelet, kube-proxy, container runtime) with a full diagram
- **Object hierarchy** — Namespace → Deployment → ReplicaSet → **Pod** (smallest deployable unit) → Container
- **Entering a container** — `kubectl exec -it <pod> -- bash/sh`, what to do inside, debug technique for crashing containers
- **Reading logs** — `kubectl logs`, `--previous`, `--follow`, multi-container pods, label selectors
- **Debugging CrashLoopBackOff** — exit codes, OOMKilled, liveness vs readiness probes
- **HPA, rolling updates, zero-downtime deploys** — full YAML examples with explained fields
- **Interview Q&A** — Pod vs Deployment, rolling updates, secrets, ConfigMaps

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
docker build → Docker image
        ↓
Image pushed to registry (AWS ECR, GHCR, Docker Hub)
        ↓
Kubernetes pulls image → runs it as a Pod
        ↓
Service exposes the Pod (ClusterIP / LoadBalancer / NodePort)
        ↓
Deployment manages rolling updates and rollbacks
        ↓
HPA scales pods up/down based on CPU/memory
```

---

[← Back to Main](/) | [Next: IaC →](/iac/)
