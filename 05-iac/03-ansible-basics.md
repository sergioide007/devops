# Ansible — Configuration Management

> Ansible configures servers and deploys applications.
> It connects via SSH — no agent needed on target servers.
> YAML playbooks describe the desired state.

---

## Install Ansible

```bash
# Ubuntu
sudo apt install python3-pip -y
pip3 install ansible

# Or via apt
sudo apt-add-repository ppa:ansible/ansible
sudo apt update
sudo apt install ansible -y

# Verify
ansible --version

# Install additional modules
ansible-galaxy collection install amazon.aws
ansible-galaxy collection install community.docker
ansible-galaxy collection install community.kubernetes
```

---

## Inventory — Define Your Servers

```ini
# inventory.ini

[web_servers]
web1.mycompany.com ansible_user=ec2-user ansible_ssh_private_key_file=~/.ssh/prod.pem
web2.mycompany.com ansible_user=ec2-user ansible_ssh_private_key_file=~/.ssh/prod.pem
10.0.1.5          ansible_user=ubuntu

[db_servers]
db1.mycompany.com ansible_user=ec2-user

[monitoring]
grafana.mycompany.com ansible_user=ubuntu

[production:children]
web_servers
db_servers

[staging]
staging-web ansible_host=10.0.2.10 ansible_user=ubuntu

[all:vars]
ansible_python_interpreter=/usr/bin/python3
```

```yaml
# inventory.yaml (YAML format)
all:
  children:
    production:
      children:
        web_servers:
          hosts:
            web1.mycompany.com:
              ansible_user: ec2-user
            web2.mycompany.com:
              ansible_user: ec2-user
        db_servers:
          hosts:
            db1.mycompany.com:
              ansible_user: ec2-user
    staging:
      hosts:
        staging-web:
          ansible_host: 10.0.2.10
          ansible_user: ubuntu
  vars:
    ansible_ssh_private_key_file: ~/.ssh/prod.pem
```

---

## Basic Commands

```bash
# Test connection (ping)
ansible all -i inventory.ini -m ping
ansible web_servers -i inventory.ini -m ping

# Run a command on all servers
ansible all -i inventory.ini -m shell -a "uptime"
ansible web_servers -i inventory.ini -m shell -a "systemctl status nginx"

# Copy a file
ansible web_servers -i inventory.ini -m copy \
    -a "src=/local/file.conf dest=/etc/app/file.conf"

# Install a package
ansible web_servers -i inventory.ini -m apt \
    -a "name=nginx state=present" \
    --become    # use sudo

# Run a playbook
ansible-playbook -i inventory.ini playbook.yml
ansible-playbook -i inventory.ini playbook.yml --dry-run  # check mode
ansible-playbook -i inventory.ini playbook.yml -v         # verbose
ansible-playbook -i inventory.ini playbook.yml -vvv       # very verbose
ansible-playbook -i inventory.ini playbook.yml --limit web1.mycompany.com  # only one server
ansible-playbook -i inventory.ini playbook.yml --tags install  # only tagged tasks
```

---

## Playbooks — The Core of Ansible

```yaml
# site.yml — Main playbook

---
# Configure all web servers
- name: Configure web servers
  hosts: web_servers
  become: yes               # run as root (sudo)
  gather_facts: yes         # collect server info (OS, memory, etc.)

  vars:
    nginx_port: 80
    app_user: devops
    app_dir: /opt/my-app
    node_version: "20"

  pre_tasks:
    - name: Update apt cache
      apt:
        update_cache: yes
        cache_valid_time: 3600  # don't update if less than 1 hour old
      when: ansible_os_family == "Debian"

  roles:
    - common          # installed on all servers
    - nginx           # web server
    - app             # application

  post_tasks:
    - name: Verify nginx is running
      service_facts:

    - name: Assert nginx is active
      assert:
        that: "ansible_facts.services['nginx.service'].state == 'running'"
        fail_msg: "Nginx is not running!"
        success_msg: "Nginx is running correctly"

---
# Configure database servers
- name: Configure database servers
  hosts: db_servers
  become: yes

  roles:
    - common
    - postgresql
```

---

## Real Playbook — Deploy Application

```yaml
# deploy.yml — Deploy application to production servers
---
- name: Deploy my-api to production
  hosts: web_servers
  become: yes
  serial: 1                 # deploy to one server at a time (rolling deploy)

  vars:
    app_name: my-api
    app_version: "{{ version | default('latest') }}"
    app_dir: /opt/my-api
    app_user: appuser
    registry: registry.mycompany.com

  tasks:
    - name: Remove server from load balancer
      shell: |
        aws elbv2 deregister-targets \
            --target-group-arn {{ target_group_arn }} \
            --targets Id={{ instance_id }}
      delegate_to: localhost

    - name: Wait for connections to drain
      pause:
        seconds: 30

    - name: Pull new Docker image
      docker_image:
        name: "{{ registry }}/{{ app_name }}:{{ app_version }}"
        source: pull
        force_source: yes

    - name: Stop old container
      docker_container:
        name: "{{ app_name }}"
        state: stopped
      ignore_errors: yes

    - name: Start new container
      docker_container:
        name: "{{ app_name }}"
        image: "{{ registry }}/{{ app_name }}:{{ app_version }}"
        state: started
        restart_policy: unless-stopped
        ports:
          - "8080:8080"
        env:
          APP_ENV: production
          DATABASE_URL: "{{ db_url }}"
        volumes:
          - /var/log/app:/app/logs

    - name: Wait for application to be healthy
      uri:
        url: "http://localhost:8080/health"
        status_code: 200
      register: health_check
      retries: 12
      delay: 10
      until: health_check.status == 200

    - name: Add server back to load balancer
      shell: |
        aws elbv2 register-targets \
            --target-group-arn {{ target_group_arn }} \
            --targets Id={{ instance_id }}
      delegate_to: localhost

    - name: Notify Slack
      uri:
        url: "{{ slack_webhook_url }}"
        method: POST
        body_format: json
        body:
          text: "✅ Deployed {{ app_name }}:{{ app_version }} to {{ inventory_hostname }}"
      delegate_to: localhost
```

---

## Roles — Organize and Reuse

```
roles/
└── nginx/
    ├── tasks/
    │   └── main.yml     # tasks
    ├── handlers/
    │   └── main.yml     # handlers (e.g., reload nginx)
    ├── templates/
    │   └── nginx.conf.j2  # Jinja2 template
    ├── files/
    │   └── index.html   # static files
    ├── vars/
    │   └── main.yml     # role variables
    └── defaults/
        └── main.yml     # default variables (lowest priority)
```

```yaml
# roles/nginx/tasks/main.yml
---
- name: Install nginx
  apt:
    name: nginx
    state: present

- name: Create nginx config
  template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    mode: '0644'
  notify:
    - Reload nginx      # runs handler

- name: Create app config
  template:
    src: app.conf.j2
    dest: /etc/nginx/sites-available/my-app
  notify:
    - Reload nginx

- name: Enable site
  file:
    src: /etc/nginx/sites-available/my-app
    dest: /etc/nginx/sites-enabled/my-app
    state: link
  notify:
    - Reload nginx

- name: Start and enable nginx
  systemd:
    name: nginx
    state: started
    enabled: yes
    daemon_reload: yes
```

```yaml
# roles/nginx/handlers/main.yml
---
- name: Reload nginx
  systemd:
    name: nginx
    state: reloaded

- name: Restart nginx
  systemd:
    name: nginx
    state: restarted
```

```nginx
# roles/nginx/templates/app.conf.j2
# Jinja2 template — variables replaced at runtime
server {
    listen {{ nginx_port }};
    server_name {{ inventory_hostname }};

    location / {
        proxy_pass http://localhost:{{ app_port }};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://localhost:{{ app_port }}/health;
        access_log off;
    }
}
```

---

## Ansible Vault — Encrypt Secrets

```bash
# Encrypt a file
ansible-vault encrypt secrets.yml

# Decrypt
ansible-vault decrypt secrets.yml

# Edit encrypted file
ansible-vault edit secrets.yml

# Encrypt inline string
ansible-vault encrypt_string 'myPassword123!' --name 'db_password'
# Outputs:
# db_password: !vault |
#           $ANSIBLE_VAULT;1.1;AES256
#           6161...

# Use vault password file (for CI/CD)
echo "my-vault-password" > .vault-pass
chmod 600 .vault-pass
ansible-playbook playbook.yml --vault-password-file .vault-pass
# Or set env var:
export ANSIBLE_VAULT_PASSWORD_FILE=.vault-pass
```

```yaml
# group_vars/all/vault.yml (encrypted)
# After decryption, contains:
vault_db_password: "superSecretPassword!"
vault_api_key: "sk-1234abcd"
vault_slack_webhook: "https://hooks.slack.com/..."

# group_vars/all/main.yml (not encrypted)
db_password: "{{ vault_db_password }}"
api_key: "{{ vault_api_key }}"
slack_webhook_url: "{{ vault_slack_webhook }}"
```

---

## Dynamic Inventory — AWS

```bash
# Install AWS dynamic inventory
pip3 install boto3
ansible-galaxy collection install amazon.aws

# Use AWS dynamic inventory
ansible-inventory -i aws_ec2.yml --list

# aws_ec2.yml
plugin: amazon.aws.aws_ec2
regions:
  - us-east-1
keyed_groups:
  - key: tags.Environment
    prefix: env
  - key: tags.Role
    prefix: role
filters:
  instance-state-name: running

# Now you can use groups based on tags:
ansible env_production -m ping
ansible role_web_server -a "uptime"
```

---

## Interview Questions — Ansible

**Q: What is idempotency and why is it important?**
> "Idempotency means running the same operation multiple times gives the same result.
> If Ansible installs nginx and nginx is already installed, it does nothing — it doesn't
> reinstall. This is important because I can run the same playbook 10 times safely, and
> it will only make changes when something is out of desired state. If a server drifts
> from configuration, the next playbook run fixes it automatically."

**Q: When would you use Terraform vs Ansible?**
> "Terraform is for provisioning infrastructure — creating VPCs, EC2 instances, RDS
> databases in AWS. Ansible is for configuration management — installing packages,
> configuring services, deploying application code to those servers. I use them together:
> Terraform creates the infrastructure, outputs the server IPs, and Ansible configures them."

---

[← Back to Section](./README.md) | [Next: Ansible Playbooks →](./04-ansible-playbooks.md)
