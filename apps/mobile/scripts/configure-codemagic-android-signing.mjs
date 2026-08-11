import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredVariables = [
  "CM_KEYSTORE_PATH",
  "CM_KEYSTORE_PASSWORD",
  "CM_KEY_ALIAS",
  "CM_KEY_PASSWORD"
];

const missingVariables = requiredVariables.filter((name) => !process.env[name]);
if (missingVariables.length > 0) {
  throw new Error(`Missing Codemagic Android signing variables: ${missingVariables.join(", ")}`);
}

const gradlePath = resolve(process.cwd(), "android", "app", "build.gradle");
const gradleSource = readFileSync(gradlePath, "utf8");

const generatedSigningBlock = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const codemagicSigningBlock = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file(System.getenv("CM_KEYSTORE_PATH"))
            storePassword System.getenv("CM_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CM_KEY_ALIAS")
            keyPassword System.getenv("CM_KEY_PASSWORD")
        }
    }`;

const generatedReleaseSigning = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
const codemagicReleaseSigning = "            signingConfig signingConfigs.release";

if (!gradleSource.includes(generatedSigningBlock)) {
  throw new Error("Expo Android signing block changed; update the Codemagic signing patch before releasing");
}

if (!gradleSource.includes(generatedReleaseSigning)) {
  throw new Error("Expo Android release build block changed; update the Codemagic signing patch before releasing");
}

const signedGradleSource = gradleSource
  .replace(generatedSigningBlock, codemagicSigningBlock)
  .replace(generatedReleaseSigning, codemagicReleaseSigning);

writeFileSync(gradlePath, signedGradleSource, "utf8");
console.log("Configured the generated Android release build for Codemagic signing.");
