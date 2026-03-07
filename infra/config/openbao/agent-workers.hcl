# =============================================================================
# OpenBao Agent Configuration: Neanelu Workers
# =============================================================================

pid_file = "/tmp/openbao-agent.pid"
log_level = "info"

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path                   = "/openbao/config/role_id"
      secret_id_file_path                 = "/openbao/config/secret_id"
      remove_secret_id_file_after_reading = false
    }
  }
}

vault {
  address = "https://s3cr3ts.neanelu.ro"
  retry {
    num_retries = 5
  }
}

template {
  source      = "/openbao/templates/neanelu-workers.env.ctmpl"
  destination = "/secrets/neanelu-workers.env"
  perms       = 0600
  error_on_missing_key = true
  command         = "/bin/sh -c 'touch /secrets/.credentials-rotated'"
  command_timeout = "10s"
  wait { min = "2s" max = "10s" }
}

telemetry {
  prometheus_retention_time = "60s"
  disable_hostname          = true
}

