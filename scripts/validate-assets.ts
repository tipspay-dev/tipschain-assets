import { collectValidatedAssets, formatValidationError, ValidationError } from "./lib/asset-registry";

async function main(): Promise<void> {
  const assets = await collectValidatedAssets();
  console.log(`Validated ${assets.length} asset director${assets.length === 1 ? "y" : "ies"} successfully.`);
}

main().catch((error: unknown) => {
  if (error instanceof ValidationError) {
    console.error(formatValidationError(error));
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
