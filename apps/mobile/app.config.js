// Extends app.json with values from the environment or the repository's root .env.
const root = require('./scripts/root-env');

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    // Publishable keys are public by design; the secret key is never read here.
    clerkPublishableKey:
      process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
      root.VITE_CLERK_PUBLISHABLE_KEY ||
      root.CLERK_PUBLISHABLE_KEY ||
      '',
  },
});
