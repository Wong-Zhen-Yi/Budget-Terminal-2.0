# Certificate security

Budget Terminal is an Electron/TypeScript application. It does not install or run
Python, pip, certifi, uv, or Docker images. Updating those tools does not update
the app's TLS runtimes.

The October 2026 eMudhra/emSign incident affects multiple TLS stacks. An attacker
on the network path can impersonate sites using compromised intermediate keys.
Removing only a root certificate can miss cross-signed chains. We use the vendor's
native SPKI blocklist rather than a custom hostname or certificate-name filter.

- System Node must be 22.23.4+, 24.22.1+, or 26.12.1+ within those major versions.
  The launcher, npm preinstall, and direct dev/build/preview configuration enforce
  this floor. Typechecking and offline probes can still run while fixing a setup.
- Electron must be 44.9.3 or newer. The locked 44.9.3 release includes the 44.x
  backport of Electron PR #55126. Both Chromium and Node TLS reject the compromised
  keys, including Node fetch, HTTPS, and worker connections. Its embedded Node
  version is 24.22.0 **with the Electron fix backported**; comparing that number
  to standalone Node releases would give the wrong result.
- App startup rejects `NODE_TLS_REJECT_UNAUTHORIZED=0`,
  `--ignore-certificate-errors`, `--ignore-certificate-errors-spki-list`, and
  `--allow-insecure-localhost`. The launcher rejects the TLS environment bypass
  before running dependency installation and forces `--strict-ssl=true` for npm.
- Fully close and restart Budget Terminal after an update. Existing processes
  continue using their loaded runtime, and resumed TLS sessions may skip a new
  certificate verification. All implemented pages still preload at startup.

Run `npm run probe:launcher`, `npm run probe:certificates`, and
`npm run typecheck` for offline regression checks. Add `-- --live` to the certificate
probe to check fresh connections against the researcher's twelve public test
hosts, covering direct and cross-signed TLS chains, through system Node,
Electron Node (including a worker), and Chromium. The probe uses TLS handshakes
and unauthenticated HTTPS requests with a temporary profile. A DNS error or timeout does
not count as proof that a compromised chain was rejected.

Separate Python environments on your machine are outside this repository's
runtime. Follow the Python security team's instructions for **each** environment:
upgrade pip to at least 26.2.2, certifi to at least 2026.10.19, uv to at least
0.13.4, and sigstore to at least 4.5.1 where installed; rebuild affected container
images. Updating the OS trust store alone does not repair pip's vendored bundle.
Use the hash-pinned pip bootstrap command in the official announcement if needed.
This repository change does not patch those independent environments or OS stores.

Sources checked 2026-10-23:

- [Python security announcement](https://discuss.python.org/t/information-for-python-users-regarding-emudhra-emsign-ca-certificate-security-incident/109576)
- [Node security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Electron native blocklist fix](https://github.com/electron/electron/pull/55126)
- [44.x backport](https://github.com/electron/electron/pull/55127)
- [Researcher's incident and test hosts](https://we-have-a-problem.com/)
