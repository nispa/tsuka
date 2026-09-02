interface PackageMetadata {
  name: string;
  version: string;
}

// The relative path is identical from src/core and compiled dist/core.
const packageMetadata = require('../../package.json') as PackageMetadata;

/** Product metadata sourced from package.json, the release manifest. */
export const TSUKA_PACKAGE = Object.freeze({
  name: packageMetadata.name,
  version: packageMetadata.version,
  userAgent: `TSUKA/${packageMetadata.version}`,
});
