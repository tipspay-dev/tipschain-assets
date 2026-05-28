import { isAddress, getAddress } from "ethers";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";

export const CHAIN_ID = 1925;
export const CHAIN_DIRECTORY = path.resolve(process.cwd(), "tokens", String(CHAIN_ID));
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_ADDRESS_CHECKSUM = getAddress(ZERO_ADDRESS);
export const MAX_LOGO_BYTES = 500 * 1024;
export const REQUIRED_LOGO_DIMENSION = 256;
export const GITHUB_ORG = "tipspay-dev";
export const GITHUB_REPO = "tipschain-assets";
export const TOKEN_LIST_FILE = path.resolve(process.cwd(), "tips-token-list.json");

const tokenInfoSchema = z.object({
  name: z.string().trim().min(1, "Token name is required."),
  symbol: z.string().trim().min(1, "Token symbol is required."),
  decimals: z.number().int().min(0).max(18)
});

export type TokenInfo = z.infer<typeof tokenInfoSchema>;

export interface ValidatedAsset {
  address: string;
  directory: string;
  info: TokenInfo;
  logoPath: string;
}

export interface TokenListVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface TokenListEntry extends TokenInfo {
  chainId: number;
  address: string;
  logoURI: string;
}

export interface TokenListDocument {
  name: string;
  timestamp: string;
  version: TokenListVersion;
  keywords: string[];
  tokens: TokenListEntry[];
}

export class ValidationError extends Error {
  public readonly details: string[];

  public constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export async function ensureChainDirectoryExists(): Promise<void> {
  const stats = await fs.stat(CHAIN_DIRECTORY).catch(() => null);

  if (!stats?.isDirectory()) {
    throw new ValidationError(`Missing chain asset directory: ${CHAIN_DIRECTORY}`);
  }
}

export async function getTokenDirectories(): Promise<string[]> {
  const entries = await fs.readdir(CHAIN_DIRECTORY, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function validateChecksummedAddress(directoryName: string): string {
  if (!isAddress(directoryName)) {
    throw new ValidationError(`Invalid token directory address: ${directoryName}`);
  }

  const checksummedAddress = getAddress(directoryName);

  if (directoryName !== checksummedAddress) {
    throw new ValidationError(
      `Token directory must use the EIP-55 checksummed address.`,
      [`Expected: ${checksummedAddress}`, `Received: ${directoryName}`]
    );
  }

  return checksummedAddress;
}

export async function parseTokenInfo(infoPath: string, address: string): Promise<TokenInfo> {
  const raw = await fs.readFile(infoPath, "utf8").catch((error) => {
    throw new ValidationError(`Missing info.json for ${address}`, [String(error)]);
  });

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ValidationError(`Invalid JSON in ${infoPath}`, [String(error)]);
  }

  const result = tokenInfoSchema.safeParse(parsed);

  if (!result.success) {
    throw new ValidationError(
      `Metadata schema validation failed for ${address}`,
      result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    );
  }

  const info = result.data;

  if (address === ZERO_ADDRESS_CHECKSUM) {
    const nativeAssetErrors: string[] = [];

    if (info.name !== "Tips Coin") {
      nativeAssetErrors.push(`Native asset name must be "Tips Coin", received "${info.name}".`);
    }

    if (info.symbol !== "TPC") {
      nativeAssetErrors.push(`Native asset symbol must be "TPC", received "${info.symbol}".`);
    }

    if (nativeAssetErrors.length > 0) {
      throw new ValidationError(`Native asset metadata validation failed for ${address}`, nativeAssetErrors);
    }
  }

  return info;
}

export async function validateLogo(logoPath: string, address: string): Promise<void> {
  const stats = await fs.stat(logoPath).catch((error) => {
    throw new ValidationError(`Missing logo.png for ${address}`, [String(error)]);
  });

  if (stats.size > MAX_LOGO_BYTES) {
    throw new ValidationError(
      `logo.png exceeds the 500KB limit for ${address}`,
      [`File size: ${stats.size} bytes`]
    );
  }

  let metadata: sharp.Metadata;

  try {
    metadata = await sharp(logoPath, { failOn: "error" }).metadata();
  } catch (error) {
    throw new ValidationError(`Unable to parse logo.png for ${address}`, [String(error)]);
  }

  const errors: string[] = [];

  if (metadata.format !== "png") {
    errors.push(`logo.png must be a true PNG image, received "${metadata.format ?? "unknown"}".`);
  }

  if (metadata.width !== REQUIRED_LOGO_DIMENSION || metadata.height !== REQUIRED_LOGO_DIMENSION) {
    errors.push(
      `logo.png must be exactly ${REQUIRED_LOGO_DIMENSION}x${REQUIRED_LOGO_DIMENSION}px, received ${metadata.width ?? "unknown"}x${metadata.height ?? "unknown"}px.`
    );
  }

  if (metadata.width !== metadata.height) {
    errors.push(`logo.png must have a strict 1:1 aspect ratio.`);
  }

  if (errors.length > 0) {
    throw new ValidationError(`Logo validation failed for ${address}`, errors);
  }
}

export async function validateTokenDirectory(directoryName: string): Promise<ValidatedAsset> {
  const address = validateChecksummedAddress(directoryName);
  const directory = path.join(CHAIN_DIRECTORY, directoryName);
  const infoPath = path.join(directory, "info.json");
  const logoPath = path.join(directory, "logo.png");
  const info = await parseTokenInfo(infoPath, address);

  await validateLogo(logoPath, address);

  return {
    address,
    directory,
    info,
    logoPath
  };
}

export async function collectValidatedAssets(): Promise<ValidatedAsset[]> {
  await ensureChainDirectoryExists();

  const directories = await getTokenDirectories();
  const assets: ValidatedAsset[] = [];
  const errors: string[] = [];

  for (const directoryName of directories) {
    try {
      assets.push(await validateTokenDirectory(directoryName));
    } catch (error) {
      if (error instanceof ValidationError) {
        errors.push(formatValidationError(error));
        continue;
      }

      throw error;
    }
  }

  if (errors.length > 0) {
    throw new ValidationError("Asset validation failed.", errors);
  }

  const hasNativeAsset = assets.some((asset) => asset.address === ZERO_ADDRESS_CHECKSUM);

  if (!hasNativeAsset) {
    throw new ValidationError(`Missing required native asset directory: ${ZERO_ADDRESS_CHECKSUM}`);
  }

  return assets;
}

export function buildLogoUri(address: string): string {
  return `https://raw.githubusercontent.com/${GITHUB_ORG}/${GITHUB_REPO}/main/tokens/${CHAIN_ID}/${address}/logo.png`;
}

export function nextPatchVersion(existing: unknown): TokenListVersion {
  const schema = z.object({
    version: z.object({
      major: z.number().int().min(0),
      minor: z.number().int().min(0),
      patch: z.number().int().min(0)
    })
  });

  const parsed = schema.safeParse(existing);

  if (!parsed.success) {
    return { major: 1, minor: 0, patch: 0 };
  }

  return {
    major: parsed.data.version.major,
    minor: parsed.data.version.minor,
    patch: parsed.data.version.patch + 1
  };
}

export async function readExistingTokenList(): Promise<unknown | null> {
  const raw = await fs.readFile(TOKEN_LIST_FILE, "utf8").catch(() => null);

  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ValidationError(`Existing ${path.basename(TOKEN_LIST_FILE)} contains invalid JSON.`, [String(error)]);
  }
}

export async function writeTokenList(document: TokenListDocument): Promise<void> {
  await fs.writeFile(TOKEN_LIST_FILE, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export function formatValidationError(error: ValidationError): string {
  if (error.details.length === 0) {
    return error.message;
  }

  return [error.message, ...error.details.map((detail) => `  - ${detail}`)].join("\n");
}
