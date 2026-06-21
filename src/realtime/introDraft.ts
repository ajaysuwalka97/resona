import type { MatchResult } from "../types/match";

export type IntroDraftProfile = {
  name: string;
  company: string;
};

function compactClause(clause: string, maxChars = 120): string {
  const normalized = clause.trim().replace(/\s+/g, " ").replace(/[.?!]+$/g, "");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const sliced = normalized.slice(0, maxChars).trimEnd();
  const lastSpaceIndex = sliced.lastIndexOf(" ");
  if (lastSpaceIndex > Math.floor(maxChars * 0.6)) {
    return sliced.slice(0, lastSpaceIndex).trimEnd();
  }
  return sliced;
}

export function shortCompanyLabel(company: string): string {
  const trimmed = company.trim();
  if (!trimmed) {
    return "their company";
  }
  const firstClause = trimmed.split(/[:—–-]/)[0]?.trim() ?? trimmed;
  return compactClause(firstClause, 56);
}

export function isSelfConnectorDemo(
  profileName: string,
  connectorName: string,
): boolean {
  const profile = profileName.trim().toLowerCase();
  const connector = connectorName.trim().toLowerCase();
  if (!profile || !connector) {
    return false;
  }
  return profile === connector || profile.startsWith(`${connector} `);
}

export function humanizeNeedPhrase(text: string): string {
  let normalized = text.trim().replace(/[.?!]+$/g, "");
  if (!normalized) {
    return "the immediate outcome they described";
  }

  normalized = normalized
    .replace(/^i have\b/i, "they have")
    .replace(/^i'm\b/i, "they're")
    .replace(/^i am\b/i, "they are")
    .replace(/^i need\b/i, "they need")
    .replace(/^i want\b/i, "they want")
    .replace(/^i'm looking for\b/i, "an")
    .replace(/^i am looking for\b/i, "an")
    .replace(/\bi\b/g, "they")
    .replace(/\bmy\b/g, "their")
    .replace(/\bme\b/g, "them")
    .replace(/\bI'm\b/g, "they're")
    .replace(/\s+/g, " ")
    .trim();

  if (/^an\s+/i.test(normalized)) {
    return compactClause(normalized.replace(/^an\s+/i, ""), 120);
  }

  return compactClause(normalized, 120);
}

export function describeIntroNeed(match: MatchResult): string {
  const needDimension = match.need_dimension?.trim();
  if (needDimension) {
    return compactClause(needDimension, 120);
  }

  const summary = match.situation_summary?.trim();
  if (summary) {
    return humanizeNeedPhrase(summary);
  }

  const bringClaim = match.selection?.topBrings[0]?.claim?.trim();
  if (bringClaim) {
    return compactClause(bringClaim, 120);
  }

  return "the immediate outcome they described";
}

export function createIntroDraft(
  match: MatchResult,
  profile: IntroDraftProfile,
  connectorName = "Ajay",
): string {
  const candidate = match.candidate;
  if (!candidate) {
    return "";
  }

  const need = describeIntroNeed(match);
  const selfDemo = isSelfConnectorDemo(profile.name, connectorName);

  if (selfDemo) {
    return [
      `Hey ${connectorName} — would you warm-intro me to ${candidate.name}?`,
      `I'm looking for ${need}.`,
      `${candidate.name}, if you're open to it, could we do a short call this week to align on the highest-leverage next step?`,
    ].join("\n");
  }

  const founderFirst = profile.name.trim().split(/\s+/)[0] || profile.name;
  const company = shortCompanyLabel(profile.company);

  return [
    `${connectorName}, could you introduce ${profile.name} to ${candidate.name}?`,
    `${founderFirst} is building at ${company} and needs ${need}.`,
    `${candidate.name}, if helpful, would you be open to a short call this week?`,
  ].join("\n");
}
