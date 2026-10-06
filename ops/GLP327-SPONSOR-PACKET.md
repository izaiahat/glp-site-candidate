# GLP-327 offline sponsor packet producer

`scripts/glp327_sponsor_packet.py` creates current review PDFs from the site's existing, hash-bound native captures. It does not build, browse, send, draft, install, activate, collect payment or deploy. It rejects changed rendering/pixel bytes, incomplete capture pairs, an enabled campaign and an existing output directory. The old packet stays unchanged.

Dependencies: Python 3.11+, `reportlab==5.0.1 pypdf==6.19.0 pillow==12.3.0` in an isolated venv. Portable synthetic fixture checks are registered in `mirror-ci.yml`; synthetic fixture images are never sponsor evidence.

```sh
python scripts/glp327_sponsor_packet.py \
  --site-root /path/to/exact-site-checkout \
  --business-root /home/ubuntu/business \
  --capture-manifest /home/ubuntu/business/reports/ops/sponsor-clean-layout-20261003/copy/revision-r4/captures/CAPTURE.json \
  --review-gate /home/ubuntu/business/reports/ops/system-resume-20261006/sponsor-execution/REVIEW-GATE.json \
  --out /home/ubuntu/business/reports/ops/sponsor-clean-layout-20261003/copy/packet-NEW-SUCCESSOR
```

The first six PDF pages are the genuine mobile/desktop unscrolled viewports. Attachments contain native pixels, followed by overlapping readable full-page tiles; the directory capture is honestly limited to the first independent results row. Internal review text and exact drafts follow the first screens. The PDF embeds the ZIP and production verifies extracted bytes. ZIP contains current three attachments, disabled configuration/copy, exact draft bytes, actual installed sender snapshot, site/producer sources, 18 original capture images, capture manifest and current supplied review gate. `PACKAGING.json` gives exact archive/PDF/attachment hashes.

## Parent integration (not performed by this producer)

`installation-proposal/ops/sponsor-machine/assets.json` binds the actual six maintained sender/contact/inbox/copy/config dependency snapshots and native attachments. It is not an installed receipt. Parent first installs the independently reviewed maintained business source through the supported importer, then produces the packet from coherent installed bytes. Never blindly install the packet's approval snapshots as source.

Before any authorized promotion, retain the predecessor canonical packet/assets byte-for-byte in immutable evidence. Promote only the reviewed three PDFs, current REVIEW.md, generated assets.json and exact reviewed ZIP to the sender's existing canonical paths. Check each manifest entry against installed bytes and ZIP SHA against the approval. If installed source/copy changes, produce a new successor and get approval for it; never patch the archive or hand-reseal a manifest. Never blindly sync the whole bundle. No runtime approval.json/activation.json is produced; existing job 3940adcf89f6 remains paused.

Izaiah must approve the exact successor prices/copy/campaign and three native attachments. Nu Image is excluded from this packet; its warm conversation is separate. Designated Fable acceptance must cover these successor bytes, not predecessor layout approval. The old request/refusal remains NO_DECISION and cannot approve changed inputs. No new review invocation, paid fallback, capacity redemption or release is authorized by this producer. Full current capture-source tests deliberately fail until fresh admitted successor captures exist; old images are rejected. Shared-resource admission and parent review/install/release gates remain in force.
