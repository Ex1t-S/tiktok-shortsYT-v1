const { createApp } = require("./src/app");
const { env } = require("./src/config/env");
const { getYoutubeOauthDiagnostics } = require("./src/services/youtubeService");

async function main() {
  const app = await createApp();
  const youtubeOauth = getYoutubeOauthDiagnostics();

  app.listen(env.port, () => {
    console.log(`Server listening on port ${env.port}`);

    if (youtubeOauth.ready) {
      console.log(`YouTube OAuth ready. Redirect URI: ${youtubeOauth.redirectUri}`);
      if (!youtubeOauth.matchesExpectedLocalRedirectUri) {
        console.warn(
          `Configured GOOGLE_REDIRECT_URI does not match the local default callback ${youtubeOauth.expectedLocalRedirectUri}`
        );
      }
      return;
    }

    console.warn(
      `YouTube OAuth is not ready. Missing: ${youtubeOauth.missingVariables.join(", ")}`
    );
    console.warn(
      `For localhost testing, set GOOGLE_REDIRECT_URI to ${youtubeOauth.expectedLocalRedirectUri}`
    );
  });
}

main().catch((error) => {
  console.error("Failed to start application", error);
  process.exit(1);
});
