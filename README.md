# NwiseKit

Combinatorial coverage for the tests you already have.

NwiseKit measures which valid combinations of explicitly modelled
parameter values (roles, plans, feature flags, regions and other finite
dimensions) an existing test suite covers, lists the missing
interactions, and recommends extra configurations to close the gaps.

> **Status:** under development. Nothing has been published to npm yet,
> and the commands below are being built.

## Development

Requires Node.js 24.

```bash
npm ci
npm run verify
```

`verify` runs the format check, lint, type check, unit tests and build.

After cloning, enable the commit message hook and template:

```bash
git config core.hooksPath .githooks
git config commit.template .gitmessage.txt
```

## License

[MIT](LICENSE)
