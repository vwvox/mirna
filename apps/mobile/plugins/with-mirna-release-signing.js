// Signs release builds with Mirna's own key when the build provides one.
//
// The key never lives in the repo. scripts/build-android.sh reads its location
// and password (from the macOS Keychain) into these environment variables:
//   MIRNA_RELEASE_STORE_FILE, MIRNA_RELEASE_STORE_PASSWORD, MIRNA_RELEASE_KEY_ALIAS
// Without them, release builds fall back to the debug key, as React Native's
// template does.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// mirna-release-signing";

const RELEASE_SIGNING = `
        release { ${MARKER}
            if (System.getenv("MIRNA_RELEASE_STORE_FILE")) {
                storeFile file(System.getenv("MIRNA_RELEASE_STORE_FILE"))
                storePassword System.getenv("MIRNA_RELEASE_STORE_PASSWORD")
                keyAlias System.getenv("MIRNA_RELEASE_KEY_ALIAS")
                keyPassword System.getenv("MIRNA_RELEASE_STORE_PASSWORD")
            }
        }`;

function applyReleaseSigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  const withConfig = gradle.replace(
    /signingConfigs\s*\{/,
    (match) => `${match}${RELEASE_SIGNING}`,
  );
  if (withConfig === gradle) {
    throw new Error("Mirna release signing: no signingConfigs block found");
  }
  // In buildTypes.release, use Mirna's key when present.
  const buildTypes = withConfig.indexOf("buildTypes {");
  const release = withConfig.indexOf("release {", buildTypes);
  const line = withConfig.indexOf("signingConfig signingConfigs.debug", release);
  if (buildTypes < 0 || release < 0 || line < 0) {
    throw new Error("Mirna release signing: no release build type found");
  }
  return (
    withConfig.slice(0, line) +
    'signingConfig System.getenv("MIRNA_RELEASE_STORE_FILE") ? signingConfigs.release : signingConfigs.debug' +
    withConfig.slice(line + "signingConfig signingConfigs.debug".length)
  );
}

module.exports = function withMirnaReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = applyReleaseSigning(config.modResults.contents);
    return config;
  });
};
module.exports.applyReleaseSigning = applyReleaseSigning;
