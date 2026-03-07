template {
  contents = <<-EOF
    {{- with secret "kv-llm/data/guardrails" }}
    AUTH_TOKEN={{ .Data.data.auth_token }}
    {{ end }}
  EOF
  destination = "/run/llm-secrets/guardrails.env"
  perms = "0400"
}
