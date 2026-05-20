# Section 05 — Infrastructure as Code

> Infrastructure as Code means your servers and networks are defined in files.
> Never click in the AWS console to create resources. Write code instead.
> This makes environments reproducible, auditable, and version-controlled.

---

## Topics in This Section

| File | Topic | Level |
|------|-------|-------|
| [Terraform basics.md](javascript:dvGo('terraform-basics')) | Terraform fundamentals | Intermediate |
| [Terraform AWS](javascript:dvGo('terraform-aws')) | Terraform for AWS (VPC, EKS, RDS) | Advanced |
| [Ansible basics](javascript:dvGo('ansible-basics')) | Ansible for configuration management | Intermediate |
| [Ansible playbooks.md](javascript:dvGo('ansible-playbooks')) | Real-world Ansible playbooks | Advanced |

---

## Terraform vs Ansible — Which One?

| Aspect | Terraform | Ansible |
|--------|-----------|---------|
| **Primary use** | Provision infrastructure | Configure servers |
| **State** | Keeps state file | Stateless |
| **Language** | HCL (HashiCorp Config Lang) | YAML |
| **Idempotent** | Yes | Yes |
| **Best for** | Create/destroy cloud resources | Install software, configure OS |
| **Multi-cloud** | Yes (AWS, Azure, GCP) | Yes |

**Use together:** Terraform creates the EC2 instance, Ansible configures it.

---

## Why IaC?

```
Without IaC:                    With IaC:
- Manual clicks in AWS console  - Code in Git repository
- "Who created this resource?"  - Git blame shows who, when, why
- Hard to reproduce             - Run terraform apply to recreate
- Environment drift             - All environments identical
- No audit trail                - PR reviews for infra changes
```

---

[← Back to Main](/) | [Next: Monitoring →](/monitoring/)
