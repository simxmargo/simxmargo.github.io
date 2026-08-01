// Deno-side entry point for the email signature.
//
// The implementation lives in `lib/emailSignature.ts` (app-side) because the Settings
// editor must re-render the signature on every keystroke, before anything is saved —
// a server round trip per character is not a preview. Duplicating the builder here
// would be worse: two copies of the markup that composes a real outbound email is
// exactly the kind of drift nobody notices, because nobody proofreads the mail a robot
// sends.
//
// That file is deliberately dependency-free (no framework, no Node/Deno builtins), so
// the same source runs in the browser and in this function.
export {
  buildSignature,
  signatureFields,
  DEFAULT_SIGNATURE,
  type Signature,
  type SignatureFields,
  type SignatureSource,
} from '../../../lib/emailSignature.ts'
