try {
  require("dotenv").config();
} catch {
  // dotenv is optional for consumers that embed the SDK without the demo workspace.
}

const ARGUS_DEMO_ENV_KEYS = [
  "ARGUS_DEMO_BACKEND_URL",
  "EXPO_PUBLIC_ARGUS_DEMO_BACKEND_URL",
  "ARGUS_DEMO_PARTNER_ID",
  "ARGUS_DEMO_USE_CASE",
];

function argusDemoEnvPlugin({ types: t }) {
  function envObjectExpression() {
    return t.objectExpression(
      ARGUS_DEMO_ENV_KEYS.map((key) =>
        t.objectProperty(
          t.identifier(key),
          process.env[key] ? t.stringLiteral(process.env[key]) : t.identifier("undefined"),
        ),
      ),
    );
  }

  return {
    name: "argus-demo-env",
    visitor: {
      Identifier(path) {
        if (path.node.name !== "__ARGUS_DEMO_ENV__" || !path.isReferencedIdentifier()) {
          return;
        }

        path.replaceWith(envObjectExpression());
      },
    },
  };
}

module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [argusDemoEnvPlugin],
};
