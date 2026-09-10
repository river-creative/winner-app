# Committed backups — configuration only

This directory holds Winner App backup payloads that have been **screened and contain no personal
data**. It is not the disaster-recovery store; it is version control for configuration that is
otherwise reconstructible only by hand.

## The rule

**A backup payload may be committed only if `lists`, `winners`, `history` and `archive` are all
empty.**

Those four are the only places personal data lives, and when they are populated a payload carries
participants' names, email addresses, mobile numbers and dates of birth — 2,732 of them in the
September 2026 events. This repository is on GitHub. A payload committed once cannot be recalled:
rewriting history does not remove it from clones, forks or caches.

`.gitignore` enforces the default: everything in this directory is ignored unless it is named
explicitly. Un-ignoring a file is therefore a deliberate act, and that is the moment to check the
four collections rather than after pushing.

## Screening a payload before adding one

```
python3 - <<'PY'
import json, re, sys
d = json.load(open(sys.argv[1]))['data']
print({k: len(d.get(k, [])) for k in ('lists', 'winners', 'history', 'archive')})
blob = json.dumps(d)
print('emails:', len(re.findall(r'[\w.+-]+@[\w-]+\.[\w.]+', blob)))
print('phones:', len(re.findall(r'\b\d{3}[-.]\d{3}[-.]\d{4}\b', blob)))
PY
```

All zeros, or it does not belong here.

## What is here

- `2026-09-10-fresh-start-config.json` — backup `0LZT66BT`, version 1.2, taken after the
  production reset. Screened: no personal data. It carries the 13 Ministry Platform query
  definitions, 27 settings and 2 SMS templates — the configuration that took real work to build
  and that nothing else in this repository records.

## What this is *not*

A full recovery copy. It excludes `data/uploads` (the custom background referenced by
`settings.customBackgroundImage`), which is files rather than a collection and outside every
backup payload. For genuine disaster recovery, take a file-level copy of the server's `data/`
directory — see `deploy.sh` for the host, and keep it off this repository.
