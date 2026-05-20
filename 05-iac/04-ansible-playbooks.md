# Ansible — Real-World Playbooks

> **Level:** Advanced
> **Prerequisites:** Ansible Basics, Linux Fundamentals, Terraform
> **You will learn:** Production playbooks — web server provisioning, Docker deployment, user management, backup, hardening

---

## Inventory for Production

```ini
# inventory/production.ini

[web]
web-01 ansible_host=10.0.1.10
web-02 ansible_host=10.0.1.11
web-03 ansible_host=10.0.1.12

[app]
app-01 ansible_host=10.0.2.10
app-02 ansible_host=10.0.2.11

[db]
db-primary ansible_host=10.0.3.10
db-replica  ansible_host=10.0.3.11

[monitoring]
grafana ansible_host=10.0.4.10

[all:vars]
ansible_user=ec2-user
ansible_ssh_private_key_file=~/.ssh/devops-key.pem
ansible_python_interpreter=/usr/bin/python3
```

---

## Playbook 1 — NGINX Web Server Setup

```yaml
# playbooks/nginx-setup.yml
---
- name: Install and configure NGINX web server
  hosts: web
  become: true
  vars:
    server_name: "api.myapp.com"
    app_port: 8080
    ssl_cert_path: "/etc/ssl/certs/myapp.crt"
    ssl_key_path:  "/etc/ssl/private/myapp.key"

  tasks:
    - name: Install NGINX
      ansible.builtin.dnf:
        name: nginx
        state: present

    - name: Deploy NGINX configuration
      ansible.builtin.template:
        src: templates/nginx.conf.j2
        dest: /etc/nginx/conf.d/app.conf
        owner: root
        group: root
        mode: "0644"
      notify: Reload NGINX

    - name: Ensure NGINX is enabled and running
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true

    - name: Open firewall ports
      ansible.posix.firewalld:
        port: "{{ item }}/tcp"
        state: enabled
        permanent: true
        immediate: true
      loop:
        - "80"
        - "443"

  handlers:
    - name: Reload NGINX
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

```nginx
{# templates/nginx.conf.j2 #}
upstream app_backend {
  {% for host in groups['app'] %}
  server {{ hostvars[host]['ansible_host'] }}:{{ app_port }};
  {% endfor %}
}

server {
  listen 80;
  server_name {{ server_name }};
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name {{ server_name }};

  ssl_certificate     {{ ssl_cert_path }};
  ssl_certificate_key {{ ssl_key_path }};
  ssl_protocols       TLSv1.2 TLSv1.3;

  location / {
    proxy_pass         http://app_backend;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }

  location /health {
    access_log off;
    return 200 "OK";
  }
}
```

---

## Playbook 2 — Docker + App Deployment

```yaml
# playbooks/docker-deploy.yml
---
- name: Install Docker and deploy containerized application
  hosts: app
  become: true
  vars:
    app_image: "registry.company.com/myapp:{{ app_version }}"
    app_port: 8080
    app_env: "production"
    container_name: "myapp"

  pre_tasks:
    - name: Validate required variables
      ansible.builtin.assert:
        that:
          - app_version is defined
          - app_version | length > 0
        fail_msg: "app_version variable is required. Pass with -e app_version=v1.2.3"

  tasks:
    - name: Install Docker dependencies
      ansible.builtin.dnf:
        name:
          - yum-utils
          - device-mapper-persistent-data
          - lvm2
        state: present

    - name: Add Docker CE repository
      ansible.builtin.command:
        cmd: yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        creates: /etc/yum.repos.d/docker-ce.repo

    - name: Install Docker CE
      ansible.builtin.dnf:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io
        state: present

    - name: Start and enable Docker
      ansible.builtin.service:
        name: docker
        state: started
        enabled: true

    - name: Add ec2-user to docker group
      ansible.builtin.user:
        name: ec2-user
        groups: docker
        append: true

    - name: Log in to private registry
      community.docker.docker_login:
        registry_url: registry.company.com
        username: "{{ registry_user }}"
        password: "{{ registry_password }}"

    - name: Pull latest image
      community.docker.docker_image:
        name: "{{ app_image }}"
        source: pull

    - name: Stop existing container (if running)
      community.docker.docker_container:
        name: "{{ container_name }}"
        state: stopped
      ignore_errors: true

    - name: Start new container
      community.docker.docker_container:
        name: "{{ container_name }}"
        image: "{{ app_image }}"
        state: started
        restart_policy: always
        ports:
          - "{{ app_port }}:{{ app_port }}"
        env:
          APP_ENV: "{{ app_env }}"
          DB_URL:  "{{ db_url }}"
        healthcheck:
          test: ["CMD", "curl", "-f", "http://localhost:{{ app_port }}/health"]
          interval: 30s
          timeout: 10s
          retries: 3
          start_period: 60s
        log_driver: awslogs
        log_options:
          awslogs-region: us-east-1
          awslogs-group: "/app/{{ container_name }}"
          awslogs-stream: "{{ inventory_hostname }}"

    - name: Verify container is healthy
      community.docker.docker_container_info:
        name: "{{ container_name }}"
      register: container_info
      until: container_info.container.State.Health.Status == 'healthy'
      retries: 10
      delay: 15
```

---

## Playbook 3 — User Management

```yaml
# playbooks/user-management.yml
---
- name: Manage system users and SSH access
  hosts: all
  become: true
  vars_files:
    - vars/users.yml

  tasks:
    - name: Create system users
      ansible.builtin.user:
        name:     "{{ item.username }}"
        groups:   "{{ item.groups | join(',') }}"
        shell:    "{{ item.shell | default('/bin/bash') }}"
        state:    "{{ item.state | default('present') }}"
        comment:  "{{ item.fullname }}"
        password: "{{ item.password_hash }}"
      loop: "{{ users }}"

    - name: Deploy SSH public keys
      ansible.posix.authorized_key:
        user:    "{{ item.username }}"
        key:     "{{ item.ssh_public_key }}"
        state:   "{{ item.state | default('present') }}"
        exclusive: false
      loop: "{{ users }}"
      when: item.ssh_public_key is defined

    - name: Remove sudo access for deprovisioned users
      ansible.builtin.file:
        path:  "/etc/sudoers.d/{{ item.username }}"
        state: absent
      loop: "{{ users }}"
      when: item.state is defined and item.state == 'absent'

    - name: Grant sudo access for admin users
      ansible.builtin.copy:
        content: "{{ item.username }} ALL=(ALL) NOPASSWD: ALL\n"
        dest:    "/etc/sudoers.d/{{ item.username }}"
        owner:   root
        group:   root
        mode:    "0440"
        validate: /usr/sbin/visudo -cf %s
      loop: "{{ users }}"
      when:
        - item.admin is defined
        - item.admin | bool
        - item.state | default('present') == 'present'
```

```yaml
# vars/users.yml
users:
  - username: alice
    fullname: "Alice Smith"
    admin: true
    groups: ["wheel", "docker"]
    ssh_public_key: "ssh-ed25519 AAAAC3N... alice@laptop"
    password_hash: "{{ vault_alice_password }}"   # from Ansible Vault

  - username: bob
    fullname: "Bob Jones"
    admin: false
    groups: ["developers"]
    ssh_public_key: "ssh-ed25519 AAAAC3N... bob@laptop"
    password_hash: "{{ vault_bob_password }}"

  - username: charlie_old
    fullname: "Charlie (deprovisioned)"
    state: absent
    groups: []
```

---

## Playbook 4 — Automated Backup

```yaml
# playbooks/backup.yml
---
- name: Database backup and upload to S3
  hosts: db
  become: true
  vars:
    backup_dir: /opt/backups
    s3_bucket: "company-db-backups-{{ ansible_date_time.date }}"
    retention_days: 30
    db_name: appdb
    db_user: appuser

  tasks:
    - name: Ensure backup directory exists
      ansible.builtin.file:
        path:  "{{ backup_dir }}"
        state: directory
        owner: postgres
        group: postgres
        mode:  "0750"

    - name: Run PostgreSQL dump
      ansible.builtin.command:
        cmd: >
          pg_dump
          --no-password
          --format=custom
          --compress=9
          --file={{ backup_dir }}/{{ db_name }}_{{ ansible_date_time.iso8601_basic_short }}.dump
          {{ db_name }}
      become_user: postgres
      environment:
        PGPASSWORD: "{{ vault_db_password }}"
      register: dump_result

    - name: Fail if dump failed
      ansible.builtin.fail:
        msg: "pg_dump failed: {{ dump_result.stderr }}"
      when: dump_result.rc != 0

    - name: Upload dump to S3
      amazon.aws.s3_object:
        bucket: "company-db-backups"
        object: "{{ db_name }}/{{ ansible_date_time.year }}/{{ ansible_date_time.month }}/backup_{{ ansible_date_time.iso8601_basic_short }}.dump"
        src:    "{{ backup_dir }}/{{ db_name }}_{{ ansible_date_time.iso8601_basic_short }}.dump"
        mode:   put
        encrypt: true
      register: s3_upload

    - name: Verify upload succeeded
      ansible.builtin.assert:
        that: s3_upload.changed
        fail_msg: "S3 upload failed"

    - name: Clean up local backups older than {{ retention_days }} days
      ansible.builtin.find:
        paths:   "{{ backup_dir }}"
        age:     "{{ retention_days }}d"
        patterns: "*.dump"
      register: old_backups

    - name: Delete old local backup files
      ansible.builtin.file:
        path:  "{{ item.path }}"
        state: absent
      loop: "{{ old_backups.files }}"

    - name: Report backup summary
      ansible.builtin.debug:
        msg: >
          Backup complete.
          File: {{ s3_upload.key }}
          Size: {{ (s3_upload.expiry | default(0)) }} bytes
          Old files removed: {{ old_backups.files | length }}
```

---

## Playbook 5 — Server Hardening

```yaml
# playbooks/harden.yml
---
- name: CIS-aligned server hardening
  hosts: all
  become: true

  tasks:
    - name: Disable root SSH login
      ansible.builtin.lineinfile:
        path:   /etc/ssh/sshd_config
        regexp: "^#?PermitRootLogin"
        line:   "PermitRootLogin no"
        state:  present
      notify: Restart SSHD

    - name: Disable password authentication (keys only)
      ansible.builtin.lineinfile:
        path:   /etc/ssh/sshd_config
        regexp: "^#?PasswordAuthentication"
        line:   "PasswordAuthentication no"
        state:  present
      notify: Restart SSHD

    - name: Set SSH idle timeout (15 minutes)
      ansible.builtin.blockinfile:
        path:  /etc/ssh/sshd_config
        block: |
          ClientAliveInterval 900
          ClientAliveCountMax 0
      notify: Restart SSHD

    - name: Disable unused services
      ansible.builtin.service:
        name:    "{{ item }}"
        state:   stopped
        enabled: false
      loop:
        - avahi-daemon
        - cups
        - bluetooth
      ignore_errors: true

    - name: Set kernel hardening parameters
      ansible.posix.sysctl:
        name:   "{{ item.name }}"
        value:  "{{ item.value }}"
        state:  present
        reload: true
      loop:
        - { name: "net.ipv4.conf.all.rp_filter",        value: "1" }
        - { name: "net.ipv4.conf.default.rp_filter",    value: "1" }
        - { name: "net.ipv4.tcp_syncookies",             value: "1" }
        - { name: "net.ipv4.conf.all.accept_redirects",  value: "0" }
        - { name: "net.ipv4.conf.all.send_redirects",    value: "0" }
        - { name: "kernel.randomize_va_space",           value: "2" }

    - name: Install and configure fail2ban
      ansible.builtin.dnf:
        name:  fail2ban
        state: present

    - name: Configure fail2ban for SSH
      ansible.builtin.copy:
        content: |
          [sshd]
          enabled  = true
          maxretry = 3
          bantime  = 3600
          findtime = 600
        dest:  /etc/fail2ban/jail.d/sshd.conf
        owner: root
        mode:  "0644"
      notify: Restart fail2ban

  handlers:
    - name: Restart SSHD
      ansible.builtin.service:
        name:  sshd
        state: restarted

    - name: Restart fail2ban
      ansible.builtin.service:
        name:    fail2ban
        state:   restarted
        enabled: true
```

---

## Running Playbooks

```bash
# Dry run (check mode — no changes made)
ansible-playbook playbooks/nginx-setup.yml --check --diff

# Run against specific host group
ansible-playbook playbooks/docker-deploy.yml \
  --limit web-01 \
  -e "app_version=v2.1.0"

# Run with Vault (encrypted secrets)
ansible-playbook playbooks/backup.yml \
  --ask-vault-pass

# Run in parallel (forks = simultaneous hosts)
ansible-playbook playbooks/harden.yml --forks 10

# Tag-based execution (run only tagged tasks)
ansible-playbook playbooks/nginx-setup.yml --tags "install,config"

# Step-by-step (confirm each task)
ansible-playbook playbooks/docker-deploy.yml --step

# Check syntax without running
ansible-playbook playbooks/user-management.yml --syntax-check
```

---

## Interview Questions

**Q: How do you handle secrets in Ansible playbooks?**
> Use Ansible Vault: `ansible-vault encrypt_string 'mysecret' --name 'vault_db_password'`. The encrypted string is stored in vars files or inventory. At runtime, pass `--ask-vault-pass` or `--vault-password-file`. For production, integrate with HashiCorp Vault or AWS Secrets Manager using `community.hashi_vault` or `amazon.aws` lookup plugins instead.

**Q: What's the difference between `when`, `until`, and `loop` in Ansible tasks?**
> `when`: conditional — task only runs if the expression is true. `until`: retry loop — task keeps running until condition is met or retries exhausted (useful for waiting on services). `loop`: iterate — run the same task for each item in a list. They can be combined: `loop` + `when` to apply a condition per item.

**Q: How do you ensure idempotency in Ansible playbooks?**
> Use built-in modules (they are idempotent by design) over `command`/`shell` modules. When you must use `command`, add `creates:` or `removes:` to skip if already done. Use `state: present/absent` declaratively. Test with `--check` to verify nothing changes when re-run on a configured host.

---

[← Terraform AWS](./02-terraform-aws.md) | [Back to Section](./README.md)
