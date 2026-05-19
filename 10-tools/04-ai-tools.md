# AI Tools for DevOps Engineers

> AI tools can multiply your productivity.
> The best DevOps engineers in 2026 use AI as a daily co-pilot.

---

## AI Tools Overview

| Tool | Best For | Cost |
|------|---------|------|
| **GitHub Copilot** | Code completion in any IDE | $10-19/month |
| **Gemini CLI** | Terminal AI assistant | Free tier available |
| **Claude Code** | Complex code tasks, refactoring, review | API pricing |
| **Amazon Q** | AWS-specific help (IAM, CloudWatch, EKS) | Free with AWS |
| **alpaquitay-ai** | Integrated DevOps agent in VS Code | Free (local) |
| **Ollama + CodeLlama** | Local, private, free | Free (local hardware) |

---

## GitHub Copilot — Everyday Code

```bash
# VS Code: Install GitHub Copilot extension
# Sign in with GitHub account

# Copilot helps with:
# - Completing Bash scripts
# - Writing Terraform resources
# - Generating Kubernetes YAML
# - Explaining complex regex

# Example: type this and Copilot completes it:
# "Write a bash script that monitors disk usage and sends a Slack alert at 80%"
# Press Tab to accept suggestions
```

---

## Gemini CLI — Terminal AI

```bash
# Install
pip install google-generativeai

# Use
gemini "write a Dockerfile for a Python Flask app with nginx reverse proxy"

gemini "explain this error: kubectl: connection refused to api-server"

gemini "what are the DORA metrics and how do I improve each one?"

# Interactive mode
gemini --interactive
```

---

## Amazon Q — AWS Expert

```bash
# In AWS Console, click the Q icon (top right corner)

# Example questions:
# "Why is my Lambda function getting throttled?"
# "How do I set up cross-account access from EKS to RDS?"
# "Show me the CloudWatch logs for my failing ECS task"
# "Generate a CloudFormation template for my architecture"

# Amazon Q in the terminal (requires AWS Toolkit)
aws q chat
> How do I configure CloudWatch Container Insights for EKS?
> What IAM permissions does my Lambda need to write to DynamoDB?
```

---

## Ollama — Local, Private AI

```bash
# Install
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama
ollama serve

# Download models
ollama pull codellama:13b      # good for code
ollama pull llama3.2:3b        # fast, good for short questions
ollama pull deepseek-coder:6.7b # excellent for code generation

# Use from terminal
ollama run codellama "Write a Kubernetes liveness probe for a Node.js app"

# Use with alpaquitay-ai (no API key needed)
# Set in VS Code settings:
# "alpaquitay-ai.provider": "ollama"
# "alpaquitay-ai.ollama.model": "codellama:13b"

# REST API (use from scripts)
curl http://localhost:11434/api/generate \
    -d '{"model": "codellama", "prompt": "Write a health check script in Bash"}'
```

---

## How to Use AI Effectively in DevOps

### Good prompts

```bash
# ❌ Bad: too vague
# "write a terraform script"

# ✅ Good: specific context and requirements
# "Write Terraform code for an AWS RDS PostgreSQL database with:
# - db.t3.medium instance
# - Multi-AZ enabled for high availability
# - KMS encryption at rest
# - Parameter group with max_connections=200
# - Subnet group using private subnets
# - Security group allowing port 5432 from EKS worker nodes only
# - 7-day backup retention
# - Enhanced monitoring enabled"

# ✅ Good: error debugging with context
# "This kubectl command fails:
# kubectl apply -f deployment.yaml
# Error: pods 'my-api' is forbidden: unable to validate against any security policy
# I am using Kubernetes 1.28 on EKS. My deployment has securityContext.runAsRoot: true.
# What is wrong and how do I fix it?"
```

### AI for Incident Response

```bash
# During an incident, copy error logs and ask:
# "I have a production incident. Here are the last 50 error logs:
# [paste logs]
# The service started failing at 14:32 UTC.
# Recent changes: deployed v1.5.2 at 14:00 UTC.
# What is the likely root cause? What should I check first?"

# AI can often spot patterns faster than human eyes
# Always verify AI suggestions before applying to production
```

---

## AI Limitations — What NOT to Trust Blindly

```
1. AI can hallucinate AWS commands or outdated syntax
   → Always run with --dry-run or in staging first

2. AI may suggest overly permissive IAM policies
   → Apply least privilege, review every permission

3. AI-generated Terraform may have resource naming conflicts
   → terraform plan before apply

4. AI doesn't know your specific architecture
   → Provide context (environment, versions, constraints)

5. AI may not know the latest Kubernetes API versions
   → Check kubectl api-versions after generating YAML
```

---

## Interview Questions — AI in DevOps

**Q: How do you use AI tools in your daily work?**
> "I use AI tools as amplifiers, not replacements. GitHub Copilot helps me write Bash
> scripts and Terraform faster — I still review every line before committing. For
> complex debugging, I use Claude via alpaquitay-ai — paste the error and logs, get
> a structured analysis. For AWS-specific questions, Amazon Q is excellent because it
> knows the current AWS services and IAM policies.
>
> I'm careful about what I send to cloud AI — for sensitive code or production configs,
> I use local Ollama models. AI has probably saved me 5-10 hours per week on repetitive
> tasks, but human judgment is still required for production decisions."

---

[← Back to Section](./README.md)
