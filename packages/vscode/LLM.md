# Hanzo for VS Code (hanzo-ide)

The build, the models, the MCP server and @hanzo are in the root `LLM.md`. This
file is how `hanzo-ai.hanzo-ide` reaches the stores.

## Publishing

`.github/workflows/publish.yml` publishes `dist/hanzo-ide.vsix`, packaged once
by `make check` (`vsce package --no-dependencies`), to the VS Code Marketplace
with `VSCE_PAT` and to Open VSX with `OVSX_PAT`. Both are read from KMS, org
`hanzo`, env `prod`, path `/extension-publish`. A store gets a version only when
its public API does not list it yet; a store whose token KMS lacks is skipped
with a notice in `Publish summary`, and the run stays green. A release is a
bump of `version` in `package.json`.

When KMS enforces grants, the CI identity's read grant on `/extension-publish`
(universe `charts/app/values/hanzo/kms-grants.yaml`, holder `hanzo-ci`) must
name both keys.

## Owner steps

Done once, by whoever owns the store accounts. No value goes in git.

1. **Marketplace publisher.** Sign in at
   https://marketplace.visualstudio.com/manage with the Microsoft account that
   will own it. Create publisher: ID `hanzo-ai` (it must equal `publisher` in
   `package.json`), name `Hanzo AI`.
2. **Azure DevOps PAT.** At https://dev.azure.com (create an organization if the
   account has none): User settings → Personal access tokens → New Token.
   Organization: **All accessible organizations**. Scopes: **Custom defined** →
   Show all scopes → **Marketplace: Manage**. Longest expiry. Copy the token,
   then check it can publish as `hanzo-ai`:

   ```sh
   read -rs VSCE_PAT && export VSCE_PAT
   pnpm --filter hanzo-ide exec vsce verify-pat hanzo-ai
   ```

3. **Open VSX.** Sign in at https://open-vsx.org with GitHub. Settings →
   Profile → Log in with Eclipse (create the Eclipse Foundation account if there
   is none) and sign the Eclipse Foundation Open VSX Publisher Agreement.
   Settings → Access Tokens → Generate New Token, and copy it. Then create the
   namespace and check the token:

   ```sh
   read -rs OVSX_PAT && export OVSX_PAT
   npx --yes ovsx@1.2.0 create-namespace hanzo-ai
   npx --yes ovsx@1.2.0 verify-pat hanzo-ai
   ```

4. **KMS.** Signed in with `hanzo auth login`:

   ```sh
   hanzo --as hanzo kms secrets create --env prod --path /extension-publish --name VSCE_PAT --value '<value>'
   hanzo --as hanzo kms secrets create --env prod --path /extension-publish --name OVSX_PAT --value '<value>'
   hanzo --as hanzo kms secrets get --env prod --path /extension-publish
   ```

   The last lists the names, never the values.

5. **Ship.** `gh workflow run publish -R hanzoai/extension` publishes the
   current version, since neither store has it yet. `Publish summary` names each
   store it reached.

The Azure DevOps PAT expires; renew it with steps 2 and 4.
