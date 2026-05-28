import {
  buildLogoUri,
  CHAIN_ID,
  collectValidatedAssets,
  formatValidationError,
  nextPatchVersion,
  readExistingTokenList,
  TOKEN_LIST_FILE,
  TokenListDocument,
  ValidationError,
  writeTokenList,
  ZERO_ADDRESS_CHECKSUM
} from "./lib/asset-registry";

function sortTokensWithNativeFirst(tokens: TokenListDocument["tokens"]): TokenListDocument["tokens"] {
  const nativeToken = tokens.find((token) => token.address === ZERO_ADDRESS_CHECKSUM);
  const otherTokens = tokens
    .filter((token) => token.address !== ZERO_ADDRESS_CHECKSUM)
    .sort((left, right) => left.symbol.localeCompare(right.symbol) || left.name.localeCompare(right.name));

  return nativeToken ? [nativeToken, ...otherTokens] : otherTokens;
}

async function main(): Promise<void> {
  const assets = await collectValidatedAssets();
  const existing = await readExistingTokenList();
  const version = nextPatchVersion(existing);

  const tokens = sortTokensWithNativeFirst(
    assets.map((asset) => ({
      chainId: CHAIN_ID,
      address: asset.address,
      name: asset.info.name,
      symbol: asset.info.symbol,
      decimals: asset.info.decimals,
      logoURI: buildLogoUri(asset.address)
    }))
  );

  const document: TokenListDocument = {
    name: "TipsChain Asset Registry",
    timestamp: new Date().toISOString(),
    version,
    keywords: ["tipschain", "evm", "assets", "token-list"],
    tokens
  };

  await writeTokenList(document);
  console.log(`Generated ${TOKEN_LIST_FILE} with ${tokens.length} tokens at version ${version.major}.${version.minor}.${version.patch}.`);
}

main().catch((error: unknown) => {
  if (error instanceof ValidationError) {
    console.error(formatValidationError(error));
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
