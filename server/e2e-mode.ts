export function isE2ETestMode() {
  return process.env.WATCHTOGETHER_E2E === "true";
}
