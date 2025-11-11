import { getAppleHomeRows } from "../providers/appleDiscovery.js";

export async function buildHome({ user, storefront, locale }) {
  const hasApple = !!user?.providers?.apple?.musicUserToken;

  // Row assembly (Apple-first for iOS)
  const rows = [];
  if (hasApple) {
    const appleRows = await getAppleHomeRows({ user, storefront });
    rows.push(...appleRows);
  }

  // If no providers or nothing came back:
  return { rows };
}
