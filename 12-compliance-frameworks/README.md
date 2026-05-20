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
| [ISO 27001](javascript:dvGo('iso27001')) | ISO 27001 — Information Security | All sectors |
| [ISO 22301](javascript:dvGo('iso22301')) | ISO 22301 — Business Continuity | All sectors |
| [ISO 9001](javascript:dvGo('iso9001')) | ISO 9001 — Quality Management | All sectors |
| [TOGAF](javascript:dvGo('togaf')) | TOGAF — Enterprise Architecture | All sectors |
| [BIAN](javascript:dvGo('bian')) | BIAN — Banking Industry Architecture | Banking |
| [PCI DSS](javascript:dvGo('pci-dss')) | PCI-DSS — Payment Card Security | Fintech, Retail |
| [GDRP / CCPA](javascript:dvGo('gdpr-ccpa')) | GDPR / CCPA — Data Privacy | All sectors |
| [Sector Banking](javascript:dvGo('sector-banking')) | Banking: BCBS 239, Basel III | Banking |
| [Sector Retail](javascript:dvGo('sector-retail')) | Retail: SOC 2, PCI, CCPA | Retail, E-commerce |
| [Compliance Pipeline](javascript:dvGo('compliance-pipeline')) | Automated compliance in CI/CD | All sectors |

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
