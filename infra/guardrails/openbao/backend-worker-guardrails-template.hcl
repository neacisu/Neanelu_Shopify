template {
  contents = <<-EOF
    {{- with secret "kv-llm/data/guardrails" }}
    GUARDRAILS_AUTH_TOKEN={{ .Data.data.auth_token }}
    GUARDRAILS_API_URL=http://10.0.1.10:49004
    {{ end }}
  EOF
  destination = "/run/neanelu-dev/runtime-secrets/api/guardrails.env"
  perms = "0400"
}
