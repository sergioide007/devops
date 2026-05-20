# Technical Interview Questions — DevOps Senior

> 60+ real interview questions with complete answers.
> Study these, but also know the WHY behind each answer.

---

## Section 1: Linux and Systems

**Q1: A production server is using 100% CPU. What do you do?**

```bash
# Step 1: Find what is using CPU
top -b -n 1 | head -20
# or
ps aux --sort=-%cpu | head -10

# Step 2: Get more info about the process
PID=1234
lsof -p $PID | head -20      # what files it has open
strace -p $PID -c             # what system calls it's making
cat /proc/$PID/status

# Step 3: Check if it's a known issue
journalctl -u my-service -n 50 --no-pager

# Step 4: If safe, kill and restart
systemctl restart my-service

# Step 5: Root cause analysis
# - Was there a deployment?
# - Is it an infinite loop? (strace shows the pattern)
# - Memory leak? (check memory over time)
# - Are there too many requests? (check access logs)
```

**Answer in interview:**
> "First, I use `top` or `htop` to identify the process consuming CPU. Then I check
> application logs and recent deployments. If it's an application bug, I restart the
> service while investigating the root cause. I use `strace` to see system call patterns
> for obscure issues. I check if it correlates with traffic spikes — if so, it might be
> a scaling problem, not a bug."

---

**Q2: What is the difference between a process and a thread?**

> "A process is an independent program with its own memory space and resources.
> Threads are lighter units of execution within a process — they share the same
> memory space. In DevOps, this matters for performance tuning: a Node.js app is
> single-threaded, so CPU-bound work blocks everything — use worker threads or
> multiple processes. A Java Spring Boot app uses threads, so you need to size
> the thread pool correctly for high concurrency."

---

**Q3: What is the difference between TCP and UDP? When do you use each?**

> "TCP is reliable — it confirms every packet, guarantees order, retransmits if lost.
> UDP is fast — no confirmation, no guaranteed order. TCP is for: HTTP/HTTPS, databases,
> SSH, anything where you cannot lose data. UDP is for: DNS queries (fast, small),
> video streaming (a lost frame is fine), VoIP, gaming. In IoT and drone telemetry,
> I sometimes use UDP for high-frequency position data because a 10ms-old position
> is better than waiting for a TCP retransmit."

---

## Section 2: Docker and Containers

**Q4: A Docker container is starting but immediately exits. How do you debug it?**

```bash
# Check exit code and logs
docker ps -a                           # see exit code
docker logs my-container              # see what it printed before dying
docker logs my-container 2>&1         # stderr too

# Run interactively to debug
docker run -it --entrypoint bash my-image
# Now you're inside — check what's wrong

# If it exits too fast to attach
docker run my-image sleep 3600        # override command to keep it alive
# Now attach in another terminal:
docker exec -it <container-id> bash

# Check if the process is finding its dependencies
docker run my-image ldd /app/my-binary   # check linked libraries
```

**Common causes:**
- Missing environment variable (crashes on startup)
- Config file not found
- Port already in use
- Permissions issue (running as root vs non-root)
- Crash in application code

---

**Q5: What is the difference between COPY and ADD in a Dockerfile?**

> "Both copy files into the image. `COPY` is simpler and preferred — it copies files
> or directories. `ADD` has extra features: it auto-extracts tar archives and can
> copy from URLs. The rule is: use `COPY` unless you specifically need tar extraction.
> `ADD` is less predictable — a URL could change, a tar could contain unexpected files."

---

## Section 3: Kubernetes

**Q6: A pod is in CrashLoopBackOff. Walk me through debugging it.**

```bash
# Step 1: What is the pod doing?
kubectl describe pod my-pod -n production
# Look at: Events section, State, Last State, Exit Code

# Exit codes:
# 0   → success (should not crash loop with 0)
# 1   → general error
# 137 → killed by OOM (out of memory) or SIGKILL
# 143 → SIGTERM (graceful kill, often from readiness probe failure)

# Step 2: Logs of current container
kubectl logs my-pod -n production

# Step 3: Logs of PREVIOUS container (before it crashed)
kubectl logs my-pod -n production --previous

# Step 4: If OOMKilled (exit code 137)
kubectl describe pod my-pod | grep -A5 "OOMKilled"
# Solution: increase memory limit or fix memory leak

# Step 5: If liveness probe failing
# Check: is the health endpoint working?
kubectl exec -it my-pod -- wget -qO- http://localhost:8080/health
```

---

**Q7: What is the difference between a liveness probe and a readiness probe?**

> "A liveness probe tells Kubernetes whether the container is alive. If it fails,
> Kubernetes restarts the container. Use it to detect deadlocks or zombie states
> where the process is running but not doing useful work.
>
> A readiness probe tells Kubernetes whether the container is ready to receive traffic.
> If it fails, the container is removed from the Service endpoints — it doesn't receive
> traffic — but it is NOT restarted. Use it for startup time (wait until DB connection
> is established) and temporary overload (reduce traffic when busy).
>
> I always configure both. The readiness probe prevents traffic to a starting container.
> The liveness probe restarts containers that are truly stuck."

---

**Q8: How do you do a zero-downtime deployment in Kubernetes?**

```yaml
# Key settings in Deployment:
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # one extra pod during update
      maxUnavailable: 0  # never reduce below desired count

  template:
    spec:
      containers:
        - readinessProbe:        # must be configured!
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5

      terminationGracePeriodSeconds: 60  # time to finish in-flight requests
```

> "With maxUnavailable: 0, Kubernetes never removes an old pod until a new one is
> ready. The readiness probe is critical — without it, Kubernetes considers the pod
> ready immediately and routes traffic before the app has started. I also set
> terminationGracePeriodSeconds to give the app time to finish in-flight requests
> before being terminated. The app must handle SIGTERM and stop accepting new
> connections while finishing existing ones."

---

## Section 4: CI/CD

**Q9: What is the difference between continuous delivery and continuous deployment?**

> "Continuous delivery means code is always in a deployable state and can be released
> to production at any time, but deployment is triggered manually. There's a human
> approval step. Continuous deployment goes one step further — every change that passes
> all tests is deployed to production automatically, no human approval. I implement
> continuous delivery for regulated environments like banking (PCI-DSS requires
> change approval) and continuous deployment for internal services or feature flags."

---

**Q10: How do you handle a failed deployment in production?**

```bash
# Option 1: Kubernetes rollback (fastest)
kubectl rollout undo deployment/my-api -n production
kubectl rollout status deployment/my-api -n production

# Verify it rolled back correctly
kubectl rollout history deployment/my-api -n production
kubectl get pods -n production -w

# Option 2: Re-deploy previous version via CI
git revert HEAD
git push origin main
# Let the pipeline re-deploy the previous commit

# Option 3: Feature flags (safest)
# If you use feature flags, just disable the flag
# No deployment needed
```

**Communication during incident:**
> "I immediately notify the team in Slack: 'Production issue detected, investigating'.
> I don't wait until I know the root cause. If the deployment is clearly the cause,
> I rollback immediately — it's faster than debugging live. After rollback, I confirm
> with metrics that the issue is resolved. Then I investigate root cause in a non-urgent
> environment and fix it properly before re-deploying."

---

## Section 5: AWS and Cloud

**Q11: Design a highly available web application on AWS.**

```
Architecture:

Internet
    ↓
Route 53 (DNS with health checks)
    ↓
CloudFront (CDN, edge caching)
    ↓
Application Load Balancer (across 2 AZs)
    ↓
Auto Scaling Group
  EC2/EKS in Private Subnets (AZ a, AZ b)
    ↓
RDS Aurora Multi-AZ (primary + standby)
ElastiCache Redis (clustered across AZs)
    ↓
S3 (static assets, backups)
```

> "I deploy across at least 2 AZs. The ALB distributes traffic across AZs. Auto Scaling
> adds or removes EC2 instances based on CPU. RDS Multi-AZ provides automatic failover
> in under 2 minutes if the primary fails. ElastiCache in cluster mode means if one
> Redis node fails, traffic routes to another. Route 53 health checks redirect DNS
> away from a region if it fails completely. This gives us ~99.99% availability."

---

**Q12: What is the difference between SQS and SNS?**

> "SNS is a pub/sub service — you publish to a topic and all subscribers receive the
> message. One publisher, multiple subscribers. SQS is a queue — messages wait until
> a consumer pulls them. One producer, one consumer (or competing consumers).
>
> I use SNS when multiple services need to react to the same event — a payment processed
> event goes to the fraud detection service, notification service, and analytics service
> simultaneously. I use SQS when I need to process messages reliably at my own pace —
> a Lambda function processes SQS messages, and if it fails, the message is retried.
>
> Often combined: SNS sends to multiple SQS queues, and each service consumes its own
> queue independently."

---

## Section 6: Security

**Q13: How do you prevent secrets from being committed to Git?**

```bash
# 1. .gitignore
echo ".env" >> .gitignore
echo "*.pem" >> .gitignore
echo "secrets.yaml" >> .gitignore

# 2. Pre-commit hook with Gitleaks
pip install detect-secrets
detect-secrets scan > .secrets.baseline
detect-secrets audit .secrets.baseline

# 3. GitHub secret scanning (automatic on GitHub)
# Settings → Code security → Secret scanning

# 4. If a secret was already committed:
# Remove from history (dangerous, coordinate with team)
git filter-repo --invert-paths --path secrets.yaml
# OR: use BFG Repo Cleaner

# Always: rotate the exposed secret immediately!

# 5. Use Vault or AWS Secrets Manager instead
# Your app reads secrets at runtime, never in code
```

---

**Q14: What is the principle of least privilege and how do you implement it in AWS?**

> "Least privilege means giving an identity (user, role, service) only the permissions
> it needs to do its job, and nothing more. In AWS, I implement it by: (1) using IAM
> roles instead of users for EC2 and Lambda — the role has only the permissions that
> service needs; (2) using SCPs in AWS Organizations to prevent entire account classes
> from doing certain things; (3) using IAM Access Analyzer to find over-permissive
> policies; (4) reviewing unused permissions quarterly with IAM Access Advisor.
>
> Example: a Lambda that reads from S3 gets s3:GetObject on the specific bucket only —
> not `s3:*` on all buckets."

---

## Section 7: Architecture and Design

**Q15: Design a deployment strategy for a fintech payment system with zero downtime.**

```
Requirements:
- Zero downtime
- Easy rollback
- PCI-DSS compliant
- High availability

Strategy: Blue-Green with Feature Flags

Setup:
- Blue deployment: current production (v1.4)
- Green deployment: new version (v1.5)

Steps:
1. Deploy v1.5 to Green (no traffic)
2. Run smoke tests and integration tests on Green
3. Shift 5% of traffic to Green (canary)
4. Monitor error rates, P99 latency for 15 minutes
5. If metrics are good: shift 50% traffic
6. After 30 minutes: shift 100% traffic
7. Keep Blue running for 30 minutes (easy rollback)
8. Rollback trigger: error rate > 1% or P99 > 500ms

PCI compliance:
- All traffic encrypted (TLS 1.3)
- AWS WAF in front
- CloudTrail logs all changes
- Separation of duties: deployer ≠ approver
```

---

## Section 8: Behavioral Questions

**Q16: Tell me about a major incident you handled.**

**STAR format:**

> "**Situation:** During peak hours on a Monday, our payment API started returning
> 503 errors. Approximately 15% of payment attempts were failing.
>
> **Task:** I was the on-call engineer. My goal was to restore service and understand
> the root cause as fast as possible.
>
> **Action:** I immediately notified the team in Slack with current impact. I checked
> CloudWatch and saw the EKS pods were crashing with OOMKilled. A deployment 2 hours
> earlier had a memory leak. I rolled back the deployment with `kubectl rollout undo`
> in 2 minutes. Traffic normalized. Then I analyzed the memory issue in the new code —
> a Redis connection pool was not being closed properly.
>
> **Result:** Total downtime: 8 minutes. The rollback took 2 minutes; the other 6 were
> detection and communication time. We implemented memory limit alerts (when usage > 80%
> for 5 minutes, alert before OOM). Added memory usage tests in CI. MTTR improved by 40%
> for similar incidents."

---

## Quick-Fire Round — 30-Second Answers

**Q: What is a VPC?**
> "A Virtual Private Cloud — your own isolated network in AWS. You define the IP range,
> subnets, routing, and security rules."

**Q: What is Helm?**
> "Helm is the package manager for Kubernetes. Charts are packages that contain all the
> Kubernetes YAML to deploy an application. `helm install` deploys everything in one command."

**Q: What is the purpose of etcd in Kubernetes?**
> "etcd is the distributed key-value store that Kubernetes uses as its database.
> It stores the desired state of the cluster — all resource definitions, configurations,
> and cluster state. If etcd fails, the control plane fails."

**Q: What is a DaemonSet?**
> "A DaemonSet ensures one pod runs on every node in the cluster. Used for monitoring
> agents (Prometheus node-exporter), log collectors (Fluent Bit), network plugins."

**Q: What is the difference between blue-green and canary deployments?**
> "Blue-green: two identical environments, switch all traffic at once — fastest rollout,
> biggest risk. Canary: gradually shift traffic to new version — slower but safer, you
> catch problems before 100% of users are affected."

**Q: What is a headless service in Kubernetes?**
> "A Service with `clusterIP: None`. Instead of load balancing, DNS returns the IPs of
> all pods. Used for stateful applications like databases where you need to reach a
> specific pod, and for service discovery in microservices."

---

[← Back to Section](./README.md)
