// Re-export shim. The implementation moved to `lib/outreach/hosts.ts` so that the
// Deno functions, the browser bundle and the Node cleanup script all rank addresses
// through ONE definition of "does this belong to this brand?".
//
// Deno resolves this upward path fine — `sendPitch.ts` has imported `lib/emailBody.ts`
// the same way through every deploy. Kept as a shim rather than rewriting the three
// call sites so the import paths inside `_shared/` stay uniform.

export {
  apexHost,
  brandFromTitle,
  domainLabel,
  emailBelongsToBrand,
  hasPlausibleTld,
  hostOf,
  isLinkAggregator,
  isNotABrandName,
  isPlausibleBrandHost,
  LINK_AGGREGATORS,
  squash,
} from '../../../lib/outreach/hosts.ts'
