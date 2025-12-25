# Runbook: [Titlu Incident]

## Simptome

- Ce vede utilizatorul/alertele
- Care sunt indicatorii din dashboard
- Ce loguri apar

## Cauze Posibile

1. Cauza principală
2. Cauză secundară
3. Alte posibilități

## Diagnoză Rapidă

```bash
# Verificare status serviciu
docker compose ps

# Verificare logs recent
docker compose logs --tail 100 backend-worker

# Verificare metrici
curl http://localhost:65024/api/health
```

## Remediere

### Opțiunea A: [Remediere Rapidă]

```bash
# Pași de remediere
# 1. ...
# 2. ...
```

### Opțiunea B: [Remediere Completă]

```bash
# Pași pentru fix permanent
```

### Opțiunea C: Escalare

Dacă pașii de mai sus nu funcționează:

1. Contactează [echipa responsabilă]
2. Documentează ce ai încercat
3. Colectează logs suplimentare: `docker compose logs > incident-$(date +%Y%m%d).log`

## Verificare Post-Remediere

- [ ] Serviciul răspunde la health check
- [ ] Metrici revenue la normal
- [ ] Alerte clearate
- [ ] Utilizatorii pot folosi aplicația

## Post-mortem Checklist

- [ ] Log-uri colectate și păstrate
- [ ] Timeline documentat
- [ ] Root cause identificat
- [ ] Acțiuni preventive definite
- [ ] Runbook-ul actualizat dacă e cazul
