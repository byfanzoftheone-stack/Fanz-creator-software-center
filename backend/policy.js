// Voice-clone rules. Order of precedence: deny > require_approval > allow
// (same order as the Organism Policy Engine). Every decision carries a
// plain-words reason, because a refusal should say what can be done instead.

const MAX_SPEAK_CHARS = 1000;
const CONSENT_TTL_MS = 10 * 60 * 1000;      // record the statement within 10 minutes
const CLONE_WINDOW_MS = 30 * 60 * 1000;     // submit samples within 30 minutes of passing

function decide(action, ctx = {}) {
  const deny = (rule, reason) => ({ decision: 'deny', rule, reason });
  switch (action) {
    case 'consent.start': {
      if (ctx.is_adult !== true)
        return deny('VC-1', 'Voices of anyone under 18 are never cloned. A person handles anything involving a child.');
      if (ctx.is_public_figure !== false)
        return deny('VC-2', 'Public figures are not cloned here — their voices are the ones most often used to mislead people.');
      if (!ctx.owner_name || ctx.owner_name.trim().split(/\s+/).length < 2)
        return deny('VC-3', 'Enter the voice owner\'s first and last name so the consent statement can name them.');
      return { decision: 'allow', rule: 'VC-0', reason: 'Consent can begin.' };
    }
    case 'voice.create': {
      const c = ctx.consent;
      if (!c) return deny('VC-3', 'No consent record was found for this request.');
      if (c.status !== 'passed')
        return deny('VC-3', `Consent is "${c.status}", not passed. Record the consent statement first.`);
      if (Date.now() - new Date(c.checked_at).getTime() > CLONE_WINDOW_MS)
        return deny('VC-3', 'Consent passed more than 30 minutes ago. Start a fresh consent so it is current.');
      return { decision: 'require_approval', rule: 'VC-4', reason: 'Consent passed. The voice is held until the owner approves it.' };
    }
    case 'voice.speak': {
      const v = ctx.voice;
      if (!v || v.status !== 'active')
        return deny('VC-5', 'This voice is not approved and active, so it cannot speak.');
      const len = (ctx.text || '').trim().length;
      if (!len) return deny('VC-6', 'Type something for the voice to say.');
      if (len > MAX_SPEAK_CHARS)
        return deny('VC-6', `Keep it to ${MAX_SPEAK_CHARS} characters or fewer per request.`);
      return { decision: 'allow', rule: 'VC-6', reason: 'Active voice, within limits.' };
    }
    case 'voice.revoke':
      return { decision: 'allow', rule: 'VC-7', reason: 'Revoking is always allowed.' };
    default:
      return deny('VC-X', `Unknown action "${action}" — refused by default.`);
  }
}

// ---- consent statement check -------------------------------------------

const WORDS = ('amber anchor apple arrow aspen autumn badge banjo barley beacon berry birch blaze bloom bluff bramble breeze brook bronze cabin cactus candle canyon carbon cedar chalk cherry cider clover cobalt comet copper coral cotton crane creek crystal daisy delta desert dune eagle ember falcon fern fiddle flint forest fossil garden garnet glacier granite gravel harbor hazel heron hickory honey horizon island ivory jasper juniper kettle lagoon lantern lemon lilac linen locket lotus magnet maple marble meadow mesa mint mirror moss nickel nutmeg oak oasis ocean olive orchard otter paddle pebble pepper pine planet plum pocket prairie quartz quill rabbit raven ribbon river robin rocket saddle sage salmon sapphire seashell shadow silver sparrow spruce stone summit sunset thistle thunder timber topaz tulip valley velvet violet walnut willow window winter yarrow zephyr').split(' ');

function makeCode(rand) {
  const pick = () => WORDS[rand(WORDS.length)];
  let a = pick(), b = pick(), c = pick();
  while (b === a) b = pick();
  while (c === a || c === b) c = pick();
  return [a, b, c];
}

function makePhrase(ownerName, codeWords) {
  return `My name is ${ownerName.trim()}. I agree to let Creator Center make an AI copy of my voice. My code is ${codeWords.join(' ')}.`;
}

const norm = s => ' ' + String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

function checkStatement(transcript, ownerName, codeWords) {
  const t = norm(transcript);
  const has = w => t.includes(' ' + norm(w).trim() + ' ');
  const nameParts = norm(ownerName).trim().split(' ').filter(p => p.length >= 2);
  const missingName = nameParts.filter(p => !has(p));
  const missingCode = codeWords.filter(w => !has(w));
  const agreed = has('agree') || has('agreed');
  const checks = {
    name_spoken: missingName.length === 0,
    code_spoken: missingCode.length === 0,
    agreement_spoken: agreed,
  };
  const passed = checks.name_spoken && checks.code_spoken && checks.agreement_spoken;
  const problems = [];
  if (!checks.name_spoken) problems.push(`the name (${missingName.join(', ')}) wasn't heard`);
  if (!checks.code_spoken) problems.push(missingCode.length > 1 ? `the code words (${missingCode.join(', ')}) weren't heard` : `the code word (${missingCode[0]}) wasn't heard`);
  if (!checks.agreement_spoken) problems.push('the word "agree" wasn\'t heard');
  return {
    passed,
    checks,
    reason: passed ? 'Name, code and agreement were all heard.' : `Not passed: ${problems.join('; ')}. Read the full sentence again, clearly, in a quiet place.`,
  };
}

module.exports = { decide, makeCode, makePhrase, checkStatement, MAX_SPEAK_CHARS, CONSENT_TTL_MS, CLONE_WINDOW_MS };
