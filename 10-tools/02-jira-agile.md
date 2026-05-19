# Agile, Jira, and Trello for DevOps

> DevOps engineers don't just write scripts. They work in teams.
> You need to know how to communicate, plan, and track work.

---

## Agile in DevOps

Agile and DevOps work together:
- **Agile** → how the team organizes work (sprints, stories, retrospectives)
- **DevOps** → how software is built and delivered (CI/CD, automation)

---

## Scrum Roles and Ceremonies

```
Roles:
- Product Owner     → defines what to build (backlog)
- Scrum Master      → facilitates process (removes blockers)
- Development Team  → engineers, DevOps included

Ceremonies:
- Sprint Planning   → what we do this sprint (2 hours max)
- Daily Standup     → 15-minute sync (what did, will do, blockers)
- Sprint Review     → show what was built (1 hour)
- Retrospective     → improve the process (1 hour)

Sprint = 1-2 week cycle
```

---

## Jira — Enterprise Project Management

```bash
# Jira API — automate Jira from CI/CD pipeline
BASE_URL="https://yourcompany.atlassian.net"
USER="you@company.com"
TOKEN="your-api-token"  # from: id.atlassian.com → Security → API tokens

# Create a ticket from a script
curl -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic $(echo -n "${USER}:${TOKEN}" | base64)" \
    "${BASE_URL}/rest/api/3/issue" \
    -d '{
        "fields": {
            "project": {"key": "DEVOPS"},
            "summary": "Deploy my-api v1.5.0 to production",
            "issuetype": {"name": "Task"},
            "priority": {"name": "High"},
            "description": {
                "type": "doc",
                "version": 1,
                "content": [{
                    "type": "paragraph",
                    "content": [{
                        "type": "text",
                        "text": "Automated deployment task created by CI pipeline."
                    }]
                }]
            }
        }
    }'

# Transition a ticket to "In Progress"
# First get transitions
curl -H "Authorization: Basic ..." \
    "${BASE_URL}/rest/api/3/issue/DEVOPS-123/transitions"

# Transition
curl -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic ..." \
    "${BASE_URL}/rest/api/3/issue/DEVOPS-123/transitions" \
    -d '{"transition": {"id": "21"}}'  # 21 = "In Progress" ID

# Add comment from CI pipeline
curl -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic ..." \
    "${BASE_URL}/rest/api/3/issue/DEVOPS-123/comment" \
    -d '{
        "body": {
            "type": "doc",
            "version": 1,
            "content": [{"type": "paragraph", "content": [{
                "type": "text",
                "text": "Deployment to production completed successfully. Build: abc123f"
            }]}]
        }
    }'
```

---

## Jira in Jenkins Pipeline

```groovy
// Jenkinsfile — automatically update Jira on deployment
pipeline {
    stages {
        stage('Deploy') {
            steps {
                // Deploy...

                // Update Jira ticket
                script {
                    def jiraComment = "✅ Deployed to production\n" +
                        "Version: ${GIT_COMMIT.take(8)}\n" +
                        "Build: ${BUILD_URL}"

                    httpRequest(
                        url: "${JIRA_URL}/rest/api/3/issue/${JIRA_TICKET}/comment",
                        httpMode: 'POST',
                        authentication: 'jira-credentials',
                        contentType: 'APPLICATION_JSON',
                        requestBody: """
                        {
                            "body": {
                                "type": "doc",
                                "version": 1,
                                "content": [{"type": "paragraph", "content": [
                                    {"type": "text", "text": "${jiraComment}"}
                                ]}]
                            }
                        }
                        """
                    )
                }
            }
        }
    }
}
```

---

## Communicating with Teams

### How to write a deployment notice

```
Subject: [DEPLOYMENT] my-api v1.5.0 → Production | 2026-05-19 14:00 UTC

WHAT: Deploy my-api v1.5.0 to production
WHEN: Today 14:00–14:30 UTC
IMPACT: Zero downtime (rolling update)
ROLLBACK PLAN: kubectl rollout undo deployment/my-api (takes ~2 min)
MONITORING: https://grafana.mycompany.com/d/api-dashboard

CHANGES IN THIS VERSION:
- Fix: Payment timeout increased to 30s (fixes customer complaints)
- Fix: Memory leak in connection pool (fixes OOM restarts)
- Feature: Add refund dispute endpoint

JIRA: DEVOPS-456
CONTACT: @devops-team in #deployments

Let me know if you have concerns.
```

### How to communicate during an incident

```
[14:32] Starting investigation — payment API error rate spike to 12%
[14:35] Found: all errors from payment-service pods in AZ-a
[14:37] Root cause: memory limit too low, OOMKilled after 15min
[14:39] Fix: rolling out increased memory limit (512Mi → 1Gi)
[14:42] Rollout complete, monitoring
[14:47] Error rate back to normal (0.1%)
[14:48] RESOLVED — total impact: 15 minutes, 8% of requests affected
[14:48] Post-mortem scheduled for tomorrow 10:00 UTC
```

---

## Interview Questions — Agile and Communication

**Q: How do you communicate with non-technical stakeholders?**
> "I translate technical work into business impact. Instead of 'We configured Prometheus
> alerting,' I say 'We now detect outages in 2 minutes instead of 20 — that's 18 minutes
> less customer impact per incident.' I use dashboards that non-technical people can read
> (uptime %, deployment frequency). I send pre-deployment notices explaining impact and
> rollback plan. I write clear post-mortems that focus on prevention, not blame."

---

[← Back to Section](./README.md) | [Next: AI Tools →](./04-ai-tools.md)
