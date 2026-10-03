/**
 * Provision or disable the PortOne reviewer account.
 *
 * Password is read from PORTONE_REVIEWER_PASSWORD only. Never pass it as a
 * CLI flag and never commit the plaintext.
 *
 *   PORTONE_REVIEWER_PASSWORD=... npx tsx scripts/provision-portone-reviewer.ts
 *   npx tsx scripts/provision-portone-reviewer.ts --deactivate
 *   npx tsx scripts/provision-portone-reviewer.ts --activate
 */
import { getDb } from "../src/lib/db";
import {
  findPortoneReviewerAccount,
  provisionPortoneReviewerAccount,
  setPortoneReviewerLoginDisabled,
} from "../src/lib/portoneReviewerAccount";

function parseArgs(argv: string[]) {
  let deactivate = false;
  let activate = false;
  let email = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--deactivate") deactivate = true;
    else if (arg === "--activate") activate = true;
    else if (arg === "--email" && argv[i + 1]) email = argv[++i].trim();
  }
  return { deactivate, activate, email };
}

function main() {
  const { deactivate, activate, email } = parseArgs(process.argv.slice(2));
  getDb();

  if (deactivate || activate) {
    const existing = findPortoneReviewerAccount();
    if (!existing) {
      console.error("PortOne reviewer account is not provisioned.");
      process.exit(1);
    }
    setPortoneReviewerLoginDisabled(existing.id, deactivate);
    console.log(
      deactivate
        ? `Disabled reviewer login and revoked sessions: #${existing.id}`
        : `Enabled reviewer login: #${existing.id}`
    );
    return;
  }

  const password = process.env.PORTONE_REVIEWER_PASSWORD ?? "";
  if (!password) {
    console.error("Set PORTONE_REVIEWER_PASSWORD in the operator environment.");
    process.exit(1);
  }

  const result = provisionPortoneReviewerAccount({
    password,
    email: email || undefined,
  });
  console.log(
    result.created
      ? `Provisioned reviewer #${result.userId} alias=${result.alias}`
      : `Updated reviewer #${result.userId} alias=${result.alias}`
  );
  console.log("Login alias is tester. Password was not printed.");
}

main();
