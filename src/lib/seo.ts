export const SITE_NAME = "y4ho0's Garden";
export const SITE_URL = "https://y4ho0.github.io";
export const SITE_DESCRIPTION =
  "A quiet digital garden for notes, experiments, projects, and essays.";

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, SITE_URL).toString();
}
