# AI Agent Orchestration for DevOps

> AI agents can automate repetitive DevOps tasks, analyze logs faster than humans,
> and respond to incidents automatically.
> This is the cutting edge of DevOps in 2026.

---

## What Are AI Agents in DevOps?

An AI agent is an autonomous system that:
1. Observes the environment (metrics, logs, events)
2. Makes decisions using AI
3. Takes actions (run commands, open tickets, send alerts)
4. Learns from outcomes

---

## Agent Patterns in DevOps

```
Sequential Agent    → Step A → Step B → Step C
Parallel Agent      → Step A + Step B + Step C (at the same time)
Supervisor Agent    → AI plans → delegates to specialist agents
ReAct Agent         → Reason → Act → Observe → Reason again
```

---

## Incident Response Agent

```python
# incident_agent.py — Auto-diagnoses production incidents

import anthropic
import boto3
import json
from datetime import datetime, timedelta

client = anthropic.Anthropic()

def get_cloudwatch_logs(log_group, minutes=30):
    """Fetch recent error logs from CloudWatch."""
    logs_client = boto3.client('logs', region_name='us-east-1')

    end_time = int(datetime.now().timestamp() * 1000)
    start_time = end_time - (minutes * 60 * 1000)

    response = logs_client.start_query(
        logGroupName=log_group,
        startTime=start_time,
        endTime=end_time,
        queryString="""
            fields @timestamp, @message
            | filter level = "ERROR" or @message like "Exception"
            | sort @timestamp desc
            | limit 50
        """
    )

    query_id = response['queryId']

    # Wait for results
    import time
    while True:
        result = logs_client.get_query_results(queryId=query_id)
        if result['status'] == 'Complete':
            return result['results']
        time.sleep(1)

def get_recent_deployments(cluster_name, namespace):
    """Check if there was a recent deployment."""
    import subprocess
    result = subprocess.run(
        ['kubectl', 'rollout', 'history', f'deployment/{cluster_name}', '-n', namespace],
        capture_output=True, text=True
    )
    return result.stdout

def get_resource_metrics(namespace):
    """Get CPU and memory usage."""
    import subprocess
    result = subprocess.run(
        ['kubectl', 'top', 'pods', '-n', namespace, '--sort-by=cpu'],
        capture_output=True, text=True
    )
    return result.stdout

def diagnose_incident(service_name, namespace, alert_message):
    """
    Use Claude to diagnose a production incident.
    This is a ReAct (Reason + Act) agent.
    """

    tools = [
        {
            "name": "get_error_logs",
            "description": "Get recent error logs from the service",
            "input_schema": {
                "type": "object",
                "properties": {
                    "log_group": {"type": "string"},
                    "minutes": {"type": "integer", "default": 30}
                },
                "required": ["log_group"]
            }
        },
        {
            "name": "get_kubernetes_events",
            "description": "Get Kubernetes events for the namespace",
            "input_schema": {
                "type": "object",
                "properties": {
                    "namespace": {"type": "string"}
                },
                "required": ["namespace"]
            }
        },
        {
            "name": "check_recent_deployments",
            "description": "Check if there was a recent deployment that could cause issues",
            "input_schema": {
                "type": "object",
                "properties": {
                    "service": {"type": "string"},
                    "namespace": {"type": "string"}
                },
                "required": ["service", "namespace"]
            }
        },
        {
            "name": "get_resource_usage",
            "description": "Get CPU and memory usage for all pods",
            "input_schema": {
                "type": "object",
                "properties": {
                    "namespace": {"type": "string"}
                },
                "required": ["namespace"]
            }
        },
        {
            "name": "rollback_deployment",
            "description": "Rollback the deployment to the previous version",
            "input_schema": {
                "type": "object",
                "properties": {
                    "service": {"type": "string"},
                    "namespace": {"type": "string"}
                },
                "required": ["service", "namespace"]
            }
        }
    ]

    messages = [{
        "role": "user",
        "content": f"""
        PRODUCTION INCIDENT ALERT

        Service: {service_name}
        Namespace: {namespace}
        Alert: {alert_message}
        Time: {datetime.now().isoformat()}

        Please diagnose this incident. Use the available tools to:
        1. Check error logs
        2. Check Kubernetes events
        3. Check recent deployments
        4. Check resource usage

        Provide:
        - Root cause analysis
        - Immediate fix recommendation
        - Whether to rollback (only if you are confident)
        - Prevention recommendations
        """
    }]

    # Agentic loop
    while True:
        response = client.messages.create(
            model="claude-opus-4-7",  # Use most capable model for production incidents
            max_tokens=4096,
            tools=tools,
            messages=messages
        )

        if response.stop_reason == "end_turn":
            # Agent is done with analysis
            final_analysis = response.content[0].text
            print("\n" + "="*60)
            print("INCIDENT ANALYSIS")
            print("="*60)
            print(final_analysis)
            return final_analysis

        if response.stop_reason == "tool_use":
            # Agent wants to use a tool
            messages.append({"role": "assistant", "content": response.content})

            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    print(f"Agent calling: {block.name}({block.input})")

                    # Execute the tool
                    result = execute_tool(block.name, block.input)

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": str(result)
                    })

            messages.append({"role": "user", "content": tool_results})

def execute_tool(tool_name, tool_input):
    """Execute the requested tool."""
    import subprocess

    if tool_name == "get_error_logs":
        return get_cloudwatch_logs(
            tool_input['log_group'],
            tool_input.get('minutes', 30)
        )

    elif tool_name == "get_kubernetes_events":
        result = subprocess.run(
            ['kubectl', 'get', 'events', '-n', tool_input['namespace'],
             '--sort-by=.lastTimestamp', '--field-selector=type=Warning'],
            capture_output=True, text=True
        )
        return result.stdout

    elif tool_name == "check_recent_deployments":
        return get_recent_deployments(tool_input['service'], tool_input['namespace'])

    elif tool_name == "get_resource_usage":
        return get_resource_metrics(tool_input['namespace'])

    elif tool_name == "rollback_deployment":
        # CONFIRM before rollback!
        confirmation = input(f"\n⚠️  ROLLBACK {tool_input['service']}? (yes/no): ")
        if confirmation.lower() == 'yes':
            result = subprocess.run(
                ['kubectl', 'rollout', 'undo',
                 f"deployment/{tool_input['service']}",
                 '-n', tool_input['namespace']],
                capture_output=True, text=True
            )
            return f"Rollback result: {result.stdout}\n{result.stderr}"
        return "Rollback cancelled by operator"

# Usage
if __name__ == "__main__":
    diagnose_incident(
        service_name="payment-api",
        namespace="production",
        alert_message="Error rate is 15% (threshold: 1%). P99 latency is 8000ms."
    )
```

---

## Daily Standup Agent

```python
# standup_agent.py — Generate daily standup report

import anthropic
import subprocess
import json
from datetime import datetime, timedelta

def get_git_activity(repos, since_hours=24):
    """Get commits and PRs from the last 24 hours."""
    activity = {}
    since = (datetime.now() - timedelta(hours=since_hours)).isoformat()

    for repo in repos:
        result = subprocess.run(
            ['git', '-C', repo, 'log', f'--since={since}',
             '--pretty=format:{"hash":"%h","author":"%an","message":"%s","time":"%ci"}'],
            capture_output=True, text=True
        )
        commits = [json.loads(l) for l in result.stdout.splitlines() if l.strip()]
        activity[repo] = commits

    return activity

def get_deployment_history():
    """Get recent Kubernetes deployments."""
    result = subprocess.run(
        ['kubectl', 'rollout', 'history', 'deployment', '-A', '--no-headers'],
        capture_output=True, text=True
    )
    return result.stdout

def get_alerts_last_24h():
    """Get alerts that fired in the last 24 hours."""
    import boto3
    cw = boto3.client('cloudwatch')

    response = cw.describe_alarm_history(
        HistoryItemType='StateUpdate',
        StartDate=datetime.now() - timedelta(hours=24),
        EndDate=datetime.now()
    )
    return response.get('AlarmHistoryItems', [])

def generate_standup():
    """Generate a standup report using Claude."""
    client = anthropic.Anthropic()

    git_activity = get_git_activity(['/opt/repos/api', '/opt/repos/frontend'])
    alerts = get_alerts_last_24h()

    prompt = f"""
    Generate a concise daily standup report for the DevOps team.

    Git Activity (last 24h):
    {json.dumps(git_activity, indent=2)}

    Alerts Triggered:
    {json.dumps([{
        'alarm': a['AlarmName'],
        'state': a['HistorySummary'],
        'time': str(a['Timestamp'])
    } for a in alerts], indent=2)}

    Format the standup as:
    ✅ DONE (yesterday):
    🔄 IN PROGRESS (today):
    ⚠️  BLOCKERS:
    📊 METRICS: (key numbers)
    🚨 INCIDENTS: (if any alerts fired)

    Keep it brief — 5 minutes to read.
    """

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    return response.content[0].text

if __name__ == "__main__":
    print(generate_standup())
```

---

## Parallel DevOps Agents

```python
# parallel_agents.py — Run multiple checks simultaneously

import asyncio
import anthropic

async def security_audit_agent(codebase_path):
    """Audit code for security issues."""
    client = anthropic.Anthropic()
    # ... reads code, checks OWASP issues, CVEs
    pass

async def performance_agent(metrics_data):
    """Analyze performance metrics and suggest optimizations."""
    client = anthropic.Anthropic()
    # ... analyzes P99, slow queries, memory leaks
    pass

async def cost_optimization_agent(aws_cost_data):
    """Find ways to reduce AWS costs."""
    client = anthropic.Anthropic()
    # ... identifies unused resources, right-sizing opportunities
    pass

async def run_all_agents():
    """Run all agents in parallel."""
    results = await asyncio.gather(
        security_audit_agent('/opt/repos/api'),
        performance_agent(get_metrics()),
        cost_optimization_agent(get_aws_costs()),
        return_exceptions=True
    )

    security_report, perf_report, cost_report = results
    compile_weekly_report(security_report, perf_report, cost_report)

asyncio.run(run_all_agents())
```

---

## alpaquitay-ai — DevOps Agents in Your IDE

The `alpaquitay-ai` VS Code extension includes DevOps-specific agent skills:

```typescript
// DevOps agents available in alpaquitay-ai:

// 1. DailyStandupSkill — generates standup from git + specs
const standup = await ctx.spawn('daily-standup', {
    repos: ['./api', './frontend'],
    since: '24h'
});

// 2. DeploymentAnalysis — analyze a deployment plan
const analysis = await ctx.spawn('deployment-analysis', {
    manifest: 'kubernetes/deployment.yaml',
    environment: 'production'
});

// 3. IncidentSkill — diagnose an incident
const diagnosis = await ctx.spawn('incident-diagnosis', {
    service: 'payment-api',
    alertMessage: 'Error rate spike detected'
});

// Use CompositeSkill for complex workflows
const devopsReview = new CompositeSkill('devops-review', 'DevOps Review', `
    You are a senior DevOps engineer reviewing infrastructure changes.
    Available specialists: security-audit, cost-analysis, performance-review.
    For each change, delegate to the appropriate specialist and compile a report.
`);
```

```bash
# In your VS Code terminal with alpaquitay-ai:
# Open the panel → Skills tab → DevOps Agents
# Or use the chat: "Review my Kubernetes deployment.yaml for production readiness"
# The AI uses your local files, git history, and DevOps context
```

---

## Building a DevOps Bot with Claude API

```python
# devops_bot.py — Slack bot that answers DevOps questions and executes commands

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
import anthropic
import subprocess

app = App(token=os.environ["SLACK_BOT_TOKEN"])
claude = anthropic.Anthropic()

CONVERSATION_HISTORY = {}  # per-user conversation history

@app.event("app_mention")
def handle_mention(event, say):
    user = event["user"]
    text = event["text"]
    channel = event["channel"]

    # Get conversation history for this user
    history = CONVERSATION_HISTORY.get(user, [])
    history.append({"role": "user", "content": text})

    # Safety check — only allow read-only by default
    if any(dangerous in text.lower() for dangerous in ['delete', 'destroy', 'drop', 'rm -rf']):
        say("I can't execute destructive commands without explicit approval. Please contact your DevOps lead.")
        return

    # Ask Claude with DevOps context
    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system="""You are a DevOps assistant for our engineering team.
        You have access to our Kubernetes cluster, AWS account, and monitoring systems.
        Be concise. If asked to run a command, show the command first and ask for confirmation.
        Always consider safety before executing anything.""",
        messages=history
    )

    answer = response.content[0].text

    # Store history (with cache for repeated conversations)
    history.append({"role": "assistant", "content": answer})
    CONVERSATION_HISTORY[user] = history[-20:]  # keep last 20 messages

    say(answer)

if __name__ == "__main__":
    handler = SocketModeHandler(app, os.environ["SLACK_APP_TOKEN"])
    handler.start()
```

---

## Interview Questions — AI Agents in DevOps

**Q: How do you use AI to improve DevOps workflows?**
> "I use Claude-based agents for several tasks: automated incident diagnosis — when an
> alert fires, an agent gathers logs, events, and recent deployments, then provides a
> root cause analysis and suggested fix. Daily standup generation — summarizes git activity
> and deployments from the past 24 hours. Code review automation — checks Kubernetes YAML
> for security issues and resource limits. These agents save 2-3 hours per engineer per
> week. I always keep humans in the loop for destructive actions."

**Q: What precautions do you take with AI agents in production?**
> "Strict permissions — read-only by default. Any action that modifies production requires
> human confirmation. I use separate IAM roles with minimal permissions for agent accounts.
> All agent actions are logged with full context. I test agents in staging first. I monitor
> agent behavior — if it starts behaving unexpectedly, automatic circuit breakers stop it.
> Agents are tools that augment engineers, not replace them."

---

[← Back to Section](./README.md) | [Next: DevSecOps →](./05-devsecops.md)
