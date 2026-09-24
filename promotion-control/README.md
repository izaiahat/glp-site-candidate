# GLP P1 promotion-preparation control plane (held)

This directory is the versioned, local-only successor control plane. It does not confer external acceptance or operator authority.

## Fixed identities

- Candidate: `/home/ubuntu/business/site-system/flagship-v2/staging/glp-consumer-national-wow-p1-promotion-candidate-20260724`
- Report root: `/home/ubuntu/business/reports/glp-clinic-scout/national-wow-p1-promotion-candidate-20260724`
- Cloudflare Pages project: `glp-clinic-scout`
- Preview branch: `glp-go1-20260724` (the production branch is rejected)
- Deploy root: the candidate `public/` plus sibling `functions/` discovered from the fixed candidate working directory
- Pinned CLI: `wrangler@4.102.0`
- Production D1 binding contract: `GLP_DB`

## Safe commands

```bash
npm run seal:promotion-candidate
npm run test:promotion-control
npm run preview:plan
python3 promotion-control/bin/verify_preview.py --help
python3 promotion-control/bin/rollback.py --help
python3 promotion-control/bin/validate_release.py
```

`preview_deploy.py` plans only by default. A real preview requires both `--apply` and a fresh exact authorization file. It has no branch/project/root override. `main` is rejected in code.

`verify_preview.py` is GET/HEAD-only and requires `--live-read-only` before network access. Its offline fixture mode is used by tests.

`rollback.py` is held by default. A rollback requires `--apply`, an exact unconsumed, unexpired operator authorization, and a Cloudflare API token supplied only through the environment. No authorization file or secret is created here.

The production grammar is `PROMOTE GLP-P1 <release-manifest-sha256>`, but the generated manifest remains ineligible while preview receipt, fresh successor acceptance, and separate operator authority are absent. Affiliate and capture gates remain explicitly ineligible.
