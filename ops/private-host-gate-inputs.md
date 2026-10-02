# P0.4 host evidence inputs

This PR is a code/build mirror, not a private affiliate-data export or deploy carrier.

Set two read-only paths outside the checkout before running the host gate:

- `GLP_PRIVATE_EVIDENCE_ROOT`: workspace root containing the historical TRT incident, amendment, click-QA receipt and operator decision at the relative paths declared in `tests/trt-nation-link-dark.test.mjs`.
- `GLP_PRIVATE_APPROVED_REGISTRY`: path to the existing host-custodied approved registry containing the four captured ClickDealer directory rows. The loader consumes only `approved_directory_programs`; it cannot replace the public approval cohort.

Then run `env -u NODE_ENV bash scripts/ci-bootstrap-gate.sh`. Missing inputs remain required failures, never skipped tests.

The loader authenticates the exact four-row capture, each issuer URL digest and existing promotion authority. It does not request URLs, change grants or write private inputs into Git. Runtime output remains ignored. Never commit either external evidence source to make CI green.

P1.3 owns the complete browser-effect release gate. This host gate is not deployment authority.
