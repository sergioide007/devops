# Interview Structure and Preparation

> Knowing what to expect makes you confident.
> A 45-minute DevOps interview follows a predictable structure.

---

## The 45-Minute Senior DevOps Interview

```
00:00 – 05:00  INTRODUCTIONS
               "Tell me about yourself"
               "Walk me through your background"

05:00 – 15:00  TECHNICAL DEPTH
               Deep questions on your strongest area
               (AWS, Kubernetes, CI/CD — pick one to lead with)

15:00 – 30:00  SCENARIO QUESTIONS
               "How would you handle..."
               "Tell me about a time when..."
               "Design a system for..."

30:00 – 40:00  LIVE EXERCISE
               Write a Bash script
               Design a CI/CD pipeline on a whiteboard
               Review a Kubernetes YAML file

40:00 – 45:00  YOUR QUESTIONS
               Ask smart questions — shows interest
```

---

## "Tell Me About Yourself" — The Opening

You have 2 minutes. Practice this until it is perfect.

**Template:**
> "I'm a Senior DevOps Engineer with [X] years of experience, specializing in
> [AWS / Kubernetes / CI/CD]. In my current role, I [what you do] for [type of systems].
> Some highlights: I [specific achievement with a number], [another achievement].
> I'm looking for a role where I can [what you want to do]."

**Example (adapt for your situation):**
> "I'm a Senior DevOps Engineer with 12 years of experience, specializing in AWS, Kubernetes,
> and CI/CD pipelines. I've worked primarily in Banking and Fintech, managing high-transactional
> systems that process millions of transactions per day.
>
> Some highlights: I led the migration of a payment processor to a PCI-compliant AWS
> environment — reduced infrastructure cost by 60% and improved payment success rate
> from 94% to 99.7%. I also built a Kubernetes platform on EKS that serves multiple
> country deployments across Latin America.
>
> I'm looking for a role where I can work on complex distributed systems and help build
> a strong DevOps culture."

---

## How to Answer Technical Questions

Use this structure:
1. **State the concept clearly** (one sentence)
2. **Explain when/why you use it**
3. **Give a real example** from your experience

**Bad answer:**
> "Docker is a container tool."

**Good answer:**
> "Docker packages applications and their dependencies into portable containers.
> I use it to eliminate environment drift — 'it works on my machine' problems disappear
> because the container is identical everywhere. In a recent project, I containerized
> 8 legacy banking Lambda functions — the Docker image was 3.2MB instead of 28MB by
> using multi-stage builds, which reduced cold start time from 3 seconds to 200ms."

---

## How to Answer Scenario Questions

When asked "How would you handle X?", use this structure:

1. **Clarify the scenario** ("Can I ask — what scale are we talking about? What are the SLAs?")
2. **State your first action** ("The first thing I do is...")
3. **Walk through your reasoning** step by step
4. **State the outcome** ("This achieves X because Y")
5. **Mention tradeoffs** ("The tradeoff is...")

---

## Common Scenario Questions and How to Answer

**Scenario: "A critical microservice is down in production. What do you do?"**

1. **Detect:** "I check the alert in PagerDuty or Slack. I open CloudWatch/Grafana to understand scope."
2. **Communicate:** "I post in Slack immediately: 'Investigating X issue, working on fix.'"
3. **Isolate:** "Is it one pod? One AZ? All pods? I check `kubectl get pods -n production`."
4. **Mitigate:** "If it's a bad deployment, I rollback immediately — 2 minutes. Don't investigate while it's on fire."
5. **Monitor:** "I watch metrics for 15 minutes after the fix to confirm it's stable."
6. **Follow up:** "Post-mortem within 24 hours. Root cause. Prevention."

---

**Scenario: "Design a CI/CD pipeline for a new microservice."**

Draw this mentally:

```
Code push → GitHub
         ↓
GitHub Actions trigger
         ↓
Test stage:
  - Unit tests (pass/fail)
  - Integration tests (with test DB)
  - SonarQube (quality gate must pass)
         ↓
Build stage (only on main):
  - docker build
  - Trivy scan (no CRITICAL CVEs)
  - docker push to ECR
         ↓
Deploy to staging:
  - kubectl set image deployment/...
  - Wait for rollout
  - Run smoke tests
         ↓
Deploy to production (manual approval):
  - Blue-green or canary (5% → 50% → 100%)
  - Monitor error rate for 30 minutes
  - Full deployment
         ↓
Notify Slack
```

> "I'd use GitHub Actions because the code is in GitHub — zero extra setup.
> For quality gates, SonarQube integration prevents code with security hotspots
> from going to production. Container scanning with Trivy catches CVEs early.
> Canary deployment gives us a safety net — if error rate spikes above 1%, it
> auto-rolls back. Everything is tracked in Jira via the pipeline automation."

---

## Your Questions for the Interviewer

Always prepare 3-4 smart questions. This shows genuine interest.

**Good questions:**
- "What does a typical on-call rotation look like? How many incidents per week?"
- "What's the current state of your CI/CD pipeline? What are the biggest pain points?"
- "How does the DevOps team interact with the development teams?"
- "What does success look like in the first 90 days for this role?"
- "What are the biggest infrastructure challenges you're facing right now?"
- "Are you planning any major migrations? (e.g., multi-cloud, K8s upgrade)"

**Questions to avoid:**
- "What is the salary?" (save for HR conversation)
- "How many vacation days do I get?"
- "When can I go remote?" (ask after you have the offer)

---

## English Tips for Non-Native Speakers

```
Phrases for when you need thinking time:
- "That's a great question. Let me think about that for a moment."
- "Can you clarify — are you asking about X or Y?"
- "My experience with that is in the context of banking systems, specifically..."

Phrases to show confidence:
- "In my experience, the best approach is..."
- "I've done this in a production environment and the key is..."
- "The tradeoff I've seen is..."

Phrases when you don't know something:
- "I haven't worked with that specific tool, but the concept is similar to [tool you know]."
- "I haven't done that, but here's how I would approach it..."
- DON'T fake it — interviewers always know
```

---

## 1-Week Interview Preparation Plan

```
Day 1:  Review Linux fundamentals, practice Bash scripting
Day 2:  Review AWS (IAM, VPC, Lambda, EKS) — do hands-on exercises
Day 3:  Review Kubernetes — set up a local cluster, practice kubectl
Day 4:  Review CI/CD — write a Jenkinsfile or GitHub Actions workflow
Day 5:  Review monitoring — set up Prometheus/Grafana locally
Day 6:  Practice "Tell me about yourself" and scenario questions aloud
Day 7:  Rest, review notes, prepare your questions for the interview
```

---

[← Back to Section](./README.md) | [Next: Technical Questions →](./02-technical-questions.md)
