# Section 12 — Compliance, ISO Standards & Enterprise Frameworks

> Compliance is not optional in banking, fintech, healthcare, and retail.
> A senior DevOps engineer in these sectors must know how DevSecOps
> maps to ISO standards, regulatory frameworks, and enterprise architectures.

---

## Why Compliance Matters for DevOps

```
Without compliance knowledge:
  - Your pipeline is missing audit logs → ISO 27001 violation
  - You deploy without change approval → SOX violation
  - You store logs for 30 days → PCI-DSS requires 1 year
  - Your Terraform has no encryption → GDPR violation

With compliance knowledge:
  - You design security into the pipeline (shift left)
  - You automate compliance checks (compliance as code)
  - You talk the language of auditors and regulators
  - You help the business ship fast AND stay compliant
```

---

## Standards and Frameworks Covered

| File | Standard/Framework | Sector |
|------|-------------------|--------|
| [01-iso27001.md](./01-iso27001.md) | ISO 27001 — Information Security | All sectors |
| [02-iso22301.md](./02-iso22301.md) | ISO 22301 — Business Continuity | All sectors |
| [03-iso9001.md](./03-iso9001.md) | ISO 9001 — Quality Management | All sectors |
| [04-togaf.md](./04-togaf.md) | TOGAF — Enterprise Architecture | All sectors |
| [05-bian.md](./05-bian.md) | BIAN — Banking Industry Architecture | Banking |
| [06-pci-dss.md](./06-pci-dss.md) | PCI-DSS — Payment Card Security | Fintech, Retail |
| [07-gdpr-ccpa.md](./07-gdpr-ccpa.md) | GDPR / CCPA — Data Privacy | All sectors |
| [08-sector-banking.md](./08-sector-banking.md) | Banking: BCBS 239, Basel III | Banking |
| [09-sector-retail.md](./09-sector-retail.md) | Retail: SOC 2, PCI, CCPA | Retail, E-commerce |
| [10-compliance-pipeline.md](./10-compliance-pipeline.md) | Automated compliance in CI/CD | All sectors |

---

## The Compliance Stack Map

```
ISO 27001  → Information security controls (affects everything)
ISO 22301  → How you recover from incidents (DR, BCP)
ISO 9001   → Quality processes (how you test and release)
TOGAF      → Enterprise architecture framework (how systems connect)
BIAN       → Banking-specific service model (API design in banks)
PCI-DSS    → Payment card security (fintech, e-commerce)
GDPR/CCPA  → Personal data protection (affects all customer data)
SOX        → Financial reporting controls (public companies)
NIST CSF   → Cybersecurity framework (US federal + adopted globally)
```

---

[← Back to Main](../README.md)
